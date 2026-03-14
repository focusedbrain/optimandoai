# Attachment Consistency Fix — Diagnosis & Implementation

## 1. Most Likely Root Cause

**Two causes:**

1. **Document deduplication:** The code counted document–block pairs instead of unique documents. When the same document appeared in multiple `context_blocks` (e.g. same profile in different capsules), `docsWithText.length` became 2+ and the system asked "Please select which attachment" even when there was only one real document.

2. **Pattern gaps:** Some attachment-summary phrasings were not covered:
   - "Briefly summarize this document" → `(?:the\s+)?` did not allow "this", so it fell through to `knowledge_query`.
   - "Give me a short summary of the attachment" → "summary" was not matched (only "summarize"/"summarise"), so `queryRequiresAttachmentSelection` returned false and the attachment block was skipped.

---

## 2. Execution Path Comparison

### Working: "What is this attachment about?"

1. `classifyIntent` → `document_lookup` (matches `/\bwhat\s+is\s+(?:this\s+)?(?:attachment|document)\s+about/i`)
2. `queryRequiresAttachmentSelection` → true (same pattern)
3. Enters attachment block: `intent === 'document_lookup' && queryRequiresAttachmentSelection && !selectedDocId && filter.handshake_id`
4. Collects `docsWithText` from `context_blocks`
5. If `docsWithText.length === 1` → `selectedDocId = docsWithText[0].id`
6. Falls through to document path → uses `selectedDocId`, fetches `docText`, calls LLM

### Failing: "Summarize the attachment" (before fix)

**Path A — same logic, wrong count:** Same steps 1–4, but `docsWithText` had 2+ entries because the same document appeared in multiple blocks → `docsWithText.length >= 2` → returned "Please select which attachment."

**Path B — pattern gap:** For "Briefly summarize this document" or "Give me a short summary of the attachment", either:
- `classifyIntent` returned `knowledge_query` (no match), or
- `queryRequiresAttachmentSelection` returned false (no match),
so the attachment block was never entered and the query went to RAG instead.

---

## 3. Where the Branching Differs

| Query | Before fix | After fix |
|-------|------------|-----------|
| "What is this attachment about?" | Works (1 doc) | Works |
| "Summarize the attachment" | Fails if same doc in 2+ blocks | Works (dedup) |
| "Briefly summarize this document" | `knowledge_query` (no match) | `document_lookup` |
| "Give me a short summary of the attachment" | `requiresSelection: false` | `requiresSelection: true` |
| "What does the document say about refunds?" | `knowledge_query` (broad corpus) | Unchanged |

---

## 4. Files/Functions Involved

| File | Function / Area | Change |
|------|-----------------|--------|
| `electron/main.ts` | Lines 2814–2827 | Deduplicate by `doc.id` via `seenDocIds` |
| `electron/main/handshake/intentClassifier.ts` | `DOCUMENT_LOOKUP_PATTERNS` | Added "briefly summarize", "summary of"; fixed "summarize this" |
| `electron/main/handshake/intentClassifier.ts` | `ATTACHMENT_REQUIRES_SELECTION_PATTERNS` | Same pattern updates |

---

## 5. Concrete Code Fix

### main.ts

Deduplicate documents by id when building `docsWithText`:

```ts
const seenDocIds = new Set<string>()
for (const row of rows) {
  // ...
  for (const d of docs) {
    if (d?.id && ... && !seenDocIds.has(d.id)) {
      seenDocIds.add(d.id)
      docsWithText.push({ id: d.id, block_id: row.block_id })
    }
  }
}
```

### intentClassifier.ts

- Change `(?:the\s+)?` to `(?:(?:the|this)\s+)?` for summarize patterns.
- Add `/\bbriefly\s+summar(?:ise|ize)\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i`.
- Add `/\b(?:short\s+)?summary\s+(?:of\s+(?:the\s+)?)?(?:the\s+)?(?:attachment|document)\b/i`.

---

## 6. Patch by File

### electron/main.ts

```diff
          const docsWithText: Array<{ id: string; block_id: string }> = []
+         const seenDocIds = new Set<string>()
          for (const row of rows) {
            try {
              const parsed = JSON.parse(row.payload) as { ... }
              if (Array.isArray(docs)) {
                for (const d of docs) {
-                 if (d?.id && typeof d.extracted_text === 'string' && d.extracted_text.trim()) {
+                 if (d?.id && typeof d.extracted_text === 'string' && d.extracted_text.trim() && !seenDocIds.has(d.id)) {
+                   seenDocIds.add(d.id)
                    docsWithText.push({ id: d.id, block_id: row.block_id })
                  }
                }
              }
            } catch { /* skip malformed payload */ }
          }
```

### electron/main/handshake/intentClassifier.ts

```diff
  /\bsummarize\s+(?:the\s+)?(?:attachment|document)\b/i,
  /\bsummarise\s+(?:the\s+)?(?:attachment|document)\b/i,
+ /\bbriefly\s+summar(?:ise|ize)\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
+ /\b(?:short\s+)?summary\s+(?:of\s+(?:the\s+)?)?(?:the\s+)?(?:attachment|document)\b/i,
  ...
- /\bsummarize\s+(?:the\s+)?(?:attachment|document)\b/i,
- /\bsummarise\s+(?:the\s+)?(?:attachment|document)\b/i,
+ /\bsummarize\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
+ /\bsummarise\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
+ /\bbriefly\s+summar(?:ise|ize)\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
+ /\b(?:short\s+)?summary\s+(?:of\s+(?:the\s+)?)?(?:the\s+)?(?:attachment|document)\b/i,
```

---

## 7. Manual Verification Steps

1. **Single-document auto-bind**
   - Create a handshake with exactly one profile that has one document with extracted text.
   - Ask: "What is this attachment about?" → should summarize.
   - Ask: "Summarize the attachment" → should summarize.
   - Ask: "Summarize the document" → should summarize.
   - Ask: "Give me a short summary of the attachment" → should summarize.
   - Ask: "Briefly summarize this document" → should summarize.

2. **Multi-document selection**
   - Create a handshake with two or more documents with extracted text.
   - Ask: "Summarize the attachment" without selecting → should return "Please select which attachment you want me to summarize."

3. **No-document**
   - Use a handshake with no documents or only documents without extracted text.
   - Ask: "Summarize the attachment" → should return "I couldn't find an attachment in the current handshake context."

4. **Broad corpus**
   - Ask: "What does the document say about refunds?" → should use RAG/corpus, not attachment selection.

---

## 8. Remaining Limitations

- **New phrasings:** Other attachment-summary phrasings may still need patterns (e.g. "TL;DR the attachment", "Condense the document").
- **Ambiguous queries:** Queries like "Summarize" without "attachment"/"document" are not treated as attachment-specific and will use RAG.
- **Document identity:** Deduplication uses `d.id`. If different blocks use different ids for the same logical document, they will still be counted separately.
