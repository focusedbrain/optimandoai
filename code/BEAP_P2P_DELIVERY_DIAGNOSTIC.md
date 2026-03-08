# BEAP P2P Delivery Stuck — Diagnostic Report

## Summary of Investigation

Tracing through the codebase for the three linked problems: 401 errors, accept capsule not reaching initiator, and initiator not seeing handshakes.

---

## Problem 1: Outbound Queue 401 Errors

### Token Flow (verified)

1. **`getOidcToken()`** (main.ts:6899) → `ensureSession()` then `session.accessToken ?? getAccessToken()`
2. **`processOutboundQueue`** (outboundQueue.ts:78-91) → calls `getOidcToken()`, passes token to `sendCapsuleViaCoordination`
3. **`sendCapsuleViaCoordination`** (p2pTransport.ts:26-34) → builds `Authorization: Bearer ${token}` header
4. **`sendCapsuleViaHttpWithAuth`** → POST to `{coordination_url}/beap/capsule` with the header

Token is attached correctly. **Likely cause: OIDC audience mismatch.**

### Coordination Service Auth (auth.ts, server.ts)

- `validateOidcToken(token, issuer, jwksUrl, audience)` — when `COORD_OIDC_AUDIENCE` is set, jose verifies `aud` claim
- If Keycloak does not include a matching `aud` in tokens, validation fails → 401

**Fix 1a:** Decode a client token (jwt.io) and check `aud`. Either:
- Configure Keycloak audience mapper to add `COORD_OIDC_AUDIENCE` to `aud`, or
- Set `COORD_OIDC_AUDIENCE` to match what Keycloak already puts in `aud`

**Fix 1b:** Ensure `wrdesk_user_id` used for relay registration matches JWT `sub`. The coordination service uses `identity.userId = payload.sub`. We register with `session.wrdesk_user_id` (from `payload.wrdesk_user_id ?? payload.wrdesk_uid ?? sub`). If they differ, `getRecipientForSender` will fail (403, not 401).

### P2P-DEBUG Logging Added

Temporary logging in `p2pTransport.ts` `sendCapsuleViaHttpWithAuth`:
- Endpoint, handshake_id, capsule_type
- Auth header presence
- Token first 20 chars
- Error body on non-2xx

Check Electron console or `~/.opengiraffe/electron-console.log` when 401 occurs.

---

## Problem 2: Accept Capsule Not Reaching Initiator

### Relay Routing (verified)

1. **Acceptor** calls `handshake.accept` → `registerHandshakeWithRelay` (registers initiator_user_id, acceptor_user_id) → `enqueueOutboundCapsule(accept capsule)` with `targetEndpoint = record.p2p_endpoint` (initiator's relay URL)
2. **processOutboundQueue** when `use_coordination` → ignores `row.target_endpoint`, sends to `config.coordination_url/beap/capsule` with OIDC token
3. **Coordination service** receives capsule → `identity.userId` from JWT → `getRecipientForSender(handshakeId, identity.userId)` → returns initiator_user_id
4. **storeCapsule** + **pushCapsule** to initiator (if connected via WebSocket) or store for offline pull

### Critical Prerequisite

**The handshake must be registered before the accept capsule arrives.** Registration happens in `registerHandshakeWithRelay`:
- From **acceptor** on accept (ipc.ts:546-565) — registers initiator_user_id, acceptor_user_id
- If `registerHandshakeWithRelay` fails (e.g. 401), the handshake is NOT in the registry
- Then when the accept capsule arrives, `getRecipientForSender` returns null → 403

### Initiate Capsule vs. Register

- **Initiate capsule** is now enqueued for relay delivery (Fix applied). Both `handshake.initiate` and `handshake.buildForDownload` enqueue the initiate capsule after `registerHandshakeWithRelay`.
- **registerHandshakeWithRelay** POSTs metadata to `/beap/register-handshake` (handshake_id, initiator_user_id, acceptor_user_id, emails).
- The relay uses the registry for routing; when the initiate capsule arrives, it routes to the acceptor. When the accept capsule arrives, it routes to the initiator.

### Build-for-Download Flow

When the initiator uses "Export as file" (buildForDownload):
- `persistInitiatorHandshakeRecord` — saves locally ✓
- `registerHandshakeWithRelay` — registers with relay ✓ (if use_coordination and OIDC token)
- The initiate capsule is returned as JSON for download; it is NOT enqueued to the outbound queue (by design — the file is the transport).

So the initiator's `registerHandshakeWithRelay` runs. If it 401s, the relay has no record. The acceptor later also calls `registerHandshakeWithRelay` on accept — that would create/update the registry. So the acceptor's registration is the one that matters for routing the accept capsule back.

**Root cause chain:** 401 on register (acceptor) → no registry entry → 403 when accept capsule arrives. OR 401 on accept capsule POST → capsule never reaches relay.

---

## Problem 3: Initiator Doesn't See Handshake in List

### Root Cause (FIXED)

**Different database used for write vs. read.**

- **handshake:initiate** and **handshake:buildForDownload** IPC handlers used `vs?.getDb()` (vault DB)
- **handshake:list** uses `getHandshakeDb()` → ledger DB first, vault fallback
- Result: persist wrote to vault, list read from ledger → record invisible

**Fix applied:** Both initiate and buildForDownload now use `await getHandshakeDb()` so they write to the same DB (ledger) that list reads from.

### Local Persistence (verified)

- **handshake.initiate** and **handshake.buildForDownload** both call `persistInitiatorHandshakeRecord` before returning
- This inserts into `handshakes` via `insertHandshakeRecord`
- `listHandshakeRecords` queries `SELECT * FROM handshakes WHERE 1=1` with optional state/relationship_id filter, no default filter that would hide PENDING_ACCEPT

### Accept Capsule Roundtrip

When the initiator has no local handshake record, `processHandshakeCapsule` rejects accept capsules with `HANDSHAKE_NOT_FOUND` (ownership step). The fix above ensures the record exists in the ledger before the accept capsule arrives via WebSocket.

---

## Fix Priority

1. **401 first** — Fix OIDC audience (Keycloak mapper or COORD_OIDC_AUDIENCE) so register and capsule POST succeed.
2. **Verify user ID consistency** — Ensure `wrdesk_user_id` used in registration matches JWT `sub` (or that the relay uses the same identifier).
3. **Initiator list** — If 401 is fixed and handshakes still don't appear, add the DB debug query and check UI filters.

---

## Files Reference

| File | Purpose |
|-----|---------|
| `electron/main/handshake/outboundQueue.ts` | processOutboundQueue, getOidcToken usage |
| `electron/main/handshake/p2pTransport.ts` | sendCapsuleViaCoordination, sendCapsuleViaHttpWithAuth (P2P-DEBUG logging) |
| `electron/main.ts` | getOidcToken definition (ensureSession, getAccessToken) |
| `electron/main/handshake/ipc.ts` | handshake.initiate, handshake.accept, handshake.buildForDownload, enqueueOutboundCapsule |
| `electron/main/p2p/relaySync.ts` | registerHandshakeWithRelay (OIDC for coordination) |
| `packages/coordination-service/src/auth.ts` | validateOidcToken, audience check |
| `packages/coordination-service/src/server.ts` | /beap/capsule, /beap/register-handshake |
| `packages/coordination-service/src/handshakeRegistry.ts` | getRecipientForSender |
| `electron/main/handshake/db.ts` | listHandshakeRecords |
| `electron/main/handshake/initiatorPersist.ts` | persistInitiatorHandshakeRecord |

---

## Quick Checks to Run

```bash
# 1. Relay logs for this handshake
ssh relay.wrdesk.com
podman logs coordination-service 2>&1 | grep "53574856"

# 2. Audience/401 in relay logs
podman logs coordination-service 2>&1 | grep -i "audience\|401\|unauthorized" | tail -20

# 3. Token aud is now logged automatically
# Check ~/.opengiraffe/electron-console.log for:
#   [P2P-DEBUG] Token aud: <value> — relay expects COORD_OIDC_AUDIENCE to match
# Or decode manually: echo "<jwt-middle-segment>" | base64 -d 2>/dev/null | python3 -m json.tool

# 4. What the relay expects
podman exec -it coordination-service env | grep COORD_OIDC_AUDIENCE
```

---

## Fix: OIDC Audience Mismatch (401)

### Option A: Match env var to Keycloak

If the token already has `aud: "account"` or `aud: "wrdesk-client"`, set on relay:

```bash
COORD_OIDC_AUDIENCE=wrdesk-client   # whatever the token contains
```

### Option B: Add audience mapper in Keycloak

1. Realm `wrdesk` → Clients → Electron app client
2. Client Scopes → Dedicated scope → Add mapper → "Audience"
3. Set "Included Client Audience" to match `COORD_OIDC_AUDIENCE` (e.g. `https://relay.wrdesk.com`)
4. Log out and back in on Electron to get a fresh token

### Option C: Temporary fallback (testing only)

Unset `COORD_OIDC_AUDIENCE` on relay, or set `NODE_ENV=staging` to bypass the production guard. **Re-enable once Keycloak is configured.**
