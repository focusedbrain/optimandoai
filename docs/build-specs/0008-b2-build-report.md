# wrdesk — B2 Build Report: Email Depackaging Cutover (docs/build-specs/0008)

**Status:** Phase 1 (worker uplift) complete and green; seam bridge + flag +
INV-7 docs landed. Phases 2–3 live-path cutover and the rig/Outlook-spike items
are **staged or environment-blocked** (see §7). Branch `feature/layered-sandbox`;
each commit leaves the branch working with the flag **OFF**.

This report follows the spec's required structure (0007 §6.5): per-phase
evidence, the verbatim detection rule list, parity corpora, mapping table, and
deviations with rationale. It is written incrementally and will be appended as
later phases land.

---

## 0. Commit ledger (this build)

| Commit | Scope |
|---|---|
| `docs(build-specs): add 0007 B2 build spec (verbatim)` | spec persisted before code |
| `feat(depackage): B2 P1.1 guest HTML->text derivation (R1) + equivalence corpus` | Phase 1.1 |
| `feat(depackage): B2 P1.2-1.5 guest email depackage (union, carrier, hardening)` | Phase 1.2–1.5 |
| `feat(seam): B2 depackage-email kind, in-process executor, flag + INV-7 docs` | seam bridge, flag, INV-7, dev-box proofs |
| `docs: B2 entrypoint audit (email ingress) + 0008 report` | Phase 3.5 audit + this report |

Each commit is conventional and self-contained; the full off-rig suite is green
at every step (flag OFF = no live-path change).

---

## 1. Phase 1 — Worker uplift (COMPLETE, off-rig)

All Phase-1 logic is pure and lives in the self-contained guest payload dir
(`electron/main/depackaging-microvm/`), so it bundles into the golden image and
is unit-testable on the dev box. **The Build-1 `depackage`/`extractMime`/
`runDepackagingJob` functions were left untouched** so the existing rig proof and
B1 invariant tests stay valid; B2 adds new modules alongside them.

### 1.1 HTML→SafeText (R1) — DONE

- `htmlToText.ts:htmlToSafeText` is a **verbatim copy** of the live
  `email/sanitizer.ts:sanitizeHtmlToText` algorithm, moved inside the key-less
  guest. Original HTML is still custody-sealed as an artifact (preserve-only,
  input to the future `view-attachment` job — no viewing designed).
- **Output-equivalence corpus** (`__tests__/htmlToText.equivalence.test.ts`,
  13 cases) asserts byte-identity guest-vs-live across the mail kinds named in
  the spec: text-only, HTML-only, multipart-alternative (HTML leg), inline
  images + tracking pixel, nested-.eml body, lists/breaks, entities, adversarial
  (script/style/event-handlers/`javascript:`), whitespace. This corpus IS the
  anti-drift guard the ruling permits in lieu of a shared import.
- **Body-derivation parity**: the worker prefers `text/plain` when present and
  derives from HTML only when no plain part exists — matching
  `gateway.ts:2485` (`bodyText = parsed.text ?? sanitizeHtmlToText(html)`).
- **Deviation (documented):** the derived text is then passed through
  `constructSafeText` → `toPlainTextField` (NFC normalize, strip C0/C1 + bidi/
  zero-width, length cap). For normal mail these are no-ops, so renderer output
  is unchanged; the only divergence from "byte-for-byte stored text as today" is
  the removal of control/format characters the renderer would not display
  anyway. This is the SafeText security discipline and is intentional.

### 1.2 Carrier extraction (R3) — DONE — verbatim rule list

The detection predicates were ported **verbatim** from `messageRouter.ts:88–149`
into `emailDepackage.ts`. The explicit rule list (R3 deliverable):

1. **`detectBeapCapsule(text)`** — `trim()` then require leading `{`; `JSON.parse`;
   object with `typeof schema_version === 'number'` AND `typeof capsule_type ===
   'string'` AND `capsule_type ∈ {initiate, accept, refresh, revoke}`.
2. **`detectBeapMessagePackage(text)`** — `trim()` then leading `{`; `JSON.parse`;
   object with `header` (object) AND `metadata` (object) AND (`envelope` OR
   `payload` present); if `header.encoding` is present it MUST be `qBEAP` or
   `pBEAP`. *(Divergence on the not-qBEAP/pBEAP branch — see §3.)*
3. **`detectBeapInJson(parsed)`** — object with (`capsule_type` AND numeric
   `schema_version`) OR (`header` object AND (`envelope` OR `payload`)).
4. **`isBeapAttachment(filename, contentType)`** — filename ends `.beap`, OR
   contentType is `application/vnd.beap+json` / `application/x-beap`.
5. **`isJsonAttachment(filename, contentType)`** — filename ends `.json`, OR
   contentType `application/json`.

**Detection order** (mirrors the live router): (1) BEAP-named/MIME attachments →
capsule then package; (2) body-text JSON → capsule then package; (3) `.json`/
`application/json` attachments → `detectBeapInJson`. Per-candidate cap of 65 536
chars matches the live router. Multi-package and mixed (text + package) cases are
handled. Extracted package bytes are the exact `trim()`med package JSON bytes,
base64-wrapped in the opaque channel.

### 1.3 Typed result union + failure taxonomy (INV-7) — DONE

`DepackageEmailResult` =
`{ok:true; type:'plain'; safeText; artifacts}` |
`{ok:true; type:'beap-carrier'; packages; carrierSafeText?; artifacts}` |
`{ok:true; type:'mixed'; packages; safeText; artifacts}` |
`{ok:false; code: DepackageFailureCode; message}`.

Failure taxonomy (each fails CLOSED with a typed code):
`E_MALFORMED_MIME`, `E_LIMITS_EXCEEDED`, `E_DECOMPRESSION_BOMB`,
`E_AMBIGUOUS_CLASSIFICATION` (incl. partial/`unknown-encoding` carrier matches),
`E_ARTIFACT_CUSTODY_FAILED`.

### 1.4 Opaque package channel (R3) — DONE

Carrier packages travel in `OpaquePackage[]` — **not** custody-sealed (qBEAP is
already ciphertext, pBEAP is public JSON). Integrity is covered by the job-result
signature. Leaves consumed as packages are excluded from the custody-sealed
artifact set (tracked by reference, so trailing-whitespace differences between
the sealed leaf and the `trim()`med package cannot cause double custody).

### 1.5 C4 hardening — DONE

- `limits.maxInputBytes` is honored inside the guest and **wins over** the
  hardcoded 8 MiB default (`min(spec, 8 MiB)`); oversized input **fails closed**
  (`E_LIMITS_EXCEEDED`) and is **never silently truncated** (the B1 `extractMime`
  truncated; the B2 path does not — aligns with INV-7).
- Nesting-depth guard (`MAX_DEPTH = 8`, bounded recursive parse), per-part decoded
  size cap, total part-count cap (256), and a transfer-decode ratio guard
  (`E_DECOMPRESSION_BOMB`, forward-looking). All fail closed in-guest; the host
  re-checks at the consumer.

**Evidence:** `__tests__/emailDepackage.test.ts` (9) + the dev-box cutover suite
`critical-jobs/__tests__/depackageEmailCutover.test.ts` (5). Full off-rig
depackaging + seam suites: **106 passed, 5 skipped** (skips are rig-only).

---

## 2. Seam bridge + flag (DONE) — the cutover mechanics

- New `CriticalJobKind 'depackage-email'` (email pipeline, `keyLocality: none`),
  opaque-input `JobInputMap` entry (`inputBytes` + optional `maxInputBytes`),
  output = `DepackageEmailResult`.
- `InProcessExecutor` runs it via `depackageEmail` on **sandbox/appliance only**;
  INV-1 bans workstation in-process for this untrusted-content kind (proven by a
  dev-box test). Resolution rows added (sandbox-free→in-process,
  sandbox-paid→microvm, appliance→microvm+in-process-fallback,
  workstation→remote-stub).
- Flag `WRDESK_SEAM_DEPACKAGE_CUTOVER` (env + persisted `seamDepackageCutover`),
  default **OFF**.
- `liveDepackageCutover.ts` adapter: dispatch-level failures AND worker typed
  failures both surface for fail-closed quarantine; it never inline-parses
  (INV-3/INV-7).
- INV-7 encoded in `critical-jobs/types.ts` invariant docs and enforced in every
  error-mapping branch of the worker + adapter.

**MicroVM execution of `depackage-email` is deliberately NOT yet advertised** by
`MicroVMExecutor` (the golden-image worker bundle still runs only the B1
`depackage` entry). Until the bundle is uplifted + rig-verified (§7), sandbox-
paid/appliance microVM routing **fails closed** — which is correct per INV-7.

---

## 3. Deviations with rationale

- **D1 — Ambiguous carrier ⇒ quarantine (INV-7 over verbatim parity, scoped).**
  The live `detectBeapMessagePackage` returned `{detected:false}` for a
  package-shaped object whose `header.encoding` was neither `qBEAP` nor `pBEAP`,
  i.e. it **fell through to plain**. INV-7 classifies that as a partially-matching
  carrier → `E_AMBIGUOUS_CLASSIFICATION` (quarantine). Likewise a `.beap`-named
  attachment that parses as neither capsule nor package is ambiguous. This is a
  deliberate, narrowly-scoped divergence (the spec lists `ambiguous-classification`
  as a failure-taxonomy entry and binds INV-7 over parity). Parity holds for all
  **unambiguous** corpus cases.
- **D2 — SafeText normalization on HTML-derived text** (see §1.1) — intentional.
- **D3 — No silent truncation of oversized input** (see §1.5) — intentional,
  INV-7-aligned.

These resolve, rather than absorb, the latent contradiction between R3's
"verbatim parity" and INV-7's "ambiguous ⇒ quarantine": **INV-7 is the escape
valve** wherever the guest parse cannot confidently reproduce a classification.

---

## 4. Quarantine mapping table (Phase 3.3 — designed; wired at the consumer)

Every dispatcher error and worker failure maps to a quarantine reason; no
unvalidated insert, no silent drop, no inline fallback while flag-on. INV-5
logging (jobId/kind/executor/duration/code only) at every touched site.

| Source | Code | Quarantine reason (typed) | Custody-sealed bytes |
|---|---|---|---|
| worker | `E_MALFORMED_MIME` | `email_depackage_malformed` | raw opaque payload |
| worker | `E_LIMITS_EXCEEDED` | `email_depackage_limits` | raw opaque payload |
| worker | `E_DECOMPRESSION_BOMB` | `email_depackage_bomb` | raw opaque payload |
| worker | `E_AMBIGUOUS_CLASSIFICATION` | `email_depackage_ambiguous` | raw opaque payload |
| worker | `E_ARTIFACT_CUSTODY_FAILED` | `email_depackage_custody` | raw opaque payload |
| dispatch | `E_NO_EXECUTOR` / `E_EXECUTOR_UNAVAILABLE` | `email_depackage_no_executor` | raw opaque payload |
| dispatch | `E_ROLE_FORBIDDEN` | `email_depackage_role_forbidden` | raw opaque payload |
| dispatch | `E_TIMEOUT` | `email_depackage_timeout` | raw opaque payload |
| dispatch | `E_UNSUPPORTED_KIND` | `email_depackage_unsupported` | raw opaque payload |
| post | `E_SIGNATURE_INVALID` (microVM only) | `email_depackage_sig` | raw opaque payload |

The consumer (Phase 3.2) seals the raw/opaque bytes via the existing
`encryptForQuarantine` + `quarantine_messages` row machinery (B1 discipline).

---

## 5. Parity strategy + corpora (Phase 3.4 — defined)

- **Flag OFF**: byte-identical — the inline path is retained verbatim; the seam is
  never constructed. Guarded by the existing full suites.
- **Flag ON, per kind**:
  - carrier mail → extracted package bytes byte-identical to today's extraction
    on the corpus; identical downstream pipeline-2 (B1) behavior.
  - plain mail → derived text equal per the R1 corpus; sealed originals added;
    renderer output unchanged (sanitized text + safe links via the existing
    `{{LINK_BUTTON:url}}` channel).
  - failures → quarantine outcomes per the §4 mapping table.
- **R1 corpus**: the 13-case equivalence corpus (§1.1). **Carrier corpus**: the
  qBEAP/pBEAP body + `.beap`/`.json` attachment cases in
  `emailDepackage.test.ts`. These are unit-level; the **full e2e per-kind parity
  on real fetched mail** is gated on Phase 2 (provider opaque retrieval) and a
  real sync, which is part of the staged work in §7.

---

## 6. INV-7 proofs landed (dev-box, in-process)

- unobtainable/limits breach → quarantine (`E_LIMITS_EXCEEDED`), never inline.
- ambiguous classification → quarantine (`E_AMBIGUOUS_CLASSIFICATION`).
- INV-1: `depackage-email` never runs in-process on `workstation` (fails closed).

The no-KVM fail-closed proof (exit criterion 4) holds structurally: with no
microVM executor available, sandbox-paid/appliance routing yields
`E_EXECUTOR_UNAVAILABLE`/`E_NO_EXECUTOR` → quarantine; it is verified end-to-end
once the microVM `depackage-email` path is wired (§7).

---

## 7. Remaining + environment-blocked work (explicit)

Per Process §8, blockers are listed verbatim before the affected phase rather
than absorbed.

### 7a. Environment-blocked (cannot be executed in this workspace)

- **Phase 0 / Exit criterion 3 — rig e2e.** Requires the mini-PC: fix the
  `/dev/vhost-vsock` ACL, rebundle `worker-bundle.cjs` with the uplifted
  `depackage-email` guest entry, and run a real fetched email through a per-action
  crosvm microVM via `dispatch()` (signature + safe-text verify, overlay nuked,
  guard instrumentation proving the orchestrator never parsed raw bytes), then a
  dated `rig/README.md` append. **This dev box has no access to the mini-PC.**
- **Phase 2 — Outlook `/$value` spike (R2).** Requires a real Outlook/Graph test
  account + network. Per R2 a negative/unavailable spike result routes Outlook to
  the **`provider-structured-json`** input (the safety net), never to inline
  parsing. **No test account is available here**, so the recommended default is to
  ship Outlook on `provider-structured-json` and run the spike when an account is
  provisioned; this changes preference order only, not feasibility.

### 7b. Staged (code designed; deferred because it needs real provider e2e to be
landed safely without risking the live email path)

- **Phase 2 — provider opaque-input + byte-courier delta.** Gmail `format=raw`
  retrieval; IMAP full-RFC822 confirm + strip fetch-layer structure walking;
  Outlook structured-json input; flag-gate every orchestrator-side parse location
  from finding A so flag-on fetch yields only an opaque payload + minimal
  out-of-MIME envelope metadata. INV-7: no obtainable opaque form ⇒ quarantine.
- **Phase 3.2 — `detectAndRouteMessage` consumer cutover.** Behind the flag,
  consume the typed union (extracted packages → B1-routed pipeline-2; plain →
  consumer-wrap/seal/store reusing `depackaged_json`), with the §4 mapping table
  and INV-5 logging. The inline path is retained verbatim flag-off.
- **Phase 3.4 — full e2e per-kind parity suites** on real fetched mail (depends on
  Phase 2).

### 7c. Open questions to resolve before the staged phases (from 0006, the six
not closed by R1–R3)

- **OQ (storage):** does reusing `depackaged_json` for the consumer-wrapped
  SafeText require a migration, or is the existing column sufficient? (0007 §5.2
  says "migration only if the report's storage findings require it" — needs a
  decision before Phase 3.2 insert wiring.)
- **OQ (cost/limits):** Gmail `format=raw` doubles fetch bandwidth vs `full`;
  confirm acceptable before flipping the Gmail retrieval path.

These do not block Phase 1 or the seam bridge (both landed). They are listed here
so the staged phases start from an explicit, unabsorbed baseline.
