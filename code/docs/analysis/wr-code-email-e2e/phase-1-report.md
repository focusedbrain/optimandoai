# WR Code / Public Handshake — Email E2E Slice
## Phase 1 report — Baseline Code, Channel Provenance Record, trust-signal hygiene

| | |
|---|---|
| Branch | `refactor/wr-code-email-e2e-phase-1` |
| Baseline | `188c3278` |
| Build items | 1 (Baseline Code), 2 (CPR), trust-signal hygiene (G4-1, G4-3) |
| New tests | 124, all green |
| Do-not-regress | Clean — identical failure set before and after |

The agent did not build or run the desktop app or the extension. Everything
below is verified by headless unit and integration tests.

---

## 1. What was built

### 1A — Baseline Code module (build item 1)

`packages/ingestion-core/src/wrCode.ts`, exported through the package
`index.ts` beside the registries.

The §5 block of `WR-Code_Check-Profile_Registry-Material_v1.4.md` is
transcribed **verbatim**: `ALPHABET`, `normalize`, `computeCheck`,
`verifyCheck` (including the ≥ 12 length guard), `parseStructure`, and the
`mulAlpha` / `star` / `fold` internals. Pure functions, no I/O, fully
offline-capable per §XVI.15.1.

Two thin wrappers sit **outside** the transcribed block so the block stays
byte-identical to the published profile:

- `captureBaselineCode` — the fail-closed capture entry point. Normalize,
  verify, parse; on any failure it returns a typed reason and no code.
- `formatBaselineCodeForDisplay` — local rendering only, reference grouping
  `PPPPPP-LLLLL-C` (O3). It renders from a validated identifier, never from
  captured input.

The pairing-code normalizers were deliberately **not** consolidated into this
module — a different identifier class (P11 carve-out).

**Transcription guard** (`wrCode.profileTranscription.guard.test.ts`) reads the
published §5 block out of the spec document and asserts the module's
transcribed section is byte-identical to it, then asserts the section contains
no `import`, `fetch`, `process`, `Date.`, `Math.random`, or `globalThis`, and
the whole module no `require`, `node:`, or `process.env`. Offline-capability is
therefore a tested property, not a convention.

**Conformance suite** (`wrCode.conformance.test.ts`), all seven classes of
v1.4 §6:

| Class | What is asserted |
|---|---|
| 1. Table / closed-form | The 32×32 quasigroup table is parsed out of the spec and reproduced by the implementation; Latin-square property; both total-anti-symmetry conditions over all 32³ = 32,768 triples |
| 2. Vectors | Every §4.1 and §4.2 vector; the D3 no-prefix-semantics pair (`WR7X4K9B2M3P` and `WR7X4K9B2M3ZJ` both valid, distinct) |
| 3. Exhaustive negatives | 2,697 single-symbol substitutions and 59 adjacent transpositions of unequal neighbours, generated from all seven base codes — 0 missed |
| 4. Normalization | Every §4.3 row, including the `oIl3456789am` map-then-check-fail case and the `U` rejection |
| 5. Rejection before resolution | Spy resolver: 0 invocations across every invalid capture, exactly 1 on a valid capture |
| 6. Structure from length | 12 / 13 / 14 parse; 11 rejected |
| 7. Length-error bounds | Insertions: exactly one survivor **per position** (asserted per position, not aggregate). Minimum-length deletions: exactly 0. Extended-code deletions: the two exact per-code anchors plus the sampled ±4σ assertion, σ = √(N·(1/32)·(31/32)) at N = 200,000; every survivor parses as a structurally valid but *different* identifier |

The suite recovers the quasigroup operation `star` from the public API rather
than re-implementing the algebra, so it cannot agree with a copied mistake. No
point values and no sub-200k bands are encoded anywhere.

### 1B — Channel Provenance Record (build item 2)

**Type** — `packages/ingestion-core/src/channelProvenance.ts`, modelled on the
art50 `aiProvenance` package but **without** its verbatim-preservation slot:

- scheme discriminant `optirando-cpr/1`, producer version, `evaluated_at`;
- content binding: hex SHA-256 of the message the verdict describes;
- SPF / DKIM / DMARC each as `pass | fail | none | unverifiable` plus an
  alignment flag;
- `channel_pass`, the D5 aggregate (DKIM aligned-pass OR SPF aligned-pass);
- `authenticated_sender_domain`, derived from the evaluation and null whenever
  nothing was authenticated — never copied from a display header;
- `discovery_record`, tri-state, `not_evaluated` until Phase 3.

No raw `Authentication-Results`, no raw headers, no signatures. Those stay with
the original artifact; the record carries typed verdicts only, so nothing
downstream can re-parse attacker-controlled text out of it.

`decodeChannelProvenanceRecord` fails closed — an unknown scheme, a missing
field, or a malformed verdict yields null rather than a partially-trusted
record. `ratchetChannelProvenance` merges two records so that friction only
ever increases: a later evaluation can turn a pass into a fail, never the
reverse, and a disagreement about the authenticated domain collapses it to
null.

**Producer** — `apps/electron-vite-project/electron/main/email/channelProvenanceProducer.ts`
is the single place a CPR is created, merged into metadata, and evidenced.
A record is produced for **every** processed message on **both** paths:

- **flag on (guest job)** — header handling stays in the guest.
  `displayEnvelope.ts` collects `Authentication-Results` values under explicit
  count and length caps, `emailDepackage.ts` returns them as typed
  `ChannelAuthenticationMaterial` on the depackage result, and
  `providerStructuredWalker.ts` does the same from Outlook Graph's
  `internetMessageHeaders`. The host evaluates; the guest never renders a
  verdict.
- **flag off (inline)** — `mapToRawEmailMessage` forwards whatever the provider
  surfaced through `SanitizedMessageDetail.headers.authenticationResults`.

Where no material exists the verdict is `unverifiable`, which is a real verdict
and fails closed. A message with **no** CPR would be indistinguishable from one
that skipped the producer, so that state does not exist.

**Persistence** — the record is merged into
`inbox_messages.depackaged_metadata` beside `pbeap_trust` and the merged blob
is passed to `computeSeal` as bound metadata, so a post-write edit of either
verdict is detected at read time as `metadata_hash_mismatch`.

**Evidence** — `recordChannelProvenanceEvidence` appends one metadata-only
record per message to `wr_evidence_chain` (§IX.11) as a **BER**: a message
crossing the ingress boundary is a boundary event, and the CPR is the verdict
at that crossing. This makes Phase 1 the chain's first BER writer. The payload
carries identifiers, digests, and typed verdicts — no subject, no body, no
address beyond the domain the channel actually authenticated.
`quarantine_messages` has no metadata column, so for quarantined mail the
evidence chain is the only retention point; it is written there too.

### 1C — Trust-signal hygiene

1. **`InputCoordinator.evaluateEventTagConditions`** — the placeholder now
   fails closed. A configured `sender_whitelist` evaluates to `passed = false`,
   because that surface's `classifiedInput` carries inline-chat and OCR text and
   has no sender address field at all. The `default:` branch was also flipped to
   fail closed, matching `EventTagMatcher`: a condition type this build cannot
   evaluate is one it cannot honour. `EventTagMatcher` was already fail-closed
   and is left alone; its behaviour is now pinned by tests so it stays that way.

2. **`wrcode_valid` is retired outright** (see §4, correction 1). The concept it
   named does not exist, so disabling the control was not sufficient. Removed:
   the `WRCodeCondition` type and union member, the `EventTagConditionType`
   variant, `NormalizedEvent.wrcodeValid` / `.wrcodeData`, `evaluateWRCode` and
   both `case` branches, the schema enum value, the vestigial `wrcodeMatch`
   trigger field, and the checkbox itself. The "Source & Security" section now
   states that SPF/DKIM/DMARC run automatically on every incoming message and
   are mandatory, so a reader learns why there is nothing to switch on.

   `conditions/retiredConditions.ts` strips the condition from stored agent
   configurations at every read boundary — `InputCoordinator`, `EventTagMatcher`,
   and `TriggerMigration`. This is deliberate rather than incidental: with the
   `default:` branch now failing closed, a stale entry left in place would
   silently kill triggers that were never actually gated on anything. Dropping
   it is not a downgrade, because nothing ever produced the verdict it read.

3. **`ingressCaptureMethodForOffer`** returns `null` instead of defaulting to
   `'assisted_email'`, and `prepareFormationConsent` refuses with
   `INGRESS_PATH_HAS_NO_CAPTURE_METHOD:<path>` before writing anything. The
   capture method is evidence of how the user actually received the invitation,
   so an unmapped path must fail the consent rather than attest to an email
   capture that never happened.

---

## 2. Exit criteria

| Criterion | Status | Evidence |
|---|---|---|
| Full conformance suite green (all seven classes) | ✅ | `wrCode.conformance.test.ts` + `wrCode.profileTranscription.guard.test.ts` — 49 tests |
| CPR emitted and persisted for every message in the existing message-router test rigs, both flag paths | ✅ | `channelProvenancePersistence.regression.test.ts` — 12 tests covering inline plain, seam plain, seam carrier (beside `pbeap_trust`), and quarantine |
| CPR present in the evidence log | ✅ | Same suite: one BER per message, chain verifies end-to-end, payload contains no subject / body / signature bytes |
| All three hygiene items fail closed with guard tests | ✅ | `trustSignalHygiene.guard.test.ts` (12), `ingressCaptureMethodFailClosed.guard.test.ts` (7) |
| Do-not-regress against the `188c3278` pre-existing set | ✅ | Section 3 |

Supporting invariants also pinned by the new suites: the persisted metadata
contains no raw header material; the verdict is bound into the seal (a forged
upgrade of `channel_pass` is rejected on read with `metadata_hash_mismatch`);
D5's DKIM-only pass under SPF-breaking forwarding; every
`Authentication-Results` hop is read, not just the first.

---

## 3. Do-not-regress comparison

Both runs used `pnpm test:native-db` (the Electron ABI runner) on the full
workspace. This matters: under plain `node`, the ~77 SQLite-bound suites skip
via `describe.skipIf`, so a baseline captured that way silently hides their
results and cannot be compared against a run that executes them.

| | Baseline `188c3278` | With Phase 1 |
|---|---|---|
| Test files | 537 | 543 (+6) |
| Tests | 5,210 | 5,334 (+124) |
| Passed | 5,001 | 5,125 (+124) |
| Failed | 159 | 159 |
| Skipped / todo | 21 | 21 |
| Suite-load failures | 77 | 77 |

**New failures: 0. Resolved failures: 0.** The failing-test identity sets are
identical.

The 77 suite-load failures are the environment condition named in the master
brief. In this environment they surface as
`Failed to load url ../../../../../packages/shared/src/aiProvenance`, reached
transitively through `email/providers/zoho.ts`. Native modules were not rebuilt
and no test was modified to work around it.

That path was subsequently found to be a genuine defect rather than a resolver
quirk, and is fixed (§4, correction 2).

One pre-existing failure is worth naming because it sits in code this phase
touched and could be mistaken for a regression:

> `messageRouter.ingestTransaction.test.ts :: ingests two attachments with the
> same provider id when they belong to different inbox rows` —
> `SealKeyNotBoundError: Seal key provider for source 'outer' is not bound`.

The test binds only the default (inner) key provider while the plain-email path
has always sealed with the `outer` key. Verified against the baseline
`messageRouter.ts` in isolation: it fails there too. It was invisible until the
suite actually executed under the Electron ABI. Not fixed here — out of scope.

---

## 4. Corrections after review

Two items were changed after the phase was first reported, on the author's
decision. Both are recorded here because they alter what §1 delivered.

**Correction 1 — `wrcode_valid` retired instead of disabled.** The order's item
1C.2 asked for the checkbox to be disabled "until a real verdict exists". Review
established that the premise was wrong: no such verdict will ever exist at that
point, because channel provenance and publisher resolution are mandatory,
structural pipeline stages. Per Phase 2A the CPR is computed *before* Step-1
detection and a failing `channel_pass` short-circuits all WR parsing and code
extraction, so a provenance-failed message yields no code and no affordance at
all. There is consequently no class of "WRCode-stamped email" that a per-trigger
checkbox could opt into, and copy promising the option "later" was as untrue as
the copy it replaced.

Four independent findings confirmed the condition could never have functioned:
`NormalizedEvent.wrcodeValid` had no producer anywhere; `EventTagMatcher.evaluate`
has no production caller; `routeEventTagTrigger` is fed `classifiedInput` whose
sources are inline chat and OCR, never mail; and the control was rendered only
for `channel === 'email'`, the one channel that never reaches this router.

A future condition over the Channel Provenance Record would be a *different*
condition reading a verdict the pipeline actually produces, not a rename of this
one. It is out of scope until the email→automation bridge exists.

**Correction 2 — `zoho.ts` provenance import depth.** `email/providers/zoho.ts`
imported `../../../../../packages/shared/src/aiProvenance` with five levels where
its three peers in the same directory (`gmail.ts`, `outlook.ts`, `imap.ts`)
correctly use six. Pre-existing, and the cause of both the 77 suite-load failures
above and the `pnpm session:build` failure. Fixed to six.

---

## 5. Observations recorded, not implemented

Per the no-scope-creep rule, these were found while working the phase's items
and are reported rather than changed.

1. **`ingressMappingForSource` retains the same `'assisted_email'` default** for
   unmapped *source types* (`formationPipeline.ts`), and its totality is an
   asserted property of an existing acceptance test ("Q4 mapping is total: every
   transport source resolves to a recordable pair"). The order named the
   offer-side resolver only. The fabrication is not removed, it is moved
   upstream: an unknown source type still yields `beap_invitation`, which then
   maps legitimately to `assisted_email`. Worth a decision before Phase 5 makes
   `assisted_email` a truthful capture method with a live producer.

2. **`wr_code_public` is a registered, recordable ingress path with no entry in
   `SOURCE_INGRESS_MAP`.** It is now the fixture for the 1C fail-closed test.
   Phase 5 will need to add its mapping (and `wr_code_red`) when the email→offer
   path is reconnected, otherwise WR-Code captures fail consent by design.

3. **`sender_whitelist` copy in the trigger editor** ("Only emails from these
   addresses will be processed") is accurate for `EventTagMatcher`, which does
   perform the check against `event.senderAddress`, but not for the
   `InputCoordinator` surface, which now fails the condition closed. The copy was
   left unchanged because the order scoped item 2 to the WRCode control.

4. **Phase 1 alignment is strict domain equality.** Relaxed (organizational)
   DMARC alignment is deliberately not implemented — strict is the fail-closed
   direction, and Phase 3 owns alignment against the resolved publisher's bound
   origin set (3C), which is also what activates the Discovery Record field.

No spec conflicts were encountered between Annex XVI v1.2, Annex IX v2.0, and
the check profile v1.4 while implementing this phase.

---

## 5. Files

**New**

```
packages/ingestion-core/src/wrCode.ts
packages/ingestion-core/src/channelProvenance.ts
packages/ingestion-core/__tests__/wrCode.conformance.test.ts
packages/ingestion-core/__tests__/wrCode.profileTranscription.guard.test.ts
packages/ingestion-core/__tests__/channelProvenance.test.ts
apps/electron-vite-project/electron/main/email/channelProvenanceProducer.ts
apps/electron-vite-project/electron/main/email/__tests__/channelProvenancePersistence.regression.test.ts
apps/electron-vite-project/electron/main/handshake/__tests__/ingressCaptureMethodFailClosed.guard.test.ts
apps/extension-chromium/src/tests/trustSignalHygiene.guard.test.ts
```

**Modified**

```
packages/ingestion-core/src/index.ts                                  exports
apps/electron-vite-project/electron/main/email/messageRouter.ts       CPR production, persistence, evidence
apps/electron-vite-project/electron/main/email/syncOrchestrator.ts    forwards Authentication-Results
apps/electron-vite-project/electron/main/email/types.ts               SanitizedMessageDetail.headers
apps/electron-vite-project/electron/main/depackaging-microvm/displayEnvelope.ts        in-guest collection + caps
apps/electron-vite-project/electron/main/depackaging-microvm/depackageModel.ts         ParseOut.channelAuthentication
apps/electron-vite-project/electron/main/depackaging-microvm/emailDepackage.ts         result plumbing
apps/electron-vite-project/electron/main/depackaging-microvm/providerStructuredWalker.ts  Graph headers
apps/electron-vite-project/electron/main/handshake/formationPipeline.ts                capture-method fail-closed
apps/extension-chromium/src/services/InputCoordinator.ts              conditions fail closed
apps/extension-chromium/src/content-script.tsx                        WRCode control removed + honest copy
apps/extension-chromium/src/automation/types.ts                       WRCodeCondition removed
apps/extension-chromium/src/automation/conditions/EventTagMatcher.ts  evaluateWRCode removed
apps/extension-chromium/src/automation/adapters/TriggerMigration.ts   strips retired conditions
apps/extension-chromium/schemas/agent.schema.json                     enum + wrcodeMatch removed
apps/electron-vite-project/electron/main/email/providers/zoho.ts      import depth fixed
```

**Commit dependency** — `docs/spec/WR-Code_Check-Profile_Registry-Material_v1.4.md`
is currently untracked. The transcription guard reads it and asserts its
presence, so it must be committed alongside this branch or that test fails on a
clean checkout.

---

## 6. Ready for Phase 2

Phase 2 builds directly on what landed here:

- **2A** moves the CPR computation ahead of Step-1 detection — the producer is
  already called at "Step 0" in `detectAndRouteMessageInline`, so 2A adds the
  short-circuit on a failing `channel_pass` plus the ordering guard tests, and
  closes the `!sandboxHandshake` fail-open.
- **2B** consumes `channelAlertRequired`, which already implements the §IX.3.1
  rule 8 trigger (DKIM **and** DMARC absent or unverifiable) and is unit-tested.
- **2C** attaches the record as a typed input to local scam analysis.

The author builds and tests on the two-machine rig before Phase 2 begins.
