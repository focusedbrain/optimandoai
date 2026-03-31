/**
 * Renderer autosort diagnostics — set `electron/main/autosortDiagnostics.ts` to the same value when enabling.
 *
 * For performance traces (`DEBUG_AUTOSORT_TIMING`), enable in **both** this file and
 * `electron/main/autosortDiagnostics.ts` so main (`inbox:aiClassifyBatch`) and renderer logs align.
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

/** Start counting IPC-style work for one toolbar Auto-Sort run (outer pass only). */
export function autosortTimingRunStart(): void {
  if (!DEBUG_AUTOSORT_TIMING) return
  _timingRunActive = true
  _timingCounters = emptyCounters()
}

export function autosortTimingRunActive(): boolean {
  return DEBUG_AUTOSORT_TIMING && _timingRunActive
}

export function autosortTimingBump<K extends keyof AutosortTimingCounters>(key: K, delta = 1): void {
  if (!DEBUG_AUTOSORT_TIMING || !_timingRunActive) return
  _timingCounters[key] += delta
}

/** Log accumulated counters and end the run (outer `finally` only). */
export function autosortTimingRunEnd(extra?: Record<string, unknown>): void {
  if (!DEBUG_AUTOSORT_TIMING || !_timingRunActive) return
  _timingRunActive = false
  const payload = Object.keys(_timingCounters).length ? { ..._timingCounters, ...extra } : extra
  console.log('[AUTOSORT-TIMING] run-summary', payload ?? {})
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
