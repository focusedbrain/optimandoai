# WR Code / Public Handshake — Email E2E Slice
## Refactor Order v1.0 — Master Brief + Phase Orders 1–5

This order starts the implementation phase. It is the sole work instruction
for the runtime repo; the FINAL Delta Re-Verification Report v2.1 is its
analysis basis and is not re-litigated here. Each phase section below is a
standalone order: complete the phase, write the phase report, stop; the
author builds and tests on the two-machine rig before the next phase begins.

---

# 00 — Master Brief

## Objective
Implement the email E2E slice of the Public Handshake per Annex XVI v1.2 and
Annex IX v2.0: a Baseline Code embedded in an authenticated email is
captured, locally validated, resolved, publisher-validated, surfaced as a
Connect offer showing publisher + verified domain + entry, and consented —
with the failure path (unauthenticated mail → unsuppressible alert, no
derived affordance, manual entry on the same surface) equally complete.

## Authoritative inputs (in precedence order on conflict; conflicts are
reported, never resolved by the agent)
1. Annex XVI v1.2 and Annex IX v2.0 (normative spec).
2. `WR-Code_Check-Profile_Registry-Material_v1.4.md` (the check profile;
   its §5 is implemented verbatim).
3. The FINAL Delta Re-Verification Report v2.1 (evidence pointers, build
   items, amendments).
4. This order.
5. Registry API Contract v1.0 — required from Phase 3 only; delivered
   separately before Phase 3 starts.

## Decision register — FIXED, not overridable
- **D1**: Crockford Base32 + Damm order-32 per check profile v1.4; check
  derivation k = A(interim); length guard ≥ 12 is part of the profile.
- **D3**: a longer local part is a distinct identifier/entry; prefixes carry
  no resolution semantics; check recomputed over the full extended form.
- **D4**: transitions `active ↔ inactive`; `revoked`/`superseded`/
  `compromised` terminal; publisher authoritative via registry; cache
  demotion per §XVI.15.3.
- **D5**: provenance pass = DMARC-style alignment (DKIM aligned-pass OR SPF
  aligned-pass); DKIM-only suffices under SPF-breaking forwarding; any fail
  routes to the manual-entry path, never a degraded offer.
- **D6**: `dnsVerification`/`tierSteps` untouched; publisher resolution
  introduces a new per-publisher resolved record.
- **O2**: `resolution_mode` (and entry context) inside the preview hash and
  the consent record.
- **O3**: local code renderer is on-request; NEVER rendered for a message
  whose provenance failed.
- **O6**: entry status is authoritative and re-validated at consent time;
  the 7-day offer timeout is UI staleness only.
- **O7**: alias model — the Baseline Code resolves to an internal entry
  identifier; internal identifiers never surface in capture paths.
- **CPR contract**: typed, bounded verdict fields only; raw headers and
  signatures never cross the depackaging boundary; Discovery Record input
  is tri-state (present-and-consistent / present-and-inconsistent /
  not-evaluated); produced for EVERY processed message; retained in the
  evidence log (§IX.11); ratchet discipline — verdicts only ever increase
  friction, never upgrade trust or pre-satisfy consent.
- **Alert contract** (§IX.3.1 r8): never-dismissible; identical styling and
  verdict semantics on every channel-consequential surface; trigger = DKIM
  AND DMARC absent or unverifiable; copy states unverifiability, not
  maliciousness, and includes that links and codes carried in the message
  have no verified origin; policy may escalate, never remove.
- **Failure-path reading (IX↔XVI)**: derived affordances from
  provenance-failed mail are mandatorily suppressed; manual entry on the
  same surface is the only downgrade; "connect anyway" does not exist.
- **Pairing codes**: a distinct identifier class (deliberate P11 carve-out);
  the Baseline Code assignment ledger MUST NOT copy the DELETE-then-INSERT
  pattern.
- **Registry**: a real service from day one — no interim semantics, no
  code == domain equivalence, no hardcoded publisher anywhere. Any
  DNS-verified domain can register; test publishers are registration DATA.
  Default placement: standalone service (author-overridable until Phase 3
  starts; the client-side contract is identical either way).

## Invariants to preserve (regressions here fail the phase)
Fail-closed offer suppression ("no connect anyway"); no auto-execute or
auto-navigation from any ingest/parse/resolution path; P12 — received
renderings are never displayed, every shown visual is locally generated
from validated data; layer discipline (capture/transport never trigger
trust/consent/execution). New invariants introduced by this order are
pinned with source-walking guard tests (the `ingressPathLogOnly` /
`beapInboxUxSourceRegressions` / `art50Remediation` technique).

## Working discipline
- Branches: `refactor/wr-code-email-e2e-phase-<N>`; one phase per branch.
- Per-phase report: `docs/analysis/wr-code-email-e2e/phase-<N>-report.md`
  with exit-criteria table and do-not-regress comparison against the
  pre-existing failure set at baseline `188c3278` (which includes the
  better-sqlite3 ABI mismatch on SQLite-bound suites in agent
  environments — do not rebuild native modules to work around it; note
  skipped suites in the report).
- The agent does not build or run the desktop app or extension; the author
  builds and tests on the two-machine rig. Agent-side verification is unit
  and integration tests runnable headlessly.
- English everywhere, including code comments and UI copy.
- No scope creep: anything discovered outside the phase's items is recorded
  in the report, not implemented. Spec conflicts are named, never decided.

## Phase map
| Phase | Build items | Prerequisite |
|---|---|---|
| 1 | 1 (Baseline Code), 2 (CPR), trust-signal hygiene (G4-1, G4-3) | none |
| 2 | 3 (provenance gates parsing + fail-open closure), 12 (alert), 13 (scam input) | Phase 1 |
| 3 | 4 (hardened client), 5 (registry client + dual-channel), 6 (alignment) | Registry API Contract v1.0 |
| 4 | 7 (entry lifecycle), 8 (offer schema + consent) | Phase 3 |
| 5 | 9 (email→offer path), 10 (offer UI + renderer), 11 (manual entry) — E2E | Phase 4 |

The registry SERVICE is a parallel deliverable outside this repo (like
wr-connect.php), built against the same contract; it is not part of any
phase here.

---

# 01 — Phase 1: Baseline Code, Channel Provenance Record, trust-signal hygiene

## 1A — Baseline Code module (build item 1)
New module `packages/ingestion-core/src/wrCode.ts`, exported through the
package `index.ts` beside the registries. Implement check profile v1.4 §5
**verbatim**: `ALPHABET`, `normalize`, `computeCheck`, `verifyCheck`
(including the ≥ 12 length guard), `parseStructure`. Pure functions, no
I/O, fully offline-capable (§XVI.15.1). Do not consolidate the pairing-code
normalizers into it — different identifier class.

Conformance suite (new test file beside the module), per v1.4 §6:
1. Table/closed-form regression: reproduce quasigroup + both TA conditions
   over all 32³ triples.
2. All §4.1 and §4.2 vectors; the D3 no-prefix-semantics assertion
   (`WR7X4K9B2M3P` and `WR7X4K9B2M3ZJ` both valid, distinct).
3. Exhaustive negatives generated from all seven base codes (expected
   totals: 2,697 substitutions, 59 transpositions, 0 missed).
4. Mapping/case/separator equivalence (v1.4 §4.3 rows, incl. the
   `oIl3456789am` mapping-then-check-fail case and the `U` rejection).
5. Rejection-before-resolution: spy resolver, 0 invocations across all
   invalid captures, exactly 1 on a valid capture.
6. Structure-from-length at 12/13/14; 11 rejected.
7. Length-error bounds by kind: insertions — exactly one survivor per
   position (assert per position, not aggregate); minimum-length deletions
   — exactly 0; extended-code deletions — the two exact per-code anchors,
   plus the sampled ±4σ assertion (σ = √(N·(1/32)·(31/32))) at
   N ≥ 200,000; every survivor parses as a structurally valid DIFFERENT
   identifier. Never encode point values or sub-200k bands.

## 1B — Channel Provenance Record type + producer (build item 2)
Type (suggested `packages/ingestion-core/src/channelProvenance.ts`),
modelled on the art50 `aiProvenance` package WITHOUT its verbatim-
preservation slot:
- scheme discriminant `optirando-cpr/1`; content binding
  (message hash); producer version; `evaluated_at`.
- typed verdicts for SPF, DKIM, DMARC: `pass | fail | none | unverifiable`
  plus an alignment flag each; an aggregate `channel_pass` computed per D5.
- Discovery Record field: tri-state
  `present_and_consistent | present_and_inconsistent | not_evaluated`.
- authenticated sender domain (string, from the evaluation — not the raw
  header).
- fail-closed decode (unknown scheme → null), `serializeForMime`-style
  helpers only if needed later; NO raw `Authentication-Results`, no raw
  headers, no signatures — those remain with the original artifact.

Producer: evaluate at depackaging for **every** message, on both paths —
the guest job (flag on; header parsing lives in `displayEnvelope`) and
`mapToRawEmailMessage`/inline (flag off). In Phase 1 the producer consumes
whatever authentication material the mail pipeline already surfaces
(`Authentication-Results` where the gateway provides it; else
`unverifiable`) — full evaluation fidelity is acceptance-tested in Phase 2.
Persist the CPR alongside `pbeap_trust` in
`inbox_messages.depackaged_metadata` AND retain it in the evidence log per
§IX.11. Discovery-Record evaluation itself lands in Phase 3 (needs DNS in
main); until then the field is `not_evaluated` — never fabricated.

## 1C — Trust-signal hygiene (contradictions G4-1 and the G4-3 fallback)
1. `InputCoordinator.ts` — both hardcoded placeholders (`wrcode_valid`
   ~:1348-1358 and `sender_whitelist` ~:1363-1366) fail CLOSED: a required
   condition with no real verdict evaluates to `passed = false` with an
   honest detail string. `EventTagMatcher` already fails closed — keep it.
2. The extension UI checkbox "Only accept WRCode-stamped emails" — until a
   real verdict exists, the control is disabled with copy stating the check
   is not yet available. No UI text may claim verification that no code
   performs.
3. `ingressCaptureMethodForOffer` (`formationPipeline.ts:314-319`) — remove
   the `'assisted_email'` fallback for unmatched ingress paths: fail closed
   (explicit error or `'unknown'` capture method that stageing rejects), so
   consent evidence can never fabricate an email capture.
Guard tests for all three.

## Exit criteria (Phase 1)
- Full conformance suite green (all classes above).
- CPR emitted and persisted for every message routed in the existing
  message-router test rigs, both flag paths, and present in the evidence
  log.
- All three hygiene items fail closed with guard tests.
- Do-not-regress comparison clean against the `188c3278` pre-existing set.

---

# 02 — Phase 2: Provenance gates parsing; unsuppressible alert; scam-analysis input

## 2A — Pipeline reorder + fail-open closure (build item 3; contradictions G4-2, G4-5)
- In `detectAndRouteMessageInline` and the guest job ordering
  (`emailDepackage.runDepackageEmailJob`): the CPR is computed **before**
  Step-1 BEAP/code detection. A failing `channel_pass` (per D5)
  short-circuits all WR parsing and code extraction; the message lands as a
  plain message carrying its CPR. No affordance of any kind is derived
  from it.
- Close the fail-open: the `!sandboxHandshake` branch
  (`messageRouter.ts:~721`) must never degrade a failed depackage into a
  plain inbox row — fail closed into the quarantine-equivalent path.
- New source-walking guard tests: "no parse before provenance" and "no WR
  affordance from a provenance-failed message".

## 2B — Unsuppressible provenance alert (build item 12)
New component (the art50 disclosure pattern is NOT reusable — no
acknowledgement state, no per-surface divergence):
- Trigger: DKIM AND DMARC absent or unverifiable for the message.
- Rendered with identical styling and verdict semantics on every
  channel-consequential surface: inbox message detail
  (`EmailMessageDetail` / `BeapMessageDetailPanel`), the Connect offer and
  consent preview (wired fully in Phase 5 when those surfaces exist), and
  the external-link risk dialog (`LinkWarningDialog`).
- Copy: states unverifiability, not maliciousness, and that links and codes
  carried in the message therefore have no verified origin.
- No dismiss, no acknowledge, no null state; Secure-Browse policy may
  escalate (up to blocking external-link opening from unauthenticated
  channels), never remove. Guard test: component source contains no
  dismiss/acknowledge affordance.

## 2C — CPR as typed input to local scam analysis (build item 13)
Wire the CPR as a declared, typed input to the local scam-analysis path
(verify and use the `ai_analysis_json` attachment point if suitable;
otherwise report the actual attachment point). One-directional layering,
guarded: analysis findings never suppress, soften, precede, or replace the
rule-8 alert. Conditional on the deployment operating that analysis mode.

## Exit criteria (Phase 2)
- Order guard tests green on both flag paths.
- D5 verdict logic unit-tested, including DKIM-only pass under
  SPF-breaking forwarding and full-fail routing.
- Alert renders from one shared component on the inbox and link-dialog
  surfaces; guard test proves non-dismissibility.
- Fail-open branch closed with test; quarantine path exercised.

---

# 03 — Phase 3: Resolution infrastructure
**Prerequisite: Registry API Contract v1.0 (separate document).** Confirm
registry placement (default: standalone) before starting.

## 3A — Hardened outbound HTTPS client (build item 4)
Shared module (suggested `packages/ingestion-core` or `packages/shared`):
`redirect: 'error'`, TLS floor, hard timeout, response-size cap,
private-IP/SSRF guard, JSON validation hooks. Extend the `discovery.ts`
timeout/validation/cache skeleton; do not adopt it unmodified. Used by 3B
exclusively; no `rejectUnauthorized: false` anywhere in new code.

## 3B — Registry resolution client + independent dual-channel validation (build item 5)
All in Electron main (MV3 has no DNS), exposed to the extension over the
existing loopback RPC (127.0.0.1:51248):
1. Resolution call per the Registry API Contract: canonical code →
   publisher part → registry → { domain, entry (internal id per O7),
   type, status, generation, trust-material references }. The registry
   response is treated as a CLAIM.
2. Independent validation before anything is trusted: DNS TXT
   `_wr.<domain>` via `node:dns` + fetch and Ed25519-verify the signed
   `/.well-known/wr/manifest` (@noble/ed25519, `canonicalJsonString`
   idiom). Registry is never a sole trust anchor (P3).
3. Manifest cross-check: the manifest's declared publisher part must equal
   the resolved part; mismatch = alarm, no trusted presentation.
4. Generation handling and cache demotion per §XVI.15.3; unresolved-capture
   queue state per §XVI.15.1 (captured + check-passed but not yet resolved
   is never presented as validated).
5. New per-publisher resolved record (D6) — `TierSignals`/`tierSteps`
   untouched.
6. Add the identifier-class carve-out comment in `pairingCodeRegistry`
   (deliberately outside P11; not a template for this client's caches).
Client-side stores are caches of registry state — the authoritative
append-only assignment ledger lives in the registry service, out of scope
here.

## 3C — Sender-domain ↔ publisher-domain alignment (build item 6)
Compare the CPR's authenticated sender domain against the resolved
publisher's bound origin set (§IX.3.1 r7); the result enters the CPR
alignment flags and the D5 aggregate. This also activates the CPR's
Discovery Record field (tri-state becomes evaluable).

## Exit criteria (Phase 3)
- Integration test: a test code resolves against a dev registry instance
  (or contract-faithful test double) and passes/fails dual-channel
  validation with DNS/manifest fixtures; every divergence (registry vs.
  DNS vs. manifest vs. declared part) fails closed with a distinct reason.
- SSRF/redirect/size-cap behaviour unit-tested on the client.
- No production code path reaches publisher trust without both channels.

---

# 04 — Phase 4: Entry lifecycle and offer schema

## 4A — Entry status model + per-status runtime behaviour (build item 7)
`active | inactive | revoked | superseded | compromised` (the enum finally
gets a home), driven by resolution output:
- active → offer proceeds; inactive → status surface "currently not
  offered", no offer; revoked → plain revocation display, no offer;
  superseded → supersession surfaced with successor (successor offered only
  after its own full chain), never silent redirection; compromised →
  treated as revoked PLUS the unsuppressible warning (reuse the Phase-2
  alert class).
- `expires_at` auto-transition (→ revoked default, → inactive when
  publisher-configured); never-fails-silently: every known identifier
  resolves to a status surface; unknown identifier routes to the
  capture-error path, not the status path.

## 4B — Offer schema + preview + consent (build item 8; closes toward G4-7)
- `wr_connect_offers` + `ConnectOfferRow` + `StageConnectOfferInput`:
  `wr_code_canonical`, `publisher_part`, `entry_local_part`,
  `umbrella_handshake_id`, `entry_status`, `resolution_mode`
  (`public | session_bound`), `session_bound_expires_at` — all sourced from
  resolution output, never from carrier bytes.
- Preview hash input gains `entry` (part + local + resolved context) and
  `resolution_mode`; `boundDefinition` gains `publisher_domain_verified`.
- `wr_consent_records` gains `resolution_mode`.
- Consent-time re-validation (O6): `consentToStagedOffer` re-checks the
  resolved entry status before writing consent; a mid-window transition to
  inactive/revoked/expired fails consent per 4A behaviour. The 7-day offer
  timeout remains UI staleness only.

## Exit criteria (Phase 4)
- Acceptance tests per status, including the compromised warning and the
  surfaced (never silent) supersession.
- Preview-hash coverage test: two offers differing only in
  `resolution_mode` or entry produce different hashes.
- Consent fails on mid-window status change; passes on active.

---

# 05 — Phase 5: Surfaces and E2E

## 5A — Reconnect the email→offer path (build item 9)
Route validated codes (provenance-passed per Phase 2, check-passed per
Phase 1, resolved + validated per Phase 3) from the message router into
`stageInboundInitiate`, making `assisted_email` a truthful capture method
with a live producer. Remove or explicitly retire the dead
`beapSync`/`startBeapEmailSync` path (report which). The email branch of
`SOURCE_INGRESS_MAP` becomes reachable.

## 5B — Connect-offer UI in the mail surface + local renderer (build item 10; closes G4-7)
- Offer surface beside the mail view using the existing, currently-unused
  `handshake.listConnectOffers` / `handshake.consentToOffer` IPCs; the
  rendered surface shows publisher, verified domain, offered entry, and the
  session-bound marker; `expected_preview_hash` is computed from what was
  RENDERED and passed to consent, so the pin binds the displayed surface.
- Local code renderer, on-request only (O3): generated locally from the
  validated identifier, reference grouping `PPPPPP-LLLLL-C`; structurally
  impossible to invoke for a provenance-failed message (guard test).
  Cross-device handoff interaction (voice etc.) is OUT of this slice —
  render-and-capture only; flag remaining handoff scope in the report.
- Phase-2 alert wired onto the offer and consent-preview surfaces.

## 5C — Manual entry on the same surface (build item 11)
Baseline Code input beside the mail view: normalize → check-verify →
resolve through the full chain; character-level correction assistance on
check failure; explicitly works for messages whose provenance failed
(forwarded/list mail) — the one and only downgrade path.

## Exit criteria (Phase 5) — the slice's E2E acceptance
(a) Authenticated email from a registered publisher (any DNS-verified
domain; test publishers are data): CPR pass → parse → resolve →
dual-channel validate → offer showing publisher/verified domain/entry →
consent → handshake; the consent record pins the rendered preview hash
including `resolution_mode`.
(b) Forwarded/unauthenticated message: unsuppressible alert, zero derived
affordances, visible code manually entered on the same surface completes
the full chain.
(c) Revoked / inactive / compromised / superseded / expired entries:
correct status surfaces, no offer (compromised with warning; supersession
surfaced); unknown code → capture error.
(d) All Phase 1–4 guard and regression suites still green.

---

## After Phase 5
Remaining, outside this order: the registry service deliverable (parallel,
separate), the Secure-Browse author ruling on notice-then-manual-
confirmation, the Annex XVI editorial fixes (figures and §XVI.5.5 example),
and the display-to-device handoff interaction scope.
