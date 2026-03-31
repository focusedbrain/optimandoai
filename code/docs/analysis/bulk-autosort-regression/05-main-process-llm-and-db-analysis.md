# 05 — Main Process: LLM and DB Analysis

**Files traced:**
- `electron/main/email/ipc.ts`
- `electron/main/email/inboxLlmChat.ts`
- `electron/main/llm/ollama-manager.ts`
- `electron/main/llm/ollamaBulkPrewarm.ts`
- `electron/main/llm/localLlmRuntimeStatus.ts`
- `electron/main/llm/activeOllamaModelStore.ts`
- `electron/main/email/inboxOrchestratorRemoteQueue.ts`

---

## 1. `inbox:aiClassifyBatch` Handler — Step by Step

**Location:** `electron/main/email/ipc.ts:4425–4546`

```typescript
ipcMain.handle('inbox:aiClassifyBatch', async (_e, ids, sessionId, runId, chunkIndex, ollamaMaxConcurrentFromUi) => {
  // 1. resolveDbCore()
  // 2. preResolveInboxLlm()
  // 3. [Ollama only] maybePrewarmOllamaForBulkClassify()  ← BLOCKING
  // 4. resolveBulkOllamaClassifyCap()
  // 5. runClassifyBatchWithOptionalOllamaCap()
  // 6. scheduleOrchestratorRemoteDrain()
  // 7. return { results, batchRuntime }
})
```

### Step 1: `resolveDbCore()`

Resolves the SQLite database handle. Returns null if vault is locked. This is fast (handle already open) unless the vault is locked — in which case all messages in the chunk return `{ error: 'vault_locked' }`.

**Regression note:** If the vault locks mid-run (session expiry), the entire batch returns errors. The diagnostic code checks `isRecentVaultLock(120_000)` to distinguish vault lock from true DB unavailability.

### Step 2: `preResolveInboxLlm()`

**Location:** `inboxLlmChat.ts:129–158`

```typescript
export async function preResolveInboxLlm(): Promise<ResolvedLlmContext | null> {
  const settings = resolveInboxLlmSettings()  // reads ocrRouter config (sync, fast)
  if (provider === 'ollama') {
    const model = await ollamaManager.getEffectiveChatModelName()
    //                    → listModels() [TTL=120s, /api/tags on miss]
    //                    → resolveEffectiveOllamaModel() [sync]
    return { model, provider: 'ollama' }
  }
  // Cloud: verify API key
}
```

**First call per run (cold cache):** `listModels()` fires `fetch /api/tags` (5 s abort timeout). Typical response: 20–200 ms.

**Subsequent calls (within 120 s):** Cache hit, ~0 ms.

**After 120 s (long run):** Cache expires, another `/api/tags` hit. For a 90-message run at 4 per chunk, this occurs at chunk ~23 if the run takes >2 minutes. CPU-bound inference on large models can make this happen.

**Design note:** `preResolveInboxLlm` is called once per IPC invocation (per chunk). The docstring says "Resolve the inbox LLM context once for an entire batch run." But it's called in the IPC handler per chunk, not once globally. There is no run-level resolution passed from the renderer. This is semantically once-per-chunk, not once-per-run.

### Step 3: `maybePrewarmOllamaForBulkClassify(model, { chunkIndex })`

**Location:** `ollamaBulkPrewarm.ts:57–133`

```typescript
export async function maybePrewarmOllamaForBulkClassify(model, opts) {
  // Only runs when chunkIndex === 1 or chunkIndex is omitted
  if (idx != null && idx !== 1) return { action: 'skipped_not_first_chunk' }
  
  // Cooldown check: skip if prewarmed within 120s (same model)
  const last = lastPrewarmAtByModel.get(model)
  if (last != null && now - last < PREWARM_COOLDOWN_MS) {
    return { action: 'skipped_cooldown', followingClassifyLikelyResident: true }
  }
  
  // Fire minimal LLM request
  const res = await fetch(OLLAMA_CHAT, {
    method: 'POST',
    body: JSON.stringify({ model, messages: [{ role: 'user', content: '.' }],
      stream: false, keep_alive: '15m', options: { num_predict: 1 } }),
    signal: AbortController with 60s timeout,
  })
  // ...
}
```

**The blocking issue:**
- The `await fetch(...)` blocks the IPC handler until Ollama responds.
- On cold model: 2–20 s. The renderer awaits the `aiClassifyBatch` IPC response.
- Progress bar shows 0% during this time with no indication of what is happening.
- The `batchRuntime.ollamaPrewarm.action` is returned to the renderer but not shown in the progress bar.

**Cooldown state:**
- `lastPrewarmAtByModel: Map<string, number>` — per-model last prewarm timestamp
- Persists across chunks within the same process lifetime
- Reset by: nothing (no explicit invalidation except model switch via `noteOllamaActiveModelChangedForBulkPrewarm`)

**Model switch bypass:**
- `postSwitchBypassModelId` set by `noteOllamaActiveModelChangedForBulkPrewarm(modelId)`
- When set: cooldown is skipped on next prewarm for that model
- After bypass fires: `postSwitchBypassModelId = null`
- Effect: changing the model mid-run guarantees a prewarm on the next first chunk

### Step 4: `resolveBulkOllamaClassifyCap(ollamaMaxConcurrentFromUi)`

```typescript
function resolveBulkOllamaClassifyCap(fromUi?: number | null): { cap: number; source: string } {
  // 1. WRDESK_OLLAMA_CLASSIFY_MAX_CONCURRENT env var (if valid int 1–8)
  // 2. fromUi (UI parallelism slider value)
  // 3. Default: 4
}
```

Resolved once per chunk. The cap is stored in `lastBulkOllamaResolve` for diagnostic logging. No performance concern.

### Step 5: `runClassifyBatchWithOptionalOllamaCap`

**Location:** `ipc.ts:4331–4399`

```typescript
async function runClassifyBatchWithOptionalOllamaCap(batchIds, sessionId, resolvedLlm, runId, chunkIndex, ollamaParallelCap) {
  const ollama = resolvedLlm.provider.toLowerCase() === 'ollama'
  const capped = ollama && batchIds.length > ollamaParallelCap
  
  ollamaRuntimeBeginBatch({ ... })  // diagnostics only
  
  const runOne = async (id, idx) => {
    const t0 = performance.now()
    const r = await classifySingleMessage(id, sessionId, { resolvedLlm, batchIndex: idx, runId, chunkIndex })
    return r
  }
  
  if (!ollama || batchIds.length <= ollamaParallelCap) {
    results = await Promise.all(batchIds.map((id, idx) => runOne(id, idx)))
  } else {
    // Worker pool: cap concurrent workers
    results = new Array(batchIds.length)
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const idx = cursor++
        if (idx >= batchIds.length) break
        results[idx] = await runOne(batchIds[idx], idx)
      }
    }
    await Promise.all(Array.from({ length: ollamaParallelCap }, () => worker()))
  }
  
  ollamaChunkDiag = ollamaRuntimeEndBatch()
  return { results, ollamaChunkDiag }
}
```

**Structural issue:** With default `sortConcurrency=4` and `ollamaParallelCap=4`:
- `batchIds.length (4) <= ollamaParallelCap (4)` → `Promise.all` path
- 4 concurrent requests to Ollama
- Ollama queues them internally and processes sequentially
- No true parallelism benefit

**For cloud providers (OpenAI, Anthropic, etc.):**
- The capping condition `!ollama || ...` → uncapped `Promise.all`
- Cloud providers can genuinely parallelize requests
- With cloud, `sortConcurrency=4` means 4 truly concurrent LLM calls
- This is correct and beneficial for cloud providers

---

## 2. `classifySingleMessage` — DB Operations

**Location:** `ipc.ts:4057–4329`

### DB operation sequence per message

```
1. resolveDbWithDiag(tag)
   → Gets DB handle. Returns null if vault locked.
   → Fast: handle already resolved, just returns it.

2. db.prepare('SELECT from_address, from_name, subject, body_text, has_attachments,
               attachment_count, source_type, handshake_id FROM inbox_messages WHERE id = ?')
   .get(messageId)
   → SQLite point read by primary key (id). Fast: ~0.1–0.5 ms.

3. if (sessionId):
   db.prepare('UPDATE inbox_messages SET last_autosort_session_id = ? WHERE id = ?')
   .run(sessionId, messageId)
   → SQLite synchronous write. ~0.1–1 ms.
   → Happens even before LLM result is known.

4. [LLM inference — the slow step, 1–30 s]

5. One of four UPDATE branches (by category):
   db.prepare('UPDATE inbox_messages SET archived=0, pending_delete=0, ..., sort_category=?,
               sort_reason=?, urgency_score=?, needs_reply=? WHERE id=?')
   .run(...)
   → SQLite synchronous write. ~0.1–1 ms.

6. db.prepare('UPDATE inbox_messages SET ai_analysis_json = ? WHERE id = ?')
   .run(aiAnalysisJson, messageId)
   → SQLite synchronous write. ~0.1–1 ms.
   → aiAnalysisJson is a JSON.stringify() of analysis results: ~200–500 bytes.

7. enqueueRemoteOpsForLocalLifecycleState(db, [messageId])
   → Reads current row state, compares to imap_remote_mailbox
   → If state differs: INSERT or UPDATE orchestrator_remote_queue
   → If state matches: skip
   → Multiple SQLite operations, synchronous. ~0.5–2 ms.
```

**Total non-LLM DB cost per message:** ~1–5 ms. Negligible vs. LLM time.

**Concurrent write serialization:** With 4 parallel `classifySingleMessage` calls, the `better-sqlite3` synchronous writes serialize on the Node.js event loop. Each write may briefly block other concurrent `await` resolutions. Estimated additional overhead: ~0–5 ms total per chunk. Not significant.

---

## 3. `inboxLlmChat` — LLM Chat Path

**Location:** `inboxLlmChat.ts:161–284`

```typescript
export async function inboxLlmChat(params) {
  const { system, user, timeoutMs = 45_000, resolvedContext, llmTrace } = params

  // Fast path: if resolvedContext provided, skip listModels()
  // Slow path: if no resolvedContext, calls ollamaManager.getEffectiveChatModelName() again

  const provider = getProvider(settings, getApiKey)  // sync, fast

  // Set 45s AbortController timeout
  const ac = new AbortController()
  setTimeout(() => ac.abort(), timeoutMs)

  // Determine keep_alive
  const bulkOllamaAutosort = provider.id === 'ollama' && llmTrace?.source === 'bulk_autosort'
  // bulkOllamaAutosort = true when resolvedContext provided with bulk_autosort source
  // → uses ollamaKeepAlive: '15m'

  const text = await provider.generateChat(messages, {
    model: modelOverride,
    stream: false,
    signal: ac.signal,
    runtimeTrace: llmTrace,
    ...(bulkOllamaAutosort ? { ollamaKeepAlive: '15m' } : {}),
  })
}
```

**Timeout:** 45 s (`INBOX_LLM_TIMEOUT_MS`). Any Ollama call exceeding 45 s throws `InboxLlmTimeoutError`, which is caught in `classifySingleMessage` and returns `{ error: 'timeout' }`.

**keep_alive discrepancy:**
- `inboxLlmChat` requests `keep_alive: '15m'` for bulk autosort (when `llmTrace?.source === 'bulk_autosort'`)
- `ollamaManager.chat()` hardcodes `keep_alive: '2m'`
- If `provider.generateChat` uses `ollamaManager.chat()`, the `ollamaKeepAlive: '15m'` parameter may or may not override the hardcoded `'2m'`
- This depends on how `aiProviders.ts` handles the `ollamaKeepAlive` option in its provider implementation (not traced here)

**If `keep_alive` is not correctly overridden to `'15m'`**, the model evicts from Ollama memory after 2 minutes of inactivity — which could happen mid-run on a slow CPU machine, causing model reload delays on subsequent chunks.

---

## 4. `ollama-manager.ts` — Model Resolution and Cache

### `listModels()` — TTL cache implementation

```typescript
// ollama-manager.ts ~230–290
async listModels(): Promise<InstalledModel[]> {
  const epoch = this._listModelsCacheEpoch

  // 1. TTL cache hit
  if (_modelsCache && _modelsCacheValidEpoch === epoch && Date.now() - _modelsCacheTime < 120_000) {
    return _modelsCache
  }

  // 2. In-flight dedup — join existing fetch
  if (_modelsInFlight !== null) return _modelsInFlight

  // 3. New fetch
  _modelsInFlight = listModelsRaw().then(models => {
    if (epoch !== _listModelsCacheEpoch) return models  // stale, skip write
    _modelsCache = models
    _modelsCacheTime = Date.now()
    _modelsCacheValidEpoch = epoch
    _modelsInFlight = null
    return models
  })
  return _modelsInFlight
}
```

**In-flight dedup:** If multiple concurrent callers hit `listModels()` simultaneously (e.g., 4 parallel `classifySingleMessage` calls with no `resolvedLlm`), only one `/api/tags` HTTP request fires. Others join the same promise.

**But:** In the current batch path, `preResolveInboxLlm()` is called once per chunk BEFORE the parallel classify calls. The `resolvedContext` is then passed to all `classifySingleMessage` calls, which skip `listModels()` entirely. The dedup is thus a belt-and-suspenders protection for the single-message path (`aiClassifySingle`), not needed for the batch path.

### `invalidateModelsCache()` — when called

- After `pullModel()` (model installed)
- After `deleteModel()` (model removed)  
- After `setActiveModelPreference()` (model switch)

A model switch invalidates the cache, so the next `preResolveInboxLlm()` hits `/api/tags`. Minor overhead (~100 ms), but the model switch also triggers `noteOllamaActiveModelChangedForBulkPrewarm()` which queues a bypass prewarm.

### `getStatus()` — expensive call

```typescript
async getStatus(): Promise<OllamaStatus> {
  const installed = await this.checkInstalled()   // execAsync("ollama --version")
  const running = await this.isRunning()           // fetch /api/tags 2s timeout
  const version = installed ? await this.getVersion() : undefined  // execAsync again if installed
  let modelsInstalled = running ? await this.listModels() : []
  // ... activeModel resolution ...
  const localRuntime = await buildLocalLlmRuntimeInfo({ ollamaRunning: running, activeModel })
  // → getGpuAccelerationHintsCached() → wmic/lspci/nvidia-smi (5s+2.5s timeouts)
}
```

Called from `llm:getStatus` IPC, which is called by `BulkOllamaModelSelect.refresh()`. This is the most expensive non-classify call in the system.

---

## 5. `localLlmRuntimeStatus.ts` — GPU Detection

**Location:** `localLlmRuntimeStatus.ts:57–129` (`detectGpuHintsUncached`)

On Windows:
1. `wmic path win32_VideoController get Name` — up to **5 s timeout**
2. `nvidia-smi --query-gpu=name --format=csv,noheader` — up to **2.5 s timeout**

Both are always attempted in sequence. Combined worst case: **7.5 s** per cache-cold call.

Cache TTL: **45 s**. If the user focuses the window once every 45 seconds during a run, this fires the 7.5 s subprocess chain each time.

**In the main process:** These `execAsync` calls run in Node.js's `child_process.exec` — they are non-blocking at the Node.js level (subprocess), but on Windows the WMI query can slow down other operations because WMI uses system resources.

---

## 6. Orchestrator Remote Queue — Post-Classify Behavior

**Location:** `inboxOrchestratorRemoteQueue.ts`

### `enqueueRemoteOpsForLocalLifecycleState(db, [messageId])`

Called per message in `classifySingleMessage`. Reads the message's current local state and the `imap_remote_mailbox` field, then:
- If they match: no-op (skips enqueue)
- If they differ: INSERT/UPDATE a row in `orchestrator_remote_queue`

This is fast (synchronous SQLite) and non-blocking. Not a bottleneck.

### `scheduleOrchestratorRemoteDrain(resolveDb)`

Called once per batch chunk in `inbox:aiClassifyBatch`. With `setSimpleOrchestratorRemoteDrainPrimary(true)` active (set at initialization, line 1872 of `ipc.ts`), this schedules the "simple drain" processor.

The simple drain:
- Fires every **10 seconds**
- Processes up to **20 rows per batch** (via `SIMPLE_DRAIN_BATCH_SIZE`)
- For 90 messages: 90 queued ops / 20 per batch = ~4–5 drain cycles ≈ 40–50 s to fully drain

**Implication:** Remote IMAP moves happen up to 50 s after local classify. This is a product behavior trade-off (non-blocking classify vs. delayed remote sync) and is not a regression, but may surprise users who expect immediate IMAP folder moves.

### `setSimpleOrchestratorRemoteDrainPrimary(true)` — context

This call at line 1872 disables the legacy `scheduleOrchestratorRemoteDrain` chain mechanism. The comment says:
```
// Legacy setImmediate chain + bounded post-sync batch drain disabled — simple timer processor owns the queue.
```

This was introduced as part of the "simple drain" refactor. The `scheduleOrchestratorRemoteDrain` calls from `classifySingleMessage` and `aiClassifySingle` are now effectively no-ops when the simple drain primary is set. The drain is entirely timer-driven (every 10 s). This is fine for throughput but means classify itself doesn't trigger immediate remote sync.

---

## 7. `autosort:generateSummary` — The Hidden Extra LLM Call

**Location:** `electron/main/email/ipc.ts` (autosort session handlers, ~1821)

```typescript
ipcMain.handle('autosort:generateSummary', async (_e, sessionId) => {
  const db = await resolveDb()
  if (!db) return { ok: false, error: 'database_unavailable' }
  
  // Load all messages for the session
  const rows = db.prepare(
    'SELECT ... FROM inbox_messages WHERE last_autosort_session_id = ? ORDER BY ...'
  ).all(sessionId)
  
  // Build a prompt summarizing all N classified messages
  const systemPrompt = '...'
  const userPrompt = `Here are the ${rows.length} messages sorted: ...`
  
  // Full LLM inference
  const summaryRaw = await inboxLlmChat({ system, user })
  
  // Parse and store
  db.prepare('UPDATE autosort_sessions SET ai_summary_json = ?, status = ? WHERE id = ?')
    .run(summaryJson, 'completed', sessionId)
  
  return { ok: true, summary: parsed }
})
```

This is called from `handleAiAutoSort` AFTER all classification is complete. It:
1. Loads all N message rows from DB
2. Builds a prompt proportional to N (90 messages = large prompt)
3. Calls `inboxLlmChat()` without `resolvedContext` (will call `listModels()` again if cache expired)
4. Stores the result

**Impact:** This is an additional full LLM inference call, potentially with a larger prompt than any single classify call (aggregating all N messages). On a slow model/hardware, this adds 10–60 s to perceived run completion time.

**Product question:** Was this feature intended to be automatic on every run, or only on-demand? The current behavior makes it mandatory for every toolbar Auto-Sort with a session.

---

## 8. Architecture Observation: `resolveDb` vs `resolveDbCore` vs `resolveDbWithDiag`

Multiple functions exist to resolve the database handle:
- `resolveDb()` — standard resolution
- `resolveDbCore()` — used in `inbox:aiClassifyBatch` (returns null if vault locked)
- `resolveDbWithDiag(tag)` — used in `classifySingleMessage` (adds diagnostic logging)

All three are functionally similar (get or create the DB handle) but differ in error reporting. This is not a performance issue but adds cognitive overhead for maintenance.
