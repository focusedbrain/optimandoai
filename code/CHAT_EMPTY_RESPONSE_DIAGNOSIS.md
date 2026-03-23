# Chat Empty Response — Code-Level Diagnosis

## 1. Most Likely Root Cause

**Streaming fallback gap in `HybridSearch.tsx`**: When `result.streamed` is true, the renderer never sets `response` from `result.answer`. For early-return paths (no document selected, document not found), main sends the message as a single stream token and returns immediately. The IPC reply can be delivered before the stream token, causing the renderer to unsubscribe from stream events in the `finally` block before the token is processed. The token is then lost, and `response` stays null. The chat panel only renders when `response || contextBlocks.length > 0 || structuredResult`, so nothing is shown.

---

## 2. Exact Execution Path

### Query: "What is this attachment about?" (no document selected)

1. **HybridSearch.tsx:241** — `handleSubmit` runs
2. **265–269** — State cleared: `setResponse(null)`, `setShowPanel(true)`
3. **265–272** — Subscribes to `onChatStreamStart` and `onChatStreamToken`
4. **276** — `chatWithContextRag({ query, scope, model, provider, stream: true, selectedDocumentId })` invoked
5. **main.ts:2678** — IPC handler runs
6. **2708** — `queryClassifier` runs (not document_lookup for structured path)
7. **2770–2778** — `hybridSearch` runs (semantic search)
8. **2802** — `classifyIntent` → `document_lookup` (matches `/\bwhat\s+is\s+(?:this\s+)?(?:attachment|document)\s+about/i`)
9. **2805** — `queryRequiresAttachmentSelection` → true; `!params.selectedDocumentId?.trim()` → true
10. **2806–2815** — Early return:
    - `send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })`
    - `send('handshake:chatStreamToken', { token: msg })` — full message as one token
    - `return toIPC({ success: true, answer: msg, sources: [], streamed: true })`
11. **HybridSearch 286–288** — Promise resolves, `finally` runs: `unsubStart()`, `unsubToken()` — listeners removed
12. **311–314** — `result.streamed === true` → `if (!result.streamed)` is false → `setResponse` is never called
13. **442** — Render condition: `lastMode === 'chat' && (response || contextBlocks.length > 0 || structuredResult)` → all false → no content rendered

---

## 3. Where the Flow Breaks

**Location:** `HybridSearch.tsx` lines 311–314

```tsx
} else {
  if (!result.streamed) {
    setResponse(result.answer ?? '')
    setChatSources(result.sources ?? [])
  }
  // When streamed, we rely on tokens. For early returns, tokens may arrive
  // after unsubscribe; result.answer is never used.
```

- When `result.streamed` is true, `setResponse` is never called.
- Early-return paths in main send the full message as one token and return with `answer` in the payload.
- If the IPC reply is processed before the stream token, the token is lost after unsubscribe.
- `result.answer` is available but unused.

---

## 4. Files/Functions Involved

| File | Function / Area | Role |
|------|-----------------|------|
| `HybridSearch.tsx` | `handleSubmit` (241–326) | Submits query, subscribes to stream, handles result |
| `HybridSearch.tsx` | Lines 311–314 | Skips `setResponse` when `result.streamed` |
| `HybridSearch.tsx` | Line 442 | Renders only when `response \|\| contextBlocks \|\| structuredResult` |
| `main.ts` | `handshake:chatWithContextRag` (2678+) | IPC handler |
| `main.ts` | 2805–2815 | No-selection early return: sends stream token + returns |
| `main.ts` | 2865–2874 | Document-not-found early return: same pattern |
| `intentClassifier.ts` | `classifyIntent`, `queryRequiresAttachmentSelection` | Classifies "What is this attachment about?" as document_lookup requiring selection |
| `preload.ts` | `onChatStreamStart`, `onChatStreamToken` | IPC listeners for stream events |

---

## 5. Response Shape Mismatches

No mismatch. Both sides use:

- `{ success: boolean; answer?: string; streamed?: boolean; sources?: [...] }`

The problem is that when `streamed` is true, the UI never uses `result.answer` as a fallback.

---

## 6. Silent Error / Empty-State Risks

| Risk | Location | Effect |
|------|----------|--------|
| Stream token after unsubscribe | `HybridSearch.tsx` 286–288 | Token lost, `response` stays null |
| No fallback when streamed | `HybridSearch.tsx` 311–314 | `result.answer` ignored |
| Empty `contextBlocks` for early returns | `main.ts` 2810 | `contextBlocks.length > 0` is false |
| No `structuredResult` for early returns | main.ts | `structuredResult` is null |

---

## 7. Concrete Code Fixes

### Fix 1: Use `result.answer` as fallback when streamed (primary fix)

**File:** `apps/electron-vite-project/src/components/HybridSearch.tsx`

**Current (lines 310–321):**

```tsx
        } else {
          if (!result.streamed) {
            setResponse(result.answer ?? '')
            setChatSources(result.sources ?? [])
          }
          setChatGovernanceNote(result.governanceNote ?? null)
```

**Change to:**

```tsx
        } else {
          if (!result.streamed) {
            setResponse(result.answer ?? '')
            setChatSources(result.sources ?? [])
          } else if (result.answer) {
            // Early-return paths (no-selection, doc-not-found) stream the full message
            // as one token; IPC reply may arrive before the token. Use answer as fallback.
            setResponse(prev => prev || result.answer ?? '')
          }
          setChatGovernanceNote(result.governanceNote ?? null)
```

This ensures that when main returns with `answer` and `streamed: true`, the UI still shows the message even if the stream token was missed.

---

## 8. Minimal Debug Logs to Add

```ts
// HybridSearch.tsx, after line 288 (after result = await ...):
if (__DEV__ || params?.debug) {
  console.log('[Chat] Result:', {
    success: result?.success,
    streamed: result?.streamed,
    hasAnswer: !!result?.answer,
    answerLength: result?.answer?.length ?? 0,
    responseStateBefore: response,
  })
}
```

```ts
// main.ts, in no-selection path (after line 2811):
console.log('[Chat] No-selection early return, streamed:', doStream, 'msg length:', msg.length)
```

---

## 9. Manual Test Steps to Confirm the Fix

1. Open the app, go to a handshake view.
2. Do **not** open any document.
3. Enter: `What is this attachment about?`
4. Press Chat / Enter.
5. **Expected:** Message appears: "I can summarize the attachment once a specific document is selected. Please open a document from the handshake context first."
6. **Before fix:** Header shows, no answer content.
7. **After fix:** Same message is visible in the chat panel.

Additional checks:

- With a document selected: summary of the document appears.
- "I couldn't find that document in the current handshake context" appears when the selected document is not found.
- Normal RAG answers still stream and display correctly.
