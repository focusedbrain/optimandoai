/**
 * Phased P2P: future WebRTC DataChannel session manager will live here (or a sibling module).
 * Current behavior: one-time no-op registration when `WRDESK_P2P_INFERENCE_ENABLED=1` for wiring checks.
 * Does not open sockets or allocate WebRTC — prevents accidental production impact.
 */

import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { tryApplyRelayPayloadToWebrtcPod } from './webrtc/webrtcTransportIpc'
import {
  getP2pInboundLocalRoleForLog,
  getSessionState,
  handleSignal,
  preflightP2pRelaySignal,
  tryAttachP2pSessionForInboundSignaling,
} from './p2pSession/p2pInferenceSessionManager'

let registered = false

/** Brief wait when session was just attached / answerer PC is still coming up. */
const SIGNAL_PREFLIGHT_RETRY_MS = 80
const SIGNAL_PREFLIGHT_RETRY_MAX = 6

function signalTypeForLog(st: unknown): string {
  if (st === 'p2p_inference_offer') return 'offer'
  if (st === 'p2p_inference_answer') return 'answer'
  if (st === 'p2p_inference_ice') return 'candidate'
  return String(st)
}

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
  const raw = args.raw
  const hid = typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : ''
  const sid = typeof raw.session_id === 'string' ? raw.session_id.trim() : ''
  const st = raw.signal_type
  const localRole = await getP2pInboundLocalRoleForLog(hid)
  const phase = getSessionState(hid)?.phase ?? 'none'
  console.log(
    `[P2P_SIGNAL_INBOUND] type=${signalTypeForLog(st)} handshake=${hid} session=${sid} local_role=${localRole} phase=${phase}`,
  )

  let attachResult = await tryAttachP2pSessionForInboundSignaling(raw)
  let anyAttached = attachResult === 'attached'
  let ok = await preflightP2pRelaySignal(raw)
  let waited = 0
  while (!ok && waited < SIGNAL_PREFLIGHT_RETRY_MAX) {
    await new Promise((r) => setTimeout(r, SIGNAL_PREFLIGHT_RETRY_MS))
    waited++
    const ar = await tryAttachP2pSessionForInboundSignaling(raw)
    if (ar === 'attached') {
      anyAttached = true
    }
    ok = await preflightP2pRelaySignal(raw)
  }

  if (!ok) {
    const reason =
      !hid || !sid ? 'missing_handshake_or_session' : 'preflight_rejected_or_stale'
    console.log(`[P2P_SIGNAL_ROUTE] action=rejected reason=${reason}`)
    return
  }

  let action: 'handled' | 'queued' | 'attached' = 'handled'
  let routeReason = 'ok'
  if (anyAttached) {
    action = 'attached'
    routeReason = 'inbound_attach'
  } else if (waited > 0) {
    action = 'queued'
    routeReason = 'preflight_retry'
  } else if (attachResult === 'answerer_ready') {
    action = 'handled'
    routeReason = 'answerer_transport_ready'
  }
  console.log(`[P2P_SIGNAL_ROUTE] action=${action} reason=${routeReason}`)

  handleSignal(raw)
  tryApplyRelayPayloadToWebrtcPod(raw)
}
