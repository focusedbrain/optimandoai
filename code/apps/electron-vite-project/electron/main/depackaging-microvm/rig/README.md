# Build 2a — crosvm bring-up (rig runbook)

**Gating spike. Run on the mini-PC (bare-metal AMD Ryzen Linux).** Its only job:
get crosvm booting a minimal guest, assemble a golden image that carries the
Build-1 depackaging worker, and **report the host↔guest I/O mechanism** so
Build 2b (`CrosvmProvider` + invariant proofs + orchestrator cutover) is written
against discovered facts, not guesses.

> **Provenance:** this directory was authored on the **Windows dev box**, which
> cannot run crosvm/KVM. So §1–§4 below are **not yet executed on the rig** —
> they are the turnkey procedure to run there. The one platform-agnostic piece
> (the worker bundle + bare-Node smoke) **is** verified off-rig; see "Verified
> here" below. Trust the machine over this doc; correct it with real results.

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

## §5 — Deliverables checklist (fill in on the rig)

1. Prereqs: SVM ☐, `/dev/kvm` ☐, kernel/distro ☐ (or the exact fix).
2. crosvm installed + trivial guest boots ☐ — method, version, boot time, args.
3. Golden image boots worker; RO-base + ephemeral-overlay proven ☐ — steps recorded here.
4. ★ Host↔guest I/O channel chosen + round-trip proven + no-shared-FS + zero-egress ☐.
5. **Build 2b readiness paragraph** ☐ (below).
6. Commit results/edits on `feature/layered-sandbox`.

---

## §6 — What Build 2b picks up (do NOT do in 2a)

`CrosvmProvider`'s real create→run→nuke lifecycle, the vsock wiring on the host
side, the §6 invariant proofs (text-purity / blind-courier on the rig), and the
orchestrator/live-path cutover. **invariant-0 (orchestrator still parses
untrusted bytes) stays true until 2b's cutover.** Don't touch the live path here.
