# Chat & Retrieval Logic — Architecture Analysis

**Date:** 2025-03-14  
**Scope:** Systematic analysis of chat, retrieval, and RAG flow for handshake context.  
**Status:** Updated after fixes (vault_profile path mapping, conversation context, document_lookup → RAG).

---

## 1. Summary

The chat and retrieval system uses a **hybrid architecture** (structured lookup + semantic search + RAG). Recent fixes addressed three critical issues:

- **Structured lookup** — FIXED: `VAULT_PROFILE_PATH_MAP` in `structuredQuery.ts` maps graph paths to `profile.fields.*`. Opening hours, contact phone/email, company name, and contact person (from `contacts[]`) now resolve correctly for vault_profile blocks.
- **Conversation context** — FIXED: `conversationContext: { lastAnswer }` is passed from `HybridSearch.tsx`; follow-up detection in `main.ts` injects previous answer into the prompt for queries like "What does this mean?".
- **Document lookup** — FIXED: `document_lookup` intent now routes to RAG pipeline (`useRagPipeline: true`) instead of raw semantic results.

**Remaining gaps:**
- **Attachment binding**: "This attachment" has no explicit binding to a selected document; semantic search returns whatever blocks match.
- **No keyword/BM25**: Pure vector search; no hybrid with full-text.
- **Document intent patterns**: `DOCUMENT_LOOKUP_PATTERNS` match "invoice", "contract", etc., but not "attachment" or "document" in isolation — "What is this attachment about?" falls through to `knowledge_query` (which still gets RAG).
- **Semantic threshold**: 0.4 cutoff; fallback uses unfiltered results when all blocks score low.

---

## 2. Current Architecture in the Code

### 2.1 Data Flow (User Input → Answer)

```
User types in HybridSearch (Chat mode)
    │
    ▼
handleSubmit() → chatWithContextRag({ query, scope, model, provider, stream, conversationContext })
    │
    ▼
main.ts: handshake:chatWithContextRag IPC handler
    │
    ├─► [1] Structured path (no embedding): queryClassifier() → fetchBlocksForStructuredLookup → structuredLookup
    │       └─ structuredLookup checks VAULT_PROFILE_PATH_MAP for profile.fields.*
    │       └─ If found → buildPrompt → LLM → return
    │
    ├─► [2] Intent path: classifyIntent() → routeByIntent()
    │       └─ document_lookup → useRagPipeline: true (RAG + LLM)
    │       └─ inbox_lookup / general_search → forceSemanticSearch (raw results)
    │
    ├─► [3] Cache lookup (normalizeQuery, resolveCapsuleId, getCached)
    │       └─ If hit → return cached answer
    │
    └─► [4] Hybrid path: hybridSearch() [structured + semantic in parallel]
            └─ If structured.found → buildPrompt → LLM → return
            └─ Else: semantic blocks → governance filter → buildRagPrompt(conversationContext) → LLM → return
```

### 2.2 Components

| Component | File(s) | Role |
|-----------|---------|------|
| **Chat orchestration** | `main.ts` (handshake:chatWithContextRag), `HybridSearch.tsx` | Receives query, coordinates retrieval, calls LLM |
| **Query classifier** | `structuredQuery.ts` (queryClassifier) | Rule-based: maps phrases → field paths |
| **Structured lookup** | `structuredQuery.ts` (structuredLookup, fetchBlocksForStructuredLookup) | Extracts value from JSON; uses VAULT_PROFILE_PATH_MAP for vault_profile |
| **Hybrid search** | `hybridSearch.ts` | Runs structured + semantic in parallel |
| **Semantic search** | `embeddings.ts` (semanticSearch) | Cosine similarity vs capsule_blocks or context_embeddings |
| **Intent classifier** | `intentClassifier.ts` (classifyIntent) | knowledge_query, document_lookup, handshake_context_query, inbox_lookup, general_search |
| **Intent router** | `intentRouter.ts` (routeByIntent) | document_lookup → RAG; inbox/general_search → raw semantic |
| **Intent execution** | `intentExecution.ts` (executeStructuredSearch) | Used only for inbox/general_search (non-RAG) |
| **Block extraction** | `blockExtraction.ts`, `capsuleBlockIndexer.ts` | Chunks docs, extracts blocks for indexing |
| **Prompt builder** | `blockRetrieval.ts` (buildPrompt, buildRagPrompt) | Builds system + user prompt; supports conversationContext |
| **Document parsing** | `hsContextOcrJob.ts`, `hsContextNormalize.ts` | PDF extraction, profile→text normalization |

### 2.3 Payload Structures

**Vault profile block** (`ipc.ts` resolveProfileIdsToContextBlocks):
```json
{
  "profile": {
    "id": "...",
    "name": "...",
    "fields": {
      "openingHours": [{ "days": "Mon-Fri", "from": "09:00", "to": "17:00" }],
      "generalPhone": "+49...",
      "generalEmail": "contact@...",
      "supportEmail": "...",
      "legalCompanyName": "...",
      "contacts": [{ "name": "...", "phone": "...", "email": "..." }]
    }
  },
  "documents": [{ "id", "filename", "extracted_text", ... }]
}
```

**VAULT_PROFILE_PATH_MAP** (`structuredQuery.ts` 116–144): `opening_hours.schedule` → `openingHours`, `contact.general.phone` → `generalPhone`, `contact.person.phone` → extract from `fields.contacts[]`, etc.

---

## 3. Main Problems

### 3.1 Attachment Binding Missing (Remaining)

- **Location**: `HybridSearch.tsx`, chat API
- **Issue**: "This attachment" implies a selected document. UI has `selectedHandshakeId` but no `selectedAttachmentId` or `selectedBlockId` passed to chat.
- **Effect**: "What is this attachment about?" returns semantic results across all blocks; no scoping to a specific document.

### 3.2 Document Lookup Patterns Don't Match "Attachment"

- **Location**: `intentClassifier.ts` DOCUMENT_LOOKUP_PATTERNS (lines 21–31)
- **Issue**: Patterns match "invoice", "contract", "show me the document", but not "attachment" or "summarize the attachment".
- **Effect**: "What is this attachment about?" → `knowledge_query` (not `document_lookup`). Still gets RAG, but no special handling for attachment scope.

### 3.3 No Keyword / BM25 / Full-Text Search

- **Location**: `embeddings.ts` (semanticSearch) — cosine similarity only
- **Issue**: No SQL FTS, no BM25, no keyword boosting.
- **Effect**: Exact phrases may rank poorly; no hybrid ranking.

### 3.4 Semantic Threshold and Fallback

- **Location**: `main.ts` ~2905–2909
- **Issue**: Blocks with score < 0.4 filtered; if all below 0.4, fallback uses unfiltered results.
- **Effect**: Possible noise when all scores are low.

### 3.5 Query Normalization Limited

- **Location**: `queryCache.ts` (normalizeQuery) — trims, lowercases
- **Issue**: No expansion of "opening hrs", "contact #", "phone number again" to canonical forms.
- **Effect**: Cache misses; classifier may miss variations.

### 3.6 Multi-Field Queries ("Give me contact and company details")

- **Location**: `structuredQuery.ts` queryClassifier
- **Issue**: Classifier returns first match; "Give me the contact and company details" matches one path only.
- **Effect**: Only one field type returned; user may need multiple queries.

---

## 4. Most Likely Root Causes

| Category | Root Cause |
|----------|------------|
| **Architecture** | No explicit attachment selection in chat flow; scope is handshake-level only. |
| **Logic** | Document lookup patterns designed for specific doc types (invoice, contract), not generic "attachment". |
| **Retrieval** | Semantic-only; no keyword component for exact matches. |
| **Implementation** | Single-field classifier; no multi-field aggregation for compound queries. |
| **Prompt** | No "current attachment" grounding when user says "this attachment". |

---

## 5. Concrete Fixes with Priority

### 5.1 Fastest Leverage — Add Attachment Patterns to Document Lookup

**File**: `intentClassifier.ts`

Add to DOCUMENT_LOOKUP_PATTERNS:
```ts
/\battachment\b/i,
/\bsummarize\s+(?:the\s+)?(?:attachment|document)\b/i,
/\bwhat\s+is\s+(?:this\s+)?(?:attachment|document)\s+about/i,
```

**Impact**: "What is this attachment about?" gets `document_lookup` intent. (Still goes through RAG; no behavioral change unless we add attachment-scoped retrieval.)

### 5.2 Highest Technical Impact — Attachment Binding

**Files**: `HybridSearch.tsx`, `handshakeViewTypes.ts`, `preload.ts`, `main.ts`

1. When user selects an attachment in the UI, set `selectedAttachmentId` or `selectedBlockId`.
2. Pass `selectedAttachmentId` in `chatWithContextRag` params.
3. In `main.ts`, when `selectedAttachmentId` is present and query references "attachment" or "document", filter retrieval to blocks from that document (e.g. by block_id prefix or document_id in payload).

**Impact**: "What is this attachment about?" scopes to the selected document.

### 5.3 Cleanest Long-Term — Multi-Field Structured Lookup

**File**: `structuredQuery.ts`

For queries like "Give me the contact and company details", detect multi-field intent and aggregate:
- Add `multiFieldPatterns` that match compound queries.
- Return multiple field paths; `structuredLookup` could return a combined result or iterate paths.

---

## 6. Recommended Refactoring

**Phase 1 (Done)**: Vault profile path mapping, conversation context, document_lookup → RAG.

**Phase 2**: Attachment binding
- UI: expose selected attachment/block when user has one selected.
- API: pass `selectedAttachmentId`; filter retrieval by document scope.

**Phase 3**: Broaden document_lookup patterns
- Add "attachment", "summarize the document" patterns.

**Phase 4**: Hybrid keyword + vector (optional)
- Add SQL FTS or BM25; combine with cosine score.

---

## 7. Test Cases

| # | Query | Expected Behavior | Current Behavior |
|---|-------|-------------------|------------------|
| 1 | "What is this attachment about?" | Summarize selected attachment | Semantic search over all blocks; no attachment binding |
| 2 | "Summarize the attachment briefly." | Brief summary of selected attachment | Same |
| 3 | "What does this mean?" (after answer about attachment) | Explain previous answer in simpler terms | **FIXED**: lastAnswer injected; follow-up works |
| 4 | "What are the opening hours?" | Return structured opening hours from profile | **FIXED**: VAULT_PROFILE_PATH_MAP resolves |
| 5 | "What is the contact person's phone number?" | Return phone from contacts array | **FIXED**: contact.person.phone from contacts[] |
| 6 | "What is the contact person's name?" | Return name from contacts | **FIXED**: contact.person.name |
| 7 | "What does the document say about [topic]?" | Relevant passage(s) from document | Semantic search; works if chunks indexed |
| 8 | "Give me the contact and company details." | Structured contact + company info | Single field returned; may need multiple queries |
| 9 | "Show me the invoice" | RAG summary of invoice content | **FIXED**: document_lookup → RAG (was raw results) |

**Verification steps**:
1. "What are the opening hours?" → structured path returns value; LLM formats naturally.
2. "What does this mean?" after prior answer → prompt includes "Previous answer: ...".
3. "What is the contact person's phone?" → structuredLookup extracts from `profile.fields.contacts`.

---

## 8. Open Risks / Technical Debt

| Risk | Description |
|------|-------------|
| **Capsule block indexing** | If indexing fails, semantic search falls back to context_embeddings (legacy). |
| **Embedding dimension mismatch** | Different embedding model than stored → semanticSearch returns `[]`. |
| **Governance filtering** | Cloud AI path filters blocks; user may get "no relevant context". |
| **Cache invalidation** | Stale answers if context changes. |
| **Prompt length** | User prompt truncated at 8000 chars. |
| **Score threshold** | 0.4 arbitrary; may need tuning. |
| **Follow-up scope** | lastAnswer only; no multi-turn message history. |

---

## 9. File Reference

| File | Key Functions |
|------|---------------|
| `main.ts` | `handshake:chatWithContextRag` IPC handler (2678–3030) |
| `structuredQuery.ts` | `queryClassifier`, `structuredLookup`, `VAULT_PROFILE_PATH_MAP`, `fetchBlocksForStructuredLookup` |
| `hybridSearch.ts` | `hybridSearch` |
| `embeddings.ts` | `semanticSearch` |
| `intentClassifier.ts` | `classifyIntent`, `DOCUMENT_LOOKUP_PATTERNS` |
| `intentRouter.ts` | `routeByIntent` |
| `blockRetrieval.ts` | `buildPrompt`, `buildRagPrompt`, `ConversationContext` |
| `ipc.ts` | `resolveProfileIdsToContextBlocks` |
| `HybridSearch.tsx` | `handleSubmit`, `conversationContext`, `chatWithContextRag` |
