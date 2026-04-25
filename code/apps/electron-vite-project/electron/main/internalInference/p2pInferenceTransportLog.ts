/**
 * Opt-in analysis logs for phased P2P migration: transport choice only, never prompt/completion.
 * Enable with `WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1` or legacy `WRDESK_P2P_INFERENCE_ANALYSIS_LOG=1`.
 */

import { getP2pInferenceFlags } from './p2pInferenceFlags'

export type P2pInferenceTransportKind = 'http_direct' | 'http_capabilities_get' | 'stub_dc'

/**
 * One-line structured log for debugging transport without bodies.
 */
export function logP2pInferenceTransport(args: {
  transport: P2pInferenceTransportKind
  handshake_id: string
  message_type: string
  request_id?: string
  extra?: Record<string, string | number | boolean | null>
}): void {
  const flags = getP2pInferenceFlags()
  if (!flags.p2pInferenceVerboseLogs && !flags.p2pInferenceAnalysisLog) return
  const { handshake_id, message_type, request_id, transport, extra } = args
  console.log(
    '[P2P_INFER]',
    JSON.stringify({
      event: 'transport',
      transport,
      handshake_id,
      message_type,
      ...(request_id ? { request_id } : {}),
      http_fallback_allowed: flags.p2pInferenceHttpFallback,
      ...extra,
    }),
  )
}
