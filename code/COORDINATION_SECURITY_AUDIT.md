# Security Audit + Readiness Analysis — Coordination Service Integration

**Date:** 2026-03-06  
**Scope:** Coordination Service (`packages/coordination-service`) + Electron app integration  
**Live endpoint:** `https://relay.wrdesk.com` (Podman, Nginx, Cloudflare TLS)

---

## Part 1: Coordination Service Security Audit

### 1.1 Authentication (`auth.ts`)

| Check | Result |
|-------|--------|
| OIDC validation | **jose.jwtVerify** with JWKS from `COORD_OIDC_JWKS_URL` |
| Issuer checked | **Yes** — `{ issuer }` passed to jwtVerify (default `https://auth.wrdesk.com/realms/wrdesk`) |
| Audience (aud) checked | **No** — any valid wrdesk token could access any service |
| email_verified checked | **No** |
| Expired tokens | **Rejected** — jose.jwtVerify throws on expiry |
| Token cache | **Secure** — cache key = SHA-256 hash of token, not raw token |
| TEST_MODE bypass | Skips JWKS fetch + JWT verify; accepts `test-{userId}-{tier}` and returns that identity |
| TEST_MODE impersonation | **Yes** — attacker can use `test-victimId-enterprise` to impersonate any user |
| TEST_MODE in production | **Critical risk** — full impersonation if `COORD_TEST_MODE=1` left on |

### 1.2 WebSocket Security (`wsManager.ts`)

| Check | Result |
|-------|--------|
| Auth method | Token from URL param `?token=` or `?access_token=` or `Authorization` header |
| Unauthenticated listen | **No** — connection rejected with 4001 if no valid token |
| Limit per user | **1** — new connection terminates previous for same userId |
| Total connection limit | **Not enforced** — `max_connections` in config but never checked |
| Same user many connections | Only 1 allowed (previous terminated) |
| Message flooding | **No explicit limit** — no per-message rate limit |
| Message validation | Type + ids array checked; malformed ignored |
| Fake ACK for others | **Vulnerable** — `acknowledgeCapsules` does not verify `recipient_user_id` |

### 1.3 Capsule Delivery Security (`server.ts`)

| Check | Result |
|-------|--------|
| POST /beap/capsule sender verified | **Yes** — `isSenderAuthorized(handshakeId, identity.userId)` |
| User A sends for handshake they're not in | **Blocked** — 403 if not a party |
| handshake_id checked | **Yes** — must exist in registry, sender must be initiator or acceptor |
| WebSocket push recipient | **Yes** — `pushCapsule(recipientUserId, ...)` uses registry-derived recipient |
| Capsule validated before push | **Yes** — `validateInput` from ingestion-core |
| Pending on reconnect | **Yes** — `getPendingCapsules(userId)` filters by recipient_user_id |
| Cross-user capsule visibility | **No** — only recipient's capsules returned |

### 1.4 Rate Limiting (`rateLimiter.ts`)

| Check | Result |
|-------|--------|
| Per user (not IP) | **Yes** — keyed by `userId` |
| IP bypass | **No** — limits are per authenticated user |
| Tier from token | **Yes** — from OIDC payload (`tier` or `wrdesk_tier`) |
| User fakes tier | **No** — JWT is server-signed |
| Monthly reset race | Minor — `getMonthKey()` and check are not atomic; worst case one extra capsule |

### 1.5 Data Storage Security (`store.ts`)

| Check | Result |
|-------|--------|
| DB in volume | **Yes** — `COORD_DB_PATH` defaults `/data/coordination.db` |
| SQL parameterized | **Yes** — all queries use `?` placeholders |
| capsule_json stored as-is | **Yes** — no parsing/modification |
| Expired capsules deleted | **Yes** — `cleanupExpired()` via hourly interval |
| Max storage limit | **No** — attacker could fill disk; rate limits mitigate |
| Acked capsules deleted | **Yes** — `cleanupAcknowledged()` after 1 hour |

### 1.6 Input Hardening (`server.ts`)

| Check | Result |
|-------|--------|
| Content-Type enforcement | **Yes** — 415 if not `application/json` |
| Body size limit | **Yes** — 15MB before read |
| JSON depth/recursion | **No explicit limit** — Node's JSON.parse default |
| Error responses generic | **Yes** — STATUS_MESSAGES, no details |
| Stack traces in responses | **No** |
| Request logging | **Minimal** — no IP/user in responses; getClientIp used only for transportMeta |

### 1.7 Container Security (`Dockerfile`)

| Check | Result |
|-------|--------|
| Non-root user | **Yes** — `useradd -r -g beap beap`, `USER beap` |
| Shell in production | **No** — `-s /sbin/nologin` |
| Health check leaks state | **No** — only status, connected_clients, pending_capsules, uptime |
| Secrets in /health | **No** — no RELAY_AUTH_SECRET or tokens |

---

## Part 2: Electron App Readiness

### 2.1 Coordination WebSocket Client (`coordinationWs.ts`)

| Check | Result |
|-------|--------|
| OIDC token source | `getOidcToken()` → `ensureSession()` + `getAccessToken()` |
| No SSO session | Sets `coordination_last_error` "No OIDC token — please log in", does not connect |
| Token expires while connected | No proactive refresh; server may close on invalid token; reconnect gets fresh token |
| Token refresh logic | **On reconnect** — `connect()` calls `getOidcToken()` each time |
| Reconnect gets fresh token | **Yes** |
| WS URL configurable | **Yes** — `coordination_ws_url` from p2p_config |
| wss:// enforced | **No** — URL is configurable; defaults to `wss://` |

### 2.2 Capsule Processing on Receive

| Check | Result |
|-------|--------|
| Full ingestion pipeline | **Yes** — `processIncomingInput` → validator → distribution gate |
| Chain integrity | **Yes** — via `canonicalRebuild` + `processHandshakeCapsule` |
| State transition | **Yes** — in enforcement |
| Context commitment DB | **Yes** — in handshake pipeline |
| Hash verification | **Yes** — in validator + canonicalRebuild |
| Malicious coordination push | **Mitigated** — local pipeline validates; tampered capsule rejected |
| Local pipeline catches tampering | **Yes** |

### 2.3 Outbound Path

| Check | Result |
|-------|--------|
| use_coordination → coordination_url/beap/capsule | **Yes** |
| OIDC token (not Bearer) | **Yes** |
| Expired token when sending | `setP2PHealthOutboundFailure('No OIDC token — please log in')`, retries on next interval |
| p2p_endpoint in capsules | **Yes** — `getEffectiveRelayEndpoint` returns coordination URL when use_coordination |
| Coordination unreachable | Queue retries with exponential backoff (5s–5min) |

### 2.4 Handshake Registration

| Check | Result |
|-------|--------|
| Registers with coordination | **Yes** when use_coordination |
| When triggered | On initiate, on buildForDownload, on accept |
| Registration failure | Non-blocking — logs warning, handshake still created |
| Data sent | handshake_id, initiator_user_id, acceptor_user_id, initiator_email, acceptor_email |

### 2.5 Mode Logic

| Check | Result |
|-------|--------|
| relay_mode=local → use_coordination | **Yes** |
| relay_mode=remote → use_coordination | **No** |
| Both active | **No** — mutually exclusive |
| Mode switch mid-session | WS disconnected when switching to remote; polling starts |
| Existing handshakes | Not affected; delivery target comes from config at send time |

### 2.6 Configuration

| Check | Result |
|-------|--------|
| coordination_url default | `https://coordination.wrdesk.com` |
| coordination_ws_url default | `wss://coordination.wrdesk.com/beap/ws` |
| **Update needed** | Live service is `relay.wrdesk.com` — defaults must be updated |
| Migration for existing users | p2p_config has columns; migration v11 applied |

### 2.7 Error Handling

| Check | Result |
|-------|--------|
| Coordination down | "Reconnecting to wrdesk.com…" (yellow) |
| WebSocket can't connect | Same + coordination_last_error |
| Sending fails | "P2P — some failed" or "No OIDC token — please log in" |
| User-friendly errors | **Yes** — no raw codes in UI |

---

## Part 3: Attack Scenarios

| # | Attack | Defended? | How |
|---|--------|-----------|-----|
| S1 | Attacker sends capsule for someone else's handshake | **Yes** | `isSenderAuthorized` checks registry |
| S2 | Stolen OIDC token | **Partial** | Standard OIDC risk; token works if valid |
| S3 | Flood capsules to fill disk | **Partial** | Rate limits + maxStored; no global disk limit |
| S4 | Tampered capsule via coordination | **Yes** | ingestion-core + local pipeline validate |
| S5 | Coordination compromised | **Yes** | Host pipeline validates everything |
| S6 | MITM app ↔ coordination | **Yes** | TLS (Cloudflare + nginx) |
| S7 | TEST_MODE in production | **No** | Full impersonation with test-* tokens |
| S8 | ACK someone else's capsules | **No** | `acknowledgeCapsules` does not verify recipient |
| S9 | Replay old capsule | **Yes** | Chain integrity (seq + hash) on host |
| S10 | Fake tier for higher limits | **No** | Tier from server-signed JWT |

---

## Security Audit Results

### Critical Issues (must fix before connecting)

| # | Issue | Severity | File:Line | Recommended Fix |
|---|-------|----------|-----------|-----------------|
| 1 | ACK does not verify recipient — attacker can ACK others' capsules | **Critical** | store.ts:95-102 | Add `AND recipient_user_id = ?` to UPDATE; pass userId to acknowledgeCapsules |
| 2 | Config defaults point to coordination.wrdesk.com; live is relay.wrdesk.com | **Critical** | p2pConfig.ts:50-51 | Update defaults to `https://relay.wrdesk.com` and `wss://relay.wrdesk.com/beap/ws` |

### Warnings (should fix soon)

| # | Issue | Severity | File:Line | Recommended Fix |
|---|-------|----------|-----------|-----------------|
| 1 | No audience (aud) check in OIDC | **Medium** | auth.ts:80 | Add `audience: 'coordination'` or expected aud to jwtVerify options |
| 2 | max_connections not enforced | **Medium** | server.ts:238 | Reject WS connection if getConnectedCount() >= config.max_connections |
| 3 | TEST_MODE allows full impersonation | **High** | auth.ts:67-72 | Add startup warning; consider removing in production build |
| 4 | No email_verified check | **Low** | auth.ts | Optional: reject if email_verified !== true |

### Readiness Checklist

| Check | Status | Notes |
|-------|--------|------|
| OIDC auth works | ✅ | jose + JWKS; issuer checked |
| WebSocket auth works | ✅ | Token in URL or header |
| Capsule delivery secure | ⚠️ | ACK vulnerability |
| Rate limiting active | ✅ | Per user, tier-based |
| Input hardening complete | ✅ | Content-Type, 15MB, generic errors |
| Container hardened | ✅ | Non-root, no shell |
| Client token handling | ✅ | Fresh token on reconnect |
| Client capsule processing | ✅ | Full pipeline |
| Outbound routing correct | ✅ | OIDC, coordination URL |
| Mode logic correct | ✅ | Mutual exclusion |
| Config points to relay.wrdesk.com | ❌ | Defaults are coordination.wrdesk.com |
| Error handling user-friendly | ✅ | UI messages |

### Attack Scenario Results

| # | Attack | Defended? | How |
|---|--------|-----------|-----|
| S1 | Send capsule for others' handshake | ✅ | Registry check |
| S2 | Stolen OIDC token | ⚠️ | OIDC standard risk |
| S3 | Flood to fill disk | ⚠️ | Rate limits help; no global cap |
| S4 | Tampered capsule | ✅ | Double validation |
| S5 | Coordination compromised | ✅ | Host validates |
| S6 | MITM | ✅ | TLS |
| S7 | TEST_MODE in prod | ❌ | Must ensure COORD_TEST_MODE unset |
| S8 | ACK others' capsules | ❌ | **Fix required** |
| S9 | Replay | ✅ | Chain integrity |
| S10 | Fake tier | ✅ | Server-signed JWT |

### Configuration Changes Needed

- [ ] **p2pConfig.ts**: Set `coordination_url` default to `https://relay.wrdesk.com`
- [ ] **p2pConfig.ts**: Set `coordination_ws_url` default to `wss://relay.wrdesk.com/beap/ws`
- [ ] **Production**: Ensure `COORD_TEST_MODE` is not set (or is `0`)

### Code Changes Needed

1. **store.ts** — `acknowledgeCapsules(ids, recipientUserId)`: add `AND recipient_user_id = ?` to UPDATE
2. **wsManager.ts** — `handleAck` already receives userId; pass to store
3. **p2pConfig.ts** — Update DEFAULT_P2P_CONFIG coordination_url and coordination_ws_url
4. **server.ts** — Enforce max_connections before accepting WebSocket

### Safe to Connect?

**NO — fix critical issues first.**

1. Fix ACK vulnerability (store.ts + wsManager handleAck).
2. Update config defaults to relay.wrdesk.com.
3. Verify COORD_TEST_MODE is not set in production.
4. (Recommended) Add audience check and max_connections enforcement.
