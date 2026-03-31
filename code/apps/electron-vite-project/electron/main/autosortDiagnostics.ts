/**
 * Phase 0 autosort diagnostics — set DEBUG_AUTOSORT_DIAGNOSTICS true only while investigating
 * vault lock, IPC second phase, LLM timeouts, and concurrent analyze streams.
 *
 * Renderer logs use `src/lib/autosortDiagnostics.ts` — flip that flag too when enabling traces.
 *
 * **Bulk tuning (`DEBUG_AUTOSORT_TIMING`):** After a run, the main process logs **`[AUTOSORT-TIMING] run-tuning-main`**
 * when the renderer sets `bulkSortActive: false` — includes **`ollamaCapEffective`**, **`ollamaCapSource`**, **`maxInFlightSeenAcrossChunks`**, and a short **`parallelHint`**.
 * Per chunk, see **`aiClassifyBatch:ipc`** (`wallMs`, **`maxInFlightSeenDuringChunk`**) and **`aiClassifyBatch:perMessage`** (**`sumMs` overlaps parallel work**).
 */

export const DEBUG_AUTOSORT_DIAGNOSTICS = false

/** Main-process batch timing (`inbox:aiClassifyBatch`). Enable with renderer `DEBUG_AUTOSORT_TIMING` when comparing. */
export const DEBUG_AUTOSORT_TIMING = false

export function autosortTimingLog(tag: string, data?: Record<string, unknown>): void {
  if (!DEBUG_AUTOSORT_TIMING) return
  console.log(`[AUTOSORT-TIMING] ${tag}`, data ?? {})
}

/** Renderer → main sync so lockVaultIfLogged can print bulk-sort correlation. */
export interface AutosortDiagMainState {
  runId: string | null
  bulkSortActive: boolean
}

let mainState: AutosortDiagMainState = { runId: null, bulkSortActive: false }

export function setAutosortDiagMainState(patch: Partial<AutosortDiagMainState>): void {
  mainState = { ...mainState, ...patch }
}

export function getAutosortDiagMainState(): Readonly<AutosortDiagMainState> {
  return mainState
}

/** Last vault lock — updated from `lockVaultIfLoaded` (always, not gated on DEBUG). Used to classify inbox DB errors during bulk sort. */
export interface VaultLockRecord {
  at: number
  reason?: string
}

let lastVaultLock: VaultLockRecord | null = null

export function recordVaultLock(reason?: string): void {
  lastVaultLock = { at: Date.now(), reason }
}

export function getLastVaultLock(): VaultLockRecord | null {
  return lastVaultLock
}

/** True if the vault was locked within the last `windowMs` ms (correlates `resolveDb` null with session expiry). */
export function isRecentVaultLock(windowMs: number): boolean {
  return lastVaultLock != null && Date.now() - lastVaultLock.at < windowMs
}

export function autosortDiagLog(tag: string, extra?: Record<string, unknown>): void {
  if (!DEBUG_AUTOSORT_DIAGNOSTICS) return
  const ctx = mainState
  const payload = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ''
  const run = ctx.runId ? ` runId=${ctx.runId}` : ''
  const bulk = ctx.bulkSortActive ? ' bulk=1' : ''
  console.log(`[AUTOSORT-DIAG] ${tag}${run}${bulk}${payload}`)
}
