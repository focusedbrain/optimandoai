# wrdesk — FIX-SPEC A+B: Hermetic Worker Bundle + Rig Provisioning (docs/build-specs/0021)

**Type:** Build (A: off-rig tooling; B: rig-local provisioning). Commit as the next free number (`0021` expected) and update the README index. Both parts must be green before the V-series rerun. No seam/email-path/flag changes anywhere in this spec.

---

## Part A — Hermetic worker bundle (FIX-SPEC A)

**Ruling (binding):** re-blessing the hash is rejected as risk routing. V0 is upgraded to **reproducible-build verification**: the canonical build procedure, executed on the verification machine, must reproduce the committed `worker-bundle.cjs` **byte-for-byte**. The committed bundle is the reference artifact; the hash in `0009` V0 becomes the hash of the committed bundle, and the check becomes rebuild-and-diff.

1. **Determinize `buildWorkerBundle.mjs`:** strip esbuild's module-path comments from the output (post-process if no flag covers them); disable/normalize anything environment-dependent (sourcemaps off or path-normalized, fixed `target`, no absolute paths, stable module order); toolchain pinned via the lockfile (`npm ci`, never `npm install`, in the canonical procedure) with the esbuild version asserted by the script (fail loudly on mismatch, INV-7).
2. **Canonical procedure documented in the script header and `0009` V0:** clean checkout state required (`git status` clean for the guest-source paths), `npm ci`, run the script, `cmp` against the committed bundle. Any diff → STOP, report; never re-bless.
3. **Provenance fallback (belt and suspenders):** the build script also emits a `worker-bundle.provenance.json` — sha256 of every input source file, the lockfile hash, esbuild version, script hash — committed next to the bundle. If byte-reproducibility ever breaks on some future toolchain, provenance comparison localizes the cause instead of inviting a re-bless.
4. **Proofs:** two consecutive rebuilds on the dev box are byte-identical; a rebuild after touching one guest source file produces a diff (the check actually detects change); bare-Node smoke of all three parse paths on the rebuilt bundle; commit the deterministic bundle + provenance, update `0009` V0 wording and the reference hash once, with this spec cited as the reason.

## Part B — Rig provisioning (FIX-SPEC B)

1. **Answer the history question first and record it in the report:** is this machine the Build 2a rig (per `rig/README.md`: crosvm built, golden image verified)? Check for prior build artifacts (`~/crosvm`, `/usr/local/bin/crosvm`, the golden image path the README names, the vsock C binaries). Reinstalled machine, different machine, or lost user-dir build — say which; it determines whether the README's historical entries describe this hardware.
2. **Create `rig/PROVISIONING.md`** — deterministic bring-up from fresh Ubuntu to verification-ready, covering: crosvm (build or install, with the exact version/commit recorded — the hypervisor gets the same provenance discipline as the guest bundle); `kvm` group membership AND the persistent `/dev/vhost-vsock` udev rule (both, reboot-surviving, verified after a real reboot); golden base image build/refresh procedure including embedding the Part-A bundle; compilation + placement of `vsock-host-client` and `vsock-job-server`; a final smoke command that proves readiness (a trivial job through `CrosvmProvider`).
3. **Execute it on this rig** top to bottom — the document is only done when the machine it describes was provisioned by following it. Record versions/commits in the report.
4. **Proofs:** post-reboot, the session user can run the smoke job without sudo; `rig/README.md` gets a dated append noting the (re)provisioning and the crosvm provenance.

## Out of scope
The V-series itself (rerun is a new session once A+B are green and the IMAP account exists — O's action item); W-series; accounts setup; any change to guest logic, seam code, or flags.

## Report
Next number after this spec: Part A determinism evidence (double-build identity, change-detection), the updated V0 wording, Part B history answer, provenance table (crosvm/esbuild/image), reboot-survival proof, deviations reported not absorbed.
