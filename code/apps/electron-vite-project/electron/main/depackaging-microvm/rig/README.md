# Build 2a — crosvm bring-up (rig runbook)

> **2026-06-05 — re-provisioned (FIX-SPEC B, `docs/build-specs/0021`/`0022`).** Same
> mini-PC as the 2a entries below. Host kernel point-upgraded `6.17.0-29-generic`
> → `6.17.0-35-generic`. crosvm source survived at `~/build/crosvm` (HEAD
> **`938fc36e34c0122db028f4b9cd2a3477fff604f7`**, Rust 1.96.0); the binary was
> reinstalled onto PATH (`~/.local/bin/crosvm`) and boots a guest (`crosvm-launch.sh
> hello`, exit 0). Golden image refreshed (`KREL=6.17.0-29-generic`) embedding the
> new **hermetic** worker bundle (`sha256 68374091…`; verified byte-identical
> in-image). Deterministic bring-up is now documented in **`rig/PROVISIONING.md`**.
> **OPEN (operator):** `sudo usermod -aG kvm konge` + persistent `/dev/vhost-vsock`
> access + a post-reboot unprivileged vsock smoke — until then the full `worker`
> boot fails closed on `/dev/vhost-vsock: Permission denied`.

**Gating spike. Run on the mini-PC (bare-metal AMD Ryzen Linux).** Its only job:
get crosvm booting a minimal guest, assemble a golden image that carries the
Build-1 depackaging worker, and **report the host↔guest I/O mechanism** so
Build 2b (`CrosvmProvider` + invariant proofs + orchestrator cutover) is written
against discovered facts, not guesses.

> **Provenance:** this directory was authored on the **Windows dev box**, which
> cannot run crosvm/KVM. As of Build 2a it has now been **executed end-to-end on
> the mini-PC** (bare-metal AMD Ryzen 5 3550H, Ubuntu 24.04.4, kernel
> 6.17.0-29-generic). The verified results are recorded under **"RIG RESULTS
> (Build 2a — VERIFIED)"** immediately below; the build scripts
> (`build-golden-image.sh`, `crosvm-launch.sh`, `vsock-echo.{c,sh}`) reflect the
> real crosvm CLI discovered here, not the original guesses.

---

## RIG RESULTS (Build 2a — VERIFIED on the mini-PC, 2026-06-03)

**Host:** AMD Ryzen 5 3550H · Ubuntu 24.04.4 LTS · kernel `6.17.0-29-generic` · 12 GiB RAM.

| Gate | Result |
|---|---|
| **§1 SVM / KVM** | `svm` on all 8 threads; `/dev/kvm` accessible via per-user ACL (`user:konge:rw-`). |
| **§2 crosvm built + trivial boot** | Built from source (HEAD `938fc36`, Rust 1.96.0) in **2m23s**, `--no-default-features --features qcow` (avoids gpu/slirp/audio libs). Hello-world initramfs boot→run→shutdown in **~1.5s** wall-clock. |
| **§3 golden worker image** | Reuses the **host kernel** (`VIRTIO_BLK`/`VIRTIO_CONSOLE`/`EXT4_FS`/`SERIAL_8250` are `=y`). 400 MB ext4 base = Node v22.22.0 + 77 KB `worker-bundle.cjs` + busybox + glibc + vsock/overlay `.ko`. **Worker executes in-guest** (emits a valid signed `JobResult`). Root mounts `ro`; ephemeral overlay (`/dev/vdb`) mounts rw, is **pristine on every boot** (canary proof across two boots), discarded on exit. Boot ~2.3s. |
| **§4 ★ host↔guest I/O** | **virtio-vsock works.** Host `AF_VSOCK` client ↔ guest (CID 3, port 1234) JSON echo round-trip **PASS**. **No shared filesystem** (pure socket). **Zero egress** confirmed — guest has only `lo` (no `--net` passed). |

### Key facts that change Build 2b's design

- **crosvm CLI (this build, HEAD 938fc36):** `--root` / `--rwroot` / `--rwdisk` / `--disk` / `-d` are **DEPRECATED → use `--block path=…,ro=BOOL,root=BOOL`**. `--cid` → **`--vsock <CID>`**. `--tap-*` / `--vhost-net` → `--net` (omit entirely for zero egress). There is no `--version` subarg; use the device subcommands via `crosvm --help`.
- **Guest-side vsock + overlayfs are kernel MODULES** (`=m`) in the host kernel, so the rootfs stages `vsock.ko`, `vmw_vsock_virtio_transport_common.ko`, `vmw_vsock_virtio_transport.ko` (and `overlay.ko`) and `insmod`s them in this load order. Build 2b either keeps doing this or builds a tailored guest kernel with them `=y`.
- **Recommended I/O channel for 2b: virtio-vsock**, framing the `guestEntry.ts` IN/OUT JSON one object per connection. No virtio-fs / shared folder anywhere (WSL2 coupling stays rejected).
- **Host prerequisite for vsock:** `/dev/vhost-vsock` access. On this box granted via ACL (`setfacl -m u:$USER:rw /dev/vhost-vsock`, persisted by a udev rule) — see `host-setup-root.sh`.

---

## Verified here (off-rig, Windows dev box) ✅

- The worker bundles to **one standalone JS** via `buildWorkerBundle.mjs` →
  `dist/worker-bundle.cjs` (~77 KB). `@noble/curves` is bundled in; the only
  runtime dependency is Node's built-in `crypto`. **No `node_modules`, no native
  addons, no Electron** in the guest payload.
- `smokeTest.mjs` runs that bundle under **bare Node v22.22.0** with a sample
  email job and gets a valid signed `JobResult`: `ok`, `safeText.schema ===
  'safe-text/v1'`, plain body preserved, **no plaintext leak**, one encrypted
  artifact, `result_signature_b64` present. All checks PASS.

→ **Golden-image runtime requirement is settled: a Node binary (≥18; tested v22)
+ `dist/worker-bundle.cjs`. Nothing else.** Re-run both here any time:

```bash
node electron/main/depackaging-microvm/rig/buildWorkerBundle.mjs
node electron/main/depackaging-microvm/rig/smokeTest.mjs
```

---

## §0 — Pull and orient (mini-PC)

```bash
git fetch && git checkout feature/layered-sandbox && git pull
git log --oneline -3   # expect 302f4051 (depackaging-microvm) + 136ca27f (quarantine fix)
```

Worker payload lives in `apps/electron-vite-project/electron/main/depackaging-microvm/`
(`depackagingWorker.ts`, `mimeExtract.ts`, `safeText.ts`). I/O contract is in §4.

---

## §1 — Virtualization prerequisites (verify, don't assume)

```bash
egrep -c '(svm)' /proc/cpuinfo        # >0 = AMD-V/SVM exposed; 0 => enable SVM in BIOS, STOP
ls -l /dev/kvm                        # must exist
id | tr ',' '\n' | grep -i kvm        # current user in kvm group? else: sudo usermod -aG kvm "$USER" ; re-login
uname -r ; cat /etc/os-release | head -3   # record kernel + distro
```

If SVM is 0 or `/dev/kvm` is missing/inaccessible → **that is the gate. Report
the exact fix and stop.**

---

## §2 — Install crosvm + boot a trivial guest (core gate)

**Get crosvm** (pick what's cleanest; record version + method):
- Distro package if available (`apt`/`pacman`/AUR), **or**
- Source build (Rust): `rustup` toolchain, then crosvm's documented `cargo build
  --release`. Note any libs the build demanded (e.g. `libcap`, `protobuf`,
  `pkg-config`, minijail).

```bash
crosvm --version    # record it
```

**Hello-world boot first** (isolates "crosvm works" from "my image is correct").
Need a kernel with virtio + a trivial initramfs/busybox. Then:

```bash
KERNEL=./vmlinux ./crosvm-launch.sh hello
```

Record **boot time** (crosvm's fast-boot is a design goal — report what you get).
If it won't boot, fix kernel/rootfs/args **in isolation** before §3.

---

## §3 — Golden image carrying the worker (minimal, headless)

```bash
# Builds dist/worker-bundle.cjs and stages a minimal rootfs (Alpine/buildroot)
# with a static node + the bundle + an init. Edit the script against the rig.
./build-golden-image.sh

# Boot it: RO base + ephemeral overlay, NO network.
KERNEL=./vmlinux ./crosvm-launch.sh worker
```

Confirm the guest prints `node --version` and `worker-bundle present: yes`, and
the trivial worker invocation emits JSON. **That's the §3 bar** — full job
processing is Build 2b. Prove the **RO-base + writable-overlay** layout boots and
the overlay is discardable (the launch wrapper `mktemp`s a scratch overlay and
`rm`s it on exit) — this is the ephemerality primitive 2b's nuke uses.

---

## §4 — ★ Host↔guest I/O mechanism (the headline deliverable)

Build 2b must pass untrusted bytes IN and get the sealed result OUT. **The
boundary must not be file-sharing** (virtio-fs / shared folder is the rejected
WSL2-style leak surface).

**The contract the guest already speaks** (`guestEntry.ts`), one JSON object each way:

```jsonc
// IN
{ "jobId": "…", "inputBytes_b64": "<untrusted bytes, base64>",
  "sandboxPeerX25519PubB64": "<sandbox PUBLIC key>" }
// OUT  (the JobResult)
{ "jobId":"…", "ok":true, "safeText":{…}, "artifacts":[{ "blob_id","content_type","blob":{…ciphertext…} }],
  "result_signing_pub_b64":"…", "result_signature_b64":"…" }
```

**Preferred channel: `virtio-vsock`** (host↔guest socket, no shared FS). Prove it:

```bash
# 1) Kernel/crosvm support: kernel built with CONFIG_VHOST_VSOCK; crosvm '--vsock <CID>' accepted.
#    Host needs vhost_vsock: sudo modprobe vhost_vsock
# 2) Trivial echo round-trip (enough to prove the channel):
#    - guest: socat VSOCK-LISTEN:1234,fork EXEC:'/bin/cat'   (or a tiny node net vsock listener)
#    - host : echo '{"ping":1}' | socat - VSOCK-CONNECT:<CID>:1234   ; expect it echoed back
# Record: does '--vsock' work on this crosvm build? Does the round-trip succeed?
```

If vsock is **not** cleanly available, report what crosvm *does* offer
(serial/console pipe, a constrained block device) and the tradeoffs — and flag
anything that reintroduces shared-FS coupling as a **problem**, not a solution.
(A console/serial pipe carrying the same newline-delimited JSON is an acceptable
fallback and does **not** share a filesystem.)

**Egress:** confirm the guest runs with **no outbound network** — the launch
wrapper passes no `--net`/`--tap-*`. Optionally prove from inside the guest that
there is no usable network interface.

**Report for §5.4:** the recommended channel, evidence of the round-trip, the
no-shared-FS confirmation, and zero-egress confirmation.

---

## §5 — Deliverables checklist (filled in on the rig, 2026-06-03)

1. Prereqs: SVM ☑, `/dev/kvm` ☑ (ACL), kernel `6.17.0-29-generic` / Ubuntu 24.04.4 ☑.
2. crosvm installed + trivial guest boots ☑ — source build HEAD `938fc36`, Rust 1.96.0, `--no-default-features --features qcow`, hello boot ~1.5s.
3. Golden image boots worker; RO-base + ephemeral-overlay proven ☑ — `build-golden-image.sh` + `crosvm-launch.sh worker`; canary proof across two boots.
4. ★ Host↔guest I/O channel chosen + round-trip proven + no-shared-FS + zero-egress ☑ — **virtio-vsock**, `vsock-echo.sh` PASS, guest has only `lo`.
5. **Build 2b readiness paragraph** ☑ (below).
6. Commit results/edits on `feature/layered-sandbox` ☑.

### Build 2b readiness

**Yes — the real `CrosvmProvider` can be written against the channel found here.**
All three pillars 2b needs are proven on this box: (a) **create→run→nuke** maps to
the verified RO-base ext4 + per-boot ephemeral overlay (`mktemp` + `mkfs` +
`trap rm`); the overlay is genuinely discarded (canary pristine across boots).
(b) **pass-bytes-in / get-result-out** maps to **virtio-vsock**: the round-trip is
proven, and `guestEntry.ts` already speaks the one-JSON-object-each-way contract —
2b swaps its stdin/stdout shim for a vsock listener (guest) + `AF_VSOCK` client
(host) framing the same JSON. (c) **zero egress** is the default (no `--net`;
guest shows only `lo`). **No blockers.** Carry-overs for 2b: (i) stage the
guest vsock modules (or build a kernel with them `=y`); (ii) replace the
deprecated disk/cid flags with `--block`/`--vsock` (scripts already do);
(iii) the guest's per-job Ed25519 result signing key is still unattested — VM
identity attestation remains a later build, and the orchestrator must keep
re-validating `safeText` via `validateSafeText` regardless. Note also: this spike
**reuses the host kernel** for speed; 2b may want a pinned, minimal guest kernel
for reproducibility, but it is not required for correctness.

---

## §6 — What Build 2b picks up (do NOT do in 2a)

`CrosvmProvider`'s real create→run→nuke lifecycle, the vsock wiring on the host
side, the §6 invariant proofs (text-purity / blind-courier on the rig), and the
orchestrator/live-path cutover. **invariant-0 (orchestrator still parses
untrusted bytes) stays true until 2b's cutover.** Don't touch the live path here.
