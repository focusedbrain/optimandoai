/**
 * Outbound Host AI control-plane via sealed_service_rpc_v1 relay (Phase C, flag-gated).
 * Replaces POST /beap/p2p-signal only when WRDESK_UNIFIED_SERVICE_RPC_RELAY=1.
 */

import { getHandshakeRecord } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import {
  sealServiceRpcForRelay,
  sendSealedServiceRpcViaCoordinationRelay,
  type SealedRelayCapsuleSender,
  type SealedRelaySendResult,
} from '../email/ingestionPollTrigger/relaySend'
import { assertRecordForServiceRpc } from './policy'
import { isEffectiveSandboxNode, assertSandboxMaySealServiceRpcInnerType } from '../sandbox/sandboxOutboundPolicy'
import { isUnifiedServiceRpcRelayEnabled } from './unifiedServiceRpcRelayFlags'
import {
  HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE,
  buildHostAiP2pSignalUnifiedRelayWire,
} from './hostAiUnifiedServiceRpcRelayWire'

export type HostAiUnifiedRelaySendResult =
  | { readonly ok: true; readonly status: 200 | 202 }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string }

export type HostAiUnifiedRelaySendDeps = {
  getRecord?: (db: unknown, handshakeId: string) => HandshakeRecord | null | undefined
  sendSealedRelay?: (
    db: unknown,
    record: HandshakeRecord,
    envelope: import('../serviceRpc/sealedServiceRpc').SealedServiceRpcEnvelope,
    deps?: { sendCapsule?: SealedRelayCapsuleSender; getOidcToken?: () => Promise<string | null> },
  ) => Promise<SealedRelaySendResult>
}

let depsOverride: HostAiUnifiedRelaySendDeps | null = null

export function _setHostAiUnifiedRelaySendDepsForTests(deps: HostAiUnifiedRelaySendDeps | null): void {
  depsOverride = deps
}

export function isHostAiUnifiedServiceRpcRelayActive(): boolean {
  return isUnifiedServiceRpcRelayEnabled()
}

/**
 * Seal p2p_signal_body and POST sealed_service_rpc_v1 to coordination relay.
 * Returns null when unified relay flag is OFF (caller must use legacy /beap/p2p-signal).
 */
export async function trySendHostAiP2pSignalViaUnifiedRelay(params: {
  db: unknown
  handshakeId: string
  senderDeviceId: string
  receiverDeviceId: string
  p2pSignalBodyJson: string
}): Promise<HostAiUnifiedRelaySendResult | null> {
  if (!isUnifiedServiceRpcRelayEnabled()) {
    return null
  }

  const hid = params.handshakeId.trim()
  const sender = params.senderDeviceId.trim()
  const receiver = params.receiverDeviceId.trim()
  if (!hid || !sender || !receiver || !params.p2pSignalBodyJson.trim()) {
    return {
      ok: false,
      status: 0,
      code: 'E_HOST_AI_UNIFIED_RELAY_INVALID',
      message: 'handshake, device ids, and p2p_signal_body are required',
    }
  }

  const getRecord = depsOverride?.getRecord ?? getHandshakeRecord
  const r0 = getRecord(params.db, hid)
  const ar = assertRecordForServiceRpc(r0)
  if (!ar.ok) {
    return {
      ok: false,
      status: 0,
      code: ar.code,
      message: ar.message,
    }
  }

  const inner = buildHostAiP2pSignalUnifiedRelayWire({
    handshakeId: hid,
    senderDeviceId: sender,
    receiverDeviceId: receiver,
    p2pSignalBodyJson: params.p2pSignalBodyJson,
  })

  if (isEffectiveSandboxNode(params.db)) {
    const sandGate = assertSandboxMaySealServiceRpcInnerType(HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE)
    if (!sandGate.ok) {
      return {
        ok: false,
        status: 0,
        code: sandGate.code,
        message: sandGate.message,
      }
    }
  }

  const sealed = sealServiceRpcForRelay(ar.record, {
    handshake_id: hid,
    sender_device_id: sender,
    receiver_device_id: receiver,
    plaintextJson: inner,
  })
  if (!sealed.ok) {
    return {
      ok: false,
      status: 0,
      code: sealed.code,
      message: sealed.message,
    }
  }

  const sendSealedRelay = depsOverride?.sendSealedRelay ?? sendSealedServiceRpcViaCoordinationRelay
  const sent = await sendSealedRelay(params.db, ar.record, sealed.envelope)
  if (!sent.ok) {
    return {
      ok: false,
      status: 0,
      code: sent.code,
      message: sent.message,
    }
  }

  console.log(
    `[HOST_AI_UNIFIED_RELAY_OUT] sealed=${HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE} handshake=${hid} bytes=${Buffer.byteLength(params.p2pSignalBodyJson, 'utf8')}`,
  )
  return { ok: true, status: 200 }
}
