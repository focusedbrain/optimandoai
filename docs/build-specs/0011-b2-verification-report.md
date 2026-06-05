# wrdesk — B2 Verification Report (docs/build-specs/0011)

Evidence log for the hardware verification session driving the V-series runbook
(`0009`) and, if both machines are available, the W-series (`0019`). Append-only,
per step: timestamp, exact commands, relevant output, pass/fail against the
runbook's criteria.

**Session machine:** mini-PC (rig). **Session date:** 2026-06-05 (CEST).

> **SESSION VERDICT: STOPPED AT PRE-FLIGHT.** The V0 worker-bundle sha256 does not
> match the `0009` reference, and `crosvm` is not installed on this machine. Per
> the session ground rule ("if the checkout is stale or the hash mismatches, stop
> and report before anything else"), **no V step (V1–V7) and no W step was run.**
> No code was changed; no flags were changed (depackage cutover remains OFF
> everywhere); no topology was configured. B2 status is unchanged:
> **code-complete, NOT accepted.** Two numbered fix specs are needed before this
> session can be re-attempted (see §Remaining).

---

## Pre-flight

**Timestamp:** 2026-06-05T20:04Z.

### Branch / HEAD / Build C merge

```
$ git branch --show-current
feature/layered-sandbox
$ git log --oneline -1
2f55e4f2 docs(build-specs): mark Build C landed + merged by O (2026-06-05)
$ git pull --ff-only
Already up to date.
$ git merge-base --is-ancestor 3f2dbe44 HEAD && echo present
present                      # Build C merge commit 3f2dbe44 is in HEAD
```

Branch `feature/layered-sandbox` at `2f55e4f2`; contains the Build C merge
`3f2dbe44` (parents `1b5d3217` + `40163828`). Pull clean. **PASS** (checkout is
current).

### V0 — worker bundle sha256 — **FAIL (hash mismatch)**

```
$ node apps/electron-vite-project/electron/main/depackaging-microvm/rig/buildWorkerBundle.mjs
[buildWorkerBundle] wrote rig/dist/worker-bundle.cjs
$ sha256sum .../rig/dist/worker-bundle.cjs
9cfcdb866e867e101e411ec384ed0fe8ee8b50095bd865aff487845f52a9c787   (rebuilt on this rig, HEAD 2f55e4f2)
```

| | sha256 |
|---|---|
| **0009 V0 reference** | `f7310ffdb081275921de5c692923ea94fb880d5da21d4def47264d13bc22b6d7` |
| **Rebuilt here (HEAD)** | `9cfcdb866e867e101e411ec384ed0fe8ee8b50095bd865aff487845f52a9c787` |

The reference does **not** reproduce, even after a fresh rebuild from this branch.
The runbook's "rebuild before proceeding" does not resolve it, so the divergence is
in the source/toolchain, not a stale artifact on disk.

#### Root-cause investigation (read-only; no changes made)

1. **It is NOT Build C's weak-key fix changing the guest payload.** The only Build C
   commit touching the guest-bundled directory is `2ec29b14` (0020 §2 weak-key
   hardening), and it only edits `verifyJobResultSignature` in
   `depackaging-microvm/hypervisorProvider.ts` — an **orchestrator-side** function.
   The guest entry (`rig/guestEntry.ts`) imports only `runDepackagingJob`,
   `depackageEmail`/`depackageEmailStructured`, and a **type-only** `JobSpec`. The
   guard symbol is absent from the rebuilt bundle:
   ```
   $ rg -c "isWeakEd25519PublicKey" .../dist/worker-bundle.cjs        → 0
   $ rg -c "verifyJobResultSignature" .../dist/worker-bundle.cjs      → 0
   ```
   `verifyJobResultSignature` (and its new import) are tree-shaken out of the guest
   payload. Build C does not alter the guest bundle.

2. **A worktree built at the Build C base `1b5d3217` also did not match `f7310ffd`.**
   Built in a throwaway `git worktree` (since removed) with a symlinked
   `node_modules`: hash `4aed3524…`. The byte difference vs the HEAD bundle is
   **purely esbuild's environment-relative module-path comments**
   (`// node_modules/@noble/...` at HEAD vs `// ../../../home/.../node_modules/@noble/...`
   through the symlink) — first differing byte at offset 1314 / line 28, inside the
   bundled `@noble/hashes` banner comment. No absolute paths are embedded, but the
   **relative module-path comments and the baked-in dependency code/versions make
   the bundle's bytes environment-dependent**, so the hash is not hermetic across
   build environments.

   **Conclusion:** the `f7310ffd` reference was computed in a different environment
   (different `node_modules` layout and/or `@noble`/esbuild versions) from this rig.
   Toolchain here: esbuild `0.21.5`. The bundle build is **not reproducible by hash**
   across environments as currently written, so V0 cannot pass as specified.

**This is recorded as a finding, not fixed.** Re-blessing the V0 reference hash (or
making `buildWorkerBundle.mjs` produce a hermetic, environment-independent artifact
— e.g. strip path comments / pin deps / hash the source inputs instead of the
emitted bytes) is a change to the verification toolchain and belongs in a numbered
fix spec, not a mid-session fix. **V0 FAILED → V1–V7 not run** (the golden image
embeds this bundle; running the rig proofs against an un-blessed artifact would
defeat the gate).

### Hardware capability snapshot (informational — read-only, no V step executed)

Recorded to make the fix specs actionable; not a runbook step.

```
crosvm:           absent            (not on PATH)
qemu-system-x86:  absent
/dev/kvm:         crw-rw----+ root kvm   (present)
/dev/vhost-vsock: crw-rw----  root kvm   (present)
current user in 'kvm' group: NO
```

**Independent of V0:** `crosvm` is not installed, so V1–V3 (rig Phase 0 + guest
re-verify + e2e through a crosvm microVM) **cannot run on this machine as-is** even
once the bundle hash is reconciled. `/dev/kvm` and `/dev/vhost-vsock` exist but are
`root:kvm 0660` and the session user is not in `kvm`; V1's named env fix (persistent
vhost-vsock ACL via group/udev) would be needed — but it is moot until `crosvm` is
installed.

---

## Step status

| Step | Status | Note |
|------|--------|------|
| Pre-flight: branch/HEAD/merge | PASS | `feature/layered-sandbox` @ `2f55e4f2`, contains Build C merge `3f2dbe44` |
| **V0** worker-bundle hash | **FAILED** | rebuilt `9cfcdb86…` ≠ reference `f7310ffd…`; bundle not hash-reproducible across environments (esbuild path comments + baked deps); reference computed elsewhere. **Gate — blocks V1–V7.** |
| V1 rig Phase 0 (crosvm) | NOT RUN | blocked by V0; also blocked: `crosvm` absent + user not in `kvm` group |
| V2 guest re-verify | NOT RUN | blocked by V0 + crosvm absent |
| V3 rig e2e email | NOT RUN | blocked by V0 + crosvm absent; also requires a live IMAP account (not configured) |
| V4 real-mail parity | NOT RUN | blocked by V0; requires provider accounts |
| V5 Outlook `/$value` spike | NOT RUN | blocked by V0; requires a live Outlook account |
| V6 no-KVM fail-closed | NOT RUN | PENDING-WINDOWS: Windows sandbox VM not contacted this session |
| V7 acceptance | NOT RUN | cannot declare — V-series did not run |
| W1–W4 (W-series `0019`) | NOT RUN | requires both machines paired with linked topology; not established this session |

## Invariant-0 claim status

**Not claimable.** No machine-verified instance was produced this session (V3 did not
run). The unqualified invariant-0 claim remains unearned. No invariant-0 claim has
been written anywhere.

## Flags & topology end-state (verified)

- `WRDESK_SEAM_DEPACKAGE_CUTOVER`: **OFF** everywhere (no flag was set this session;
  `featureFlags.ts` defaults OFF; no `seam-flags.json` written).
- `WRDESK_SEAM_VALIDATION_CUTOVER` (B1 soak): untouched by this session.
- Linked topology: **none configured** (no `orchestrator-mode.json`, no
  `WRDESK_TOPOLOGY_LINKED`, no `--topology-linked` argv). No-topology state intact.

## Remaining for B2 acceptance

1. **FIX-SPEC A — V0 bundle reproducibility.** Decide how to make the V0 gate
   pass: either (a) make `buildWorkerBundle.mjs` produce a hermetic artifact (strip
   esbuild module-path comments, pin/vendor `@noble/*` + esbuild, or hash the source
   inputs rather than emitted bytes), then bless a new reference hash; or (b)
   re-bless `f7310ffd` → the current environment's hash with a documented note that
   the only delta from the B2.2 bundle is toolchain/path, not guest logic (the
   weak-key guard is tree-shaken and not in the guest payload). Until then V0 cannot
   pass.
2. **FIX-SPEC B — rig provisioning.** Install `crosvm` on the rig and add the
   session user to `kvm` (or a persistent udev rule for `/dev/vhost-vsock`), so
   V1–V3 can execute. (Env provisioning, not a code change.)
3. **Accounts** — V3/V4/V5 need live IMAP / Gmail / Outlook test accounts on the
   rig. BLOCKED-ON-ACCOUNTS until provided.
4. **Windows machine** — V6 (no-KVM fail-closed) PENDING-WINDOWS.
5. **W-series (`0019`)** — both machines paired; not attempted this session.

B2 stays **code-complete, NOT accepted**. Build C remains landed + inert (no
topology). Nothing in this session changes either status.
