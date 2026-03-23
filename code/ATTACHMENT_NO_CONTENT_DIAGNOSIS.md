# Attachment "No Content" — Code-Level Diagnosis

## 1. Most Likely Root Cause

**Documents in `context_blocks` have empty `extracted_text`.** The handshake shows business/profile context because `profile.fields` is populated, but `documents[].extracted_text` is null or empty. As a result:

- **Document path:** No document passes the `extracted_text.trim()` check → "I couldn't find an attachment" or "I couldn't find that document."
- **RAG path (if intent is misclassified):** Semantic search returns blocks whose indexed text is mostly profile fields; document content was never embedded because `extracted_text` was null when blocks were indexed. The LLM receives context without attachment content and responds with "The provided context does not contain this information."

**Secondary causes:**
- **Tier `free`:** `resolveProfileIdsToContextBlocks` returns `[]`, so no profile/document blocks are built.
- **`extracted_text` present but non-informative:** OCR may have written placeholder text (e.g. "No text could be extracted") or minimal content. The document path uses it, but the LLM responds "The provided context does not contain this information."

---

## 2. Actual Document Ingestion Path

```
1. User adds documents to HS Context Profile (vault)
   → hs_context_profile_documents rows created
   → extraction_status = 'pending'

2. OCR job (hsContextOcrJob.ts) runs
   → Extracts text from PDF
   → UPDATE hs_context_profile_documents SET extracted_text = ?, extraction_status = 'success'

3. User initiates/accepts handshake with profile_ids
   → resolveProfileIdsToContextBlocks(profileIds, session, handshakeId, scope)
   → resolveHsProfilesForHandshake(tier, profileIds)
   → getProfile() → rowToDetail() → documents with extracted_text from DB

4. Block content built (ipc.ts:222-232):
   content = { profile: {...}, documents: documents.map(d => ({ id, filename, extracted_text: d.extracted_text, ... })) }

5. Capsule sent with context_blocks
   → Receiver ingests via contextIngestion.ingestContextBlocks()
   → INSERT INTO context_blocks (..., payload) VALUES (..., JSON.stringify(content))

6. indexCapsuleBlocks (enforcement.ts, after ingestion)
   → extractBlocks(block_id, payload) → extractTextFromPayload(payload)
   → For vault_profile: flattens { profile, documents } to text; documents with null extracted_text → "extracted_text: " (empty)

7. Document path (main.ts:2814-2885):
   → SELECT payload FROM context_blocks WHERE handshake_id = ?
   → Parse payload, find documents[], require d.extracted_text && d.extracted_text.trim()
   → If none: "I couldn't find an attachment"
```

---

## 3. Where Document Content Is Lost or Skipped

| Stage | Location | Condition | Effect |
|-------|----------|-----------|--------|
| OCR not run | hsContextOcrJob | extraction_status stays 'pending' | extracted_text = null in DB |
| OCR failed | hsContextOcrJob | extraction_status = 'failed' | extracted_text = null |
| Tier free | ipc.ts:195-198 | session.canonical_tier === 'free' | resolveProfileIdsToContextBlocks returns [] |
| Block built with null | ipc.ts:230 | d.extracted_text from DB | documents: [{ extracted_text: null }] in payload |
| Document path filter | main.ts:2821, 2878 | `typeof d.extracted_text === 'string' && d.extracted_text.trim()` | Doc skipped when extracted_text is null/empty |
| Indexing | blockExtraction.ts | extractTextFromPayload for documents with null | Indexed text has "extracted_text: " but no actual content |

---

## 4. Files/Functions Involved

| File | Function / Area | Role |
|------|-----------------|------|
| `hsContextOcrJob.ts` | `runExtractionJob`, `markDocumentExtractionSuccess` | Populates extracted_text in hs_context_profile_documents |
| `hsContextProfileService.ts` | `getProfile`, `rowToDetail`, `resolveProfilesForHandshake` | Returns documents with extracted_text for handshake |
| `ipc.ts` | `resolveProfileIdsToContextBlocks` | Builds context blocks; tier check returns [] for free |
| `ipc.ts` | Lines 222-232 | Block content: `documents.map(d => ({ ..., extracted_text: d.extracted_text }))` |
| `contextIngestion.ts` | `ingestContextBlocks` | Stores capsule blocks in context_blocks |
| `main.ts` | 2814-2826, 2871-2885 | Document path: requires non-empty extracted_text |
| `blockExtraction.ts` | `extractBlocks`, `extractTextFromPayload` | Indexes payload for semantic search; null extracted_text → no useful content |
| `capsuleBlockIndexer.ts` | `indexCapsuleBlocks` | Indexes context_blocks into capsule_blocks |

---

## 5. Why Attachment Queries Fail

1. **Document path:** `main.ts` only uses documents where `extracted_text` is a non-empty string. If all documents have null/empty `extracted_text`, `docsWithText` is empty → "I couldn't find an attachment in the current handshake context."

2. **RAG path:** If the query is not classified as `document_lookup` (e.g. phrasing that doesn't match `DOCUMENT_LOOKUP_PATTERNS` in `intentClassifier.ts`), the attachment-specific logic is skipped. Semantic search uses `capsule_blocks`, which are built from `context_blocks` via `extractTextFromPayload`. When `documents[].extracted_text` is null, the flattened text has no real document content. Retrieved blocks are mostly profile fields. The LLM then answers "The provided context does not contain this information." (Note: "What is this attachment about?" does match `document_lookup` and `queryRequiresAttachmentSelection`, so this path applies only to non-matching phrasings.)

3. **Tier:** For tier `free`, no profile blocks are built, so the handshake has no document blocks at all.

---

## 6. Why "Open Original" Was Missing

Addressed in the previous fix: the button was hidden when `!vaultUnlocked`. It is now always shown and disabled when the vault is locked. If document entries still do not appear, the cause is that no `documents` array (or only empty entries) reaches the UI. That happens when:

- No vault_profile blocks in the handshake (tier free, or no profiles attached)
- Blocks exist but `parsed.documents` is empty or all entries lack `id`/`filename`

---

## 7. Concrete Code Fixes

### Fix 1: Ensure OCR runs before handshake attach (operational)

- **Check:** Before building context blocks, ensure documents have `extraction_status === 'success'` and non-empty `extracted_text`.
- **Option A:** In `resolveProfileIdsToContextBlocks`, filter out documents with empty `extracted_text` and log a warning.
- **Option B:** In the UI, prevent attaching a profile until documents are ready, or show a clear "Documents still extracting" state.

### Fix 2: Clearer message when documents exist but have no extracted text

**File:** `main.ts`

When `docsWithText.length === 0` but `context_blocks` has blocks with a non-empty `documents` array (all with empty `extracted_text`), return a more specific message:

```ts
// After the loop that builds docsWithText, before "I couldn't find an attachment":
const docsWithoutText = /* count docs with id but empty extracted_text */
if (docsWithoutText > 0) {
  const msg = "The attachment(s) in this handshake have not been fully extracted yet. Please wait for extraction to complete, or try again later."
  // ... return with msg
}
```

### Fix 3: Diagnostic logging

**File:** `ipc.ts` (around line 204)

```ts
console.log('[HS Profile Resolution] Resolved:', {
  profileCount: resolved?.length ?? 0,
  profiles: (resolved ?? []).map((r: any) => ({
    name: r?.profile?.name,
    docCount: r?.documents?.length ?? 0,
    docsWithText: (r?.documents ?? []).filter((d: any) => d?.extracted_text?.trim()).length,
    docs: (r?.documents ?? []).map((d: any) => ({
      filename: d?.filename,
      hasExtractedText: !!(d?.extracted_text?.trim()),
      extractionStatus: d?.extraction_status,
    })),
  })),
})
```

**File:** `main.ts` (in document path, before early return)

```ts
console.log('[Chat Document Path] Docs in blocks:', {
  totalRows: rows.length,
  docsWithText: docsWithText.length,
  docIds: docsWithText.map(d => d.id),
})
```

---

## 8. Minimal Debug Logs to Add

```ts
// ipc.ts after resolveFn(tier, profileIds):
const docsWithText = (resolved ?? []).flatMap(r => (r?.documents ?? []).filter((d: any) => d?.extracted_text?.trim()))
console.log('[HS Profile Resolution] Documents with extracted text:', docsWithText.length, 'of', (resolved ?? []).reduce((n, r) => n + (r?.documents?.length ?? 0), 0))
```

```ts
// main.ts in document path, when docsWithText.length === 0:
const blocksWithDocs = rows.filter(r => {
  try {
    const p = JSON.parse(r.payload)
    return Array.isArray(p?.documents) && p.documents.length > 0
  } catch { return false }
})
console.log('[Chat Document Path] No docs with text. Blocks with documents array:', blocksWithDocs.length)
```

---

## 9. Manual Test Steps

1. **Confirm extraction status**
   - Add a PDF to an HS Context profile.
   - Wait for extraction to finish (or check DB: `SELECT id, filename, extraction_status, length(extracted_text) FROM hs_context_profile_documents`).
   - Ensure `extraction_status = 'success'` and `extracted_text` is non-empty.

2. **Confirm tier**
   - Ensure the account tier is not `free` (enterprise/publisher) so profile resolution runs.

3. **Confirm handshake has document blocks**
   - Initiate or accept a handshake with the profile attached.
   - Check `context_blocks`: `SELECT block_id, json_extract(payload, '$.documents') FROM context_blocks WHERE handshake_id = ?`
   - Verify at least one document has non-null `extracted_text`.

4. **Test attachment query**
   - Select the handshake.
   - Ask: "What is this attachment about?"
   - Expected: summary of the document if `extracted_text` is present; otherwise the "couldn't find" or "not fully extracted" message.

5. **Inspect console logs**
   - Look for `[HS Profile Resolution]` and `[Chat Document Path]` logs to see document counts and extraction status.

---

## Summary

The handshake shows business context because `profile.fields` is populated. Attachment content is missing because `documents[].extracted_text` is null or empty. That usually means:

1. OCR has not run or has failed.
2. The profile was attached before extraction completed.
3. The account tier is `free`, so no profile blocks are built.

The smallest safe fix is to add logging and a clearer message when documents exist but have no extracted text. The underlying fix is to ensure extraction completes before attaching profiles, or to surface extraction status in the UI.
