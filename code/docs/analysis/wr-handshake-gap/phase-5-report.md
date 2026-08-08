# Phase 5 — Grants & Evidence: Phase Report

**Date:** 2026-07-24
**Branch:** `refactor/wr-handshake-phase-5-grants-evidence`
**Spec basis:** Master Brief v1.0; Annex VII §10.x, §2.6–2.7; Annex IX §19.1–19.2, §3.4; Annex X §10.1, §0.1; Annex XII §12.6 (annex-number-provisional).

---

## 1. What shipped

### 1.1 Grant objects (E2–E4, E9) — [VII.10.x, VII.2.7]

New module `electron/main/handshake/grants.ts`; schema migration **v76** (`wr_grants`,
`wr_grant_offscope_events`) — vault DB only, **never** applied to the frozen ledger handle.

- **Delivery rights** and **preparation rights** are distinct right objects.
  `GrantType = 'delivery' | 'preparation'` — the type system deliberately has
  **no `execute` variant** (structural test asserts this); preparation is
  representable with an open scope slot, standing action scopes are out of scope
  per the phase brief.
- **Receiver-side enforcement:** the Phase-1 ingress filter
  (`ingressAdmission.ts`) now *consumes* grants for `beap_message` deliveries:
  - no live delivery grant → blocked pre-visibility (`delivery_rights_revoked`);
  - declared scope outside the grant → blocked pre-visibility
    (`grant_scope_violation`), off-scope event logged; after
    `OFFSCOPE_REVOKE_OFFER_THRESHOLD` repetitions a one-tap revoke offer is
    surfaced [VII.10.2];
  - admitted deliveries return `grantRef`, threaded into provenance
    (`transport_metadata.grant_ref`) on both the email path
    (`messageRouter.ts`) and the P2P BEAP path (`beapEmailIngestion.ts`)
    [VII.10.3].
- **Lifecycle:** grants are created only behind an explicit consent event —
  a consented formation creates the relationship's initial inbound delivery
  grant carrying the formation `consent_id` (Hash-Pinned, Phase 4). Ground
  state is **unlimited-until-revoke**. Revocation kills all grants of the
  counterparty silently through the receiver filter; each revoked grant
  produces its own PoAC record.
- **Legacy backfill:** pre-grant relationships get a lazily backfilled
  delivery grant derived from the flattened `effective_policy.allowedScopes`
  (`backfilled = 1`, `consent_id = NULL` — **never a fabricated consent**).
  `effective_policy`/`sharing_mode` remain as capsule-negotiation artifacts
  and defense-in-depth, no longer the enforcement authority.
- **Limit extensions** (`optirando.grant.single_use`, `optirando.grant.ttl`)
  are parse-level **critical**: a grant carrying an ununderstood limit
  extension is refused at creation, never accepted as unlimited [VII.10.8.3].

### 1.2 Execution grants deleted + per-tap consent (V4) — [VII.10.1, VII.2.6, IX.19.2]

**Deleted authorization paths → replacement surface** (exit-criteria listing):

| Deleted path | Was | Replaced by |
|---|---|---|
| `GRANTED_TOOLS` set (`enforcement/authorizeToolInvocation.ts:52-59`) | process-global standing tool allowlist | nothing — no standing set exists; any tool is *consentable*, none is *granted* |
| ACTIVE-handshake blanket authorization (`authorizeToolInvocation.ts` / `executeToolRequest.ts:71-80`) | ACTIVE state ⇒ execution allowed | per-execution human consent tap with Intent Hash (`execution/executionConsent.ts`) |

The new flow (`wr_execution_consents`, single writer `executionConsent.ts`):

1. `prepareExecutionConsent` — builds the preview from the bound request
   (tool, canonical params digest, handshake, origin), computes the
   **Intent Hash** = canonical hash over the preview exactly as presented.
2. `confirmExecutionConsent` — records the human tap (no auto-accept, no
   bypass API, no batch-approve; structural-absence tests enforce this).
3. `executeToolRequest` — verifies the consent (fresh, tapped, un-consumed,
   Intent Hash matches a recomputation from the request), **consumes it
   first** (single use), executes, and writes a **PoAE** record binding the
   Intent Hash and consent reference [IX.19.1/19.2].
4. Divergence between executed and presented action →
   `INTENT_HASH_MISMATCH`, execution refused, **deviation PoAE** recorded.

**Hard coupling honored:** consent-tap flow and grant deletion shipped in the
same change set. **Feature gate:** `WRDESK_EXECUTION_CONSENT_TAP` (default
**enabled**) is a fail-closed **kill switch** — disabling it refuses *all*
execution; it can never restore a consent-free path (tested). Per exit
criteria, the gate is removed only after acceptance test 1 is green in
staging; until then it stays.

Risk note: the execution layer (`executeToolRequest`/tool registry) has **no
production IPC callers yet** — it is scaffolding ahead of the execution
feature. Consequently "all tool execution stopping silently" has zero blast
radius today; the consent surface is the module API
(`prepare → tap/confirm → execute with consent_ref`), ready for the renderer
consent screen when execution ships.

### 1.3 Append-only hash-chained evidence store (H1–H4) — [IX.19.1, X.10.1]

New module `electron/main/handshake/evidenceChain.ts`; table
`wr_evidence_chain` — **ledger-native schema** (applied via `ledger.ts`
`applySchema`, never through the frozen handshake migration chain).

- **Record classes:** `poac` (formation, grant create/revoke, admission
  blocks, content deletion), `poae` (executions with Intent Hash, incl.
  `refused_deviation`), `ber` (schema representable now; writers arrive in
  Phase 6), plus explicit `genesis`.
- **Chain discipline:** per-contract (`chain_id`) strictly monotonic,
  contiguous sequence; each record hash = SHA-256 over domain-tagged
  canonical form including `prev_hash`. Chains start with an explicit
  **genesis record** referencing the cutover timestamp; continuity is
  **never claimed** for pre-cutover rows [X.0.1].
- **Store-enforced append-only:** UPDATE and DELETE aborted by triggers.
  `verifyEvidenceChain` detects removal (sequence gap), insertion/reorder
  (prev-hash/record-hash mismatch), and payload tampering even if an
  attacker with raw file access drops the triggers.
- **Production writers:** `appendEvidenceBestEffort` (evidence must never
  make the operational path fail) — writers: `db.ts` (formation PoAC +
  initial grant), `grants.ts` (grant lifecycle PoAC), `ingressAdmission.ts`
  (blocked-admission PoAC), `revocation.ts` (content-deletion PoAC),
  `executeToolRequest.ts` (PoAE). `evidenceChain.ts` is the **only** module
  issuing `INSERT INTO wr_evidence_chain` (structural test).

### 1.4 Ledger repurposing (Q10, completes G5)

`handshake-ledger.db` (frozen at v74, swept in Phase 3) is now the
**Tier-L evidence chain home**: `wr_evidence_chain` is the only new table
class permitted on the ledger handle (`ledgerHygiene.ts`
`LEDGER_NATIVE_TABLES`). The ledger header documentation was rewritten to
state its actual role honestly: Tier-L evidence home **plus, transitionally,
the Tier-1 handshake pipeline DB** while SSO-session-scoped operation
requires it. The old "hashes only" fiction is gone from the docs; full
migration of pipeline usage off the ledger handle is future work, not
claimed here.

### 1.5 Capability-token schema (T4, Q13) — [XII.12.6, annex-number-provisional]

New module `packages/ingestion-core/src/capabilityToken.ts`:

- `token_type ∈ {delivery, preparation}` — no execute variant.
- Optional `context_scope` and `delegation_chain` are **carriage-only**:
  preserve-unknown-optional parsing (the `p2p_signal` pattern — unknown
  fields preserved byte-identically, never the `FIELD_RULES` allowlist
  strip); no delegation-chain validation until CC ships.
- `delegable` defaults false and grants nothing.
- `limit_extensions` are parse-level critical: present-but-not-understood →
  token refused.
- Round-trip byte preservation covered by property-style tests; XII-derived
  elements are marked `annex-number-provisional` in code comments.

### 1.6 Hygiene (H5)

- `deleteHandshakeRecord` **no longer deletes `audit_log` rows**.
- `audit_log` is **frozen for mutation**: `trg_audit_log_no_update` /
  `trg_audit_log_no_delete` triggers (applied idempotently on every open, on
  **both** handles including the frozen ledger — triggers are protective,
  not schema-chain migrations). INSERT stays open: it remains the
  operational audit sink; existing rows are read-only for forensics.
- Retention carve-out: `retention/retentionJob.ts` documents and exports
  `RETENTION_TABLES` (ingestion_audit_log, ingestion_quarantine,
  sandbox_queue) vs `RETENTION_EXCLUDED_TABLES` (**wr_evidence_chain,
  audit_log**) — structural test asserts no purge SQL targets the excluded
  tables.
- **Stated plainly:** audit rows purged by the old `deleteHandshakeRecord`
  behavior before this phase are **unrecoverable**. The chain claims no
  continuity for the pre-cutover period.

---

## 2. Acceptance tests (all automated, all green)

Primary suite: `electron/main/handshake/__tests__/phase5GrantsEvidence.acceptance.test.ts` (23 tests),
plus `execution/__tests__/executeToolRequest.test.ts`,
`ingestion/__tests__/authorization.test.ts`,
`__tests__/invariants.test.ts` (invariant 4 rewritten for per-tap consent),
`packages/ingestion-core/__tests__/capabilityToken.test.ts`.

| # | Requirement | Result |
|---|---|---|
| 1 | No execution without consent tap; structural absence of `GRANTED_TOOLS` / bypass / auto-accept | green (behavioral + structural-absence + single-writer/consumer checks) |
| 2 | Intent-Hash validity: post-preview mutation → refused + deviation PoAE | green |
| 3 | Receiver-enforced scoping: off-scope blocked pre-visibility + logged + revoke offer after repetition; delivered items resolve grant refs (incl. BEAP inbox) | green |
| 4 | Limit-extension criticality: ununderstood-present → refused; absent → unlimited ground state | green (grants + token layers) |
| 5 | Tier-L chain: removal/reorder/insertion detected; monotonic seq; genesis; pre-cutover audit_log outside chain and read-only (trigger-enforced) | green |
| 6 | Token forward-compatibility: unknown optional fields round-trip byte-preserved, no validation | green |
| 7 | Revocation history (Q8): revoke → grants dead via filter, evidence + digests intact; separate PoAC-recorded content-deletion action | green |
| 8 | Do-not-regress | see §3 |

Bugs found and fixed by the acceptance suite while landing:

- `poacAdmissionPayload` spread (`{ kind: 'admission', ...args }`) let the
  delivery kind overwrite the record kind — payload now names the delivery
  class `delivery_kind`.
- Phase-4 latent test-pollution bug: without an installed test provider,
  `getConnectOfferDb()` opened the **developer-profile**
  `connect-offers.db`, so test runs staged offers into the real staging DB
  (163 fixture rows accumulated and began leaking into `handshake.list`).
  Fixed by defaulting to an in-memory staging DB under vitest; the polluted
  rows (all test fixtures) were purged from the profile DB.

## 3. Do-not-regress evidence

Baseline: Phase-4 commit `0ed24437` in worktree `C:/wrdesk-p3-baseline`.

- Core suites (`handshake`, `execution`, `enforcement`, `ingestion`,
  `retention`, `__tests__`): **978 passed / 9 failed** — the 9 failures are
  the documented pre-existing `outboundQueue.backoff.test.ts` set (failing
  since before Phase 3; unrelated commit `34e26f42`).
- `email` + `p2p` + `internalInference` + `packages/ingestion-core`:
  failing-file set at HEAD is **identical** to the Phase-4 baseline
  (29 files / 91 tests, environment/pre-existing) — zero Phase-5
  regressions. New Phase-5 test files all pass on top.
- `tsc --noEmit` (electron main tsconfig): clean except the pre-existing
  `vite.config.ts` plugin-type error.

## 4. Decisions and open items for later phases

- **BER writers** land in Phase 6 (schema and payload builder shipped now).
- **Standing action scopes / effect vocabulary / Capability Diff /
  Finalizer lifecycle:** out of scope, per brief.
- **Preparation-right consumers:** the type exists; nothing issues or
  enforces preparation grants yet (deliberate — the slot is open).
- **Consent screen UI:** the renderer consent surface ships with the
  execution feature itself; the main-process gate is complete and fail-closed
  ahead of it.
- **Ledger pipeline-usage migration** (vault DB as sole contract/runtime
  home): documented as transitional; not attempted in this phase.
