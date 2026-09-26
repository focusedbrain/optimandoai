# WR Code Run 2 — Six Gates, Entry Lifecycle, One-Time-Use — Report

Branch `integration/consolidated-current`, commits `d13e3a54..6472be62` (on top
of Run 1 at `1085c13d`). Authority: `docs/spec/Annex_XVI_WR_Code_v1.95.pdf`
(SHA256 `064AAD6D…829F`), pinned intact at start and end. Suite:
6247 tests / 153 pre-existing failures before → 6347 / 153 after, failure set
identical. **Zero new failures**; +100 new tests. (One flaky suite,
`userDataBootstrapPersistence`, flips WHICH of its assertions fails between
runs — it was failing before this run and is untouched by it.)

## What shipped

1. **Gate pipeline** (`d13e3a54`) — `wrc/gatePipeline.ts`: one ordered,
   fail-closed §XVI.7.6 pipeline (Syntax → Namespace → Entry → Self-Match →
   Relay-Release → Capsule-Admission). Gate 1 delegates to the Run-1 grammar
   module — no second parser. First failure terminates with gate number +
   precise reason; `gatesPassed` is strictly the prefix, so later gates are
   unobservable past a failure; callers cannot reorder or skip (order lives in
   the runner, self-match and the P15 link scan are pipeline-owned). Gate 2
   verifies EVERY Publisher Identifier (both for C). New `wrc.submitReference`
   RPC is THE resolution path; `wrc.resolvePublisher` is demoted to the
   status/audit surface; e-mail detection documents its exit into submission.
2. **Entry lifecycle** (`23e1c691`) — `wrc/entryLifecycle.ts`: one vocabulary
   (§XVI.8.1 base + §XVI.8.4 use-limited + §XVI.8.3 invitation states), one
   transition table (terminal states have no exits — P11), one admission
   evaluator that Gate 3 consults. Superseded surfaces its successor as data;
   everything else rejects with the status as the reason; compromised and
   consumed carry the unsuppressible warning class.
3. **One-time-use** (`6472be62`) — `wrc/useLimitStore.ts` + schema v78
   (`wrc_entry_use_state`, additive): §XVI.8.4 profile on the entry, never the
   reference. Claim = one conditional UPDATE (compare-and-set in the
   statement); racing claimants get exactly one winner, loser gets
   deterministic `CLAIMED_BY_OTHER` — proven at store level and through the
   full pipeline. Lazy timeout release (no background timer), decline/post-
   claim-gate-failure revert (a failed verification never consumes a use),
   n>1 decrement-and-return, idempotent retry per `request_instance_id`,
   bearer `consume_at=resolution`, automation scope → `EXHAUSTED`.
   CONSUMED/EXHAUSTED are terminal; re-declaration never resurrects.
4. **Fixtures** — every gate has passing and failing vectors
   (`gatePipeline.test.ts`, 36), lifecycle transitions + effects
   (`entryLifecycle.test.ts`, 40), claim conformance run identically against
   memory AND native-DB backends + races (`useLimitStore.test.ts`, 24).

## Gate-2 interim-anchor seam (pre-authorized)

`wrc/gatePipelineAdapter.ts` is the seam. The pipeline's deps interface is
written against the §XVI.6.4/6.5 Directory Record shape (dual signature, DNS
leg, account-holder attestation, successor); the adapter fills those legs from
the Phase-3 chain (DNS-pinned root, dual-channel, head-embedded delegation,
ingest countersign), fail-closed on any failure. TODO markers cite
§XVI.6.4/6.5 at the seam; swapping in the real directory is internal to that
file. Account-holder attestation has no separate interim source — chain
success stands in for it (noted in code). The successor of a superseded
namespace is not carried by the Phase-3 claim → surfaced as `null` until the
directory provides it.

## Decisions under pre-authorization

- Claim timeout default **600 s**, conservative fail-closed, configurable via
  `WRDESK_WRC_CLAIM_TIMEOUT_S` (§XVI.8.4 leaves the duration open).
- One-time-use split per the annex's own text: Gate 3 enforces the posture
  (CONSUMED/CLAIMED_BY_OTHER/EXHAUSTED refusals), the CAS transition itself
  fires on Gate-5 passage ("successful passage through Gate 5 … moves it
  atomically"), and any later gate failure reverts the claim.
- `allowSuspended` inside the adapter's entry leg is not an admission bypass:
  it returns suspended/retired material as data so Gate 3 can refuse with the
  precise layer (platform vs publisher), fail-closed.
- Interim resolver reach: only P entries are designatable; C (ordered pair)
  and I/S\* (combination expansion, §XVI.5.10) fail closed at Gate 3 with
  `entry_verification_unavailable`. I/S\* self-match also fails closed.
- Live resolution by construction: every submission re-runs the full chain
  (satisfies forced `require_live_resolution`); the Gate-3 entry leg re-runs
  the namespace legs — accepted network duplication, correctness first.
- Legacy Run-1 rows untouched (`WR_CODE_LEGACY_FORMAT` on consent stands);
  preview/consent hash composition untouched (Q7) — gate results are runtime
  decisions, never hash inputs.

## TODO attachment points left

- Gate 5: relay-backed recipient-bound release (signed claim, delegation with
  accept scope, rate/replay) — interim release hands over Gate-3-verified EVP.
- Gate 6: BEAP capsule verification chain + `request_instance_id` replay
  against the Handshake State Index (P15 link scan already runs, non-delegable).
- Gate 2: acting-principal SSO-domain check (§XVI.13.x/SSO out of scope).
- `use_scope = context` counting attaches at session binding (§XVI.13.3).

## Open items

- No renderer/extension UI consumes `wrc.submitReference` yet (same posture as
  Run 1: contract first, no half-built UI).
- The e-mail capture indicator (§XVI.7.7) that would let a user act on a
  stored detection — and thereby call `wrc.submitReference` — is still the
  Run-1 TODO; the pipeline is ready for it.
