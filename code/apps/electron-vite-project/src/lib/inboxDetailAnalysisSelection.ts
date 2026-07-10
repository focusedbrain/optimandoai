/**
 * Selection-change analysis trigger helpers (InboxDetailAiPanel).
 * Pure functions for debounce / stale-result guards — unit-tested.
 */

export const INBOX_ANALYSIS_SELECTION_DEBOUNCE_MS = 400

/** Analysis runs on selection change only when the Analysis section toggle is active. */
export function shouldTriggerAnalysisOnSelectionChange(analysisModeActive: boolean): boolean {
  return analysisModeActive
}

/** Drop stream chunks/done/error when the user switched messages or a newer run superseded this one. */
export function shouldApplyAnalysisStreamResult(p: {
  runGeneration: number
  activeGeneration: number
  eventMessageId: string
  panelMessageId: string
}): boolean {
  return p.runGeneration === p.activeGeneration && p.eventMessageId === p.panelMessageId
}

/** After debounce settles, decide whether to invoke analysis (manual IPC when analysis mode is on). */
export function resolveSelectionAnalysisRun(p: {
  analysisModeActive: boolean
  debounceGeneration: number
  activeGeneration: number
  hasCachedResult: boolean
}): { shouldInvoke: boolean; manual: boolean; skipBecauseStale: boolean } {
  if (!p.analysisModeActive) {
    return { shouldInvoke: false, manual: false, skipBecauseStale: false }
  }
  if (p.debounceGeneration !== p.activeGeneration) {
    return { shouldInvoke: false, manual: false, skipBecauseStale: true }
  }
  return { shouldInvoke: true, manual: true, skipBecauseStale: false }
}
