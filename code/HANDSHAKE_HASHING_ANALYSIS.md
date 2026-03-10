# Handshake Hashing & Context Proof Chain — Code Analysis

**Purpose:** Trace the complete lifecycle of context block hashes from creation through verification. This document answers the analysis questions and flags any broken or missing steps.

---

## 1. CONTEXT BLOCK CREATION (before handshake initiation)

### Where is the context block created?

**File:** `apps/electron-vite-project/electron/main/handshake/ipc.ts`

- **`buildContextBlocksFromParamsWithPolicy`** (lines 100–141): Builds `ContextBlockForCommitment[]` from raw client params (`rawBlocks`, `rawMessage`).
- **`resolveProfileIdsToContextBlocks`** (lines 147–184): Resolves Vault Profile IDs to blocks when acceptor attaches profiles during accept.

### What function computes `block_hash`?

**File:** `apps/electron-vite-project/electron/main/handshake/contextCommitment.ts`

```typescript
// Lines 54–57
export function computeBlockHash(content: Record<string, unknown> | string): string {
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  return createHash('sha256').update(serialized, 'utf8').digest('hex')
}
```

**Input:** Canonical content only — string or JSON-stringified object. No metadata (block_id, type, etc.) is included.

**Data flow:**
- `ipc.ts` lines 115–116, 129, 171: `computeBlockHash(b.content)` or `computeBlockHash(content)`.
- Hash is computed over the raw content string/JSON.

### Where is the block stored at this point?

**Before initiate:** Blocks are not persisted to `context_blocks` until ingestion. They live in memory as `ContextBlockForCommitment[]` and are passed to `buildInitiateCapsuleWithContent`.

**After initiate:** Initiator persists to `context_store` (not `context_blocks`) via `initiatorPersist.ts`:

- **File:** `initiatorPersist.ts` lines 147–168
- **Table:** `context_store` (block_id, block_hash, handshake_id, content, status: `pending_delivery`, etc.)
- **Note:** `context_blocks` is populated later when content is ingested (e.g. via `context_sync` or `ingestContextBlocks`).

### Is the hash stored alongside the block?

**Yes.** In `context_blocks`: column `block_hash` (TEXT NOT NULL).  
In `context_store`: column `block_hash` (TEXT NOT NULL).

**Status:** Working correctly.

---

## 2. INITIATE CAPSULE CONSTRUCTION

### How is `context_block_proofs` assembled?

**File:** `apps/electron-vite-project/electron/main/handshake/capsuleBuilder.ts`

**Finding:** The **initiate** capsule does **not** set `context_block_proofs`. It uses `context_blocks` instead.

- **Line 307:** `context_blocks: canonicalBlocks ? stripContentFromBlocks(canonicalBlocks) : []`
- **`context_block_proofs`** is an optional field used only for **refresh** capsules (lines 408–409).

### What data goes into each proof entry?

For **initiate**, the wire format uses `context_blocks` (not `context_block_proofs`):

**File:** `contextCommitment.ts` lines 40–48

```typescript
export function stripContentFromBlocks(blocks): ContextBlockWireProof[] {
  return blocks.map(b => ({
    block_id: b.block_id,
    block_hash: b.block_hash,
    type: b.type,
    scope_id: b.scope_id ?? null,
  }))
}
```

Each wire block has: `block_id`, `block_hash`, `type`, `scope_id`. No content.

### How is `context_commitment` computed?

**File:** `contextCommitment.ts` lines 65–72

```typescript
export function computeContextCommitment(blocks): string | null {
  if (!blocks || blocks.length === 0) return null
  const hashes = blocks.map(b => b.block_hash).sort()
  const concatenated = hashes.join('')
  return createHash('sha256').update(concatenated, 'utf8').digest('hex')
}
```

**Input:** Sorted concatenation of all `block_hash` values. **Not** a Merkle root — single SHA-256 over concatenated hashes.

### Is `context_hash` different from `context_commitment`?

**Yes.**

| Field | Meaning | Computation |
|-------|---------|-------------|
| `context_hash` | Tamper-evident hash over capsule metadata (identity, timestamp, nonce, policy, etc.) | `contextHash.ts` — SHA-256 over canonical payload (no block hashes) |
| `context_commitment` | Aggregate commitment over context block hashes | SHA-256(sorted(block_hash[]).join('')) |

### Are raw context block payloads excluded from the wire format?

**Yes.** `stripContentFromBlocks` removes content. Wire blocks carry only `block_id`, `block_hash`, `type`, `scope_id`.

### Code path: "user clicks send handshake" → capsule built

1. **`ipc.ts`** `handshake.initiate` (or `handshake.buildForDownload`) → `buildContextBlocksFromParamsWithPolicy` → blocks with `block_hash` from `computeBlockHash(content)`.
2. **`buildInitiateCapsuleWithContent`** (capsuleBuilder.ts 531–538) → `buildInitiateCapsuleCore` (228–315).
3. `canonicalizeBlockIds` assigns `ctx-{shortId}-{NNN}`.
4. `computeContextCommitment(canonicalBlocks)` → `context_commitment`.
5. `stripContentFromBlocks(canonicalBlocks)` → `context_blocks` (proof-only).
6. Capsule built with `context_commitment`, `context_blocks`, `capsule_hash` (includes `context_commitment`).

**Status:** Working correctly.

---

## 3. CAPSULE SIGNING & INTEGRITY

### What is `capsule_hash` and how is it computed?

**File:** `capsuleHash.ts` lines 63–106

**Input:** Canonical fields: `capsule_type`, `handshake_id`, `relationship_id`, `schema_version`, `sender_wrdesk_user_id`, `receiver_email`, `seq`, `timestamp`, plus type-specific fields (`sharing_mode`, `prev_hash`, `wrdesk_policy_hash`, `wrdesk_policy_version`, **`context_commitment`**).

**Algorithm:** Sorted keys, JSON.stringify, SHA-256.

### Does `capsule_hash` include `context_block_proofs` / `context_commitment`?

**`context_commitment`:** Yes (lines 90–92). It is part of the hash input when non-null.

**`context_block_proofs`:** No. They are not in the hash. Only `context_commitment` (the aggregate) is included. Individual proofs are carried in `context_blocks`, and the commitment binds them.

### What key signs the capsule?

**File:** `signatureKeys.ts` — `signCapsuleHash(capsuleHash, privateKey)` produces Ed25519 signature.

**File:** `capsuleBuilder.ts` line 274: `signCapsuleHash(capsuleHash, keypair.privateKey)`.

### What is `countersigned_hash`?

**File:** `capsuleBuilder.ts` lines 299–302

On **accept** only: acceptor signs the **initiator’s** `capsule_hash` with their private key. Proves the acceptor saw and endorsed the initiate capsule.

**Status:** Working correctly.

---

## 4. CAPSULE RECEIVING & PROOF STORAGE

### When the acceptor receives an initiate capsule, what function processes it?

**Import path:** `processIncomingInput` → `persistRecipientHandshakeRecord` (recipientPersist.ts).

**Relay path:** `processHandshakeCapsule` (enforcement.ts) — used when initiate arrives via coordination (initiate is normally file/email, not relay).

### Are `context_block_proofs` from the received capsule stored?

**Initiate** does not send `context_block_proofs`; it sends `context_blocks`. Those proof-only blocks are **not** ingested because they have no content:

**File:** `contextIngestion.ts` lines 99–101

```typescript
if (block.content === null || block.content === undefined) {
  continue  // Skip hash-only proof blocks
}
```

So initiate’s `context_blocks` (proof-only) are intentionally skipped. Content arrives later via `context_sync`.

### Is `context_commitment` from the received capsule stored?

**Yes.**

- **recipientPersist.ts** line 107: `initiator_context_commitment: c.context_commitment ?? null`
- **enforcement.ts** `buildInitiateRecord` line 581: `initiator_context_commitment: input.context_commitment ?? null`
- **enforcement.ts** `buildAcceptRecord` line 619: `acceptor_context_commitment: input.context_commitment ?? null`

Stored in `handshakes` table columns `initiator_context_commitment`, `acceptor_context_commitment`.

### Is `capsule_hash` verified against `sender_signature` on receipt?

**Yes.** **File:** `enforcement.ts` lines 150–161

1. `verifyCapsuleHashIntegrity(input)` — recomputes `capsule_hash` from canonical fields.
2. `verifyCapsuleSignature(input.capsule_hash, senderSignature, senderPublicKey)` — Ed25519 verify.

### Is `context_commitment` re-derived and compared?

**For initiate/accept:** No. These capsules establish the stored commitment. Verification happens when content is delivered.

**For refresh:** Yes. **File:** `enforcement.ts` lines 366–391 — capsule’s `context_commitment` must match the stored handshake commitment for that sender role.

**For context_sync:** `ingestContextBlocks` verifies the capsule’s `context_commitment` against the received `context_blocks` (contextIngestion.ts 50–57).

**Status:** Working correctly.

---

## 5. ACCEPT CAPSULE (reverse direction)

### Does the accept capsule include `context_block_proofs` for the acceptor’s context?

**No.** Accept uses `context_blocks` (same as initiate), not `context_block_proofs`.

**File:** `capsuleBuilder.ts` line 325: `context_blocks: opts.context_blocks ? stripContentFromBlocks(opts.context_blocks) : []`

### Is the flow symmetric?

**Yes.** Same `stripContentFromBlocks`, `computeContextCommitment`, `context_blocks` wire format. Accept carries acceptor’s block proofs (and, when available, echoed initiator blocks) in `context_blocks`.

### When do both sides have both sets of proofs?

After the **context_sync** roundtrip:

1. Initiator sends `context_sync` with their blocks (content).
2. Acceptor sends `context_sync` with their blocks (content).
3. Each side ingests the other’s blocks via `ingestContextBlocks`, which verifies commitment and block hashes.

**Status:** Working correctly.

---

## 6. CONTEXT SYNC DELIVERY

### What function handles ingestion?

**File:** `contextIngestion.ts` — `ingestContextBlocks` (lines 45–166).

Called from **enforcement.ts** lines 394–401 when `rawContextBlocks` are present.

### After receiving raw content, is `block_hash` recomputed and compared?

**Yes.** **File:** `contextIngestion.ts` lines 64–72

```typescript
for (const block of input.context_blocks) {
  if (block.content === null || block.content === undefined) continue
  const recomputed = computeBlockHash(block.content)
  if (recomputed !== block.block_hash) {
    throw new Error(`Context block hash mismatch for ${block.block_id}: ...`)
  }
}
```

### If verification fails, what happens?

**Throws.** The transaction rolls back (enforcement.ts 302–344). The handshake does not transition; the capsule is rejected.

### Where is verified status stored?

Blocks are inserted into `context_blocks` only after verification. There is no separate “verified” flag — insertion implies verification passed.

**Status:** Working correctly.

---

## 7. WHAT THE REFACTOR MAY HAVE BROKEN

### Recent changes to hashing logic

- **contextBlocks.ts:** No hash computation. Only persists blocks with existing `block_hash`. **Unchanged.**
- **capsuleBuilder.ts:** Proof assembly and commitment logic unchanged. **Unchanged.**
- **contextIngestion.ts:** Verification logic unchanged. **Unchanged.**
- **db.ts:** Schema includes `block_hash`, `initiator_context_commitment`, `acceptor_context_commitment`. **Unchanged.**

### TODO comments, skip flags, empty arrays

- No TODOs or skip flags in the hash/commitment path.
- **Initiate:** `context_blocks` can be `[]` when no blocks — correct. `context_commitment` is `null` in that case.
- **`context_block_proofs`:** Initiate and accept do not set it. Only refresh optionally does (lines 408–409). This is by design; `context_blocks` serves as the proof structure for initiate/accept.

### Is `context_block_proofs` currently empty in built capsules?

**For initiate/accept:** Not used. Capsules use `context_blocks` (proof-only) instead.

**For refresh:** Set only when `opts.context_block_proofs` is provided and non-empty.

### Is `context_commitment` set to placeholder or null?

**No.** It is computed from blocks when present, or `null` when no blocks. No placeholders.

**Status:** No regressions identified in the refactor.

---

## 8. CURRENT STATE OF THE UI DISPLAY

### "LAST CAPSULE HASH" — where does it come from?

**File:** `RelationshipDetail.tsx` — Technical Details section.

**Source:** `record.last_capsule_hash_received` from the handshake record.

**DB:** `handshakes.last_capsule_hash_received` — updated by `buildInitiateRecord`, `buildAcceptRecord`, `buildRefreshRecord`, `buildContextSyncRecord`, `buildRevokeRecord` in enforcement.ts.

### Context block HASH (`bc4c0f056f…f1ce0b3087`)

**File:** `HandshakeContextSection.tsx` lines 178–204

**Source:** `block.block_hash` from `VerifiedContextBlock` (from `queryContextBlocksWithGovernance`).

**DB:** `context_blocks.block_hash` — the hash stored when the block was ingested.

**Not computed in the frontend** — it is the stored `block_hash` from the DB.

### UI element for `context_block_proofs` from initiate?

**No.** The initiate capsule’s `context_blocks` (proof-only) are not persisted. The UI shows blocks from `context_blocks` (ingested content). The initiate’s proof array is not displayed; only the aggregate `initiator_context_commitment` is shown in "Context Commitments".

### "CONTEXT COMMITMENTS" SENDER and RECEIVER

**Source:** `record.initiator_context_commitment` and `record.acceptor_context_commitment` from the handshake record.

**DB:** `handshakes.initiator_context_commitment`, `handshakes.acceptor_context_commitment`.

**Status:** Working correctly.

---

## Summary Table

| Step | File | Function | Status |
|------|------|----------|--------|
| Block hash computation | contextCommitment.ts | computeBlockHash | ✅ Working |
| Context commitment | contextCommitment.ts | computeContextCommitment | ✅ Working |
| Proof stripping (no content on wire) | contextCommitment.ts | stripContentFromBlocks | ✅ Working |
| Initiate capsule build | capsuleBuilder.ts | buildInitiateCapsuleCore | ✅ Working |
| Accept capsule build | capsuleBuilder.ts | buildAcceptCapsule | ✅ Working |
| Capsule hash (includes commitment) | capsuleHash.ts | computeCapsuleHash | ✅ Working |
| Signature over capsule_hash | signatureKeys.ts | signCapsuleHash | ✅ Working |
| Commitment storage | db.ts, enforcement.ts | initiator/acceptor_context_commitment | ✅ Working |
| Hash verification on receive | verifyCapsuleHash.ts | verifyCapsuleHashIntegrity | ✅ Working |
| Context ingestion + hash verify | contextIngestion.ts | ingestContextBlocks | ✅ Working |
| Block hash in UI | HandshakeContextSection.tsx | block.block_hash | ✅ Working |
| Commitment hashes in UI | RelationshipDetail.tsx | CopyableHash | ✅ Working |

**Conclusion:** The handshake hashing and context proof chain is implemented correctly. No broken or bypassed steps were found. The refactor did not introduce regressions in the hash/commitment logic.
