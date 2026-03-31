# 01 — Current Auto-Sort End-to-End Flow

**Files traced:**
- `src/components/EmailInboxBulkView.tsx` — renderer, bulk grid view
- `src/stores/useEmailInboxStore.ts` — Zustand store
- `electron/main/email/ipc.ts` — main-process IPC handlers
- `electron/main/email/inboxLlmChat.ts` — LLM chat wrapper
- `electron/main/llm/ollama-manager.ts` — Ollama singleton
- `electron/main/llm/ollamaBulkPrewarm.ts` — warm-up helper
- `electron/preload.ts` — IPC bridge

---

## Phase 0: User clicks "⚡AI Auto-Sort"

**Renderer — `handleAiAutoSort` (EmailInboxBulkView.tsx ~3516)**

1. Guard: check `isSortingRef.current` and Zustand `isSortingActive`. If either is true, display notice and return.
2. Set `isSortingRef.current = true`, `setSortingActive(true)`, show progress bar with label `"Gathering messages…"`.
3. Clear pause/stop flags, clear previous outcome summary.

---

## Phase 1: Session and ID gathering (BLOCKING, before LLM work)

**~3540–3591**

### 1a. Session create
```
sessionApi.create()  →  IPC: autosort:createSession
  main: INSERT INTO autosort_sessions (id, started_at, status) VALUES (?, ?, 'running')
  returns: sessionId (UUID)
```

### 1b. ID gather (when `bulkBatchSize === 'all'`)
```
fetchAllMessages({ soft: true })
  → loadBulkInboxSnapshotPaginated(get)
    → fetchBulkTabCountsServer(filter)       [5 sequential listMessages limit=1]
    → trackedListMessages(bridge, { limit: BULK_UI_PAGE_SIZE, offset: 0 })  [1 listMessages]
  ← sets allMessages, tabCounts, total

fetchMatchingIdsForCurrentFilter()
  → bridge.listMessageIds({ limit: INBOX_LIST_PAGE_SIZE, offset })  [1+ paginated IPCs]
  loop until no more results
  ← returns all matching IDs

targetIds = [...new Set(all matching IDs)]
```

**Minimum IPC cost before first classify:** 7 IPCs (1 session create + 5 tab counts + 1 list).  
**For 90 messages:** 7–9 IPCs, all sequential, all in the renderer awaiting main.

---

## Phase 2: Classify loop — `runAiCategorizeForIds(targetIds, …, manageConcurrencyLock: false)`

**EmailInboxBulkView.tsx ~2596**

Note: `manageConcurrencyLock: false` means `runAiCategorizeForIds` does NOT own the busy flags — `handleAiAutoSort` caller does.

### 2a. Pre-run diagnostic sync
```
window.emailInbox.autosortDiagSync({ runId, bulkSortActive: true })
  → IPC: inbox:autosortDiagSync
  main: setAutosortDiagMainState({ runId, bulkSortActive: true })
  returns: { ok: true }
```

### 2b. Chunk loop (while `_i < ids.length`)

**Chunk building:** `chunkSize = Math.max(1, sortConcurrencyRef.current)` (default: 4)  
`batch = ids.slice(_i, _i + chunkSize)`

**Per-chunk IPC call:**
```
window.emailInbox.aiClassifyBatch(batch, sessionId, runId, chunkIndex, uiOllamaParallel)
  → IPC: inbox:aiClassifyBatch
```

**Inside `inbox:aiClassifyBatch` (main process):**

```
1. resolveDbCore()                     → get DB handle (check vault lock)
2. preResolveInboxLlm()                → ollamaManager.getEffectiveChatModelName()
                                         → listModels() [TTL=120s; hits /api/tags on first or after expiry]
3. [Ollama only, chunk 1 only]:
   maybePrewarmOllamaForBulkClassify(model, { chunkIndex: 1 })
     → POST http://127.0.0.1:11434/api/chat
       { model, messages: [{ role: 'user', content: '.' }], num_predict: 1, keep_alive: '15m' }
     → WAIT for full Ollama response  (BLOCKING, up to 60s timeout)
     → on cold model: 10–20 s delay before classify starts

4. resolveBulkOllamaClassifyCap(ollamaMaxConcurrentFromUi)  → cap = 4 (default)

5. runClassifyBatchWithOptionalOllamaCap(batchIds, sessionId, resolvedLlm, runId, chunkIndex, cap=4)
   → if batchIds.length <= cap: Promise.all(batchIds.map(runOne))
   → else: worker-pool with `cap` concurrent workers

   Per message: classifySingleMessage(messageId, sessionId, { resolvedLlm, runId, chunkIndex, batchIndex })
     a. resolveDbWithDiag()             → get DB handle
     b. SELECT inbox_messages WHERE id = ?   [1 DB read]
     c. UPDATE last_autosort_session_id = ?  [1 DB write]
     d. getInboxAiRulesForPrompt()      → fs.statSync + conditional readFileSync (cached by mtime)
     e. Build system + user prompts (inline, fast)
     f. inboxLlmChat({ system, user, resolvedContext })
          → provider.generateChat(messages, { model, stream: false, keep_alive: '15m' })
          → POST http://127.0.0.1:11434/api/chat  [THE SLOW STEP: 1–20 s per message]
     g. parseAiJson(raw)
     h. reconcileInboxClassification(...)
     i. Attachment guard
     j. UPDATE inbox_messages (sort_category, sort_reason, urgency_score, needs_reply, ...)  [1 DB write]
     k. UPDATE inbox_messages SET ai_analysis_json = ?  [1 DB write]
     l. enqueueRemoteOpsForLocalLifecycleState(db, [messageId])  [1 DB INSERT/UPDATE]
     m. return { messageId, category, urgency, ..., pending_delete_at, pending_review_at, archived }

6. scheduleOrchestratorRemoteDrain(resolveDb)  → schedule timer-based remote sync
7. return { results, batchRuntime: { model, provider, preResolveMs } }
```

**Back in renderer after each chunk:**
```
applyBulkClassifyMainResultsToLocalState(chunkClassifyApplies)  → single Zustand transaction
setBulkAiOutputs(prev => ({ ...prev, ...batchUiUpdates }))      → React state update
setAiSortProgress(...)                                           → progress bar update
```

**Note:** `skipBulkTabCountRefresh: true` is set on all classify payloads in the chunk apply, so no per-chunk tab count IPC fires from the store.

### 2c. Completeness retry (conditional, `!isRetry && !sortStopRequestedRef`)

If any messages have `error` results, the renderer fires `runAiCategorizeForIds(toRetry, false, true, { manageConcurrencyLock: false, skipEndRefresh: true, … })`.

The retry path is a recursive call with the same chunk loop, but skips the end-of-run `fetchAllMessages`. After the retry, if `manageConcurrencyLock && skipEndRefresh` (condition is false here since outer `manageConcurrencyLock: false`), it calls `refreshBulkTabCountsFromServer`.

**Actual behavior with toolbar-triggered run:** the retry block at line ~3186 that calls `refreshBulkTabCountsFromServer` is only entered when `manageConcurrencyLock && skipEndRefresh`. Since toolbar sets `manageConcurrencyLock: false`, this block is NEVER entered from the toolbar — neither in the outer pass nor the retry. Tab counts update only at the end-of-run `fetchAllMessages`.

### 2d. Remote sync deferral

After all chunks complete:
```
if (classifiedIdsForRemote.length > 0) {
  setTimeout(() => {
    window.emailInbox.fullRemoteSyncForMessages(classifiedIdsForRemote)  → IPC (fire-and-forget)
  }, 0)
}
```

---

## Phase 3: End-of-run refresh (when not `skipEndRefresh`)

**~3281–3292**
```
fetchAllMessages({ soft: true, skipTabCountFetch: false })
  → loadBulkInboxSnapshotPaginated(get)
    → fetchBulkTabCountsServer()       [5 sequential listMessages IPC calls]
    → trackedListMessages(...)         [1 listMessages IPC call]
```

This is the same 6-serial-IPC sequence as Phase 1b, repeated at the end.

---

## Phase 4: Session finalization and summary

**`handleAiAutoSort` ~3605–3660**
```
sessionApi.getSessionMessages(sessionId)    → IPC: autosort:getSessionMessages
                                              SELECT * FROM inbox_messages WHERE last_autosort_session_id = ?

sessionApi.finalize(sessionId, stats)       → IPC: autosort:finalizeSession
                                              UPDATE autosort_sessions SET status='completed', stats, …

[Progress phase set to 'summarizing']

sessionApi.generateSummary(sessionId)       → IPC: autosort:generateSummary
                                              Loads all session messages, builds summary prompt
                                              inboxLlmChat(...)  [ANOTHER FULL LLM CALL]
                                              UPDATE autosort_sessions SET ai_summary_json = ?
```

---

## Phase 5: Finally block (always)

**`handleAiAutoSort` finally ~3641–3655**
```
isSortingRef.current = false
setSortingActive(false)
setAiSortProgress(null)
```

**`runAiCategorizeForIds` finally** (when `manageConcurrencyLock: false` from toolbar, this block does NOT clear sorting flags):
```
autosortDiagSync({ runId: null, bulkSortActive: false })   → IPC
triggerAnalysisRestart()   → increment store counter
[isSortingRef NOT cleared here — caller owns it]
```

---

## Call graph summary

```
handleAiAutoSort
├── autosortSession.create()                      [IPC ×1]
├── fetchAllMessages({ soft: true })              [IPC ×6 serial]
├── fetchMatchingIdsForCurrentFilter()            [IPC ×1+]
├── runAiCategorizeForIds(targetIds, …)
│   ├── autosortDiagSync(bulkSortActive: true)    [IPC ×1]
│   ├── [for each chunk of 4 IDs:]
│   │   └── aiClassifyBatch(chunk, …)             [IPC ×1]
│   │       ├── resolveDbCore()
│   │       ├── preResolveInboxLlm()              [listModels, TTL=120s]
│   │       ├── maybePrewarmOllamaForBulkClassify [blocking LLM call on chunk 1]
│   │       └── [for each ID in chunk:]
│   │           └── classifySingleMessage()
│   │               ├── SELECT inbox_messages
│   │               ├── UPDATE session_id
│   │               ├── inboxLlmChat()            [Ollama /api/chat — THE SLOW STEP]
│   │               ├── UPDATE inbox_messages     [sort columns]
│   │               ├── UPDATE inbox_messages     [ai_analysis_json]
│   │               └── enqueueRemoteOps()
│   ├── [completeness retry if failures]
│   │   └── (recursive runAiCategorizeForIds with skipEndRefresh)
│   ├── fetchAllMessages({ soft: true })          [IPC ×6 serial] END OF RUN
│   └── autosortDiagSync(bulkSortActive: false)   [IPC ×1]
├── autosortSession.getSessionMessages()          [IPC ×1]
├── autosortSession.finalize()                    [IPC ×1]
└── autosortSession.generateSummary()             [IPC ×1 → another LLM call]
```

---

## Essential vs. non-essential steps

| Step | Essential? | Notes |
|------|-----------|-------|
| Session create | Optional for core sort | Required for session review feature only |
| Pre-flight `fetchAllMessages` | **No** — only needed to gather IDs | `fetchMatchingIdsForCurrentFilter` alone is sufficient; the tab-count refresh is waste |
| `fetchMatchingIdsForCurrentFilter` paginated loop | Yes, needed for "All" mode | But could be a single lighter query |
| `autosortDiagSync` IPC | No — diagnostic only | Low overhead but non-zero |
| `preResolveInboxLlm` per chunk | Yes, needed for LLM resolution | Acceptable once per chunk |
| `maybePrewarmOllamaForBulkClassify` (blocking) | **No** — should be fire-and-forget | Currently blocks entire first chunk |
| `classifySingleMessage` LLM call | Yes — core work | Irreducible cost |
| 3 DB writes per message | Partially redundant | `ai_analysis_json` and session_id could be batched |
| `enqueueRemoteOpsForLocalLifecycleState` per message | Yes for remote sync | Low cost but per-message |
| End-of-run `fetchAllMessages` (6 IPCs) | Partially | Tab counts could be maintained incrementally |
| Session `getSessionMessages` + `finalize` | Optional | Required for session review feature only |
| `generateSummary` (extra LLM call) | **No** — user did not request it | Added by session refactor, blocks completion |
| `triggerAnalysisRestart` | Low priority | Kicks preload queue |
