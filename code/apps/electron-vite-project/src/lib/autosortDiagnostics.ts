/**
 * Renderer autosort diagnostics — set `electron/main/autosortDiagnostics.ts` to the same value when enabling.
 */

export const DEBUG_AUTOSORT_DIAGNOSTICS = false

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
