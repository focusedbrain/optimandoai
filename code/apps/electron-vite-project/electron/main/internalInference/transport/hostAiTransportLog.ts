/**
 * Opt-in [HOST_AI_TRANSPORT] lines: handshake id + transport metadata only, never prompt/completion.
 * Enable with WRDESK_P2P_INFERENCE_VERBOSE_LOGS=1 (or legacy WRDESK_P2P_INFERENCE_ANALYSIS_LOG=1).
 */

import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import type { HostAiTransport, HostAiTransportLogReason, HostAiTransportPreference } from './hostAiTransportTypes'

export function shouldLogHostAiTransport(): boolean {
  const f = getP2pInferenceFlags()
  return f.p2pInferenceVerboseLogs || f.p2pInferenceAnalysisLog
}

export function logHostAiTransportChoose(args: {
  handshakeId: string
  preferred: HostAiTransportPreference
  selected: HostAiTransport
  reason: HostAiTransportLogReason
}): void {
  if (!shouldLogHostAiTransport()) return
  const { handshakeId, preferred, selected, reason } = args
  console.log(
    `[HOST_AI_TRANSPORT] choose handshake=${handshakeId} preferred=${preferred} selected=${selected} reason=${reason}`,
  )
}

export function logHostAiTransportFallback(args: {
  handshakeId: string
  from: HostAiTransport
  to: HostAiTransport
  reason: HostAiTransportLogReason
}): void {
  if (!shouldLogHostAiTransport()) return
  const { handshakeId, from, to, reason } = args
  console.log(
    `[HOST_AI_TRANSPORT] fallback handshake=${handshakeId} from=${from} to=${to} reason=${reason}`,
  )
}

export function logHostAiTransportUnavailable(args: { handshakeId: string; reason: HostAiTransportLogReason }): void {
  if (!shouldLogHostAiTransport()) return
  const { handshakeId, reason } = args
  console.log(`[HOST_AI_TRANSPORT] unavailable handshake=${handshakeId} reason=${reason}`)
}
