/**
 * Inbound sealed_service_rpc_v1 Host AI control-plane (Phase C, flag-gated).
 * Open → validate inner type → dispatch to existing p2p_signal consumer.
 */

import { getHandshakeRecord } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { openServiceRpcPayload } from '../serviceRpc/sealedServiceRpc'
import {
  parseSealedServiceRpcEnvelopeFromRelayCapsule,
  type IngestionPollRelayCapsuleContext,
} from '../email/ingestionPollTrigger/relayCapsuleHandler'
import {
  assertSandboxMayReceiveSealedServiceRpcInnerType,
  isEffectiveSandboxNode,
} from '../sandbox/sandboxOutboundPolicy'
import {
  HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE,
  parseHostAiP2pSignalUnifiedRelayWire,
  parseP2pSignalPayloadFromUnifiedRelayBody,
} from './hostAiUnifiedServiceRpcRelayWire'

export const HOST_PERMITTED_HOST_AI_UNIFIED_RELAY_INNER_TYPES: ReadonlySet<string> = new Set([
  HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE,
])

export function assertHostMayReceiveHostAiUnifiedRelayInnerType(
  innerType: string,
): { ok: true } | { ok: false; innerType: string; message: string } {
  const t = typeof innerType === 'string' ? innerType.trim() : ''
  if (!t) {
    return { ok: false, innerType: t || '(empty)', message: 'sealed service-RPC inner type required' }
  }
  if (HOST_PERMITTED_HOST_AI_UNIFIED_RELAY_INNER_TYPES.has(t)) {
    return { ok: true }
  }
  return {
    ok: false,
    innerType: t,
    message: 'host rejects sealed inner type for unified Host AI relay',
  }
}

function assertLocalMayReceiveHostAiUnifiedRelayInner(
  db: unknown,
  innerType: string,
): { ok: true } | { ok: false; message: string } {
  if (isEffectiveSandboxNode(db)) {
    const v = assertSandboxMayReceiveSealedServiceRpcInnerType(innerType)
    if (!v.ok) return { ok: false, message: v.message }
    return { ok: true }
  }
  const v = assertHostMayReceiveHostAiUnifiedRelayInnerType(innerType)
  if (!v.ok) return { ok: false, message: v.message }
  return { ok: true }
}

function parseInnerTypeFromPlaintext(plaintextJson: string): string | null {
  try {
    const o = JSON.parse(plaintextJson) as { type?: unknown }
    return typeof o.type === 'string' ? o.type.trim() : null
  } catch {
    return null
  }
}

export type HostAiUnifiedRelayHandlerDeps = {
  getRecord?: (db: unknown, handshakeId: string) => HandshakeRecord | null | undefined
  dispatchP2pSignal?: (
    msg: Record<string, unknown>,
    relayMessageId: string,
    getDb?: () => unknown,
  ) => boolean
}

let handlerDepsOverride: HostAiUnifiedRelayHandlerDeps | null = null

export function _setHostAiUnifiedRelayHandlerDepsForTests(deps: HostAiUnifiedRelayHandlerDeps | null): void {
  handlerDepsOverride = deps
}

/**
 * Handle inbound sealed Host AI control envelope. No-op when unified flag is OFF.
 * @returns true if consumed (including drops with ack)
 */
export async function tryHandleHostAiUnifiedServiceRpcRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
): Promise<boolean> {
  const { isUnifiedServiceRpcRelayEnabled } = await import('./unifiedServiceRpcRelayFlags')
  if (!isUnifiedServiceRpcRelayEnabled()) {
    return false
  }

  const envelope = parseSealedServiceRpcEnvelopeFromRelayCapsule(ctx.capsule)
  if (!envelope) return false

  const localId = getInstanceId().trim()
  if (envelope.receiver_device_id !== localId) {
    return false
  }

  const getRecord = handlerDepsOverride?.getRecord ?? getHandshakeRecord
  const record = getRecord(ctx.db, envelope.handshake_id)
  if (!record) {
    console.warn(
      `[HOST_AI_UNIFIED_RELAY_IN] drop reason=no_handshake handshake=${envelope.handshake_id} relay_message_id=${ctx.relayMessageId}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const opened = openServiceRpcPayload(record, envelope)
  if (!opened.ok) {
    console.warn(
      `[HOST_AI_UNIFIED_RELAY_IN] drop reason=open_failed code=${opened.code} handshake=${envelope.handshake_id} relay_message_id=${ctx.relayMessageId}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const innerType = parseInnerTypeFromPlaintext(opened.plaintextJson)
  if (!innerType) {
    console.warn(
      `[HOST_AI_UNIFIED_RELAY_IN] drop reason=inner_type_missing handshake=${envelope.handshake_id} relay_message_id=${ctx.relayMessageId}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const gate = assertLocalMayReceiveHostAiUnifiedRelayInner(ctx.db, innerType)
  if (!gate.ok) {
    console.warn(
      `[HOST_AI_UNIFIED_RELAY_IN] drop reason=inner_forbidden inner=${innerType} handshake=${envelope.handshake_id} relay_message_id=${ctx.relayMessageId}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  let innerParsed: unknown
  try {
    innerParsed = JSON.parse(opened.plaintextJson)
  } catch {
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const wire = parseHostAiP2pSignalUnifiedRelayWire(innerParsed)
  if (!wire.ok) {
    console.warn(
      `[HOST_AI_UNIFIED_RELAY_IN] drop reason=wire_invalid handshake=${envelope.handshake_id} relay_message_id=${ctx.relayMessageId}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const payloadParse = parseP2pSignalPayloadFromUnifiedRelayBody(wire.wire.p2p_signal_body)
  if (!payloadParse.ok) {
    console.warn(
      `[HOST_AI_UNIFIED_RELAY_IN] drop reason=p2p_body_invalid handshake=${envelope.handshake_id} relay_message_id=${ctx.relayMessageId}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const dispatch =
    handlerDepsOverride?.dispatchP2pSignal ??
    (await import('./relayP2pSignalHandler')).tryHandleCoordinationP2pSignal
  const msg = {
    type: 'p2p_signal',
    id: ctx.relayMessageId,
    payload: payloadParse.payload,
  }
  console.log(
    `[HOST_AI_UNIFIED_RELAY_IN] dispatch signal_type=${String(payloadParse.payload.signal_type ?? '?')} handshake=${wire.wire.handshake_id} relay_message_id=${ctx.relayMessageId}`,
  )
  dispatch(msg, ctx.relayMessageId, () => ctx.db)
  ctx.sendAck([ctx.relayMessageId])
  return true
}
