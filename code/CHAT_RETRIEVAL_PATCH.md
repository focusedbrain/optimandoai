# Chat & Retrieval Implementation Patch

## 1. Patch Summary

All six implementation areas are in place:

1. **intentClassifier.ts** — Attachment/document patterns + `queryRequiresAttachmentSelection()`
2. **UI → selection** — `selectedDocumentId` from StructuredHsContextPanel → App → HybridSearch → IPC
3. **main.ts attachment-scoped retrieval** — No-selection message, document-scoped prompt, not-found message
4. **structuredQuery.ts** — `MULTI_FIELD_GROUPS`, `structuredLookupMulti()`, `queryClassifier` returns `fieldPaths`
5. **hybridSearch.ts** — Uses `structuredLookupMulti` for compound queries
6. **main.ts low-confidence fallback** — Empty results when all scores < 0.4 (no unfiltered fallback)

---

## 2. File-by-File Changes

### 2.1 `apps/electron-vite-project/electron/main/handshake/intentClassifier.ts`

**Add to DOCUMENT_LOOKUP_PATTERNS (after existing invoice/contract patterns):**

```ts
  // Attachment and document phrasing (generic)
  /\battachment\b/i,
  /\bwhat\s+is\s+(?:this\s+)?(?:attachment|document)\s+about/i,
  /\bsummarize\s+(?:the\s+)?(?:attachment|document)\b/i,
  /\bsummarise\s+(?:the\s+)?(?:attachment|document)\b/i,
  /\bwhat\s+does\s+(?:this\s+)?(?:attachment|document)\s+say/i,
  /\bshow\s*me\s*(?:the\s+)?(?:attachment|document)\b/i,
  /\b(?:this\s+)?(?:attachment|document)\s+about/i,
  /\b(?:the\s+)?(?:attachment|document)\s+briefly/i,
```

**Add at end of file:**

```ts
/** Patterns that imply the user is referring to a specific attachment/document (requires selection). */
const ATTACHMENT_REQUIRES_SELECTION_PATTERNS = [
  /\bthis\s+(?:attachment|document)\b/i,
  /\bwhat\s+is\s+(?:this\s+)?(?:attachment|document)\s+about/i,
  /\bwhat\s+does\s+this\s+(?:attachment|document)\s+say\b/i,
  /\b(?:the\s+)?(?:attachment|document)\s+(?:about|briefly)\b/i,
  /\bsummarize\s+(?:the\s+)?(?:attachment|document)\b/i,
  /\bsummarise\s+(?:the\s+)?(?:attachment|document)\b/i,
  /\bshow\s*me\s*(?:the\s+)?(?:attachment|document)\b/i,
]

export function queryRequiresAttachmentSelection(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return false
  return ATTACHMENT_REQUIRES_SELECTION_PATTERNS.some((re) => re.test(trimmed))
}
```

**Why:** Classifies attachment/document queries as `document_lookup`. `queryRequiresAttachmentSelection` distinguishes "this attachment" (needs selection) from "What does the document say about refunds?" (can search corpus).

---

### 2.2 `apps/electron-vite-project/src/components/StructuredHsContextPanel.tsx`

**Add to interface StructuredHsContextPanelProps:**

```ts
  /** Called when user opens a document (for chat attachment binding). */
  onDocumentSelect?: (documentId: string | null) => void
```

**Add to destructured props:**

```ts
  onDocumentSelect,
```

**In handleOpenReader, add after setReaderDoc(doc):**

```ts
    onDocumentSelect?.(doc.id)
```

**Why:** Propagates selected document ID when user opens a document reader.

---

### 2.3 `apps/electron-vite-project/src/components/HandshakeWorkspace.tsx`

**Add to HandshakeWorkspaceProps:**

```ts
  onDocumentSelect?: (documentId: string | null) => void
```

**Add to destructured props:**

```ts
  onDocumentSelect,
```

**Add to StructuredHsContextPanel:**

```ts
                            onDocumentSelect={onDocumentSelect}
```

**Why:** Passes `onDocumentSelect` from HandshakeView to StructuredHsContextPanel.

---

### 2.4 `apps/electron-vite-project/src/components/HandshakeView.tsx`

**Add to HandshakeViewProps:**

```ts
  onDocumentSelect?: (documentId: string | null) => void
```

**Add to destructured props:**

```ts
  onDocumentSelect
```

**Add to HandshakeWorkspace:**

```ts
                onDocumentSelect={onDocumentSelect}
```

**Why:** Passes `onDocumentSelect` from App to HandshakeWorkspace.

---

### 2.5 `apps/electron-vite-project/src/App.tsx`

**Add state:**

```ts
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
```

**In onHandshakeScopeChange, add:**

```ts
              setSelectedDocumentId(null)
```

**Add to HybridSearch:**

```ts
          selectedDocumentId={selectedDocumentId}
```

**Add to HandshakeView:**

```ts
            onDocumentSelect={setSelectedDocumentId}
```

**Why:** Stores selected document at app level; clears on handshake change; passes to HybridSearch and HandshakeView.

---

### 2.6 `apps/electron-vite-project/src/components/HybridSearch.tsx`

**Add to HybridSearchProps:**

```ts
  selectedDocumentId?: string | null
```

**Add to destructured props:**

```ts
  selectedDocumentId = null
```

**In chatWithContextRag call, add:**

```ts
            selectedDocumentId: selectedDocumentId ?? undefined,
```

**Add selectedDocumentId to useCallback deps:**

```ts
  }, [query, mode, scope, selectedHandshakeId, selectedModel, availableModels, isLoading, response, selectedDocumentId])
```

**Why:** Passes `selectedDocumentId` into the chat request.

---

### 2.7 `apps/electron-vite-project/src/components/handshakeViewTypes.ts`

**Add to chatWithContextRag params:**

```ts
      chatWithContextRag?: (params: { query: string; scope?: string; model: string; provider: string; stream?: boolean; debug?: boolean; conversationContext?: { lastAnswer?: string }; selectedDocumentId?: string }) => Promise<{
```

**Why:** Type definition for `selectedDocumentId`.

---

### 2.8 `apps/electron-vite-project/electron/preload.ts`

**Add to chatWithContextRag params and invoke:**

```ts
  chatWithContextRag: (params: { query: string; scope?: string; model: string; provider: string; stream?: boolean; debug?: boolean; conversationContext?: { lastAnswer?: string }; selectedDocumentId?: string }) => {
    ...
    return ipcRenderer.invoke('handshake:chatWithContextRag', {
      ...
      selectedDocumentId: typeof params.selectedDocumentId === 'string' && params.selectedDocumentId.trim() ? params.selectedDocumentId.trim() : undefined,
    })
  },
```

**Why:** Forwards `selectedDocumentId` to main process.

---

### 2.9 `apps/electron-vite-project/electron/main.ts`

**Update IPC handler params:**

```ts
    ipcMain.handle('handshake:chatWithContextRag', async (event, params: { query: string; scope?: string; model: string; provider: string; stream?: boolean; debug?: boolean; conversationContext?: { lastAnswer?: string }; selectedDocumentId?: string }) => {
```

**After intent classification, add (before executeStructuredSearch branch):**

```ts
        const { classifyIntent, queryRequiresAttachmentSelection } = await import('./main/handshake/intentClassifier')
        ...
        // Attachment binding: when query implies "this attachment" but no document selected, fail gracefully
        if (intentResult.intent === 'document_lookup' && queryRequiresAttachmentSelection(params.query ?? '') && !params.selectedDocumentId?.trim()) {
          const msg = 'I can summarize the attachment once a specific document is selected. Please open a document from the handshake context first.'
          const doStream = params.stream === true && event.sender
          if (doStream) {
            const send = (ch: string, payload: unknown) => event.sender.send(ch, payload)
            send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })
            send('handshake:chatStreamToken', { token: msg })
          }
          return toIPC({ success: true, answer: msg, sources: [], streamed: doStream, resultType: 'context_answer' })
        }

        // Attachment binding: when document selected, scope retrieval to that document's content
        const selectedDocId = params.selectedDocumentId?.trim()
        if (intentResult.intent === 'document_lookup' && selectedDocId && filter.handshake_id) {
          const { visibilityWhereClause: visWhere, isVaultCurrentlyUnlocked } = await import('./main/handshake/visibilityFilter')
          const vaultUnlocked = isVaultCurrentlyUnlocked()
          const { sql: visSql, params: visParams } = visWhere('cb', vaultUnlocked)
          const rows = db.prepare(
            `SELECT cb.block_id, cb.payload FROM context_blocks cb WHERE cb.handshake_id = ?${visSql}`
          ).all(filter.handshake_id, ...visParams) as Array<{ block_id: string; payload: string }>
          let docText: string | null = null
          let foundBlockId: string | null = null
          for (const row of rows) {
            try {
              const parsed = JSON.parse(row.payload) as { documents?: Array<{ id?: string; extracted_text?: string | null }> }
              const docs = parsed?.documents
              if (Array.isArray(docs)) {
                const doc = docs.find((d) => d?.id === selectedDocId)
                if (doc && typeof doc.extracted_text === 'string' && doc.extracted_text.trim()) {
                  docText = doc.extracted_text.trim()
                  foundBlockId = row.block_id
                  break
                }
              }
            } catch { /* skip malformed payload */ }
          }
          if (docText && foundBlockId) {
            const { buildPrompt } = await import('./main/handshake/blockRetrieval')
            const docContext = `[block_id: ${foundBlockId}]\n[Document content]\n${docText}`
            const trimmedQuery = params.query?.trim() ?? ''
            const { system, user: userPrompt } = buildPrompt(docContext, trimmedQuery)
            const sources = [{ handshake_id: filter.handshake_id, capsule_id: filter.handshake_id, block_id: foundBlockId, source: 'received', score: 1 }]
            const doStream = params.stream === true && event.sender
            const send = doStream ? (ch: string, payload: unknown) => event.sender.send(ch, payload) : () => {}
            try {
              if (doStream) send('handshake:chatStreamStart', { contextBlocks: [foundBlockId], sources })
              const answer = await provider.generateChat(
                [{ role: 'system' as const, content: system }, { role: 'user' as const, content: userPrompt }],
                { model: params.model, stream: doStream, send: doStream ? send : undefined }
              )
              return toIPC({ success: true, answer, sources, streamed: doStream, resultType: 'context_answer' })
            } catch (err: any) {
              const msg = err?.message ?? 'Unknown error'
              if (/no_api_key|API key required/i.test(msg)) return toIPC({ success: false, error: 'no_api_key', provider: providerLower, message: msg })
              if (/ECONNREFUSED|fetch failed|Failed to fetch/i.test(msg) && provider.id === 'ollama') return toIPC({ success: false, error: 'ollama_unavailable', message: msg })
              return toIPC({ success: false, error: 'model_execution_failed', provider: providerLower, message: msg })
            }
          } else {
            const msg = "I couldn't find that document in the current handshake context. It may not have been extracted yet."
            const doStream = params.stream === true && event.sender
            if (doStream) {
              const send = (ch: string, payload: unknown) => event.sender.send(ch, payload)
              send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })
              send('handshake:chatStreamToken', { token: msg })
            }
            return toIPC({ success: true, answer: msg, sources: [], streamed: !!doStream, resultType: 'context_answer' })
          }
        }
```

**Update structured path (before hybrid search) to support fieldPaths:**

```ts
        const { queryClassifier, structuredLookup, structuredLookupMulti, fetchBlocksForStructuredLookup } = await import('./main/handshake/structuredQuery')
        const classifierResult = queryClassifier(params.query ?? '')
        const pathForFetch = classifierResult.fieldPaths?.[0] ?? classifierResult.fieldPath
        if (classifierResult.matched && pathForFetch) {
          const blocks = fetchBlocksForStructuredLookup(db, filter, pathForFetch)
          if (blocks.length > 0) {
            const structResult = classifierResult.fieldPaths && classifierResult.fieldPaths.length > 0
              ? structuredLookupMulti(blocks, classifierResult.fieldPaths)
              : structuredLookup(blocks, classifierResult.fieldPath!)
```

**Replace semantic threshold fallback logic:**

```ts
        // Filter out low-relevance blocks (cosine similarity < 0.4) to avoid unrelated answers.
        // When ALL blocks score below threshold, do NOT fall back to unfiltered results — return
        // explicit "not enough reliable context" instead of weakly grounded answers.
        const SEMANTIC_RELEVANCE_THRESHOLD = 0.4
        const relevantResults = searchResults.filter(r => (r.score ?? 0) >= SEMANTIC_RELEVANCE_THRESHOLD)
        const allFiltered = relevantResults.length === 0 && searchResults.length > 0
        if (allFiltered) {
          searchResults = []
        } else if (relevantResults.length > 0) {
          searchResults = relevantResults
        }
```

**Why:** Handles attachment-scoped retrieval, compound structured lookup, and safe low-confidence fallback.

---

### 2.10 `apps/electron-vite-project/electron/main/handshake/structuredQuery.ts`

**Add MULTI_FIELD_GROUPS (before QueryClassifierResult):**

```ts
const MULTI_FIELD_GROUPS: Array<{ phrases: RegExp[]; fieldPaths: string[] }> = [
  {
    phrases: [
      /contact\s+and\s+company\s+(?:details?|info)/i,
      /company\s+and\s+contact\s+(?:details?|info)/i,
      /give\s+me\s+(?:the\s+)?(?:contact\s+and\s+company|company\s+and\s+contact)\s+(?:details?|info)/i,
      /(?:contact|company)\s+details?/i,
    ],
    fieldPaths: ['contact.general.phone', 'contact.general.email', 'contact.support.email', 'company.name', 'company.address'],
  },
  {
    phrases: [
      /contact\s+info\s+and\s+opening\s*hours?/i,
      /opening\s*hours?\s+and\s+contact\s+info/i,
      /(?:show|give)\s+me\s+contact\s+(?:info\s+)?and\s+opening\s*hours?/i,
    ],
    fieldPaths: ['contact.general.phone', 'contact.general.email', 'opening_hours.schedule'],
  },
  {
    phrases: [
      /phone\s*(?:number)?\s+and\s+(?:company\s+)?address/i,
      /(?:company\s+)?address\s+and\s+phone\s*(?:number)?/i,
      /phone\s+and\s+address/i,
    ],
    fieldPaths: ['contact.general.phone', 'company.address'],
  },
]
```

**Update QueryClassifierResult:**

```ts
export interface QueryClassifierResult {
  matched: boolean
  fieldPath?: string
  /** When matched as compound query, multiple paths to aggregate. */
  fieldPaths?: string[]
}
```

**Update queryClassifier to check MULTI_FIELD_GROUPS first:**

```ts
  // Check multi-field patterns first (more specific)
  for (const { phrases, fieldPaths } of MULTI_FIELD_GROUPS) {
    for (const re of phrases) {
      if (re.test(normalized)) {
        return { matched: true, fieldPaths }
      }
    }
  }
```

**Add structuredLookupMulti (after structuredLookup):**

```ts
export function structuredLookupMulti(
  blocks: ScoredContextBlock[],
  fieldPaths: string[],
): StructuredLookupResult {
  const parts: string[] = []
  let source: { handshake_id: string; block_id: string; source?: string } | undefined

  for (const block of blocks) {
    const payload = block.payload_ref
    if (!payload || typeof payload !== 'string') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }

    for (const fieldPath of fieldPaths) {
      let value: unknown
      if (parsed && typeof parsed === 'object' && 'profile' in parsed) {
        const profile = (parsed as Record<string, unknown>).profile as Record<string, unknown> | undefined
        const fields = profile?.fields as Record<string, unknown> | undefined
        const mapper = VAULT_PROFILE_PATH_MAP[fieldPath]
        if (mapper && fields) {
          if (typeof mapper === 'function') {
            value = mapper(fields)
          } else {
            value = getAtPath(fields, mapper)
            if ((value === undefined || value === null) && mapper === 'legalCompanyName') {
              value = profile?.name
            }
          }
        }
      }
      if (value === undefined || value === null) value = getAtPath(parsed, fieldPath)
      if ((value === undefined || value === null) && parsed && typeof parsed === 'object' && 'context_graph' in parsed) {
        value = getAtPath(parsed, `context_graph.${fieldPath}`)
      }

      if (value !== undefined && value !== null) {
        const formatted = formatValue(value)
        if (formatted) {
          const label = fieldPath.split('.').pop() ?? fieldPath
          const entry = `${label}: ${formatted}`
          if (!parts.includes(entry)) {
            parts.push(entry)
            if (!source) source = { handshake_id: block.handshake_id, block_id: block.block_id, source: block.source }
          }
        }
      }
    }
    if (parts.length > 0) break
  }

  if (parts.length === 0) return { found: false }
  return {
    found: true,
    value: parts.join('\n'),
    source,
  }
}
```

**Why:** Supports compound structured queries and multi-field aggregation.

---

### 2.11 `apps/electron-vite-project/electron/main/handshake/hybridSearch.ts`

**Add import:**

```ts
  structuredLookupMulti,
```

**Update runStructuredPath:**

```ts
async function runStructuredPath(
  db: any,
  _query: string,
  filter: StructuredLookupFilter,
  classifierResult: { matched: boolean; fieldPath?: string; fieldPaths?: string[] },
): Promise<StructuredLookupResult | null> {
  if (!classifierResult.matched) return null
  if (classifierResult.fieldPaths && classifierResult.fieldPaths.length > 0) {
    const pathForFetch = classifierResult.fieldPaths[0]
    const blocks = fetchBlocksForStructuredLookup(db, filter, pathForFetch)
    if (blocks.length === 0) return { found: false }
    return structuredLookupMulti(blocks, classifierResult.fieldPaths)
  }
  if (!classifierResult.fieldPath) return null
  const blocks = fetchBlocksForStructuredLookup(db, filter, classifierResult.fieldPath)
  if (blocks.length === 0) return { found: false }
  return structuredLookup(blocks, classifierResult.fieldPath)
}
```

**Why:** Uses multi-field structured lookup for compound queries.

---

## 3. Updated Types/Signatures

| Location | Change |
|----------|--------|
| `intentClassifier.ts` | `queryRequiresAttachmentSelection(query: string): boolean` (new) |
| `structuredQuery.ts` | `QueryClassifierResult.fieldPaths?: string[]` (new) |
| `structuredQuery.ts` | `structuredLookupMulti(blocks, fieldPaths): StructuredLookupResult` (new) |
| `handshakeViewTypes.ts` | `chatWithContextRag` params: `selectedDocumentId?: string` |
| `main.ts` | `handshake:chatWithContextRag` params: `selectedDocumentId?: string` |
| `StructuredHsContextPanelProps` | `onDocumentSelect?: (documentId: string \| null) => void` |
| `HandshakeWorkspaceProps` | `onDocumentSelect?: (documentId: string \| null) => void` |
| `HandshakeViewProps` | `onDocumentSelect?: (documentId: string \| null) => void` |
| `HybridSearchProps` | `selectedDocumentId?: string \| null` |

---

## 4. Behavior Changes

| Scenario | Before | After |
|----------|--------|-------|
| "What is this attachment about?" (no selection) | Semantic search over all blocks | "I can summarize the attachment once a specific document is selected." |
| "What is this attachment about?" (with selection) | Semantic search over all blocks | Document-scoped retrieval → LLM summary |
| "Give me the contact and company details" | Single field (first match) | Multiple fields aggregated |
| All semantic scores < 0.4 | Unfiltered results used | Empty context → "retrieved blocks did not contain relevant information" |
| "What does the document say about refunds?" | document_lookup | RAG (no selection required) |

---

## 5. Tests to Run

```bash
pnpm test -- run apps/electron-vite-project/electron/main/handshake/__tests__/resilience.chaos.test.ts
```

Manual checks:
1. Open handshake → open document → ask "Summarize the attachment briefly" → expect summary of that document.
2. Ask "What is this attachment about?" without opening a document → expect "I can summarize the attachment once a specific document is selected."
3. Ask "What are the opening hours?" → expect structured lookup.
4. Ask "Give me the contact and company details" → expect multiple fields.

---

## 6. Remaining Limitations

- Document content comes from `context_blocks` payload; documents only in vault (not committed) are not supported.
- `selectedDocumentId` is cleared when handshake changes; no cross-handshake document reference.
- 0.4 threshold is fixed; may need tuning per dataset.
- "What does the document say about [topic]?" uses normal RAG; no explicit document-scoping when topic is specified.
