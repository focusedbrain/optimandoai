/**
 * Renderer autosort diagnostics — set `electron/main/autosortDiagnostics.ts` to the same value when enabling.
 *
 * For performance traces (`DEBUG_AUTOSORT_TIMING`), enable in **both** this file and
 * `electron/main/autosortDiagnostics.ts` so main (`inbox:aiClassifyBatch`) and renderer logs align.
 *
 * **Bulk Auto-Sort validation (outer run, `skipEndRefresh: false`):**
 * - `[AUTOSORT-TIMING] renderer:chunk` — `ipcMs` ≈ main `aiClassifyBatch:ipc` wall time; includes **`uiMessagesPerBatch`** /
 *   **`uiOllamaParallel`** (values for this chunk). `processLoopMs` + `zustandApplyMs` + `reactBulkOutputsMs` should stay
 *   small vs `ipcMs` (no per-chunk dwell or mid-run tab recounts on the hot path).
 * - `[AUTOSORT-TIMING] run-summary` — `listMessagesCalls`: expect **6** per end snapshot (five tab total queries + first page);
 *   `refreshBulkTabCountsFromServerCalls`: **0** unless the run uses `skipEndRefresh` (then **1** without end fetch). Nested missed-id
 *   retry must not add a second snapshot (outer invocation only).
 * - **Outer run aggregates:** `outerClassifyIpcSumMs` / `outerChunkWallSumMs` / `outerRendererNonIpcSumMs`, `completenessRetryInvoked`, `postRunTailMs`.
 * - **`run-tuning-one-line`** (renderer): quick compare of classify vs renderer-non-IPC vs tail; main **`run-tuning-main`** follows on **`autosortDiagSync`** (cap + run max in-flight).
 * - Main **`aiClassifyBatch:ollamaPrewarm`** — first-chunk tiny `/api/chat` (`action`, `prewarmLoadDurationMs`, cooldown/skip); compare to **`aiClassifyBatch:perMessage`** load for first vs later messages.
 */

export const DEBUG_AUTOSORT_DIAGNOSTICS = false

/**
 * Concise performance traces (chunk timing, IPC counts, tail). Independent of DEBUG_AUTOSORT_DIAGNOSTICS.
 * Enable in main: `electron/main/autosortDiagnostics.ts` → DEBUG_AUTOSORT_TIMING.
 */
export const DEBUG_AUTOSORT_TIMING = false

export type AutosortTimingCounters = {
  listMessagesCalls: number
  refreshBulkTabCountsFromServerCalls: number
  fetchAllMessagesCalls: number
  refreshMessagesCalls: number
  remoteEnqueueCalls: number
  fullRemoteSyncCalls: number
}

const emptyCounters = (): AutosortTimingCounters => ({
  listMessagesCalls: 0,
  refreshBulkTabCountsFromServerCalls: 0,
  fetchAllMessagesCalls: 0,
  refreshMessagesCalls: 0,
  remoteEnqueueCalls: 0,
  fullRemoteSyncCalls: 0,
})

let _timingRunActive = false
let _timingCounters: AutosortTimingCounters = emptyCounters()

/** Outer `runAiCategorizeForIds` only (`manageConcurrencyLock` chunks — excludes nested missed-id retry chunks). */
let _outerChunkCount = 0
let _outerIpcSumMs = 0
let _outerChunkWallSumMs = 0
let _postRunTailMs: number | undefined
let _completenessRetryInvoked = false

/** Start counting IPC-style work for one toolbar Auto-Sort run (outer pass only). */
export function autosortTimingRunStart(): void {
  if (!DEBUG_AUTOSORT_TIMING) return
  _timingRunActive = true
  _timingCounters = emptyCounters()
  _outerChunkCount = 0
  _outerIpcSumMs = 0
  _outerChunkWallSumMs = 0
  _postRunTailMs = undefined
  _completenessRetryInvoked = false
}

export function autosortTimingRunActive(): boolean {
  return DEBUG_AUTOSORT_TIMING && _timingRunActive
}

export function autosortTimingBump<K extends keyof AutosortTimingCounters>(key: K, delta = 1): void {
  if (!DEBUG_AUTOSORT_TIMING || !_timingRunActive) return
  _timingCounters[key] += delta
}

/** Sum outer-chunk `renderer:chunk` metrics (call with `manageConcurrencyLock` only). */
export function autosortTimingAccumulateOuterChunk(ipcMs: number, chunkWallMs: number): void {
  if (!DEBUG_AUTOSORT_TIMING || !_timingRunActive) return
  _outerChunkCount += 1
  _outerIpcSumMs += ipcMs
  _outerChunkWallSumMs += chunkWallMs
}

export function autosortTimingNoteCompletenessRetry(): void {
  if (!DEBUG_AUTOSORT_TIMING || !_timingRunActive) return
  _completenessRetryInvoked = true
}

/** End-of-run tail from `tPostClassifyDone` (remote scheduling + clear selection + optional `fetchAllMessages`). */
export function autosortTimingSetPostRunTailMs(ms: number): void {
  if (!DEBUG_AUTOSORT_TIMING || !_timingRunActive) return
  _postRunTailMs = ms
}

/** Log accumulated counters and end the run (outer `finally` only). */
export function autosortTimingRunEnd(extra?: Record<string, unknown>): void {
  if (!DEBUG_AUTOSORT_TIMING || !_timingRunActive) return
  _timingRunActive = false
  const derived =
    _outerChunkCount > 0
      ? {
          outerChunkCount: _outerChunkCount,
          outerClassifyIpcSumMs: _outerIpcSumMs,
          outerChunkWallSumMs: _outerChunkWallSumMs,
          outerRendererNonIpcSumMs: _outerChunkWallSumMs - _outerIpcSumMs,
          avgRendererChunkWallMs: Math.round(_outerChunkWallSumMs / _outerChunkCount),
          avgClassifyIpcMsPerChunk: Math.round(_outerIpcSumMs / _outerChunkCount),
          completenessRetryInvoked: _completenessRetryInvoked,
          postRunTailMs: _postRunTailMs,
        }
      : {
          completenessRetryInvoked: _completenessRetryInvoked,
          postRunTailMs: _postRunTailMs,
        }
  const merged = { ..._timingCounters, ...derived, ...extra }
  console.log('[AUTOSORT-TIMING] run-summary', merged)

  const wall = _outerChunkWallSumMs
  const classifyMs = _outerIpcSumMs
  const renderNonIpc = wall > 0 ? wall - classifyMs : 0
  const pctClassify = wall > 0 ? Math.round((100 * classifyMs) / wall) : 0
  const pctRenderNonIpc = wall > 0 ? Math.round((100 * renderNonIpc) / wall) : 0
  const tailStr = _postRunTailMs != null ? `${_postRunTailMs}ms` : 'n/a'
  const uiTail =
    extra && typeof extra === 'object' && ('uiOllamaParallel' in extra || 'uiMessagesPerBatch' in extra)
      ? ` uiParallel=${(extra as { uiOllamaParallel?: unknown }).uiOllamaParallel ?? 'n/a'} uiPerBatch=${(extra as { uiMessagesPerBatch?: unknown }).uiMessagesPerBatch ?? 'n/a'} (end-of-run slider snapshot)`
      : ''
  console.log(
    '[AUTOSORT-TIMING] run-tuning-one-line',
    `classifyIPC=${classifyMs}ms (${pctClassify}% of ΣchunkWall=${wall}ms) rendererNonIpc=${renderNonIpc}ms (${pctRenderNonIpc}%) tail=${tailStr} retries=${_completenessRetryInvoked} listMsg=${_timingCounters.listMessagesCalls} outerChunks=${_outerChunkCount}${uiTail} | main: see run-tuning-main → cap & maxInFlight`,
  )
}

export function autosortTimingLog(tag: string, data?: Record<string, unknown>): void {
  if (!DEBUG_AUTOSORT_TIMING) return
  console.log(`[AUTOSORT-TIMING] ${tag}`, data ?? {})
}

let _runId: string | null = null

export function setAutosortDiagRunId(id: string | null): void {
  _runId = id
}

export function getAutosortDiagRunId(): string | null {
  return _runId
}

export function autosortDiagLog(tag: string, extra?: Record<string, unknown>): void {
  if (!DEBUG_AUTOSORT_DIAGNOSTICS) return
  const payload = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ''
  const run = _runId ? ` runId=${_runId}` : ''
  console.log(`[AUTOSORT-DIAG] ${tag}${run}${payload}`)
}
