# Handshake Key Exchange Gap — Diagnostic Report

## Executive Summary

The handshake establishment flow exchanges **relational context** (business identity, VAT, policy, etc.) and **Ed25519 signing keys** for capsule verification, but **never exchanges X25519 or ML-KEM-768 public keys** required for qBEAP encryption. The capsule builder correctly checks for `peerX25519PublicKey` and fails closed when absent. The fields exist in type definitions but are **never populated** anywhere in the pipeline.

---

## 1. TRACE: Handshake Establishment Flow End-to-End

### 1.1 Initiation — What Data Is Sent?

**Location:** `apps/electron-vite-project/electron/main/handshake/capsuleBuilder.ts`

- **Function:** `buildInitiateCapsuleCore` (lines 228–311)
- **Capsule wire format:** `HandshakeCapsuleWire` (lines 42–83)

**Data sent in initiate capsule:**
- `sender_public_key` — Ed25519 (64-char hex) for signing
- `sender_signature` — Ed25519 signature over capsule_hash
- `p2p_endpoint`, `p2p_auth_token` — optional P2P config
- Context blocks, policy hash, tier signals, etc.

**NOT sent:** No `sender_x25519_public_key_b64`, no `sender_mlkem768_public_key_b64`.

### 1.2 Acceptance — What Data Comes Back?

**Location:** Same file, `buildAcceptCapsule` (lines 340–446)

**Data sent in accept capsule:**
- `sender_public_key` — Acceptor's Ed25519 public key
- `sender_signature` — Acceptor's signature
- `countersigned_hash` — Acceptor's signature over initiator's capsule_hash
- `sharing_mode`, context blocks, etc.

**NOT sent:** No X25519 or ML-KEM public keys.

### 1.3 Handshake Type / Interface — Crypto-Related Fields

**Extension-side types** (`apps/extension-chromium/src/handshake/types.ts`):

| Field | Lines | Purpose |
|-------|-------|---------|
| `peerX25519PublicKey?: string` | 78 | Peer's X25519 public key (base64) |
| `localX25519KeyId?: string` | 85 | Local keypair ID |
| `peerMlkem768PublicKeyB64?: string` | 99 | Peer's ML-KEM-768 public key |
| `localMlkem768KeyId?: string` | 104 | Local ML-KEM keypair ID |
| `keyAgreementVersion?: number` | 113 | 1 = X25519 only, 2 = Hybrid |

**HandshakeRequest** (lines 152–191): `senderX25519PublicKeyB64`, `senderMlkem768PublicKeyB64` — defined but **never used** by the Electron capsule builder.

**HandshakeAcceptRequest** (lines 197–235): `senderX25519PublicKeyB64`, `senderMlkem768PublicKeyB64` — same.

**Electron HandshakeRecord** (`apps/electron-vite-project/electron/main/handshake/types.ts` lines 324–366):
- `local_public_key` / `local_private_key` / `counterparty_public_key` — **Ed25519 only**
- **No** `peer_x25519_public_key` or `peer_mlkem768_public_key_b64`

**DB schema** (`apps/electron-vite-project/electron/main/handshake/db.ts`):
- Columns: `local_public_key`, `local_private_key`, `counterparty_public_key` (Ed25519)
- **No** columns for X25519 or ML-KEM keys

---

## 2. FIND: Capsule Builder's Key Lookup

### 2.1 Error String Location

**File:** `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts`  
**Lines:** 937–944

```typescript
const hasX25519KeyMaterial = hasValidX25519Key(recipient.peerX25519PublicKey)

if (!hasX25519KeyMaterial) {
  return {
    success: false,
    error: 'SECURITY: qBEAP requires cryptographic key agreement. Selected handshake has no X25519 public key. Complete the handshake key exchange before sending private messages.'
  }
}
```

### 2.2 Field Checked

- **Field:** `recipient.peerX25519PublicKey`
- **Type:** `SelectedHandshakeRecipient` (from `apps/extension-chromium/src/handshake/rpcTypes.ts` lines 33–48)
- **Also required:** `recipient.peerPQPublicKey` (line 1055) for ML-KEM-768 encapsulation

### 2.3 Where Should That Field Have Been Set?

**Recipient construction** (`apps/extension-chromium/src/beap-messages/components/RecipientHandshakeSelect.tsx` lines 45–53):

```typescript
const handleSelect = (hs: HandshakeRecord) => {
  const recipient: SelectedHandshakeRecipient = {
    handshake_id: hs.handshake_id,
    counterparty_email: hs.counterparty_email,
    counterparty_user_id: hs.counterparty_user_id,
    sharing_mode: hs.sharing_mode ?? 'receive-only',
  }
  onSelect(recipient)
}
```

`peerX25519PublicKey` and `peerPQPublicKey` are **never assigned** because `HandshakeRecord` from the backend does not include them.

**Backend record normalization** (`apps/extension-chromium/src/handshake/handshakeRpc.ts` lines 196–214):

```typescript
function normalizeRecord(raw: any): HandshakeRecord {
  // ...
  return {
    handshake_id: raw.handshake_id,
    state: raw.state,
    local_role: raw.local_role,
    counterparty_email: counterparty?.email ?? '',
    counterparty_user_id: counterparty?.wrdesk_user_id ?? '',
    relationship_id: raw.relationship_id,
    sharing_mode: raw.sharing_mode ?? undefined,
    created_at: raw.created_at,
    activated_at: raw.activated_at ?? undefined,
  }
}
```

`raw` from `handshake.list` RPC has no `peer_x25519_public_key` or `peer_mlkem768_public_key_b64` — the backend never stores or returns them.

---

## 3. FIND: Existing Key Exchange Code

### 3.1 Extension handshakeService

**File:** `apps/extension-chromium/src/handshake/handshakeService.ts`

- `getOurIdentity()` — returns X25519 public key (lines 90–115)
- `deriveFingerprintFromX25519()` — fingerprint from X25519
- **No** `createHandshakeRequestPayload` or `createHandshakeAcceptPayload` in this file (PREFLIGHT_ANALYSIS referred to logic that may have been removed or lives elsewhere)

### 3.2 Extension types (HandshakeRequest / HandshakeAcceptRequest)

**File:** `apps/extension-chromium/src/handshake/types.ts`

- `HandshakeRequest.senderX25519PublicKeyB64` (line 183)
- `HandshakeRequest.senderMlkem768PublicKeyB64` (line 190)
- `HandshakeAcceptRequest.senderX25519PublicKeyB64` (line 228)
- `HandshakeAcceptRequest.senderMlkem768PublicKeyB64` (line 231)

These types exist but are **not used** by the Electron handshake flow. The Electron app uses `buildInitiateCapsuleWithContent` / `buildAcceptCapsule`, which do not read or emit these fields.

### 3.3 TODOs / Key Exchange References

- No `keyExchange`, `handshakeKeyExchange`, or `exchangePublicKeys` functions found.
- No TODOs about key exchange in handshake code.
- Migration test (`apps/extension-chromium/src/handshake/__tests__/migration.test.ts`) explicitly asserts that `RecipientHandshakeSelect` and new types have **no** X25519/ML-KEM fields — reflecting the current design decision to keep crypto in the backend, but the backend never implemented it.

### 3.4 BEAP Capsule Protocol

**HandshakeCapsuleWire** (`capsuleBuilder.ts` lines 42–83): No fields for X25519 or ML-KEM public keys. Only `sender_public_key` (Ed25519) and `sender_signature`.

---

## 4. DESIGN: The Fix

### 4.1 Architecture Summary

| Component | Role |
|-----------|------|
| **Extension** | BEAP message builder, RecipientHandshakeSelect, X25519 device keys (`x25519KeyAgreement.ts`), qBEAP builder, PQ encapsulation via Electron `/api/crypto/pq/mlkem768/*` |
| **Electron** | Handshake DB, capsule builder, ingestion pipeline, ML-KEM API |

Key agreement keys must be:
1. Generated (X25519 in extension; ML-KEM in Electron)
2. Included in initiate/accept capsules
3. Extracted on receive and stored in handshake record
4. Returned in `handshake.list` (or `handshake.get` for builder)
5. Passed through RecipientHandshakeSelect → SelectedHandshakeRecipient → BeapPackageBuilder

### 4.2 Proposed Code Changes

#### A. DB Migration — Add Key Agreement Columns

**File:** `apps/electron-vite-project/electron/main/handshake/db.ts`

Add migration (e.g. version 7):

```sql
ALTER TABLE handshakes ADD COLUMN peer_x25519_public_key_b64 TEXT;
ALTER TABLE handshakes ADD COLUMN peer_mlkem768_public_key_b64 TEXT;
```

Update `serializeHandshakeRecord` / `deserializeHandshakeRecord` and `HandshakeRecord` type to include:
- `peer_x25519_public_key_b64?: string | null`
- `peer_mlkem768_public_key_b64?: string | null`

#### B. Capsule Wire Format — Add Key Agreement Fields

**File:** `apps/electron-vite-project/electron/main/handshake/capsuleBuilder.ts`

Extend `HandshakeCapsuleWire`:

```typescript
/** X25519 public key (base64, 32 bytes) for qBEAP key agreement */
readonly sender_x25519_public_key_b64?: string;
/** ML-KEM-768 public key (base64, 1184 bytes) for post-quantum key agreement */
readonly sender_mlkem768_public_key_b64?: string;
```

#### C. Initiation — Include Sender's Keys

**File:** `apps/electron-vite-project/electron/main/handshake/capsuleBuilder.ts`

- `buildInitiateCapsuleWithContent` (and `buildInitiateCapsuleCore`) must obtain:
  - X25519: Call extension or a new Electron API that uses the same device key. **Option:** Add `handshake.getKeyAgreementKeys` RPC that the extension invokes; Electron fetches keys from extension via message passing, or Electron generates its own X25519/ML-KEM keys and stores them.
  - Simpler approach: **Electron generates and stores X25519 + ML-KEM keys per handshake** (or per device) and includes them in the capsule. The extension would need to receive these from Electron when building qBEAP — but the extension currently uses its own X25519 device key. This creates a key identity mismatch.

**Recommended approach:** The extension holds the X25519 device key. The Electron app needs to either:
1. **Request keys from extension** via a new RPC (e.g. `handshake.getKeyAgreementKeys`) before building the capsule, or
2. **Generate keys in Electron** and store them, then return them to the extension when the extension builds qBEAP. The extension would use the Electron-stored keys for outbound and the peer's keys for derivation.

For ML-KEM, Electron already has the API (`/api/crypto/pq/mlkem768/keypair`). For X25519, Electron would need to either call into a shared module or the extension.

**Pragmatic path:** Add an IPC/RPC that the extension can call: `handshake.getKeyAgreementKeysForInitiate()`. The extension provides its X25519 public key (from `getDeviceX25519PublicKey()`). Electron generates ML-KEM keypair, returns both for inclusion in the capsule. On accept, Electron does the same. The capsule carries both keys. When the acceptor processes the initiate, it stores initiator's X25519 + ML-KEM as `peer_*`. When the initiator processes the accept, it stores acceptor's X25519 + ML-KEM as `peer_*`.

**Implementation sketch for initiate:**
- Before `buildInitiateCapsuleWithContent`, Electron calls extension (or extension sends keys in `handshake.initiate` params): `{ x25519_public_key_b64, mlkem768_public_key_b64 }`.
- `handshake.initiate` RPC accepts optional `key_agreement: { x25519_public_key_b64, mlkem768_public_key_b64 }`.
- Extension's `initiateHandshake` in handshakeRpc gets keys via `getDeviceX25519PublicKey()` and `pqGenerateKeypair()` (or similar), passes them in params.
- Capsule builder adds these to the wire capsule.
- On ingestion of initiate, acceptor pipeline extracts and stores `peer_x25519_public_key_b64`, `peer_mlkem768_public_key_b64` on the handshake record.

#### D. Acceptance — Include Acceptor's Keys

- Same pattern: `handshake.accept` RPC accepts `key_agreement: { x25519_public_key_b64, mlkem768_public_key_b64 }`.
- Extension provides keys when calling accept.
- `buildAcceptCapsule` adds them to the accept capsule.
- On ingestion of accept (initiator side), pipeline extracts and stores peer keys.

#### E. Ingestion — Extract and Store Peer Keys

**Files:** `apps/electron-vite-project/electron/main/handshake/initiatorPersist.ts`, `recipientPersist.ts`, and/or the ingestion pipeline.

- When processing a validated initiate capsule: extract `sender_x25519_public_key_b64`, `sender_mlkem768_public_key_b64` from the capsule.
- When processing a validated accept capsule: same.
- Call `updateHandshakePeerKeys(db, handshakeId, { peer_x25519_public_key_b64, peer_mlkem768_public_key_b64 })`.

Add `updateHandshakePeerKeys` in db.ts.

#### F. handshake.list — Return Key Material

**File:** `apps/electron-vite-project/electron/main/handshake/ipc.ts`

The `handshake.list` response already returns full records. Ensure `listHandshakeRecords` → `deserializeHandshakeRecord` includes the new columns. The records will then have `peer_x25519_public_key_b64` and `peer_mlkem768_public_key_b64`.

#### G. Extension normalizeRecord — Pass Through Keys

**File:** `apps/extension-chromium/src/handshake/handshakeRpc.ts`

```typescript
function normalizeRecord(raw: any): HandshakeRecord {
  // ...existing...
  return {
    // ...existing fields...
    peerX25519PublicKey: raw.peer_x25519_public_key_b64 ?? undefined,
    peerPQPublicKey: raw.peer_mlkem768_public_key_b64 ?? undefined,
  }
}
```

#### H. Extension rpcTypes — HandshakeRecord

**File:** `apps/extension-chromium/src/handshake/rpcTypes.ts`

Add to `HandshakeRecord` (or ensure `SelectedHandshakeRecipient` is built from a type that has them):

```typescript
readonly peerX25519PublicKey?: string;
readonly peerPQPublicKey?: string;
```

`SelectedHandshakeRecipient` already has these (lines 45–47). The `normalizeRecord` output must satisfy a type that includes them so they flow through.

#### I. RecipientHandshakeSelect — Copy Keys to Recipient

**File:** `apps/extension-chromium/src/beap-messages/components/RecipientHandshakeSelect.tsx`

```typescript
const recipient: SelectedHandshakeRecipient = {
  handshake_id: hs.handshake_id,
  counterparty_email: hs.counterparty_email,
  counterparty_user_id: hs.counterparty_user_id,
  sharing_mode: hs.sharing_mode ?? 'receive-only',
  peerX25519PublicKey: hs.peerX25519PublicKey,
  peerPQPublicKey: hs.peerPQPublicKey,
}
```

#### J. Existing ACTIVE Handshakes — Upgrade / Re-Key

For handshakes that are ACTIVE but have no `peer_x25519_public_key_b64`:

1. **Handshake detail view:** Add an "Upgrade for qBEAP" or "Complete key exchange" action.
2. **Flow:** Trigger a new "key exchange" capsule (or reuse refresh with a new `key_agreement` block). Both sides send their X25519 + ML-KEM public keys. The pipeline updates the handshake record with peer keys.
3. **Alternative:** Add a dedicated `handshake.upgradeKeyAgreement` RPC that sends a minimal capsule containing only key material, processed like a refresh but only updates `peer_*` fields.

---

## 5. Summary Table

| Location | Current State | Required Change |
|----------|---------------|-----------------|
| `capsuleBuilder.ts` HandshakeCapsuleWire | No X25519/ML-KEM fields | Add `sender_x25519_public_key_b64`, `sender_mlkem768_public_key_b64` |
| `capsuleBuilder.ts` buildInitiateCapsuleCore | Does not include key agreement keys | Accept keys as input, add to capsule |
| `capsuleBuilder.ts` buildAcceptCapsule | Same | Same |
| `db.ts` handshakes table | No key columns | Migration: add `peer_x25519_public_key_b64`, `peer_mlkem768_public_key_b64` |
| `db.ts` HandshakeRecord (Electron types) | No key fields | Add fields |
| `initiatorPersist.ts` / `recipientPersist.ts` / ingestion | Does not extract/store peer keys | Extract from capsule, call `updateHandshakePeerKeys` |
| `handshake.initiate` IPC params | No key_agreement | Accept `key_agreement` from extension |
| `handshake.accept` IPC params | No key_agreement | Same |
| Extension `initiateHandshake` | Does not send keys | Get X25519 + ML-KEM, pass in params |
| Extension `acceptHandshake` | Does not send keys | Same |
| Extension `normalizeRecord` | Does not pass keys | Add `peerX25519PublicKey`, `peerPQPublicKey` |
| Extension `HandshakeRecord` (rpcTypes) | Has optional keys | Ensure raw backend includes them |
| RecipientHandshakeSelect | Does not copy keys | Add `peerX25519PublicKey`, `peerPQPublicKey` to recipient |
| Handshake detail view | No upgrade action | Add "Complete key exchange" for ACTIVE without keys |

---

## 6. Verification Checklist

After implementing:

1. [ ] New handshake initiate includes X25519 + ML-KEM in capsule
2. [ ] New handshake accept includes X25519 + ML-KEM in capsule
3. [ ] Acceptor stores initiator's keys on handshake record when processing initiate
4. [ ] Initiator stores acceptor's keys when processing accept
5. [ ] `handshake.list` returns `peer_x25519_public_key_b64`, `peer_mlkem768_public_key_b64`
6. [ ] RecipientHandshakeSelect passes keys to SelectedHandshakeRecipient
7. [ ] BeapPackageBuilder receives `peerX25519PublicKey` and `peerPQPublicKey`, builds qBEAP successfully
8. [ ] ACTIVE handshakes without keys show upgrade option; upgrade flow populates keys
