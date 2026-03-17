# Outbound Path Trace

**Date:** 2025-03-15  
**Context:** Trace every outbound path for BEAP packages — download, email, P2P, relay — and handshake key exchange blocker.

---

## PATH A — Download (.beap file to disk)

### User clicks Send/Download → buildPackage() → .beap file downloaded

**Yes.** Flow:
- `executeDeliveryAction(config)` with `config.deliveryMethod === 'download'`
- → `buildPackage(config)` → `executeDownloadAction(pkg, config)`
- `executeDownloadAction`: `JSON.stringify(pkg)` → `Blob` → `URL.createObjectURL` → `<a href=url download=filename>.click()` → `URL.revokeObjectURL`

### buildResult.pkg vs buildResult.package mismatch — fixed?

**Yes.** `BeapPackageBuilder.ts` and consumers use `buildResult.package`:
- `executeDeliveryAction` line 2082: `if (!buildResult.success || !buildResult.package)`
- `useReplyComposer` lines 381, 414: `buildResult.package`
- `useBulkSend` lines 143, 163, 167: `buildResult.package`
- BEAP_DIAGNOSTIC_ANALYSIS.md described the bug; code now uses `package`.

### PRIVATE mode always calls sendViaHandshakeRefresh, never download — fixed?

**Yes.** Sidepanel logic (lines 451–476):
- `useHandshakeRefresh` only when: `handshakeDelivery === 'email'` AND `beapRecipientMode === 'private'` AND `selectedRecipient` with `handshake_id`
- For `handshakeDelivery === 'download'`: goes to `executeDeliveryAction(config)` with `deliveryMethod: 'download'`
- PRIVATE + download correctly uses package builder + executeDownloadAction.

### Download mechanism

**Blob URL + anchor click.** Not `chrome.downloads.download`. Uses:
```ts
const blob = new Blob([packageJson], { type: 'application/json' })
const url = URL.createObjectURL(blob)
const link = document.createElement('a')
link.href = url
link.download = pkg.metadata.filename
link.click()
URL.revokeObjectURL(url)
```

### MVP: user builds pBEAP → downloads .beap → manually imports on other side

**Yes.** Works for both pBEAP (PUBLIC) and qBEAP (PRIVATE with handshake keys).

### Status: ✅

---

## PATH B — Email Send (.beap as email attachment)

### User composes BEAP message → attach .beap to email → send via connected account

**Stub.** `executeEmailAction` (BeapPackageBuilder.ts:1876–1925):
- Builds `emailContract` via `buildEmailTransportContract` (subject, body, attachments)
- Validates via `validateEmailTransportContract`
- **Simulates send:** `await new Promise(resolve => setTimeout(resolve, 500))` — no real email API call
- Returns success with `message: 'BEAP™ ... package sent to ...'`

### Does the email sending actually work?

**No.** It is a stub. Comment: "Stub: In production, would integrate with email provider." No call to `emailGateway.sendEmail` or equivalent.

### For depackaged email replies: plain email with WR Desk signature

**Different path.** Inbox reply composer (`useReplyComposer`) for email mode:
- `buildPackage` + `executeEmailAction` — same stub. So inbox email replies also do not actually send.
- `EMAIL_SIGNATURE` is appended; `executeEmailAction` still simulates.

### Status: ❌

**Shortest path:** Wire `executeEmailAction` to Electron `emailGateway.sendEmail` (or extension equivalent) with `emailContract` (to, subject, body, attachments). The contract already has `attachments[0]` as the .beap file.

---

## PATH C — P2P Send (direct to peer orchestrator)

### KNOWN: NOT IMPLEMENTED?

**Actually implemented.** Flow:
1. `executeP2PAction(pkg, config)` → `sendBeapViaP2P(handshakeId, packageJson)` (handshakeRpc)
2. IPC `handshake.sendBeapViaP2P` → `enqueueOutboundCapsule(db, handshakeId, targetEndpoint, pkg)`
3. `processOutboundQueue(db, getOidcToken)` → sends via `sendCapsuleViaCoordination` or `sendCapsuleViaHttp`

### Requirements

- `config.selectedRecipient` with `handshake_id` and `p2pEndpoint` (non-empty)
- Handshake must be ACTIVE
- `record.p2p_endpoint` must be set (recipient's orchestrator URL)
- Coordination mode: OIDC token, `coordination_url` configured
- Direct mode: POST to `target_endpoint` (recipient's `/beap/ingest`)

### Status: ⚠️

- **Implemented** for Electron (IPC → outbound queue → coordination/HTTP)
- **Extension:** Calls `sendBeapViaP2P` via RPC; requires Electron backend. Standalone extension has no backend → RPC fails.
- **Gaps:** Recipient must run orchestrator with `/beap/ingest`; `p2p_endpoint` must be populated (from handshake accept/context_sync).

---

## PATH D — Relay Forward (via hosted relay)

### Architecture

Local orchestrator → relay endpoint → recipient relay → recipient orchestrator.

### Current state

- `processOutboundQueue` uses either:
  - `sendCapsuleViaCoordination` → POST to `coordination_url/beap/capsule` (OIDC)
  - `sendCapsuleViaHttp` → POST to `target_endpoint` (recipient's URL)
- Relay pull (`relayPull.ts`) fetches from relay; outbound goes to coordination or direct.
- No dedicated "relay forward" path — coordination URL can point at a relay service.

### What would be needed for explicit relay forward

1. Relay server: `/beap/ingest` or `/beap/capsule` endpoint accepting capsules, storing by recipient, exposing pull API.
2. Recipient registration: Store `relay_user_id` or similar so relay knows where to deliver.
3. Pull integration: Recipient `relayPull` fetches from relay by user ID.
4. Outbound: When `target_endpoint` is a relay URL, enqueue with relay as target; relay routes to recipient's pull queue.

### Status: ❌

- Relay pull exists for inbound. Outbound to relay is not explicitly implemented as "relay forward" — coordination mode may act as relay if coordination_url is a relay service.

---

## HANDSHAKE KEY EXCHANGE BLOCKER

### qBEAP requires recipient's X25519 + ML-KEM public keys

**Yes.** Builder uses `recipient.peerX25519PublicKey` for ECDH; `peerPQPublicKey` for ML-KEM hybrid.

### Handshake only exchanged Ed25519 signing keys — was key exchange fix applied?

### a. DB columns: peer_x25519_public_key_b64, peer_mlkem768_public_key_b64?

**Yes.** `db.ts` migration (lines 547–548):
```sql
ALTER TABLE handshakes ADD COLUMN peer_x25519_public_key_b64 TEXT
ALTER TABLE handshakes ADD COLUMN peer_mlkem768_public_key_b64 TEXT
```
`listHandshakeRecords` / `deserializeHandshakeRecord` include them (lines 657–658, 697–698).

### b. buildInitiateCapsuleCore: includes sender_x25519_public_key_b64?

**Yes.** `capsuleBuilder.ts` line 322:
```ts
...(opts.sender_x25519_public_key_b64 ? { sender_x25519_public_key_b64: opts.sender_x25519_public_key_b64 } : {}),
```
Initiate/accept builders pass key agreement from session/keypair.

### c. RecipientHandshakeSelect: copies peerX25519PublicKey?

**Yes.** `RecipientHandshakeSelect.tsx` line 53:
```ts
peerX25519PublicKey: hs.peerX25519PublicKey,
peerPQPublicKey: hs.peerPQPublicKey,
```
`handshakeRpc` `normalizeRecord` maps `raw.peer_x25519_public_key_b64` → `peerX25519PublicKey`.

### d. Upgrade path for existing ACTIVE handshakes?

**No.** `hasHandshakeKeyMaterial` requires both `peerX25519PublicKey` and `peerPQPublicKey`. Handshakes without keys are not selectable for PRIVATE mode. No automatic upgrade — user must re-establish handshake (new initiate/accept with key exchange).

### Status: ⚠️

- **New handshakes:** Key exchange applied. Initiate includes X25519/ML-KEM; acceptor stores peer keys; RecipientHandshakeSelect passes them.
- **Existing ACTIVE handshakes:** No upgrade. `peer_x25519_public_key_b64` / `peer_mlkem768_public_key_b64` are null → handshake not selectable for qBEAP.
- **MVP:** pBEAP works without keys. qBEAP requires new handshakes (post-fix).

---

## Summary Table

| Path | Status | Notes |
|-----|--------|-------|
| **A — Download** | ✅ | buildResult.package fixed; PRIVATE+download uses executeDeliveryAction; Blob + anchor click |
| **B — Email** | ❌ | executeEmailAction is stub; no real send |
| **C — P2P** | ⚠️ | Implemented in Electron; extension needs backend; recipient needs p2p_endpoint |
| **D — Relay** | ❌ | No explicit relay forward; coordination may act as relay |
| **Key exchange** | ⚠️ | New handshakes have keys; existing handshakes need re-establish for qBEAP |

---

## MVP Demo: Outbound

| Requirement | Status |
|-------------|--------|
| Build pBEAP → Download .beap | ✅ |
| Build qBEAP → Download .beap | ⚠️ (requires new handshake with keys) |
| Email send with .beap attachment | ❌ (stub) |
| P2P send to peer | ⚠️ (Electron + recipient orchestrator) |
