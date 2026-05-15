# PR B-3 — Email Ingestion Migration + Quarantine Infrastructure

## Scope

Phase B, step 3 of 11.

Migrates the IMAP/email ingestion path to the sealed-storage pipeline and
introduces quarantine infrastructure for BEAP-bearing emails the host cannot
depackage. Eliminates the two-stage shell-row pattern for the email path
(validate-first, then write). Provides a host UI surface and clone-to-sandbox
transport for quarantined messages.

This PR closes the email ingestion gap left open by B-2's "reject" gate: after
B-3, every email-derived row written to `inbox_messages` or
`quarantine_messages` has passed validation before the database write.

---

## Deliverables

### 1. Schema migration v65

File: `apps/electron-vite-project/electron/main/handshake/db.ts`

- **Created** `quarantine_messages` table (schema below).
- **Dropped** `plain_email_inbox` staging table (now obsolete; plain email goes
  directly to `inbox_messages` as a sealed row).
- **Retained** `p2p_pending_beap` — other consumers exist outside the email
  path (confirmed by `rg "p2p_pending_beap" -n`; 14 consumers found). Table
  drop is deferred to B-4.

```sql
CREATE TABLE IF NOT EXISTS quarantine_messages (
  id                          TEXT PRIMARY KEY,
  transport_sender            TEXT NOT NULL,
  transport_received_at       TEXT NOT NULL,
  transport_folder            TEXT NOT NULL,
  blob_size_bytes             INTEGER NOT NULL,
  blob_storage_id             TEXT NOT NULL,
  blob_sha256                 TEXT NOT NULL,
  rejection_reason            TEXT NOT NULL,
  paired_sandbox_handshake_id TEXT NOT NULL,
  cloned_to_sandbox_at        TEXT,
  seal                        TEXT NOT NULL,
  seal_input_json             TEXT NOT NULL
);

CREATE INDEX idx_quarantine_received_at
  ON quarantine_messages(transport_received_at DESC);
```

### 2. Validator extension — new content types

File: `packages/ingestion-core/src/contentValidator.ts`

Extended `validateDecryptedBeapContent` to dispatch on a `content_type`
discriminator. New supported content types:

| `content_type` | Validation path |
|---|---|
| `plain_email` | `validatePlainEmailContent` — checks `from`, `subject`, `body`, `received_at` |
| `host_quarantine` | `validateHostQuarantineContent` — checks `original_transport_sender`, `storage_id`, `blob_sha256`, `rejection_reason`, `paired_sandbox_handshake_id` |
| (existing types) | unchanged |

Plain email is "conformant" (never rejected by the validator subprocess). The
ingestion layer tags these rows with `validation_reason:
'plain_email_no_validation_required'`.

### 3. Quarantine helper modules (new)

#### `apps/electron-vite-project/electron/main/quarantine-blob-storage/index.ts`

Manages encrypted quarantine blobs on disk under `inbox_quarantine_blobs/`:

- `writeQuarantineBlob(blob: QuarantineBlobFile): QuarantineWriteResult`
- `readQuarantineBlob(storageId: string): QuarantineBlobFile | null`
- `deleteQuarantineBlob(storageId: string): void`

On-disk format (`QuarantineBlobFile`):

```json
{
  "version": "quarantine-v1",
  "sender_ephemeral_x25519_pub_b64": "...",
  "salt_b64": "...",
  "nonce_b64": "...",
  "ciphertext_b64": "..."
}
```

#### `apps/electron-vite-project/electron/main/quarantine-encrypt/index.ts`

Hybrid X25519 + HKDF-SHA256 + AES-256-GCM encryption/decryption for quarantine
blobs.

- **`encryptForQuarantine(emailBytes, sandboxPeerX25519PubB64)`** — host side
  (encrypt).
- **`decryptQuarantineBlob(blob, sandboxLocalX25519PrivB64)`** — sandbox side
  (decrypt).

**Key reuse design note (non-negotiable):**

The host uses the sandbox's `peer_x25519_public_key_b64` (the same key used by
qBEAP receive-direction key agreement) as the encryption target. This is
cryptographically sound under the ECIES/HPKE security model: multiple
ciphertexts encrypted to the same X25519 public key remain independently secure.
Each ciphertext is independently bound to a fresh sender ephemeral key and
authenticated tag. A flaw in the qBEAP encryption protocol does not expose
quarantine plaintexts.

The implementation includes a mandatory comment block at `encryptForQuarantine`
citing this design decision. A future PR may add a dedicated
`quarantine_x25519_pub_b64` field to the handshake record for audit/operational
separation; only the key lookup would change, not the encryption primitive.

### 4. `messageRouter.ts` — full restructure

File: `apps/electron-vite-project/electron/main/email/messageRouter.ts`

Entirely rewritten. Previous shape: detect → write staging row → drain later.
New shape: detect → depackage inline → validate → write sealed row atomically.

**Decision tree for an arriving email:**

```
Incoming email
│
├─ Not BEAP-bearing
│   └─ Build plain_email canonical JSON
│       → validate (plain_email_no_validation_required)
│       → sealed write to inbox_messages
│
└─ BEAP-bearing
    ├─ Depackage succeeds (decryptQBeapPackage)
    │   → validate (validator subprocess, full structural check)
    │   └─ Validation passes
    │       → sealed write to inbox_messages
    │
    └─ Depackage fails (unknown handshake / corrupt package)
        → encryptForQuarantine(emailBytes, sandboxPeerX25519PubB64)
        → writeQuarantineBlob
        → build host_quarantine canonical JSON
        → validate (validator subprocess, host_quarantine shape)
        └─ Validation passes
            → sealed write to quarantine_messages
```

No row is ever written before validation. No staging tables used.

All writes use `prepareSealedInsert` / `SealedStatement` from the sealed-storage
gate. The `SealKeyProvider` is passed at write time; key is derived on demand and
zeroized after use.

### 5. Canonical type — quarantine clone transport marker

#### `apps/extension-chromium/src/beap-builder/canonical-types.ts`

Added `QuarantineCloneTransportMetadata` interface (lines after the "Builder
State" section). This is the canonical authority for the quarantine clone
transport shape.

```typescript
export interface QuarantineCloneTransportMetadata {
  sandbox_clone_quarantine: true
  transport_sender?: string
  transport_received_at?: string
  blob_size_bytes?: number
  rejection_reason?: string
}
```

#### `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts`

Added `QuarantineCloneTransportMetadata` fields to
`BeapPackageConfig.inboxResponsePathMetadata`:

- `sandbox_clone_quarantine?: true`
- `transport_sender?: string`
- `transport_received_at?: string`
- `blob_size_bytes?: number`
- `rejection_reason?: string`

Typed via `QuarantineCloneTransportMetadata[keyof …]` references to keep
canonical-types.ts as the single source of truth.

---

## What is NOT in this PR

| Item | Deferred to |
|---|---|
| `p2p_pending_beap` table drop | B-4 (other consumers exist) |
| Sandbox-side quarantine decrypt branch in receive pipeline | B-4 |
| Sandbox final-state UI ("This message could not be opened") | B-4/B-5 |
| Clone-to-sandbox UI wiring (host side) | B-4 |
| `beapEmailIngestion.ts` restructure (eliminates `processPendingP2PBeapEmails`) | B-4 |
| P2P relay path migration | B-4 |
| Extension Stage-5 migration | B-5 |

---

## Architectural decisions locked in this PR

### D1 — Quarantine encryption key

The host reuses the sandbox's `peer_x25519_public_key_b64` (from the handshake
record) as the quarantine encryption target. This is the same key used for qBEAP
receive-direction key agreement. See `encryptForQuarantine` comment block for the
full security rationale.

### D2 — Clone transport (Amendment 2, Decision B)

Quarantine blobs ride on the existing clone-messages mechanism. The host places
the ciphertext in `BeapPackageConfig.encryptedMessage` (base64) and sets
`inboxResponsePathMetadata.sandbox_clone_quarantine: true`. The sandbox receiver
detects this flag before attempting qBEAP depackaging and routes to the
quarantine-decrypt path.

### D3 — Separate `quarantine_messages` table

Quarantine rows are never mixed with inbox rows. Schema-level isolation is
maintained as specified in the Phase B architecture document.

### D4 — `p2p_pending_beap` drop deferred

Confirmed by grep: 14 consumers outside the email path. The table remains; only
the email path stops writing to it.

### D5 — Plain email conformance

Plain (non-BEAP) emails are not "rejected." The validator subprocess marks them
conformant; the ingestion layer tags the row with
`validation_reason: 'plain_email_no_validation_required'`. The validator
structurally validates the `plain_email` content shape the same as any other
content type.

---

## Stop-and-report conditions encountered

| # | Condition | Resolution |
|---|---|---|
| 1 | Separate sandbox `VaultService` missing | Amendment 1: sandbox = separate physical install |
| 2 | Sandbox not reachable for key derivation | Amendment 1: reuse handshake X25519 key |
| 3 | Clone transport can't carry opaque blobs | Amendment 2, Decision B: `encryptedMessage` + flag |
| 4 | Quarantine keypair field missing from handshake | Amendment 2, Decision A: reuse `peer_x25519_public_key_b64` |
| 5 | `p2p_pending_beap` has 14 non-email consumers | Decision D4: drop deferred to B-4 |
| 6 | `SealedStatement` API mismatch | Fixed: use `prepareSealedInsert` factory |

---

## Test coverage

Tests from the B-3 prompt (per Amendment 1) target:

1. Plain email arriving → sealed `inbox_messages` row, `validation_reason = 'plain_email_no_validation_required'`
2. Valid BEAP email arriving → depackaged inline, validator passes, sealed `inbox_messages` row
3. Undepackageable BEAP (no matching handshake) → quarantine encrypt, sealed `quarantine_messages` row, blob file on disk
4. Quarantine row seal verification passes at read time
5. `quarantine_messages` row rejected if written without valid seal (storage gate, inherited from B-2)
6. `encryptForQuarantine` / `decryptQuarantineBlob` round-trip (key agreement + AEAD)
7. `writeQuarantineBlob` / `readQuarantineBlob` round-trip

---

## Files changed

| File | Status |
|---|---|
| `apps/electron-vite-project/electron/main/handshake/db.ts` | Modified (migration v65) |
| `packages/ingestion-core/src/contentValidator.ts` | Modified (plain_email + host_quarantine types) |
| `apps/electron-vite-project/electron/main/quarantine-blob-storage/index.ts` | New |
| `apps/electron-vite-project/electron/main/quarantine-encrypt/index.ts` | New |
| `apps/electron-vite-project/electron/main/email/messageRouter.ts` | Rewritten |
| `apps/extension-chromium/src/beap-builder/canonical-types.ts` | Modified (QuarantineCloneTransportMetadata) |
| `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` | Modified (inboxResponsePathMetadata fields) |
