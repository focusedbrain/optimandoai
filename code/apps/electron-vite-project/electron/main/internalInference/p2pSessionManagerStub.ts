/**
 * Phased P2P: future WebRTC DataChannel session manager will live here (or a sibling module).
 * Current behavior: one-time no-op registration when `WRDESK_P2P_INFERENCE_ENABLED=1` for wiring checks.
 * Does not open sockets or allocate WebRTC — prevents accidental production impact.
 */

import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { tryApplyRelayPayloadToWebrtcPod } from './webrtc/webrtcTransportIpc'
import { handleSignal, preflightP2pRelaySignal } from './p2pSession/p2pInferenceSessionManager'

let registered = false

export function maybeInitP2pSessionManagerStub(context: { phase: 'app_init' }): void {
  if (registered) return
  registered = true
  if (!getP2pInferenceFlags().p2pInferenceEnabled) {
    return
  }
  console.log(
    '[P2P_SESSION]',
    JSON.stringify({
      event: 'manager_stub',
      context: context.phase,
      datachannel: 'not_wired',
      webrtc: 'deferred',
      note: 'Enable DC in later phase; HTTP direct path remains active',
    }),
  )
}

/** Relay-originated WebRTC signaling; routes into `p2pInferenceSessionManager` (no WebRTC). */
export async function maybeHandleP2pInferenceRelaySignal(args: {
  relayMessageId: string
  raw: Record<string, unknown>
}): Promise<void> {
  const f = getP2pInferenceFlags()
  if (!f.p2pInferenceEnabled || !f.p2pInferenceSignalingEnabled) {
    return
  }
  void args.relayMessageId
  const ok = await preflightP2pRelaySignal(args.raw)
  if (!ok) {
    return
  }
  handleSignal(args.raw)
  tryApplyRelayPayloadToWebrtcPod(args.raw)
}