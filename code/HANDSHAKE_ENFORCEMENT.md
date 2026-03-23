# BEAP Handshake Enforcement — MVP Specification

## 1. Overview

The BEAP Handshake Process Flow defines how two parties establish, maintain, and revoke a cryptographically-anchored data-sharing relationship. All enforcement runs in the Electron main process (trusted boundary). The Chrome extension communicates via IPC (read-only access).

## 2. Architecture

```
┌────────────────────────────────────────────┐
│         Chrome Extension (UI Layer)        │
│   Zustand store ← IPC events (read-only)  │
└────────────────┬───────────────────────────┘
                 │ WebSocket RPC / HTTP
┌────────────────▼───────────────────────────┐
│       Electron Main Process                │
│  ┌──────────────────────────────────────┐  │
│  │  Ingestion Layer (upstream)          │  │
│  │  Ingestor → Validator → Dist. Gate   │  │
│  │  (ValidatedCapsule only passes)      │  │
│  └──────────────┬───────────────────────┘  │
│  ┌──────────────▼───────────────────────┐  │
│  │  Handshake Enforcement Layer         │  │
│  │  ┌──────────────────────────────┐    │  │
│  │  │  Pipeline Runner (20 steps)  │    │  │
│  │  └──────────┬───────────────────┘    │  │
│  │             ▼                        │  │
│  │  ┌──────────────────────────────┐    │  │
│  │  │  Record Builder + DB Writer  │    │  │
│  │  └──────────┬───────────────────┘    │  │
│  │             ▼                        │  │
│  │  ┌──────────────────────────────┐    │  │
│  │  │  SQLCipher Vault Database    │    │  │
│  │  │  (handshakes, context_blocks,│    │  │
│  │  │   audit_log, embeddings)     │    │  │
│  │  └──────────────────────────────┘    │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

## 3. Handshake State Machine

| Current State    | Capsule Type        | Target State     |
|------------------|---------------------|------------------|
| (none)           | handshake-initiate  | PENDING_ACCEPT   |
| PENDING_ACCEPT   | handshake-accept    | ACTIVE           |
| PENDING_ACCEPT   | handshake-revoke    | REVOKED          |
| ACTIVE           | handshake-refresh   | ACTIVE           |
| ACTIVE           | handshake-revoke    | REVOKED          |
| EXPIRED          | (any)               | **DENIED**       |
| REVOKED          | (any)               | **DENIED**       |

- DRAFT is a UI-only state (never reaches the pipeline).
- PENDING_ACCEPT auto-expires after 7 days (configurable).
- ACTIVE auto-expires per `expires_at`.
- EXPIRED and REVOKED are terminal — no transitions out.

## 4. Deny-By-Default Pipeline

The `HANDSHAKE_PIPELINE` is a frozen, ordered array of 20 verification steps. Each step returns `{ passed: true }` or `{ passed: false, reason: ReasonCode }`. The first failure stops the pipeline and the capsule is denied.

### Pipeline Order

1. `check_schema_version` — Reject unsupported versions
2. `check_duplicate_capsule` — Dedup by `(handshake_id, capsule_hash)`
3. `verify_handshake_ownership` — Self-handshake prevention, party validation
4. `verify_sender_domain` — Allowlist enforcement
5. `verify_wrdesk_policy_anchor` — Platform policy hash validation
6. `verify_input_limits` — ID length, payload size, block count limits
7. `check_state_transition` — Valid state machine transitions
8. `verify_chain_integrity` — seq monotonicity, prev_hash chain
9. `verify_sharing_mode` — Asymmetric sharing mode enforcement
10. `verify_external_processing` — Cloud AI gating (snippet-only MVP)
11. `verify_context_binding` — Three-way binding, classification check
12. `verify_context_versions` — Version monotonicity
13. `resolve_effective_policy` — Capsule ∩ Receiver policy intersection
14. `verify_scope_purpose` — Scope escalation prevention
15. `verify_timestamp` — Clock skew (email-delay safe: future only)
16. `check_expiry` — Expiry validation, no extension, no mutation
17. `collect_tier_signals` — Extract signals from capsule
18. `classify_tier` — Compute tier, detect downgrade
19. `tier_specific_checks` — Signal-specific validation per tier
20. `enforce_minimum_tier` — Receiver minimum tier gate

### Key Invariants

- **Exception = Denial**: Any thrown exception yields `INTERNAL_ERROR`.
- **Null/undefined result = Denial**: Invalid step returns are treated as `INTERNAL_ERROR`.
- **Steps are pure functions**: No I/O. DB lookups are pre-loaded into the `HandshakeVerificationContext`.
- **Single transaction**: All mutations (record + blocks + dedup + audit) happen atomically on pipeline success.

## 5. Asymmetric Sharing Model

- **Initiator** sends the first capsule. **Acceptor** chooses the sharing mode.
- `sharing_mode` is set by the acceptor on `handshake-accept` and is **immutable** after that.
- `receive-only`: Acceptor can read but cannot write context blocks.
- `reciprocal`: Both parties can read and write.
- `reciprocal_allowed` is set by the initiator and controls whether the acceptor can choose `reciprocal`.

## 6. Tier Classification

Tiers: `free` < `pro` < `publisher` < `enterprise`

| Tier       | Requirements                                  |
|------------|-----------------------------------------------|
| free       | (any plan)                                    |
| pro        | plan ≥ pro + WRStamp                         |
| publisher  | plan ≥ publisher + WRStamp + DNS verification|
| enterprise | plan ≥ enterprise + WRStamp + DNS + HW attestation (fresh) |

- `tier_snapshot` is recorded at handshake creation (immutable).
- `current_tier_signals` are updated on each capsule for live evaluation.
- `effectiveTier = min(claimedTier, computedTier)` — downgrade if signals insufficient.

## 7. Context Blocks

- Stored in `context_blocks` table with PK `(sender_wrdesk_user_id, block_id, block_hash)`.
- Same `block_id` with different `block_hash` = new version (both stored).
- Same `block_id` with same `block_hash` = skip (dedup).
- Version monotonicity enforced: new version must be strictly greater.
- `embedding_status` tracks background embedding generation.

## 8. Revocation

1. Mark state = REVOKED (historical `tier_snapshot` preserved).
2. Delete all context blocks for the handshake.
3. Delete all embeddings (FK cascade).
4. Record audit log entry.
5. Future capsules for this handshake are denied immediately.

## 9. WRVault Gating

Five gates for vault access:

1. **Handshake active** — State = ACTIVE and not expired.
2. **Effective tier sufficient** — Current SSO tier meets handshake minimum.
3. **Policy ceilings** — Cloud, export, scope checks from effective policy.
4. **Sharing mode enforcement** — `receive-only` acceptors cannot write.
5. **LWM boundary** — Architectural gate (no LLM can call gateVaultAccess).

## 10. Cloud AI (MVP)

- Cloud AI is **OFF by default**.
- Only `snippet` mode is supported in MVP (`full` mode = denied).
- `buildCloudSnippet` is a deterministic text processor:
  - Strips email signatures, quoted replies, forwarded blocks.
  - Normalizes whitespace.
  - Truncates on word boundary with ellipsis.
  - No PII detection, no NLP.
- Cloud payload byte limit enforced per receiver policy.

## 11. IPC Contract

### WebSocket RPC Methods (Extension → Main)

- `handshake.queryStatus` → handshake record
- `handshake.requestContextBlocks` → blocks (with auth check)
- `handshake.authorizeAction` → allowed/denied
- `handshake.initiateRevocation` → revocation result
- `handshake.list` → filtered handshake list
- `handshake.isActive` → active/inactive

### HTTP Routes

- `GET /api/handshake/status/:id`
- `GET /api/handshake/list`
- `GET /api/handshake/:id/context-blocks`
- `POST /api/handshake/:id/revoke`

### Push Events (Main → Extension)

- `handshake-pending` — New handshake received
- `handshake-activated` — Handshake activated
- `handshake-revoked` — Handshake revoked
- `handshake-expired` — Handshake expired
- `context-updated` — New context blocks stored
- `tier-changed` — Tier changed

## 12. WR Desk Platform Policy Anchor

- `wrdesk_policy_hash` is recorded immutably per party in the `HandshakeRecord`.
- Initiator's hash is recorded on initiate; acceptor's on accept.
- The receiver policy declares `acceptedWrdeskPolicyHashes` — only matching hashes pass.
- This enables auditing which platform policy version each party accepted.

## 13. Audit Log

All handshake actions produce structured audit log entries:

- `handshake_pipeline_success` — Pipeline passed, record mutated
- `handshake_pipeline_denial` — Pipeline failed, with reason and failed step
- `handshake_revoked` — Revocation executed
- `retention_cycle` — Periodic cleanup stats

**No PII** is stored in audit metadata (no email addresses, no user content).

## 14. Persistence

All handshake data is stored in the existing SQLCipher vault database:

- `handshakes` — Handshake records (state, parties, policy, tier)
- `context_blocks` — Context blocks (payload, classification, version)
- `context_block_versions` — Version tracking for monotonicity
- `context_embeddings` — Embedding vectors for semantic search
- `seen_capsule_hashes` — Dedup ledger
- `audit_log` — Structured audit entries
- `handshake_schema_migrations` — Migration tracking

Migrations are additive and safe to run on every vault open.

## 15. Ingestion & Validation Layer (Upstream)

As of the `feature/ingestion-pipeline` branch, a mandatory two-stage ingestion pipeline sits upstream of the handshake layer:

```
External Input ──► Ingestor ──► Validator ──► Distribution Gate ──► Handshake Layer
```

### Key Changes

- `processHandshakeCapsule()` now accepts ONLY `ValidatedCapsule` (branded type from `electron/main/ingestion/types.ts`). Passing unvalidated input produces a compile error.
- The `ValidatedCapsule` constructor is module-private within `validator.ts` — no other module can produce instances.
- The 20-step frozen pipeline, state machine, sharing mode, policy resolution, tier classification, and all existing handshake semantics are **unchanged**.
- Ingestion is stateless — no database writes occur until the distribution gate forwards to the handshake layer.

### Architectural Invariants (Reinforced)

1. Only validated capsules cross the trust boundary into the handshake layer
2. Fail-closed at every stage (ingestor, validator, distribution gate, handshake pipeline)
3. Type system prevents bypass — `CandidateCapsuleEnvelope.__brand` ≠ `ValidatedCapsule.__brand`

See `INGESTION_PIPELINE.md` for full ingestion layer specification.
