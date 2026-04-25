/**
 * [INFERENCE_TARGET_REFRESH] — Host AI model list + merged selector composition (orchestrator / WR Chat).
 * No PII, no model prompt text.
 */

export type InferenceTargetRefreshReason =
  | 'startup'
  | 'selector_open'
  | 'handshake_active'
  | 'mode_change'
  | 'account_change'
  | 'capabilities_result'
  | 'p2p_change'

export function logInferenceTargetRefreshReason(reason: InferenceTargetRefreshReason): void {
  console.log(`[INFERENCE_TARGET_REFRESH] reason=${reason}`)
}

export function logInferenceTargetRefreshResult(local: number, host: number, final: number): void {
  console.log(`[INFERENCE_TARGET_REFRESH] result local=${local} host=${host} final=${final}`)
}

/** Merged getAvailableModels rows: count local, host_internal, and total. */
export function countMergedModelList(
  models: Array<{ type?: string }> | null | undefined,
): { local: number; host: number; final: number } {
  const a = Array.isArray(models) ? models : []
  return {
    local: a.filter((m) => m && m.type === 'local').length,
    host: a.filter((m) => m && m.type === 'host_internal').length,
    final: a.length,
  }
}

export function countWrChatMerged(installed: unknown[], hostRows: unknown[]): {
  local: number
  host: number
  final: number
} {
  const l = Array.isArray(installed) ? installed.length : 0
  const h = Array.isArray(hostRows) ? hostRows.length : 0
  return { local: l, host: h, final: l + h }
}
