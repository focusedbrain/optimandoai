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
  | 'manual_refresh'
  | 'visibility_resume'

/** @deprecated Use {@link logInferenceTargetRefresh} for the one-line spec format. */
export function logInferenceTargetRefreshReason(reason: InferenceTargetRefreshReason): void {
  console.log(`[INFERENCE_TARGET_REFRESH] reason=${reason}`)
}

/** @deprecated Use {@link logInferenceTargetRefresh} for the one-line spec format. */
export function logInferenceTargetRefreshResult(local: number, host: number, final: number): void {
  console.log(`[INFERENCE_TARGET_REFRESH] result local=${local} host=${host} final=${final}`)
}

/** Single-line diagnostic: `reason=… local=… host=… final=…` */
export function logInferenceTargetRefresh(
  reason: InferenceTargetRefreshReason,
  local: number,
  host: number,
  final: number,
): void {
  console.log(`[INFERENCE_TARGET_REFRESH] reason=${reason} local=${local} host=${host} final=${final}`)
}

/** Prefer `capabilities_result` when the Host capabilities probe ran; otherwise log the trigger reason (if any). */
export function logInferenceTargetRefreshFromLoad(
  reason: InferenceTargetRefreshReason | undefined,
  hadCapabilitiesProbed: boolean,
  local: number,
  host: number,
  final: number,
): void {
  if (hadCapabilitiesProbed) {
    logInferenceTargetRefresh('capabilities_result', local, host, final)
    return
  }
  if (reason) {
    logInferenceTargetRefresh(reason, local, host, final)
  }
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

export function countWrChatMerged(
  installed: unknown[],
  hostRows: unknown[],
  cloudRows: unknown[] = [],
): {
  local: number
  host: number
  cloud: number
  final: number
} {
  const l = Array.isArray(installed) ? installed.length : 0
  const h = Array.isArray(hostRows) ? hostRows.length : 0
  const c = Array.isArray(cloudRows) ? cloudRows.length : 0
  return { local: l, host: h, cloud: c, final: l + h + c }
}
