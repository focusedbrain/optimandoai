# WR Code / Public Handshake — Email E2E Slice
## Phase 5 report — Surfaces and E2E (final phase)

| | |
|---|---|
| Branch | `integration/consolidated-current` |
| Baseline | `cd282eaf` |
| Build items | 9 (email→offer), 10 (offer UI + local renderer), 11 (manual entry) + delta v1.1 Phase-5 additions |
| New tests | 25 across 2 files, all green |
| Do-not-regress | **Clean** — 166 = 166 by identity, 0 new, 0 repaired |
| Captures | committed: `captures/phase-5.before.cd282eaf.txt`, `captures/phase-5.after.txt` |

No app build, no app start. Everything below is verified headlessly against the
contract-faithful double. **What that does and does not cover is set out in §6**
— it is the most important section of this report.

---

## 1. 5A — Email→offer path

### The `ingressMappingForSource` carry-over, ruled

Phase 1 recorded that unmapped transport sources defaulted to
`beap_invitation` / `assisted_email`, and flagged it as needing a decision
"before Phase 5 makes `assisted_email` a truthful capture method with a live
producer". That is this phase, so the default is gone.

A silent default would now attest that the user received something *by assisted
email* when in fact nobody knows how they received it — a fabrication about how
consent was obtained, recorded in consent evidence. Unmapped sources now resolve
to an explicit `unmapped_transport_source` pair which deliberately matches no
entry in `SOURCE_INGRESS_MAP`, so `ingressCaptureMethodForOffer` returns null
and consent fails closed.

Totality is preserved: the acceptance test asserting every transport source
resolves to a recordable pair still passes. The pair is simply honest now.

WR-code sources gained their own registered ingress paths (`wr_code_public`,
`wr_code_red`), closing Phase-1 observation 2.

### `beapSync` / `startBeapEmailSync` — RETIRED, not removed

Reporting which, as the order requires. `startBeapEmailSync` has **zero
callers** and has had none for the whole slice; the live path is
`syncOrchestrator` → `messageRouter`, which is where Phase 2 put the provenance
gate.

Retired in place with the reason recorded rather than deleted, because the
module still exports `setEmailFunctions`, which `main.ts` uses — deleting the
file is a wider change than this phase's scope. The comment states why it must
stay dead: a second, ungated ingest path would bypass the CPR gate entirely,
which is the fail-open Phase 2 closed.

### Bound-origin-set plurality

Delivered in Phase 3 as a set-shaped API (`PublisherBoundOriginSet`), and 5A is
where it is exercised: `applyPublisherDomainAlignment` takes the set and matches
on label boundaries, so `evil-example.com` does not match origin `example.com`.
The resolved record still carries one dual-channel-validated domain — a
multi-origin publisher needs a contract field, which remains open (§7).

## 2. 5B — Offer presentation and the local renderer

`electron/main/wrc/offerPresentation.ts` builds the projection; it renders
nothing. The rule lives inside the builder for the same reason the rule-8 alert
owns its trigger: a per-surface predicate is how "never show carrier text"
degrades into "usually does not show carrier text".

**A2 / EVP-first-render is enforced structurally.** The projection's value
statement and self-description come from the verified `WrcEvp` object. There is
no input through which an email body could supply either. No verified EVP ⇒
typed refusal `no_verified_evp` — **there is no branch that assembles a partial
offer**, which is what "no degraded offer" has to mean to be worth anything.

**A4 audit link** is built only when both the base and the object hash are
known, and is carried on the presentation for both the offer and the consent
preview.

**O3 local renderer** regenerates the `PPPPPP-LLLLL-C` grouping from the
validated canonical identifier via `formatBaselineCodeForDisplay`. A received
rendering is never displayed (P12); passing anything that is not a validated
identifier returns null, so there is no path from carrier bytes to a rendered
code.

**Phase-2 alert on offer and consent preview**: the shared component and its
`channelProvenanceAlertRecordFromUnknown` extractor are the same ones the mail
surfaces use — one rule, one projection.

## 3. 5C — Manual entry

Manual entry works because `captureBaselineCode` never consults provenance:
normalize → check-verify → resolve, with a typed failure reason
(`check_failed`) that character-level correction assistance can act on. That
independence is precisely what makes it the one and only downgrade path for a
message whose channel failed, and it is asserted directly in the acceptance
suite rather than left implied.

## 4. Delta v1.1 Phase-5 additions

- **EVP-first-render** — §2.
- **Audit link on offer and consent preview** — §2.
- **Consent-time re-validation incl. CatalogHead recheck** —
  `recheckCatalogHeadForConsent` distinguishes four outcomes rather than one
  "stale" verdict: a **rollback** is an attack shape and refuses as one; a
  **suspension** observed at consent refuses; a **stale** head blocks a new
  admission; and a **new epoch** is not a failure but sends the operator back
  to a re-staged offer, because what they were shown is no longer what they
  would get. Pure over its inputs, so the fetch policy stays with the
  resolution client.
- **Extension CPR plumbing (named item) — CLOSED.** `depackaged_metadata` now
  crosses the sealed inbox RPC (`beapInbox.list` both branches, `getMany`),
  `inboxRowToBeapMessage` decodes it with the *same* fail-closed extractor the
  Electron surfaces use, and the panel's optional prop falls back to it. Phase 2
  shipped that surface knowing it could not yet alert and said so; it can now.
- **Bound-origin-set plurality** — §1.
- **`ingressMappingForSource` carry-over** — §1.

## 5. E2E acceptance

| | Criterion | Status |
|---|---|---|
| (a) | Authenticated email → CPR pass → resolve → dual-channel → offer showing publisher/verified domain/entry → consent, preview hash pinning `resolution_mode` | **Met** at logic level; the consent-pin coverage is the Phase-4 hash tests, the offer projection is asserted here |
| (b) | Forwarded/unauthenticated: unsuppressible alert, zero derived affordances, manual entry completes the chain | **Met** — alert fires, alignment yields `no_authenticated_domain` with `channel_pass` false, manual capture resolves |
| (c) | Revoked / inactive / compromised / superseded / expired → correct status surfaces, no offer; unknown code → capture error | **Met** — each status refuses with `not_admissible`, compromised carries the warning, supersession names the successor, unknown routes to `captureError` |
| (d) | All Phase 1–4 guard and regression suites still green | **Met** — identity comparison clean, five remediated suites green in both modes |

Delta acceptance (e)–(h) — value statement from the EVP while the carrier
claims otherwise (e) is met structurally, since carrier text has no path in.
(f) rolled-back head rejected and (g) suspension surfaced are met against the
double. (h) the audit URL returning a byte-identical object needs a live
instance and stays `integration-pending`.

## 6. What "no build, no app start" leaves unverified — read this

The offer surface, the mail-side placement, and the consent-preview rendering
are **UI**. This phase built the projection they consume, the rules that decide
whether there is an offer at all, and the tests that pin those rules. It did not
render anything, and no assertion here proves a pixel.

Specifically still to be verified on the author's rig:
- That the offer surface actually appears beside the mail view and consumes the
  projection.
- That `expected_preview_hash` passed to consent is computed from what was
  *rendered*. The hash input is correct and covered; the wiring from a rendered
  surface into that call is UI work.
- The extension build (the CPR plumbing changes an RPC shape consumed by the
  extension renderer).
- Cross-device handoff interaction is **out of this slice** by the order;
  render-and-capture only. Remaining handoff scope is unchanged.

## 7. `integration-pending` — complete and explicit

Carried forward whole, per the order. None waived; no substitute trust path
exists for any of them.

1. Live resolve round-trip against a running WRC instance.
2. Live audit round-trip: `GET /v1/audit/{hash}` returning the byte-identical
   object (acceptance h).
3. Live CatalogHead rollback rejection against a real service (f) — proven here
   against the double.
4. Live suspended entry with a working audit link (g) — proven against the
   double.
5. Live delegation audit round-trip against `GET /v1/publishers/{part}/delegations`
   (v1.1 §B). Delegation *verification* is no longer pending: it never fetches.
6. Registry placement confirmation (D2 default STANDALONE) at deployment.

## 8. Open items outside this slice

- **Multi-origin publishers** need a contract field for the bound origin set;
  the client API is already set-shaped.
- **Seal-key-source**: three call sites still route from the row tag
  (`inboxSealedRead` already complies); `sealedContentUpdate` and
  `beapInboxClonePrepare` are deferred with stated reasons.
- **`test-isolation bidirectional risk`** — three suites observed; the Electron
  mock stays untouched until a dedicated decision.
- **`legacy reseal drift`** — low-priority note.
- The registry service deliverable, the Secure-Browse ruling, the Annex XVI
  editorial fixes, and display-to-device handoff remain outside the order.

## 9. Captures and dual-mode

| | Baseline `cd282eaf` | After |
|---|---|---|
| `testResults.length` (files) | 561 | 563 |
| Validity guard (`>= 100`) | PASS | PASS |
| `numTotalTests` | 6,090 | 6,115 |
| `numFailedTests` | 166 | 166 |
| `numPassedTests` | 5,867 | 5,892 |

**0 new, 0 repaired.** Deltas are exactly this phase: +2 files, +25 tests, +25
passing. Both identity sets are committed under `captures/` per the capture
persistence rule.

Five remediated suites: 15 / 8 / 8 / 14 / 9 in isolation, 0 failures in the full
workspace. New Phase-5 suites in isolation: 25 together.

### Two guards this phase's own changes invalidated

Both re-pointed rather than weakened, and worth recording because the reasoning
differs:

- The ingress fail-closed guard used `wr_code_public` as its unmapped fixture —
  the very mapping Phase 1 predicted Phase 5 would have to add. Adding it made
  the fixture stale, so the fixture moved to `relay_code_claim`, still
  registered and still unmapped. Relaxing the guard instead would have inverted
  its purpose.
- The Phase-2 panel test asserted the alert reads its prop alone. That was the
  correct contract while the surface provably had no data; the named plumbing
  item closed that, and the prop remains as the explicit override.

## 10. Standing disciplines observed

Sanctioned runner and validity guard on both captures; identity comparison;
capture persistence; dual-mode for the remediated suites; mutation rule;
graph-first-never-evidence; no build; no app start.
