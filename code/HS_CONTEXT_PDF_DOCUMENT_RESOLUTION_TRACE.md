# HS Context PDF Document Resolution Pipeline — Critical Bug Trace

**Purpose:** Map the complete pipeline from PDF upload in WRVault to inclusion in the context_sync capsule. Identify every point where a successfully parsed document could be dropped.

**Status:** Read-only analysis — no fixes applied.

---

## PART A — Document Resolution Pipeline

### 1. PDF Upload and Parsing in WRVault

#### 1.1 Entry Points

| Step | File | Function/Component |
|------|------|-------------------|
| UI upload | `apps/extension-chromium/src/vault/hsContext/HsContextDocumentUpload.tsx` | User selects PDF → `uploadHsProfileDocument(profileId, file)` |
| RPC | `apps/extension-chromium/src/vault/hsContextProfilesRpc.ts` | `uploadHsProfileDocument` → HTTP/WebSocket to Electron |
| Backend | `apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts` | `uploadProfileDocument` (lines 341–469) |
| Extraction | `apps/electron-vite-project/electron/main/vault/hsContextOcrJob.ts` | `runExtractionJob` (fire-and-forget via `setImmediate`) |

#### 1.2 Storage Schema

**Table: `hs_context_profile_documents`** (from `apps/electron-vite-project/electron/main/vault/db.ts` lines 512–527)

```sql
CREATE TABLE hs_context_profile_documents (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES hs_context_profiles(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  storage_key TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'confidential',
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending','success','failed')),
  extracted_text TEXT,
  extracted_at INTEGER,
  extractor_name TEXT,
  error_message TEXT,
  error_code TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  document_type TEXT,
  created_at INTEGER NOT NULL
);
```

**Additional columns** (additive migrations): `sensitive`, `label`, `document_type`, `error_code`.

#### 1.3 What Marks a Document as "Successfully Parsed"

- **Success:** `extraction_status = 'success'` AND `extracted_text` is non-null/non-empty
- **Update:** `markDocumentExtractionSuccess` in `hsContextOcrJob.ts` (lines 622–638):
  ```ts
  UPDATE hs_context_profile_documents
  SET extraction_status = 'success',
      extracted_text = ?,
      extracted_at = ?,
      extractor_name = ?,
      error_message = NULL,
      error_code = NULL
  WHERE id = ?
  ```

#### 1.4 WRVault UI Status Display

**File:** `apps/extension-chromium/src/vault/hsContext/HsContextDocumentUpload.tsx`

- **Green/complete:** `extraction_status === 'success'` → badge "Text ready" (line 79)
- **Pending:** `extraction_status === 'pending'` → badge "Extracting…"
- **Failed:** `extraction_status === 'failed'` → badge "Failed"

Documents are fetched via `getHsProfile(profileId)` which returns `ProfileDocumentSummary[]` with `extraction_status`, `extracted_text`, `error_message`, `error_code`.

---

### 2. resolveHsProfilesForHandshake — Document Query

#### 2.1 Call Chain

| Step | File | Function |
|------|------|----------|
| Accept handler | `apps/electron-vite-project/electron/main/handshake/ipc.ts` | `resolveProfileIdsToContextBlocks(profileIds, session, handshake_id)` |
| Vault ref | Same file line 156 | `vs.resolveHsProfilesForHandshake(tier, profileIds)` |
| Service | `apps/electron-vite-project/electron/main/vault/service.ts` | `resolveHsProfilesForHandshake` → `resolveProfilesForHandshake` |
| Resolution | `apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts` | `resolveProfilesForHandshake` (lines 592–612) |

#### 2.2 Document Query — NO FILTERING BY extraction_status

**File:** `hsContextProfileService.ts`

```ts
// getProfile (lines 176–194)
const docRows: HsContextProfileDocumentRow[] = db
  .prepare('SELECT * FROM hs_context_profile_documents WHERE profile_id = ? ORDER BY created_at ASC')
  .all(profileId)

return rowToDetail(row, docRows)
```

**SQL:** `SELECT * FROM hs_context_profile_documents WHERE profile_id = ? ORDER BY created_at ASC`

- **No WHERE clause** on `extraction_status`, `extracted_text`, or hash.
- **All documents** for the profile are returned regardless of status.

#### 2.3 rowToDetail Mapping

**File:** `hsContextProfileService.ts` lines 120–142

```ts
const documents: ProfileDocumentSummary[] = docRows.map((d) => ({
  id: d.id,
  filename: d.filename,
  label: d.label ?? undefined,
  document_type: d.document_type ?? undefined,
  extraction_status: d.extraction_status,
  extracted_text: d.extracted_text,
  error_message: d.error_message,
  error_code: d.error_code ?? null,
  sensitive: !!(d.sensitive ?? 0),
}))
```

- **No filtering.** Pending, success, and failed documents are all included.

---

### 3. Document → Context Block Transformation

#### 3.1 Block Construction

**File:** `apps/electron-vite-project/electron/main/handshake/ipc.ts` lines 168–191

```ts
for (let i = 0; i < resolved.length && blocks.length < MAX_BLOCKS_PER_CAPSULE; i++) {
  const { profile, documents } = resolved[i]
  const content = JSON.stringify({
    profile: { id, name, description, fields, custom_fields },
    documents: documents.map((d: any) => ({
      id: d.id,
      filename: d.filename,
      label: d.label ?? null,
      document_type: d.document_type ?? null,
      extracted_text: d.extracted_text,   // ← Can be null for pending/failed
      sensitive: !!d.sensitive,
    })),
  })
  const blockHash = computeBlockHash(content)
  blocks.push({ block_id, block_hash, type: 'vault_profile', content, ... })
}
```

- **All documents** are serialized into the block content.
- **extracted_text** is passed as-is (can be `null` or empty for pending/failed).
- **No drop** based on extraction_status or extracted_text.

#### 3.2 Context Store Insertion

**File:** `ipc.ts` lines 843–860

```ts
for (const block of receiverBlocks) {
  const contentStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
  insertContextStoreEntry(db, {
    block_id, block_hash, handshake_id, relationship_id, scope_id,
    publisher_id, type: block.type,
    content: contentStr,   // Full JSON with all documents
    status: 'pending_delivery',
    ...
  })
}
```

- Block content (including all documents) is stored in `context_store`.

#### 3.3 context_sync Capsule

**File:** `apps/electron-vite-project/electron/main/handshake/contextSyncEnqueue.ts`

- `getContextStoreByHandshake(db, handshakeId, 'pending_delivery')` returns blocks.
- `filterBlocksForPeerTransmission` filters only by `transmit_to_peer_allowed` (default: true).
- **No document-level filtering.** Entire block (with all documents) is sent.

---

### 4. Where "Not Attached" / "Failed" Status Comes From

#### 4.1 normalizeProfileToText — TEXT RENDERING ONLY

**File:** `apps/electron-vite-project/electron/main/vault/hsContextNormalize.ts` lines 318–333

```ts
for (const doc of documents) {
  if (doc.extraction_status === 'success' && doc.extracted_text) {
    lines.push(`[Document: ${docLabel}]`)
    lines.push(trimLines(doc.extracted_text))
  } else if (doc.extraction_status === 'pending') {
    lines.push(`[Document extraction pending: ${doc.filename}]`)
  } else if (doc.extraction_status === 'failed') {
    lines.push(`[Document extraction failed: ${doc.filename} — not included]`)
  }
}
```

- **Used for:** Plain-text rendering (e.g. embedding, search, display).
- **Effect:** Documents with `success` + `extracted_text` contribute text; pending/failed are labeled but do not add extracted content.
- **Not used** in `resolveProfileIdsToContextBlocks` — that path uses raw `documents` from `resolveProfilesForHandshake`.

#### 4.2 StructuredHsContextPanel — Post-Accept Display

**File:** `apps/electron-vite-project/src/components/StructuredHsContextPanel.tsx`

- Parses block payload: `parseHsContextPayload(block.payload)` → `{ profile, documents }`
- Renders `documents` from the block.
- **Documents with empty `extracted_text`:** Card shows filename/label but no preview (lines 310–354).
- **No explicit "not attached" or "failed" badge** — only presence/absence of `extracted_text` affects what is shown.

#### 4.3 HandshakeContextProfilePicker (Extension)

- Shows `document_count` per profile.
- **No per-document status** during profile selection.
- Warning: "Some profiles have documents — text extraction may still be in progress."

---

## PART B — Deterministic Hash Chain

### 5. Hash Chain Construction

#### 5.1 Block Hash

**File:** `apps/electron-vite-project/electron/main/handshake/contextCommitment.ts`

```ts
export function computeBlockHash(content: Record<string, unknown> | string): string {
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  return createHash('sha256').update(serialized, 'utf8').digest('hex')
}
```

- **Algorithm:** SHA-256 of canonical JSON.
- **Scope:** Entire block content (profile + all documents).
- **When:** At block creation in `resolveProfileIdsToContextBlocks`.

#### 5.2 Context Commitment

```ts
// SHA-256 of sorted concatenated block_hash values
const hashes = blocks.map(b => b.block_hash).sort()
const concatenated = hashes.join('')
return createHash('sha256').update(concatenated, 'utf8').digest('hex')
```

- **Scope:** All blocks in the handshake.
- **When:** During accept capsule construction.

#### 5.3 Hash Timing

- **Block hash:** Computed when `resolveProfileIdsToContextBlocks` builds blocks (accept time).
- **Commitment:** Computed when building the accept capsule.
- **Document hash:** No per-document hash; documents are part of the block content.

---

### 6. Exclusion and Manifest

#### 6.1 Current Behavior

- **No manifest** of excluded documents.
- **No receipt** listing exactly which documents were included.
- **Failed documents:** Included in block with `extracted_text: null`; `normalizeProfileToText` labels them "[Document extraction failed: X — not included]" in text rendering only.
- **Pending documents:** Same — included in block with null text; labeled "[Document extraction pending]" in text.

#### 6.2 Gap for High-Assurance

- Failed documents are **in the block** (metadata + null text) but contribute no content.
- No explicit "excluded manifest" or "inclusion receipt" for audit.

---

## PART C — Potential Drop Points (Hypothesis)

### 7. Where Documents Could Be Dropped

| # | Location | Condition | Likelihood |
|---|----------|-----------|------------|
| 1 | **Vault ref missing** | `__og_vault_service_ref.resolveHsProfilesForHandshake` undefined | **HIGH** — Was a known bug (fixed in rpc.ts). If ref not set (e.g. vault locked at wrong moment), returns `[]`. |
| 2 | **Tier check** | `tier === 'free'` | Medium — Free tier returns `[]`. |
| 3 | **getProfile returns null** | Profile not found | Low — Would log and skip profile, not drop documents. |
| 4 | **filterBlocksForPeerTransmission** | `transmit_to_peer_allowed === false` | Low — Default is true for handshake context. |
| 5 | **MAX_BLOCKS_PER_CAPSULE** | `blocks.length >= MAX_BLOCKS_PER_CAPSULE` | Low — Would truncate profiles, not individual documents. |
| 6 | **Different vault DB** | Extension vs Electron vault | **NONE** — Extension WRVault uses Electron backend via HTTP; same vault DB. |
| 7 | **extraction_status filtering** | Backend filters by status | **NONE** — No such filter in `getProfile` or `rowToDetail`. |
| 8 | **extracted_text null drop** | Block drops docs with null text | **NONE** — All documents are serialized; no drop. |

### 8. Most Likely Root Cause

**Vault service ref / timing:**

- `resolveProfileIdsToContextBlocks` returns `[]` if `vs?.resolveHsProfilesForHandshake` is falsy.
- `__og_vault_service_ref` is set in `setupEmbeddingServiceRef` when vault is unlocked.
- If the ref is cleared (e.g. on lock) or not yet set when accept runs, **all profile blocks are dropped**.
- Result: 0 blocks → 0 documents in context_sync, even if DB has success records.

**Verification:** Add logging in `resolveProfileIdsToContextBlocks`:

```ts
if (!vs?.resolveHsProfilesForHandshake) {
  console.warn('[Handshake] resolveHsProfilesForHandshake NOT AVAILABLE — returning []')
  return []
}
```

---

## PART D — Diagnostic Queries

### 9. Compare Vault State vs Resolution

**Vault DB query (when unlocked):**

```sql
SELECT d.id, d.filename, d.extraction_status, d.extractor_name,
       LENGTH(d.extracted_text) as text_len, d.error_message, d.error_code
FROM hs_context_profile_documents d
WHERE d.profile_id = '<PROFILE_ID>'
ORDER BY d.created_at;
```

**Expected for "successfully parsed":**

- `extraction_status = 'success'`
- `extracted_text` non-null, `LENGTH(extracted_text) > 0`
- `extractor_name` set (e.g. `pdfjs-direct` or `tesseract`)

**Resolution check:** Call `resolveHsProfilesForHandshake(tier, [profileId])` and inspect returned `documents` array. Compare with DB rows.

---

## Summary

| Stage | Filtering | Documents Included |
|-------|-----------|-------------------|
| getProfile | None | All (pending, success, failed) |
| rowToDetail | None | All |
| resolveProfilesForHandshake | None | All |
| resolveProfileIdsToContextBlocks | Requires vs.resolveHsProfilesForHandshake | All (or [] if ref missing) |
| context_store insert | None | All |
| filterBlocksForPeerTransmission | transmit_to_peer_allowed | All (default allow) |
| context_sync capsule | None | All |

**Critical finding:** The only identified point that can drop **all** profile documents is when `__og_vault_service_ref.resolveHsProfilesForHandshake` is undefined, causing `resolveProfileIdsToContextBlocks` to return `[]`.

**No filtering** by `extraction_status` or `extracted_text` exists in the resolution path. Successfully parsed documents (green in WRVault) should be included if the vault ref is available and the vault is unlocked at accept time.
