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

---

## Build 2b — DONE (provider + proofs + safe cutover slice)

Implemented + proven on this box (2026-06-06):

- **vsock transport** — `vsock-job-server.c` (guest: accepts one AF_VSOCK conn,
  PROXIES it to `node worker-bundle.cjs` over ordinary pipes, since Node/libuv
  can't use a vsock fd as stdio) + `vsock-host-client.c` (host: the orchestrator
  is Node with no native AF_VSOCK, so `CrosvmProvider` spawns this static helper).
  The one-JSON-each-way contract is byte-identical to 2a; `guestEntry.ts` is
  unchanged. Built static by `build-golden-image.sh` into the rootfs / `~/build`.
- **Real `CrosvmProvider`** (`../crosvmProvider.ts`) — create (RO golden +
  ephemeral overlay + `--vsock`, no `--net`) → run-over-vsock → verify signature
  → nuke. Fail-loud, no in-process fallback. Paths env-overridable.
- **On-rig proofs through the real provider** (`__tests__/crosvmProvider.rig.test.ts`):
  text-purity, blind-courier, ephemerality, zero-egress (argv), legacy re-pair.
  **Perf: ~3.2s create→run→nuke.** Tests auto-skip off-rig.
- **Safe cutover slice** — `livePbeapTrust.ts` ends silent pBEAP trust on the live
  receive path (explicit recorded decision; `verified_bound` only when bound +
  verified). `depackagingService.ts` is the gated provider seam that re-validates
  `safeText` before the blind-courier record.

### What's next (deferred)

- **Full live-path cutover of qBEAP** — NOT done by design. qBEAP hybrid decrypt
  needs handshake PRIVATE keys; the decided trust model keeps keys in the
  orchestrator (inner VM holds none). The Build-1 worker is an email-MIME
  depackager, not a BEAP decryptor. Splicing the live path also needs the
  cross-machine §4 regression (mini-PC + Win Pro + relay), impossible on one box.
- **VM-identity attestation** of the guest result-signing key (until then,
  `validateSafeText` re-validation stays authoritative — already wired in the seam).
- **pBEAP Gate-5 signing-bytes canonicalization** in main → unlocks `verified_bound`.
- Interactive (inner-orchestrator) microVM + role flag; Windows hypervisor
  backends (Hyper-V / VirtualBox flush); pinned reproducible guest kernel/image.

### Re-running the VM proofs after a reboot

`/dev/vhost-vsock` loses its ACL on reboot (udev rule didn't reapply). Restore with:
`sudo setfacl -m u:$USER:rw /dev/vhost-vsock` (or re-run `host-setup-root.sh`).
`/dev/kvm` persists via its ACL. Then: `pnpm vitest run .../crosvmProvider.rig.test.ts`.

---

## Build B1 — audit + verification pass (2026-06-06)

**Finding (reported, not absorbed): the B1/B2 live-email cutover is already
implemented and committed at HEAD `8d4ea3c0`** (authored 2026-06-05, before this
session). The prompt's premise — "splice `depackagingService` behind
`WRDESK_SEAM_EMAIL_CUTOVER`" — is superseded by the real constructs already in
the tree:

- **Depackage leg (spliced):** `messageRouter.ts:326` gates ingest on
  `isSeamDepackageCutoverEnabled()` → `routeViaDepackageSeam` (`:916`) →
  `dispatchDepackageEmail` (`liveDepackageCutover.ts`, kind `depackage-email`).
  Plain mail → `writePlainSeamInbox` storing **SafeTextV1 + sealed artifacts**;
  carrier/mixed → re-enter pipeline-2 with the guest-extracted package; failures
  → `quarantineRawBytes` with mapped reason codes. Providers feed raw values
  (`gmail/outlook/imap`); `inlineParseGuard.ts` is the invariant-0 tripwire.
  Flag: **`WRDESK_SEAM_DEPACKAGE_CUTOVER`** (env + `seam-flags.json`), default OFF.
- **Validation leg (spliced):** `messageRouter.ts:612` + `beapEmailIngestion` route
  content validation through `dispatchValidateDecryptedBeap`, fail-closed
  (`seam_validation_dispatch_failed:<code>`). Flag: **`WRDESK_SEAM_VALIDATION_CUTOVER`**.
- The **SafeTextV1 plain-mail representation** (the Step-0.3 product-visible change)
  was therefore decided/committed when B2 was built; it is the existing flag-on
  behavior, not introduced by this session.

**The one genuine gap vs. the prompt's rig criteria (4.2 / 4.3):** the rig-proven
microVM never runs the LIVE `depackage-email` job. `liveDepackageCutover`'s
dispatcher wires only `in-process` + `remote-handshake` (no microVM executor);
`MicroVMExecutor` supports only Build-1 `depackage` (not `depackage-email`); and
the `JobSpec`/`JobResult` transport is Build-1-shaped (no `inputForm`/`provider`,
and the `JobResult` can't represent the `plain|carrier|mixed` union the
`guestEntry.ts:73-79` already emits). So with the depackage flag ON the live
worker runs **in-process** only. Closing this is a cross-cutting build (VM
protocol + executor + dispatcher wiring + golden-image confirm + rig proofs),
**not** a splice — DEFERRED pending a scope decision.

### Proofs run this session

**Ran green** (vitest under node, `code/`):
- `critical-jobs/**` — **112/112**. Includes the dev-box **validation parity**
  (`cutoverParity.devbox.test.ts`: seam == inline byte-identical, real validator
  subprocess) and **depackage parity** (`depackageParity.test.ts`: InProcessExecutor
  == pure worker).
- `depackaging-microvm/**` + `email/**` — **362 passed / 62 skipped**.

**Ran green ON RIG** (real crosvm, `/dev/vhost-vsock` ACL present this session):
- `dispatcher.microvm.rig.test.ts` — `dispatch()` runs **kind `depackage`** in the
  microVM, central signature + safe-text verify, overlay nuked. `executor=microvm`,
  `flushed=per-action`, ~3.5s.
- `crosvmProvider.rig.test.ts` (6) — text-purity / blind-courier / ephemerality /
  zero-egress / legacy-repair through the real VM.
- `depackagingService.test.ts` (rig) — bytes through the VM → re-validated
  safe-text + courier record.

**Skip-guarded (NOT run here)** — all gated on `better-sqlite3`, which isn't
loadable under the plain-node vitest runtime (the installed binary is built for
Electron's ABI; rebuilding it for node would disturb the Electron native module):
- `messageRouter.depackageSeam.test.ts` (7) — contains **both** the flag-ON
  in-process consumer suite **and** the flag-OFF inline-parity suite (i.e. the
  prompt's proof-#1 for the live path). `describe.skipIf(!Database)`.
- `b72DecryptedContentReseal.test.ts` (10), `mergeExtensionDepackaged.validation.test.ts`
  (4), `messageRouter.ingestTransaction.test.ts` (2 of 3).

To run the live-path DB parity, run these under Electron's runtime (or rebuild
better-sqlite3 for node) — an environment change kept out of this verification pass.

---

## 2026-06-06 — Build B1 close-out: microVM executes the LIVE `depackage-email` job

The "one genuine gap" above (microVM never runs the live `depackage-email`) is
**CLOSED**. The flag-gated email path can now route the typed email worker into
the rig-proven crosvm microVM end-to-end, with the SAME verification discipline
the B1 `depackage` kind already enjoys. No invariants relaxed.

### What changed (the right way, not a shim)

- **Signed email result (transport integrity), uniform across executors.** The
  `depackage-email` worker emits a typed `plain | beap-carrier | mixed` union (or
  a typed failure). It is now SIGNED in-guest exactly like `runDepackagingJob`
  signs the B1 result: `emailDepackage.runDepackageEmailJob()` runs the worker +
  signs with a per-job Ed25519 key. BOTH the guest entry (`rig/guestEntry.ts`)
  and the in-process executor call it, so every result — whichever executor — is
  signed, and the dispatcher verifies it uniformly. The signed wire shape is
  `DepackageEmailJobResult` (`hypervisorProvider.ts`).
- **Canonical bytes over the union.** `canonicalDepackageEmailResultBytes` commits
  to the variant `type`, each safe-text, per-artifact ciphertext digests,
  per-package byte digests, and the display/threading metadata (bytes HASHED, not
  embedded — mirrors `canonicalJobResultBytes`). A recursive key-sort
  (`stableStringify`) makes guest-sign and host-verify byte-identical.
  - **Determinism bug found + fixed on the rig:** `JSON.stringify` DROPS
    `undefined`-valued keys on the wire (e.g. an absent `DisplayEnvelope.from`,
    or a sealed artifact with no `filename`), but the first serializer emitted
    them as `null` → guest/host bytes diverged → signature failed → live job
    `ok:false`. Fixed `stableStringify` to omit `undefined` keys exactly as JSON
    does. Locked down off-rig by `__tests__/emailResultSigning.test.ts` (sign →
    JSON round-trip → verify, incl. undefined-laden envelopes + a tamper case).
- **Transport carries the routing discriminators.** `JobSpec` gained optional
  `inputForm` / `provider`; `CrosvmProvider.runJob` sends `kind` + (for email)
  `inputForm` / `provider` / `maxInputBytes`, parses the email-result variant, and
  verifies its signature before returning. `runJob` now returns
  `JobResult | DepackageEmailJobResult` (a plain `Promise<JobResult>` is still
  assignable, so the depackage path / fakes are untouched).
- **Executor + dispatcher.** `MicroVMExecutor.supports('depackage-email')` and
  maps spec→`JobSpec`→signed result→`CriticalJobResult`. The dispatcher's central
  post-verify now branches by kind: `verifyDepackageEmailResult` checks the
  signature AND re-validates **every** safe-text against the closed schema
  (`validateSafeText`), replacing the worker's claimed value; a signed worker
  failure passes through for the consumer to quarantine. `SAFE_TEXT_OUTPUT_KINDS`
  now includes `depackage-email`, so no executor can skip it.
- **Live wiring + fail-closed.** `liveDepackageCutover` now registers the crosvm
  `MicroVMExecutor` (config from env / `~/build/rig` defaults). Its
  `isAvailable()` probes the host, so on a box without crosvm/kvm/vhost-vsock/
  golden image, paid/`exec=microvm` routing fails closed with `E_NO_EXECUTOR` —
  NEVER an in-process fallback for an untrusted-content kind.

### Golden image

Rebuilt with the signing guest bundle. **Kernel-pin caveat (PROVISIONING.md):**
the host kernel had been point-upgraded `6.17.0-29 → -35`; an unpinned rebuild
staged `-35` vsock/overlay modules against the committed `-29` `vmlinuz`, so
`insmod` failed in-guest and every job hit a vsock **connect timeout**. Rebuilt
with `KREL=6.17.0-29-generic` (matches `vmlinuz`); booting + vsock restored.
Bundle sha `bf7eb844…`; smoke test (`smokeTest.mjs`) green for all three parse
paths and now asserts the in-guest signature on each.

### Proofs run this session

**Ran green** (vitest under node, `code/`, full trees together):
- `critical-jobs/**` + `depackaging-microvm/**` + `email/**` —
  **482 passed / 62 skipped**, 0 failed. Includes the new
  `emailResultSigning.test.ts` (5) wire round-trip + tamper guard, and the
  existing dev-box cutover/parity suites unchanged.

**Ran green ON RIG** (real crosvm, `/dev/kvm` + `/dev/vhost-vsock` ACLs present):
- **4.2 — live `depackage-email` in the microVM** (`dispatcher.microvm.email.rig.test.ts`):
  - plain mail → `executor=microvm`, central signature + safe-text verify, typed
    `plain` union, overlay nuked (`flushed=per-action`, ~3s).
  - carrier mail → typed `beap-carrier` union; the opaque package round-trips
    byte-exact (the orchestrator never parsed it); overlay nuked.
- **4.3 — fail-closed** (same file, runs always): an unavailable microVM backend →
  paid-sandbox `depackage-email` returns `E_NO_EXECUTOR`, executor **never**
  `in-process` (untrusted bytes never parsed in the orchestrator).
- **Inline-parse guard:** each live-path assertion pins `meta.executorId ===
  'microvm'` — the only venue that parsed the bytes.
- `dispatcher.microvm.rig.test.ts` (B1 `depackage`) + `crosvmProvider.rig.test.ts`
  (6) + `depackagingService.test.ts` — still green against the rebuilt image.

**Test isolation:** the rig suites now use dedicated overlay dirs
(`overlays`, `overlays-dispatcher`, `overlays-email`) so the per-action-flush
("overlay nuked") assertions don't race across vitest's parallel file workers.

### Live-path DB parity — now PROVEN under Electron's runtime

The flag-ON/flag-OFF live email-path parity (`messageRouter.depackageSeam.test.ts`)
was the README's "proof #1" but had **never actually run** — it `skipIf(!Database)`s
under plain-`node` vitest (the `better-sqlite3` binding is electron-rebuilt to
Electron's ABI). Doing this right, without a divergent second binary: run it on the
runtime the product ships — **Electron's embedded Node** via `ELECTRON_RUN_AS_NODE`,
where that exact binary loads natively.

- New runner: `scripts/run-native-db-tests.cjs` + `pnpm test:native-db`
  (`ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --pool=forks …`).
- **Result: 7/7 green** — flag-ON: plain → sealed inbox row from guest SafeText;
  HTML-only → body in-guest + HTML sealed as artifact; carrier → proven pipeline-2
  (`email_beap`); ambiguous → quarantine with mapped reason; no opaque payload →
  HELD; no paired sandbox → HELD. flag-OFF: inline path byte-for-byte unchanged.
- Under plain `node` it still **skips cleanly** (7 skipped, 0 errors) — CI is
  unaffected.

The test had **bit-rotted while perpetually skipped**; fixing it (not the easy
path of leaving it skipped) surfaced three real staleness bugs in the harness:
1. seal binding is now source-aware — bind BOTH `'inner'` and `'outer'` (plain
   mail seals with `'outer'`);
2. `findPairedSandboxHandshake` needs a non-null `session` and
   `listAvailableInternalSandboxes` now returns `{ success, sandboxes }`;
3. `vi.mock` specifiers resolve relative to the TEST file — the `main/`-level
   modules needed `../../`, not `../` (a mismatched path silently no-ops the mock,
   so the real handshake/quarantine modules had been running), and factory state
   must be `vi.hoisted` (the mocked modules import transitively during the
   ESM-hoisted `import` of messageRouter, before plain consts initialize).

**Scope note (other `better-sqlite3`-gated suites):** running the whole `email`
tree under Electron's Node shows **305 passed / 26 failed**. The 26 are
**pre-existing and independent** of this build (a skipped test cannot have been
regressed by it): some are the SAME seal-source/mock-path rot in unrelated
subsystems (`b4P2PRelayMigration`, `b7IpcContentUpdates`, `beapInboxClonePrepareSealGate`,
`inboxSealedRead`, one of `messageRouter.ingestTransaction`), and the
`googleOAuthBuiltin.packaged` failures are Electron-runtime-sensitive (they PASS
under plain `node`). The 2 other depackage-adjacent gated files the README named
(`b72DecryptedContentReseal`, `mergeExtensionDepackaged.validation`) already pass.
Bringing the full gated suite green is a separate maintenance epic (and a global
dev-vs-test ABI decision: the repo's root `postinstall` installs a node-ABI
`better-sqlite3` for tests, which `electron-vite-project`'s `postinstall`
electron-rebuilds back to Electron ABI) — deliberately out of scope here.
