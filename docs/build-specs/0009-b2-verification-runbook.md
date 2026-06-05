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
ON for soak is fine; B2 depackage flag OFF).

> **V0 upgraded to REPRODUCIBLE-BUILD VERIFICATION (FIX-SPEC A, spec `0021`).**
> Re-blessing a hash on hardware was rejected as risk routing. The
> `worker-bundle.cjs` is now a **committed reproducible reference artifact**; the
> check is **rebuild-and-diff**, not a typed-in hash. The committed bundle is the
> reference, and `buildWorkerBundle.mjs` is hermetic (esbuild version pinned +
> asserted, module-path banners stripped, no sourcemap, fixed target/charset, LF).

**Canonical V0 procedure (on the verification machine):**

```
# 1. Clean checkout for the guest sources:
git status --porcelain -- apps/electron-vite-project/electron/main/depackaging-microvm   # must be empty
# 2. Pinned toolchain from the lockfile (repo is pnpm; this is the `npm ci` equivalent):
pnpm install --frozen-lockfile
# 3. Rebuild (run from the code/ directory so input paths are stable):
node apps/electron-vite-project/electron/main/depackaging-microvm/rig/buildWorkerBundle.mjs
# 4. Byte-for-byte diff against the committed reference:
git diff --exit-code -- apps/electron-vite-project/electron/main/depackaging-microvm/rig/dist/
```

Step 4 must show **no diff** (exit 0). Any diff → **STOP and report; never
re-bless.** Use `dist/worker-bundle.provenance.json` (sha256 of every bundled
input, lockfile hash, esbuild version, script hash) to localize the cause.

```
sha256(rig/dist/worker-bundle.cjs) = 68374091f7bf5683d33dc7a41e64a027b1ddb39bba3d60b0877f4899b07cc177
```

> This hash is informational provenance for the committed artifact (set by
> spec `0021`). The authoritative V0 gate is the rebuild-and-diff above — the
> committed bytes are the reference, not the hash string.
>
> **Superseded references (do not use):** the pre-hermetic B2.2 hash
> `f7310ffd…` and the B2.1/D6 hash `cb04ae51…` were environment-dependent (esbuild
> module-path banners + un-pinned deps) and are not reproducible across machines;
> `0021` replaced the bless-a-hash model with this rebuild-and-diff.

> **Golden-image refresh:** the rig golden image embeds the worker bundle. Before
> V1/V2/V3 runs, refresh it with the **committed reference bundle**: run the
> canonical V0 procedure above (rebuild-and-diff must be clean), copy
> `rig/dist/worker-bundle.cjs` into the rootfs alongside the node binary, and
> re-verify the in-image bytes match the committed `rig/dist/worker-bundle.cjs`
> (`cmp`). An image built on an older bundle (pre-B2.2 `cb04ae51…` lacks the
> in-guest envelope/threading derivation; pre-hermetic `f7310ffd…`) will fail
> V3/V4's envelope-parity legs — refresh before running.

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
Dated `rig/README.md` append: **invariant-0 closed (UNQUALIFIED) for the
sandbox+microvm configuration on the email path** — body, classification, AND
headers are parsed only in-guest; the orchestrator retains no header parse flag-on
(B2.2 removed the last one). This is the first machine-verified instance of the
product's core security claim with no exceptions. Run at least: one plain-text
mail, one HTML-only mail (R1 path), one carrier mail (extracted package handed to
the B1-routed pipeline-2 path), one malformed/limit-breaching mail (→ quarantine,
INV-7), and one encoded-word-subject + degraded-header mail (→ guest-decoded
envelope, degraded field marked, message still processed — display degradation,
not risk routing, per spec 0013 §1.2).

## V4 — Real-mail parity suites (exit criterion 2; provider accounts)

Per provider (IMAP, Gmail `format=raw`, Outlook structured-json): per-kind parity
from spec 0007 §5.4 — carrier mail: extracted packages byte-identical to today's
extraction; plain mail: derived text equal per the R1 corpus, sealed originals
added, renderer output unchanged; failures: quarantine outcomes per mapping table.
Flag-on vs flag-off on the same fixture set.

> **Envelope-parity legs (B2.2, per provider):** on the well-formed corpus the
> flag-on inbox envelope (subject/from/to/cc/date) — now derived in-guest — must
> equal today's flag-off parsed envelope. Corpus must include: encoded-word
> subjects (B64 + QP, multiple charsets), address lists with quoted-comma display
> names, and malformed/oversized headers (→ degraded placeholder + `degradedFields`
> marker, message still processed). Threading legs: IMAP `imap_rfc_message_id`
> equals the guest-derived `threadingHints.messageId` (no orchestrator parse);
> Gmail keys on `threadId`, Outlook on `conversationId` (provider-native). The
> off-rig dual-form equivalence corpus
> (`providerStructuredWalker.equivalence.test.ts`) already asserts RFC822==Graph
> for envelope + threading on synthetic pairs; V4 confirms on real mail.

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
