# Rig provisioning — fresh Ubuntu → verification-ready (FIX-SPEC B, docs/build-specs/0021)

Deterministic bring-up for the depackaging-microvm rig (bare-metal AMD Ryzen,
Ubuntu 24.04). Following this top-to-bottom takes a clean machine to the point
where the session user can run a real depackaging job through `CrosvmProvider`
**without sudo** and the access survives a reboot.

> **Provenance discipline (INV-7).** The hypervisor gets the same treatment as the
> guest bundle: crosvm is pinned to an exact commit and that commit is recorded in
> the report. The guest bundle is the hermetic reference artifact from FIX-SPEC A
> (`buildWorkerBundle.mjs`; V0 = rebuild-and-diff). Record every version/commit you
> actually used in `docs/build-specs/00NN-*` (the FIX-SPEC B report) and append a
> dated line to `rig/README.md`.

Legend: **[root]** needs sudo once; **[user]** runs as the session user; **[reboot]**
must survive / be verified after a real reboot.

---

## 0. Identify the machine (record in the report)

```bash
uname -r ; grep -m1 'model name' /proc/cpuinfo ; grep -c svm /proc/cpuinfo
cat /etc/os-release | head -3
```

If this is a re-provision of an existing rig, also check what survived a prior
build / a host kernel upgrade (these determine whether you BUILD or just INSTALL):

```bash
ls -ld ~/build/crosvm ~/build/crosvm/target/release/crosvm 2>&1   # surviving crosvm source/binary?
ls -lh ~/build/rig/golden-base.ext4 ~/build/rig/vmlinuz ~/build/rig/vsock-host-client 2>&1
ls -l /etc/udev/rules.d/99-wrdesk-vhost-vsock.rules 2>&1            # persistent vsock ACL rule?
id | tr ',' '\n' | grep -i kvm || echo "user NOT in kvm group"
```

---

## 1. Virtualization prerequisites [user, verify] / [root, fix]

```bash
egrep -c '(svm|vmx)' /proc/cpuinfo   # >0 = HW virt exposed; 0 => enable in BIOS, STOP
ls -l /dev/kvm                       # must exist
```

`/dev/kvm` and `/dev/vhost-vsock` are both group **`kvm`**. The durable, reboot-
surviving grant is **group membership** (preferred over per-user ACLs, which a
plain `setfacl` does not persist):

```bash
sudo usermod -aG kvm "$USER"   # [root] then LOG OUT / LOG IN (or reboot) to pick up the group
```

> A per-user ACL (`sudo setfacl -m u:$USER:rw /dev/kvm`) works for the current boot
> but does **not** survive reboot on its own. Use group membership for durability;
> reserve ACLs for the device that needs a udev rule (vhost-vsock, §3).

---

## 2. crosvm — pinned build or install [user build, root deps]

crosvm is **pinned** to a commit; record it. Build deps are installed once as root.

```bash
# [root] one-time toolchain (Debian/Ubuntu) — see host-setup-root.sh §1:
sudo apt-get update && sudo apt-get install -y --no-install-recommends \
  build-essential pkg-config clang libclang-dev libcap-dev libdbus-1-dev \
  libssl-dev protobuf-compiler cmake meson ninja-build nasm curl git ca-certificates

# [user] Rust toolchain (rustup); pin the toolchain used for the build and record it:
rustc --version    # record (rig was built with 1.96.0)

# [user] fetch crosvm at the PINNED commit, init submodules, build the minimal feature set:
CROSVM_COMMIT=938fc36e34c0122db028f4b9cd2a3477fff604f7   # record the exact commit you build
mkdir -p ~/build && cd ~/build
[ -d crosvm ] || git clone https://chromium.googlesource.com/crosvm/crosvm
cd crosvm && git fetch --all && git checkout "$CROSVM_COMMIT" && git submodule update --init --recursive
cargo build --release --no-default-features --features qcow   # avoids gpu/slirp/audio libs

# [user] install onto PATH (~/.local/bin is on PATH; no sudo, no /usr/local write):
install -m755 target/release/crosvm ~/.local/bin/crosvm
hash -r && crosvm --help >/dev/null && echo "crosvm OK ($(git rev-parse --short HEAD))"
```

> If a prior build survives (`~/build/crosvm/target/release/crosvm` exists at the
> pinned commit), skip the `cargo build` and just `install` it — but still record
> the commit. A host kernel point-upgrade does **not** invalidate the crosvm
> binary (it talks to `/dev/kvm`'s stable ABI); it only affects the guest image
> kernel/modules (§4).

---

## 3. Persistent `/dev/vhost-vsock` access [root, reboot]

vsock is the host↔guest channel (no shared FS). `/dev/vhost-vsock` is group `kvm`,
so §1's group membership already grants it — but the vhost_vsock module must be
loaded at boot and the device must exist. Make both persistent:

```bash
# [root] load vhost_vsock at boot:
echo vhost_vsock | sudo tee /etc/modules-load.d/wrdesk-vhost-vsock.conf

# [root] belt-and-suspenders ACL for the session user, applied whenever the device
# appears (survives reboot; see host-setup-root.sh). Harmless alongside group membership:
echo 'KERNEL=="vhost-vsock", RUN+="/usr/bin/setfacl -m u:'"$USER"':rw /dev/vhost-vsock"' \
  | sudo tee /etc/udev/rules.d/99-wrdesk-vhost-vsock.rules
sudo udevadm control --reload && sudo modprobe vhost_vsock && sudo udevadm trigger --name-match=vhost-vsock
```

**Verify [reboot]:** reboot, log in as the session user, and confirm BOTH:

```bash
id | tr ',' '\n' | grep -i kvm            # user is in kvm group
test -r /dev/kvm        -a -w /dev/kvm        && echo "kvm rw OK"
test -r /dev/vhost-vsock -a -w /dev/vhost-vsock && echo "vhost-vsock rw OK"
lsmod | grep -q vhost_vsock && echo "vhost_vsock loaded"
```

All four must pass with **no sudo** in the login session. If they do, §6's smoke
runs unprivileged.

---

## 4. Golden base image (RO base + Part-A bundle) [user]

The image carries a Node binary + the **committed hermetic worker bundle**
(`dist/worker-bundle.cjs`, FIX-SPEC A) + busybox + the guest-kernel-matching vsock
/ overlay `.ko` modules. It uses `mkfs.ext4 -d` (no loop-mount, **no sudo**).

> **Kernel parity (important after a host upgrade).** The image embeds a guest
> kernel image (`vmlinuz`) and `.ko` modules that **must come from the same kernel
> release** (`KREL`). `build-golden-image.sh` defaults `KREL` to the running host
> kernel but accepts an override. If the host kernel was point-upgraded since the
> guest kernel was captured (e.g. host now `6.17.0-35`, guest image built on
> `6.17.0-29`), pin `KREL` to a release whose `/boot/vmlinuz-$KREL` is readable and
> whose `/lib/modules/$KREL` is present:

```bash
cd code/apps/electron-vite-project/electron/main/depackaging-microvm/rig

# build/refresh — embeds dist/worker-bundle.cjs (rebuilt hermetically) into the rootfs:
KREL="$(uname -r)" bash build-golden-image.sh
#   …or pin to a specific readable kernel after a host upgrade:
# KREL=6.17.0-29-generic bash build-golden-image.sh

# verify the embedded bundle equals the committed reference (no mount needed):
debugfs -R "dump /opt/worker/worker-bundle.cjs /tmp/embedded.cjs" ~/build/rig/golden-base.ext4
cmp /tmp/embedded.cjs dist/worker-bundle.cjs && echo "embedded bundle == committed reference"
```

Outputs (all under `~/build/rig`, git-ignored): `golden-base.ext4` (RO base),
`vmlinuz` (guest kernel), `vsock-host-client` (host AF_VSOCK client).

---

## 5. vsock host/guest binaries [user]

`build-golden-image.sh` compiles both static C binaries as part of step 4:

- **`vsock-job-server`** → staged into the image at `/bin/vsock-job-server`; the
  guest `init` runs it to serve exactly one job over vsock into the worker bundle.
- **`vsock-host-client`** → `~/build/rig/vsock-host-client`; the host-side client
  `CrosvmProvider` spawns (Node has no native `AF_VSOCK`). Override its path via
  `CrosvmProviderConfig` if you move it.

Confirm:

```bash
debugfs -R "stat /bin/vsock-job-server" ~/build/rig/golden-base.ext4 | head -2
ls -l ~/build/rig/vsock-host-client
```

---

## 6. Readiness smoke [user, no sudo]

**Hypervisor only (KVM, no vsock)** — proves crosvm + the guest kernel boot:

```bash
cd code/apps/electron-vite-project/electron/main/depackaging-microvm/rig
KERNEL=~/build/rig/vmlinuz bash crosvm-launch.sh hello   # expect "HELLO-CROSVM guest is up", exit 0
```

**Full job through the channel (KVM + vsock)** — the actual readiness bar:

```bash
# manual boot reserving the vsock channel:
bash crosvm-launch.sh worker
# …then a trivial job through CrosvmProvider (host side), which spawns
# vsock-host-client and frames the guestEntry IN/OUT JSON one object per connection.
```

The `worker` boot fails closed with
`failed to open virtual socket device /dev/vhost-vsock: Permission denied`
if §3 is incomplete — that is the signal the operator steps still need doing, not
a crosvm fault.

---

## Done criteria

- crosvm on PATH at the **recorded** pinned commit; `hello` boots, exit 0.
- Golden image embeds the **committed** worker bundle (verified by `cmp`).
- Post-reboot login: `kvm` group + `/dev/kvm` rw + `/dev/vhost-vsock` rw, **no sudo**.
- A trivial job runs through `CrosvmProvider` over vsock in that unprivileged session.
- `rig/README.md` has a dated append recording the (re)provisioning + crosvm commit.
