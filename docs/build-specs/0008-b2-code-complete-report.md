# wrdesk — B2 Code-Complete Report: Email Depackaging Cutover (docs/build-specs/0008)

**Status: CODE-COMPLETE EXCEPT D4–D6, NOT ACCEPTED.** (Reclassified by spec `0010`:
the deviations below — D4 structured-json guest walker, D5 residual parse removal +
guard, D6 bundle uplift — are closed by the B2.1 remainder build, report `0012`.)
All B2 code (Phases 1–3 + provider byte-courier) is landed on
`feature/layered-sandbox` and the flag-off suite is green (exit criterion 1). Exit criteria **2–4 are UNMET** (rig e2e, real-mail
parity, Outlook `/$value` spike, no-KVM fail-closed) — see §8. **No invariant-0
claim is made or implied here.** Per INV-7, `WRDESK_SEAM_DEPACKAGE_CUTOVER` stays
**OFF on every machine, dev included**, until the verification runbook
(`0009-b2-verification-runbook.md`, executed into `0010-b2-verification-report.md`)
passes. B1's validation-cutover soak is unaffected.

This report follows the spec's required structure (0007 §6.5).

---

## 0. Per-phase commit map

| Commit | Phase / scope |
|---|---|
| `f93c322` | spec persisted verbatim (0007) before any code |
| `7a0074b` | **P1.1** guest HTML→text derivation (R1) + output-equivalence corpus |
| `08d18e9` | **P1.2–1.5** guest email depackage: carrier rules, typed union, opaque channel, C4 hardening |
| `db21d70` | **seam bridge**: `depackage-email` kind, in-process executor, flag, INV-7 docs, dev-box proofs |
| `75e2273` | **P3.5** `ENTRYPOINT_AUDIT.md` email ingress + initial report |
| `6984a61` | **P3.2/3.3** `detectAndRouteMessage` consumes the typed union (flag-gated) + quarantine mapping + INV-5 logging |
| `b8a9fcd` | **P2** provider byte-courier: opaque `rawRfc822` field plumbed; IMAP raw capture + Gmail `format=raw` |
| `ffcf595` | report: Phase 2 + Phase 3 consumer evidence |
| `ebdf3a2` | **P2** Outlook byte-courier via Graph `/$value` |
| `5c463ae` | Outlook `/$value` made binary-safe (8-bit MIME round-trips losslessly) |
| `7fdf34a` | **INV-7** Outlook opaque-input defaults to `provider-structured-json`; `/$value` opt-in only |

Each commit is conventional, self-contained, and leaves the branch working
flag-off.

---

## 1. Flag-off suite evidence (exit criterion 1 — MET)

Flag **off** is byte-identical: `detectAndRouteMessage` delegates to the original
body, renamed `detectAndRouteMessageInline` and left **verbatim**; the new opaque
`rawRfc822` field is unset/unused; providers populate it only when the flag is on.

- Off-rig depackaging + critical-jobs suites: **106 passed, 5 skipped** (skips are
  rig-only).
- Email + critical-jobs suites: **323 passed** (1 pre-existing slow-import flake in
  `b5ExtensionMerge §G.1`, passes in isolation; unrelated to B2).
- New consumer suite `messageRouter.depackageSeam.test.ts` (flag-off parity, plain,
  HTML-only, carrier, ambiguous→quarantine, 2× HELD) is native-`better-sqlite3`
  gated, like the existing router suite — runs in CI/Electron, skips under plain
  Node here.
- `tsc`: zero new errors in any touched file (pre-existing project errors unchanged).

> Exit criterion 1 is the only criterion this report claims as met. It is a
> flag-off claim only; it asserts nothing about the cutover behavior.

---

## 2. Verbatim carrier-detection rule list as ported (R3)

Ported **verbatim** from `messageRouter.ts:88–149` into
`depackaging-microvm/emailDepackage.ts`:

1. **`detectBeapCapsule(text)`** — `trim()`, require leading `{`, `JSON.parse`;
   object with `typeof schema_version === 'number'` AND `typeof capsule_type ===
   'string'` AND `capsule_type ∈ {initiate, accept, refresh, revoke}`.
2. **`detectBeapMessagePackage(text)`** — `trim()`, leading `{`, `JSON.parse`;
   object with `header` (object) AND `metadata` (object) AND (`envelope` OR
   `payload`); if `header.encoding` present it MUST be `qBEAP` or `pBEAP`.
   *(Not-qBEAP/pBEAP branch diverges — see §6, D1.)*
3. **`detectBeapInJson(parsed)`** — object with (`capsule_type` AND numeric
   `schema_version`) OR (`header` object AND (`envelope` OR `payload`)).
4. **`isBeapAttachment(filename, contentType)`** — filename ends `.beap`, OR
   contentType `application/vnd.beap+json` / `application/x-beap`.
5. **`isJsonAttachment(filename, contentType)`** — filename ends `.json`, OR
   contentType `application/json`.

**Detection order** (mirrors the live router): (1) BEAP-named/MIME attachments →
capsule then package; (2) body-text JSON → capsule then package; (3) `.json` /
`application/json` attachments → `detectBeapInJson`. Per-candidate cap 65 536
chars (matches the live router). Multi-package and mixed (text + package) handled.
Extracted package bytes are the exact `trim()`med package JSON, base64-wrapped in
the opaque channel.

---

## 3. Typed result union + failure taxonomy as shipped

`DepackageEmailResult` =
- `{ ok:true; type:'plain'; safeText; artifacts }`
- `{ ok:true; type:'beap-carrier'; packages; carrierSafeText?; artifacts }`
- `{ ok:true; type:'mixed'; packages; safeText; artifacts }`
- `{ ok:false; code: DepackageFailureCode; message }`

Failure taxonomy (each fails **closed** with a typed code; INV-7):
`E_MALFORMED_MIME`, `E_LIMITS_EXCEEDED`, `E_DECOMPRESSION_BOMB`,
`E_AMBIGUOUS_CLASSIFICATION` (incl. partial / `unknown-encoding` carrier matches),
`E_ARTIFACT_CUSTODY_FAILED`.

**Opaque package channel:** carrier packages travel in `OpaquePackage[]`, **not**
custody-sealed (qBEAP is ciphertext, pBEAP is public JSON); integrity is the
job-result signature. Leaves consumed as packages are excluded from the
custody-sealed artifact set (tracked by reference, so `trim()` whitespace deltas
cannot cause double custody).

---

## 4. Quarantine mapping table (as wired at the consumer)

`routeViaDepackageSeam` consumes the union; every dispatcher error and worker
failure maps to a quarantine reason — no unvalidated insert, no silent drop, no
inline fallback while flag-on (INV-3 + INV-7). INV-5 logging (ids/codes only) at
every touched site. Raw opaque bytes are custody-sealed and written to
`quarantine_messages` via the exact B1 quarantine discipline.

| Worker / dispatch code | `rejection_reason` |
|---|---|
| `E_MALFORMED_MIME` | `email_depackage_malformed` |
| `E_LIMITS_EXCEEDED` | `email_depackage_limits` |
| `E_DECOMPRESSION_BOMB` | `email_depackage_bomb` |
| `E_AMBIGUOUS_CLASSIFICATION` | `email_depackage_ambiguous` |
| `E_ARTIFACT_CUSTODY_FAILED` | `email_depackage_custody` |
| `E_SIGNATURE_INVALID` | `email_depackage_sig` |
| `E_NO_EXECUTOR` / `E_EXECUTOR_UNAVAILABLE` | `email_depackage_no_executor` |
| `E_ROLE_FORBIDDEN` | `email_depackage_role_forbidden` |
| `E_TIMEOUT` | `email_depackage_timeout` |
| `E_UNSUPPORTED_KIND` | `email_depackage_unsupported` |
| (other) | `email_depackage_other:<code>` |

**Fail-closed-without-quarantine (HELD):** no opaque payload obtainable, or no
paired sandbox custody key → `DepackageCutoverHeldError` (nothing inserted, retried
next sync; never inline-parsed, never downgraded).

---

## 5. Per-provider input wiring (as it stands)

Opaque `rawRfc822?: Buffer` threaded **provider → gateway (`sanitizeMessageDetail`)
→ `SanitizedMessageDetail` → `mapToRawEmailMessage` → router**; populated only when
the flag is on; the orchestrator never inspects it; flag-off byte-identical.

| Provider | Opaque input as wired | State |
|---|---|---|
| **IMAP** | retains the full RFC822 buffer it already fetches (`bodies: ''`) — no extra I/O | wired; pending V-series |
| **Gmail** | additional `messages.get?format=raw`, base64url-decoded; `format=full` parse still supplies envelope metadata | wired; pending V-series |
| **Outlook** | **default `provider-structured-json` (guest-side walker — NOT YET BUILT)**; `/$value` raw MIME implemented + binary-safe but opt-in only (`WRDESK_OUTLOOK_OPAQUE_INPUT=value`) per INV-7 fidelity-doubt | **default path not functional until walker built**; see §6 D4 |

Envelope metadata (from/to/date/folder/ids) continues to come from
provider-structured fields (IMAP ENVELOPE, Gmail/Graph fields), never from
orchestrator MIME-body parsing; body + carrier classification move into the guest
under the flag. **Byte-courier delta caveat:** the existing provider parse still
runs flag-on (its body output is simply not trusted/used); full removal of every
orchestrator-side parse location is deferred (see §6 D5).

---

## 6. Deviations from spec 0007 (with rationale)

- **D1 — Ambiguous carrier ⇒ quarantine (INV-7 over verbatim parity, scoped).**
  Live `detectBeapMessagePackage` fell through to *plain* for a package-shaped
  object whose `header.encoding` was neither `qBEAP` nor `pBEAP`. INV-7 classifies
  that (and a `.beap` attachment parsing as neither capsule nor package) as
  `E_AMBIGUOUS_CLASSIFICATION` → quarantine. The spec lists
  `ambiguous-classification` in the taxonomy and binds INV-7 over parity; parity
  holds for all **unambiguous** corpus cases.
- **D2 — SafeText normalization on HTML-derived text.** Derived text passes through
  `constructSafeText`/`toPlainTextField` (NFC, strip C0/C1 + bidi/zero-width, length
  cap). No-ops for normal mail (renderer output unchanged); intentional SafeText
  discipline.
- **D3 — No silent truncation of oversized input.** B1 `extractMime` truncated; the
  B2 path fails closed (`E_LIMITS_EXCEEDED`). Intentional, INV-7-aligned.
- **D4 — `provider-structured-json` guest walker NOT built (open vs spec 0007 R2).**
  R2 says the structured-json input is "implemented regardless" as the safety net;
  the B2 worker uplift built only the RFC822 parse path. Consequence: with the
  INV-7-mandated default preference, **Outlook obtains no opaque payload and the
  seam HELDs flag-on** until the walker lands. This is the conservative posture (no
  defaulting onto unproven `/$value`), but it means **V4/V5 Outlook steps cannot
  pass until the walker is built.** Flagged, not absorbed — listed as a prerequisite
  in §8 and in the 0009 runbook.
- **D5 — Byte-courier delta is partial.** Opaque capture is wired, but the existing
  orchestrator-side provider parse is not yet removed/flag-gated (its output is
  unused flag-on rather than not produced). Functionally INV-7-safe (untrusted
  structure is not consumed by the orchestrator flag-on); full parse-location
  removal is deferred to the verification phase where it can be proven by guard
  instrumentation (0009 V3).
- **D6 — MicroVM `depackage-email` not yet advertised.** `MicroVMExecutor` still
  runs only the B1 `depackage` entry; the golden-image bundle is not yet uplifted
  with the B2 guest entry. Sandbox-paid/appliance microVM routing therefore fails
  closed until the rig bundle + V2 re-verify land — correct per INV-7.

---

## 7. C4 hardening summary (guards + where enforced)

All enforced **inside the guest** (`emailDepackage.ts`), re-checked **outside** at
the consumer:

| Guard | Behavior |
|---|---|
| `limits.maxInputBytes` | honored in-guest, **wins over** the hardcoded 8 MiB (`min(spec, 8 MiB)`); oversized → `E_LIMITS_EXCEEDED`, **never silently truncated** |
| Nesting depth | `MAX_DEPTH = 8`, bounded recursive parse → fail closed |
| Per-part decoded size | cap → fail closed |
| Total part count | cap 256 → fail closed |
| Transfer-decode ratio | decompression-ratio guard → `E_DECOMPRESSION_BOMB` (forward-looking) |

---

## 8. PENDING VERIFICATION (exit criteria 2–4, verbatim from spec 0007 §6)

These are **unmet**. B2 is not accepted until all pass (runbook `0009`, evidence
`0010`). Verbatim:

> **2.** Flag on (dev box, in-process resolution): per-kind parity green; INV-7
> proofs — unobtainable-opaque → quarantine; ambiguous classification →
> quarantine; limits breach → quarantine; in no case the inline path.
>
> **3.** Rig e2e: a real fetched email depackaged in a per-action crosvm microVM
> via `dispatch()`; guard instrumentation proving the orchestrator never parsed the
> raw bytes; overlay nuked; sealed insert + UI notification normal. Dated
> `rig/README.md` append: invariant-0 closed for the sandbox+microvm configuration
> on the email path.
>
> **4.** Fail-closed on a no-KVM box with exec=microvm: quarantine per mapping,
> never inline (INV-3/INV-7).

**Verification prerequisites surfaced by this build:**
- D6 — uplift + rebundle `worker-bundle.cjs` with the B2 guest entry (gates V2/V3).
- D4 — build the `provider-structured-json` guest walker (gates V4/V5 for Outlook).
- D5 — remove/flag-gate residual orchestrator-side parse locations + add the guard
  instrumentation that V3 asserts.

Until §8 is fully green (runbook V7), B2 remains code-complete/unaccepted and
`WRDESK_SEAM_DEPACKAGE_CUTOVER` remains OFF on every machine.
