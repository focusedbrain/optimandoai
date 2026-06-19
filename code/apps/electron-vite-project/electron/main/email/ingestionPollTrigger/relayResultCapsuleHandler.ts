/**
 * Host-side handler for inbound sealed_service_rpc_v1 poll RESULT capsules (A5).
 *
 * Open (A1) → match request_id to pending → recordHostIngestionPollAck → resolve async UI.
 * INV-ENCRYPT: plaintext ingestion_poll_* on relay is rejected in sealedServiceRpcRelayDispatch.
 */

import { BrowserWindow } from 'electron'
import { getHandshakeRecord } from '../../handshake/db'
import type { HandshakeRecord } from '../../handshake/types'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { openServiceRpcPayload } from '../../serviceRpc/sealedServiceRpc'
import {
  recordHostIngestionPollAck,
  type HostIngestionPollAck,
} from './hostAckStore'
import { resolveHostIngestionPollCompletion } from './hostIngestionPollCompletion'
import { resolveHostIngestionPollPending } from './hostPendingStore'
import {
  isSealedServiceRpcRelayCapsule,
  parseSealedServiceRpcEnvelopeFromRelayCapsule,
  type IngestionPollRelayCapsuleContext,
} from './relayCapsuleHandler'
import {
  isValidIngestionPollBaseEnvelope,
  type IngestionPollErrorWire,
  type IngestionPollResultWire,
} from './wire'

/** Inner types the host may receive inside sealed_service_rpc_v1 (sandbox → host). */
export const HOST_PERMITTED_SEALED_SERVICE_RPC_INBOUND_INNER_TYPES = new Set([
  'ingestion_poll_result',
  'ingestion_poll_error',
])

export function assertHostMayReceiveSealedServiceRpcInnerType(
  innerType: string,
): { ok: true } | { ok: false; innerType: string; message: string } {
  const t = typeof innerType === 'string' ? innerType.trim() : ''
  if (!t) {
    return { ok: false, innerType: t || '(empty)', message: 'sealed service-RPC inner type required' }
  }
  if (HOST_PERMITTED_SEALED_SERVICE_RPC_INBOUND_INNER_TYPES.has(t)) {
    return { ok: true }
  }
  return {
    ok: false,
    innerType: t,
    message: 'host rejects sealed inner type — only sandbox poll results/errors are accepted',
  }
}

export function mapIngestionPollWireToHostAck(
  accountId: string,
  wire: IngestionPollResultWire | IngestionPollErrorWire,
): HostIngestionPollAck {
  if (wire.type === 'ingestion_poll_result') {
    return {
      accountId,
      requestId: wire.request_id,
      pollStatus: wire.poll_status,
      fetched: wire.fetched,
      depackaged: wire.depackaged,
      delivered: wire.delivered,
      held: wire.held,
      at: Date.now(),
    }
  }
  const pollStatus =
    wire.code === 'E_INGESTION_POLL_EXPIRED' || wire.code === 'E_INGESTION_POLL_LINK_DOWN'
      ? 'trigger_unreachable'
      : wire.code === 'E_INGESTION_POLL_FORBIDDEN' || wire.code === 'E_INGESTION_POLL_AUTH'
        ? 'held_fetch_failed'
        : wire.code
  return {
    accountId,
    requestId: wire.request_id,
    pollStatus,
    fetched: 0,
    depackaged: 0,
    delivered: 0,
    held: 0,
    at: Date.now(),
  }
}

export type IngestionPollResultRelayHandlerDeps = {
  getRecord?: (db: unknown, handshakeId: string) => HandshakeRecord | null | undefined
  onAckRecorded?: (ack: HostIngestionPollAck) => void
}

let handlerDepsOverride: IngestionPollResultRelayHandlerDeps | null = null

export function _setIngestionPollResultRelayHandlerDepsForTests(
  deps: IngestionPollResultRelayHandlerDeps | null,
): void {
  handlerDepsOverride = deps
}

function notifyHostIngestionPollAsyncComplete(ack: HostIngestionPollAck): void {
  const payload = {
    accountId: ack.accountId,
    requestId: ack.requestId,
    pollStatus: ack.pollStatus,
    fetched: ack.fetched,
    delivered: ack.delivered,
    held: ack.held,
    at: ack.at,
  }
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      if (!w.isDestroyed() && w.webContents) {
        w.webContents.send('email:hostIngestionPollComplete', payload)
      }
    } catch {
      /* ignore */
    }
  })
}

/**
 * Handle sealed poll result/error on the host. Returns true when this capsule was consumed
 * (including idempotent ignore of unmatched duplicates). Returns false when not addressed
 * to this device (sandbox request handler may run next).
 */
export async function tryHandleIngestionPollResultRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
  deps: IngestionPollResultRelayHandlerDeps = handlerDepsOverride ?? {},
): Promise<boolean> {
  if (!isSealedServiceRpcRelayCapsule(ctx.capsule)) return false

  const envelope = parseSealedServiceRpcEnvelopeFromRelayCapsule(ctx.capsule)
  if (!envelope) {
    console.warn('[IngestionPollTrigger] host sealed result — invalid envelope shape')
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const localDeviceId = getInstanceId().trim()
  if (envelope.receiver_device_id !== localDeviceId) {
    return false
  }

  const getRecord = deps.getRecord ?? ((db, hid) => getHandshakeRecord(db as never, hid))
  const record = getRecord(ctx.db, envelope.handshake_id)
  if (!record) {
    console.warn(
      `[IngestionPollTrigger] host sealed result — handshake not found. handshake=${envelope.handshake_id}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const opened = openServiceRpcPayload(record, envelope)
  if (!opened.ok) {
    console.warn(
      `[IngestionPollTrigger] host sealed result open failed. request_handshake=${envelope.handshake_id} code=${opened.code}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  let inner: unknown
  try {
    inner = JSON.parse(opened.plaintextJson)
  } catch {
    console.warn('[IngestionPollTrigger] host sealed result — inner JSON invalid')
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const innerType =
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? String((inner as Record<string, unknown>).type ?? '')
      : ''
  const receiveGate = assertHostMayReceiveSealedServiceRpcInnerType(innerType)
  if (!receiveGate.ok) {
    console.warn(
      `[IngestionPollTrigger] host sealed result rejected inner type=${receiveGate.innerType}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  if (!isValidIngestionPollBaseEnvelope(inner)) {
    console.warn('[IngestionPollTrigger] host sealed result — invalid poll wire envelope')
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const wire = inner as IngestionPollResultWire | IngestionPollErrorWire
  const pending = resolveHostIngestionPollPending(wire.request_id)
  if (!pending) {
    console.log(
      `[IngestionPollTrigger] host sealed result ignored (no pending / duplicate). request_id=${wire.request_id}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const ack = mapIngestionPollWireToHostAck(pending.accountId, wire)
  recordHostIngestionPollAck(ack)
  resolveHostIngestionPollCompletion(ack)
  deps.onAckRecorded?.(ack)
  notifyHostIngestionPollAsyncComplete(ack)

  console.log(
    `[IngestionPollTrigger] host sealed result ack. request_id=${ack.requestId} account=${ack.accountId} ` +
      `status=${ack.pollStatus} fetched=${ack.fetched} delivered=${ack.delivered} held=${ack.held}`,
  )

  ctx.sendAck([ctx.relayMessageId])
  return true
}
