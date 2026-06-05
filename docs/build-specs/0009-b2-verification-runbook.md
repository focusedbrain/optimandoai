# wrdesk — B2 Verification Runbook (docs/build-specs/0009)

**Status ruling:** B2 is **code-complete, not accepted**. Exit criteria 2–4 of
spec 0007 are unmet (rig e2e, real-mail parity, Outlook spike, no-KVM
fail-closed). No invariant-0 claim may be made or written anywhere yet. Per INV-7,
`WRDESK_SEAM_DEPACKAGE_CUTOVER` stays **OFF on every machine, dev included**, until
the V-series below passes. B1's validation-cutover soak is unaffected and
continues.

Execute the runbook later (mini-PC session + provider-account session); check off
**in order**; record evidence per step in `0011-b2-verification-report.md`.

---

## V0 — Preconditions

`git pull` on the rig; branch + HEAD sanity; confirm both flags' states (B1 cutover
ON for soak is fine; B2 depackage flag OFF). Confirm `worker-bundle.cjs` on disk
matches the bundle built from this branch (B2.1/D6 uplift = Phase 1 + D4):

```
sha256(rig/dist/worker-bundle.cjs) = cb04ae5150daee06fb8d27d776492421445fb444354c14ac85fed37b0155eead
```

Regenerate + verify with:

```
node apps/electron-vite-project/electron/main/depackaging-microvm/rig/buildWorkerBundle.mjs
sha256sum apps/electron-vite-project/electron/main/depackaging-microvm/rig/dist/worker-bundle.cjs
```

The bundle is a reproducible build artifact (git-ignored); the hash above is the
authoritative reference for V0. If it differs, rebuild before proceeding.

> **Golden-image refresh (B2.1/D6):** the rig golden image embeds the worker
> bundle. Before V1/V2/V3 runs, refresh it with the B2.1 bundle (hash above):
> rebuild via `buildWorkerBundle.mjs`, copy `rig/dist/worker-bundle.cjs` into the
> rootfs alongside the node binary, and re-verify the in-image hash matches. The
> pre-B2.1 image only contains the B1 worker and will NOT exercise the email path.

## V1 — Rig Phase 0 (carried-forward prerequisite)

Fix the `/dev/vhost-vsock` ACL (persistent udev rule or group membership, not a
chmod that dies on reboot — document which). Then run the deferred Build A proof: a
`depackage` job through `dispatcher.dispatch()` → MicroVMExecutor → crosvm, with
signature + safe-text verification in `verify.ts` passing and the overlay confirmed
nuked. Dated append to `rig/README.md`.

## V2 — Phase 1 guest re-verify on the rig

Run the worker-uplift corpus (HTML-derivation equivalence, carrier extraction incl.
multi-package/mixed, failure taxonomy incl. `ambiguous-classification`, C4 guards:
maxInputBytes honored over the 8 MiB hardcode, nesting depth, per-part size,
decompression ratio) through the actual microVM, not just the bare-Node bundle.

## V3 — Rig e2e email proof (exit criterion 3)

With a live IMAP test account configured on the rig orchestrator, flag ON,
role=sandbox, exec=microvm: a real fetched email is depackaged in a per-action
crosvm microVM via `dispatch()`; the guard instrumentation proves the orchestrator
never parsed the raw bytes; overlay nuked; sealed insert + UI notification normal.
Dated `rig/README.md` append: **invariant-0 closed for the sandbox+microvm
configuration on the email path** — the first machine-verified instance of the
product's core security claim. Run at least: one plain-text mail, one HTML-only
mail (R1 path), one carrier mail (extracted package handed to the B1-routed
pipeline-2 path), one malformed/limit-breaching mail (→ quarantine, INV-7).

## V4 — Real-mail parity suites (exit criterion 2; provider accounts)

Per provider (IMAP, Gmail `format=raw`, Outlook structured-json): per-kind parity
from spec 0007 §5.4 — carrier mail: extracted packages byte-identical to today's
extraction; plain mail: derived text equal per the R1 corpus, sealed originals
added, renderer output unchanged; failures: quarantine outcomes per mapping table.
Flag-on vs flag-off on the same fixture set.

> Prerequisite (0008 D4): the `provider-structured-json` guest walker **is now
> built** (B2.1, report `0012`): Outlook no longer HELDs by design — flag-on it
> ships the Graph message resource opaque and the guest walker depackages it. The
> Outlook leg of V4 can run against the structured-json path.

## V5 — Outlook `/$value` spike (timeboxed)

Fidelity corpus vs structured payload on a real account: attachments (binary,
large), encodings (8-bit, quoted-printable, base64, non-UTF-8 charsets), large
messages, throttling behavior. PASS → flip Outlook preference to `/$value` in a
small commit recorded in 0011. FAIL or AMBIGUOUS → preference stays structured-json
permanently-until-revisited; record findings. Either way the invariant holds; this
step never reopens inline parsing.

> The raw path is already implemented and binary-safe (`5c463ae`) and gated behind
> `WRDESK_OUTLOOK_OPAQUE_INPUT=value` (`7fdf34a`); the spike toggles it on for
> measurement only.
>
> **Dual-fetch instrument (B2.1/D4.4):** the strongest Outlook fidelity check is
> not `/$value` vs the provider parse, but the **dual-fetch equivalence**: fetch
> the same live message BOTH ways (`/$value` → rfc822 worker; Graph JSON →
> structured-json walker) and require the depackage results to match — same
> derived text, byte-identical extracted packages, same artifacts, same failure
> outcomes — exactly as the off-rig equivalence corpus
> (`providerStructuredWalker.equivalence.test.ts`) asserts on synthetic pairs.
> Agreement on real messages is the spike's PASS signal for either path; a
> disagreement localizes the fidelity gap to one form before any preference flip.

## V6 — Fail-closed proof (exit criterion 4)

On a no-KVM box (the Windows machine's sandbox VM without nested virt is fine):
flag ON, exec=microvm forced → every test mail quarantines per the mapping table;
the inline path is provably never entered; nothing inserts unvalidated.

## V7 — Acceptance

All of V1–V6 green → B2 is ACCEPTED: write `0011` with evidence per step, update
the README index, and only then decide per-provider flag enablement and soak. Until
V7, B2 remains code-complete/unaccepted and the flag remains OFF.

---

## Carried forward (untouched by this closeout)

B1 default-flip + inline-path deletion after soak. `decrypt-qbeap` build (pipeline-2
isolation: key provisioning over the job channel, memory-only; zero-egress proof
for a key-loaded guest). Build C (handshake `critical_job_request|result|error`
family modeled on `internal_inference_*` + RemoteHandshakeExecutor, activating
workstation rows and the appliance topology). Fetch relocation. Build C's spec can
be drafted and even built off-rig while B2 awaits hardware — it depends on the
Build A envelope, not on B2's verification.
