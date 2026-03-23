# BEAP / WRDesk — Codebase Analysis Report

**Date:** 2026-03-08  
**Scope:** Handshake flow, signatures, P2P delivery, capsule_hash, auth, tests

---

## 1. Architecture Map

### 1.1 Current State

**Capsule building:**
- `capsuleBuilder.ts`: `buildInitiateCapsule`, `buildAcceptCapsule`, `buildContextSyncCapsuleWithContent`, `buildRefreshCapsule`, `buildRevokeCapsule`
- Initiate: Ed25519 `sender_public_key`, `sender_signature` over `capsule_hash`; `p2p_endpoint`, `p2p_auth_token`
- Accept: `countersigned_hash` (acceptor signs initiator's `capsule_hash`) when `initiator_capsule_hash` is valid

**Outbound queue:**
- `outboundQueue.ts`: `enqueueOutboundCapsule`, `processOutboundQueue`
- Table: `outbound_capsule_queue` (status: pending/sent/failed)
- **Only context_sync capsules are enqueued** — initiate and accept are NOT
- `processOutboundQueue` runs every 10s via `tryP2PStartup` in `main.ts:6925`
- Processes one capsule per run (LIMIT 1); exponential backoff on retry

**Sending to relay:**
- `p2pTransport.ts`: `sendCapsuleViaCoordination` (POST to `{coordination_url}/beap/capsule`, Bearer OIDC), `sendCapsuleViaHttp` (POST to `target_endpoint`, `X-BEAP-Handshake`, optional Bearer)
- When `use_coordination`: always POSTs to coordination URL, ignores `row.target_endpoint`
- Timeout: 30s

**Coordination service** (`packages/coordination-service/`):
- `POST /beap/register-handshake`: Registers initiator/acceptor user IDs
- `POST /beap/capsule`: OIDC auth → `isSenderAuthorized`, `getRecipientForSender` → `validateInput` → `storeCapsule` → `pushCapsule` (WebSocket) or store for later
- `handshakeRegistry.ts`: `getRecipientForSender(handshakeId, senderUserId)` returns the other party
- WebSocket `/beap/ws`: OIDC via `?token=` or `Authorization`; `pushPendingCapsules` on connect

**Recipient receive paths:**
| Path | File | Mechanism |
|------|------|-----------|
| Coordination WS | `coordinationWs.ts` | WS to coordination; on `type: 'capsule'` → `processIncomingInput` → `canonicalRebuild` → `processHandshakeCapsule` |
| Relay pull | `relayPull.ts` | GET relay pull URL with Bearer; processes `capsules[]` |
| Direct P2P | `p2pServer.ts` | POST `/beap/ingest` with Bearer = counterparty token |

**Receive pipeline:**
```
rawInput → processIncomingInput (ingestionPipeline.ts)
  → ingestInput → validateCapsule (ingestion-core)
  → routeValidatedCapsule → distribution.target === 'handshake_pipeline'
  → canonicalRebuild (canonicalRebuild.ts)
  → processHandshakeCapsule (enforcement.ts)
```

**Accept flow:**
- `handshake.accept` RPC → `buildAcceptCapsule` → `submitCapsuleViaRpc` (local) + `sendCapsuleViaEmail` (if fromAccountId) + `registerHandshakeWithRelay` (setImmediate)
- Auto context-sync: `enqueueOutboundCapsule(db, handshake_id, targetEndpoint, contextSyncCapsule)` (setImmediate)

**Accept capsule back to initiator:**
- **Email only** (when acceptor uses `fromAccountId`) or **local RPC** (same host)
- **Accept capsule is NOT enqueued to outbound queue** — it never goes through coordination/relay

### 1.2 Gaps

| Gap | Risk |
|-----|------|
| Accept capsule never sent via coordination/relay | **Critical** — initiator on different machine without email never receives accept |
| Initiate capsule never sent via coordination — only email | **High** — coordination is underused; relay path for initiate is missing |
| 10s polling for outbound queue — first send can be delayed up to 10s | Medium |
| One capsule per 10s — multiple handshakes serialize slowly | Low |

### 1.3 Recommended Fix

**Enqueue accept capsule to outbound queue** so it flows through coordination/relay:

In `handshake/ipc.ts` accept handler, after `registerHandshakeWithRelay` succeeds (or in same setImmediate), add:

```typescript
// After registerHandshakeWithRelay, enqueue accept capsule for relay delivery
const targetEndpoint = record.p2p_endpoint?.trim()
if (targetEndpoint && (p2pAuthToken || getP2PConfig(db).use_coordination)) {
  enqueueOutboundCapsule(db, handshake_id, targetEndpoint, capsule)
}
```

Ensure `registerHandshakeWithRelay` completes before the accept capsule is processed (or run it synchronously before enqueue). The coordination service already routes by `getRecipientForSender`; when acceptor POSTs accept, recipient = initiator.

---

## 2. Signature Implementation Audit

### 2.1 Current State

**Key generation/storage:**
- `signatureKeys.ts`: `generateSigningKeypair`, `signCapsuleHash`, `verifyCapsuleSignature`
- Keys stored in `handshake` table: `local_public_key`, `local_private_key`, `counterparty_public_key`, `counterparty_p2p_token`
- Per-handshake, not global

**Initiate capsule:**
- `buildInitiateCapsuleCore`: `computeCapsuleHash` → `signCapsuleHash(capsuleHash, keypair.privateKey)`
- `sender_signature` is over `capsule_hash` ✓

**Accept capsule:**
- `buildAcceptCapsule`: `countersigned_hash = signCapsuleHash(initiatorCapsuleHash, keypair.privateKey)` when `initiator_capsule_hash` is valid
- `countersigned_hash` can be omitted if initiator hash missing — but **validator requires it** for accept (`REQUIRED_FIELDS_BY_TYPE.accept`)

**Verification (receive side):**
- `enforcement.ts`: `verifyCapsuleHashIntegrity` (before signature) → `verifyCapsuleSignature(capsule_hash, senderSignature, senderPublicKey)` → for accept with `countersigned_hash`: `verifyCapsuleSignature(initiatorHash, countersignedHash, senderPublicKey)`
- Order: hash first, then signature ✓

### 2.2 Gaps

| Gap | Risk |
|-----|------|
| `countersigned_hash` required by validator but optional in `buildAcceptCapsule` when `initiator_capsule_hash` invalid | **Medium** — schema v1 or missing hash → accept fails validation |
| `handshakeVerification.ts` (`verifyHandshakeCapsule`) — 8-step full verification — **not used** in production pipeline | Low — `verifyCapsuleHashIntegrity` + `verifyCapsuleSignature` cover the critical path |

### 2.3 Recommended Fix

- Ensure `record.last_capsule_hash_received` is always set when processing initiate (schema v2).
- For schema v1 initiate → accept: either make `countersigned_hash` optional in validator for backward compat, or reject schema v1 accept.

---

## 3. P2P Delivery Diagnosis

### 3.1 Root Cause: Accept Capsule Not Delivered via Relay

The "Delivery pending — recipient may be offline" message in `RelationshipDetail.tsx` is shown when **queue entries are pending** (context_sync). But the deeper issue: **the accept capsule itself is never sent via coordination/relay**. If initiator and acceptor are on different machines and do not use email, the initiator never receives the accept.

**Flow today:**
1. Acceptor accepts → `submitCapsuleViaRpc` (local only) + `sendCapsuleViaEmail` (optional) + `registerHandshakeWithRelay`
2. Accept capsule is **not** enqueued
3. Auto context-sync **is** enqueued (context_sync capsule)
4. `processOutboundQueue` sends context_sync to coordination
5. Coordination pushes to initiator via WebSocket

So the initiator receives **context_sync** via coordination, but the **accept** capsule only via email or local RPC. The handshake state on the initiator moves to ACTIVE only when they receive the accept. If they never receive it (no email, different machines), they stay in PENDING_ACCEPT.

**"Delivery pending"** refers to the **context_sync** queue. If the acceptor's queue has pending items, it means:
- `processOutboundQueue` hasn't sent yet (10s interval), or
- No OIDC token (`getOidcToken` returns null) → send skipped, stays pending
- Backoff delay (retry_count > 0)

### 3.2 Gaps

| Gap | Risk |
|-----|------|
| Accept capsule not enqueued | **Critical** |
| OIDC token null → queue never drains | **High** |
| 10s poll → UX delay | Medium |
| Single capsule per run | Low |

### 3.3 Recommended Fix

1. Enqueue accept capsule (see §1.3).
2. Add startup/health check: if `use_coordination` and queue has pending but no OIDC token, surface "Please log in to deliver capsules".
3. Consider triggering `processOutboundQueue` immediately after enqueue (in addition to 10s interval).

---

## 4. capsule_hash Verification Integration

### 4.1 Current State

- **Wired:** `enforcement.ts` calls `verifyCapsuleHashIntegrity(input)` **before** `verifyCapsuleSignature`.
- `steps/verifyCapsuleHash.ts`: `verifyCapsuleHashIntegrity` returns `ReasonCode.HASH_INTEGRITY_FAILURE` or `null`.
- Uses `computeCapsuleHash` from `capsuleHash.ts`; same canonical field set (excludes `sender_public_key`, `sender_signature`, `countersigned_hash`).
- Schema v1: skips with `console.warn`.
- Validator (`ingestion-core`): format-only (64-char hex for `capsule_hash`); does **not** recompute. Hash verification is in enforcement layer ✓

### 4.2 Gaps

None. Implementation is complete.

### 4.3 Risk Level

Low — verification is correctly placed before signature check.

---

## 5. Authentication & Authorization Gaps

### 5.1 COORD_TEST_MODE

- **Location:** `packages/coordination-service/src/auth.ts:69`
- **Behavior:** When `COORD_TEST_MODE=1` and token starts with `test-`, skips JWKS/JWT verify and returns synthetic identity (`test-{userId}-{tier}`).
- **Risk:** Full impersonation if left enabled in production.
- **Usage:** Only in `coordination.test.ts` (test setup).
- **Deployment:** No `COORD_TEST_MODE` in compose/env files found; must be verified in production env.

### 5.2 OIDC Audience

- **Location:** `packages/coordination-service/src/config.ts`, `auth.ts`
- **Behavior:** `oidc_audience` from `COORD_OIDC_AUDIENCE`; passed to `jose.jwtVerify` when set.
- **Gap:** `index.ts` warns if not set: "COORD_OIDC_AUDIENCE not set — audience check skipped."
- **Risk:** JWTs for other services in same Keycloak realm could authenticate.

### 5.3 email_verified

- Not explicitly checked in coordination auth. Identity comes from JWT `email`, `sub`, `tier`.

### 5.4 Recommended Fix

| Item | Action |
|------|--------|
| COORD_TEST_MODE | Ensure unset in production; add startup assertion |
| COORD_OIDC_AUDIENCE | Set in production (e.g. `wrdesk-coordination` or `account`) |
| email_verified | Optional: add check if Keycloak provides it |

---

## 6. Missing or Dead Code

### 6.1 Dead / Unused

| Item | Location | Notes |
|------|----------|-------|
| `verifyHandshakeCapsule` | `handshakeVerification.ts` | Full 8-step verification; only used in tests. Production uses `verifyCapsuleHashIntegrity` + `verifyCapsuleSignature` |
| `scripts/rebuild.js` | `electron-vite-project` | Uses `require` in ESM package → fails on `pnpm run rebuild` |

### 6.2 Incomplete / Conditional

- `countersigned_hash` in accept: optional in builder, required in validator — mismatch.

### 6.3 Recommended Fix

- Rename `scripts/rebuild.js` → `scripts/rebuild.cjs` or convert to ESM.
- Align `countersigned_hash` requirement between validator and builder.

---

## 7. Error Handling & Resilience

### 7.1 Current State

- Relay unreachable: `sendCapsuleViaHttp`/`sendCapsuleViaCoordination` return `{ success: false }`; queue retries with backoff (max 10).
- Capsules persisted in `outbound_capsule_queue` on enqueue.
- Malformed capsules: `validateInput` rejects; coordination returns 422; no crash.
- Coordination WS: `RECONNECT_DELAYS = [1,2,4,8,16,30]` seconds.

### 7.2 Gaps

| Gap | Risk |
|-----|------|
| No OIDC token → queue never drains, no user-facing message | Medium |
| Unhandled promise rejections in `setImmediate` callbacks (e.g. `registerHandshakeWithRelay`) | Low |
| `processOutboundQueue` catches and logs but doesn't surface to UI beyond health | Low |

### 7.3 Recommended Fix

- Surface "Please log in" when queue has pending and no OIDC token.
- Ensure `setImmediate` callbacks have `.catch()` for async errors.

---

## 8. Test Coverage

### 8.1 Current State

| Area | Tests |
|------|-------|
| Handshake pipeline | `e2e.pipeline.test.ts`, `e2e.roundtrip.test.ts`, `enforcement.test.ts` |
| capsule_hash | `verifyCapsuleHashIntegrity` in `enforcement.test.ts`; `HASH_INTEGRITY_FAILURE` in `hardening-verification.test.ts` |
| Signatures | `signatureKeys.test.ts`, `hardening-verification.test.ts` |
| Outbound queue | `p2p-transport.test.ts`, `coordination-client.test.ts` |
| Coordination service | `coordination.test.ts` (register, capsule POST, rate limit, WS) |
| Relay server | `relay-server.test.ts` |

### 8.2 Gaps

| Gap | Risk |
|-----|------|
| No E2E for full initiate → relay → accept → relay → confirm across two processes | High |
| No test for accept capsule via coordination | High |
| `handshakeVerification.ts` tested in isolation, not in pipeline | Low |

### 8.3 Recommended Fix

- Add E2E: two Electron instances (or mocked), initiate via coordination, accept via coordination, verify initiator receives accept and state → ACTIVE.
- Add unit test: enqueue accept capsule, run `processOutboundQueue`, assert coordination receives it.

---

## Priority Matrix

| # | Issue | Risk | Effort | Est. Time | File(s) |
|---|-------|------|--------|-----------|---------|
| 1 | Accept capsule not sent via coordination/relay | Critical | Low | 1–2 h | `handshake/ipc.ts` |
| 2 | COORD_TEST_MODE in production | Critical | Low | 30 min | `auth.ts`, deployment |
| 3 | COORD_OIDC_AUDIENCE not set | High | Low | 15 min | Deployment config |
| 4 | OIDC token null → queue never drains | High | Medium | 1 h | `outboundQueue.ts`, UI |
| 5 | countersigned_hash validator vs builder mismatch | Medium | Low | 30 min | `validator.ts`, `capsuleBuilder.ts` |
| 6 | E2E test: initiate → accept via coordination | High | High | 4–6 h | New test file |
| 7 | rebuild.js ESM error | Low | Low | 15 min | `scripts/rebuild.js` |
| 8 | Initiate via coordination (optional) | Medium | Medium | 2–3 h | `handshake/ipc.ts` |
| 9 | Trigger processOutboundQueue after enqueue | Low | Low | 30 min | `outboundQueue.ts`, `main.ts` |
| 10 | setImmediate error handling | Low | Low | 30 min | `handshake/ipc.ts` |

---

## Action Plan Status (Updated)

| Step | Description | Status |
|------|-------------|--------|
| 1 | Kill TEST_MODE | Verify COORD_TEST_MODE unset in prod |
| 2 | OIDC audience check | Set COORD_OIDC_AUDIENCE in prod |
| 3 | Ed25519 signature exchange | Initiate ✓; Accept ✓ (countersigned_hash); verification ✓ |
| 4 | capsule_hash verification | **Done** — wired in enforcement.ts |
| 5 | Manual flow trace | Unblocked by fixing accept enqueue |
| 6 | Failure scenario testing | Add E2E for coordination path |
| 7–10 | Relay hardening | In progress |
| 11–13 | Future items | Not started |

---

## Reference: Key Files

| Component | Path |
|-----------|------|
| Capsule builder | `electron/main/handshake/capsuleBuilder.ts` |
| Outbound queue | `electron/main/handshake/outboundQueue.ts` |
| P2P transport | `electron/main/handshake/p2pTransport.ts` |
| Enforcement | `electron/main/handshake/enforcement.ts` |
| capsule_hash verification | `electron/main/handshake/steps/verifyCapsuleHash.ts` |
| Handshake IPC (accept) | `electron/main/handshake/ipc.ts` |
| Relay sync | `electron/main/p2p/relaySync.ts` |
| Coordination server | `packages/coordination-service/src/server.ts` |
| Coordination auth | `packages/coordination-service/src/auth.ts` |
| Handshake registry | `packages/coordination-service/src/handshakeRegistry.ts` |
| Validator | `packages/ingestion-core/src/validator.ts` |
