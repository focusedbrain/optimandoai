/**
 * Host-side handler for inbound sealed_service_rpc_v1 poll RESULT capsules (A5).
 *
 * Open (A1) → match request_id to pending → recordHostIngestionPollAck → resolve async UI.
 * INV-ENCRYPT: plaintext ingestion_poll_* on relay is rejected in sealedServiceRpcRelayDispatch.
 */

import { BrowserWindow } from 'electron'
import { getHandshakeRecord } from '../../handshake/db'
import type { HandshakeRecord } from '../../handshake/types'
import { getInstanceId, isSandboxMode } from '../../orchestrator/orchestratorModeStore'
import { openServiceRpcPayloadResolvingLocalKey } from '../../serviceRpc/sealedServiceRpc'
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
import {
  HOST_AI_INFERENCE_ERROR_INNER_TYPE,
  HOST_AI_INFERENCE_REQUEST_INNER_TYPE,
  HOST_AI_INFERENCE_RESULT_INNER_TYPE,
} from '../../internalInference/hostAiSealedInferenceRelayWire'

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

  /**
   * Ingestion poll RESULT/ERROR capsules are host-only: the host registers pending
   * (`registerHostIngestionPollPending`) before send and correlates on `request_id` here.
   * Sandbox must never claim them — an empty pending map used to ack+drop Host AI inference
   * results that fell through with `request_id=<handshake_id>` and block
   * `tryHandleHostAiSealedInferenceResultRelayCapsule`.
   */
  if (isSandboxMode()) {
    return false
  }

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

  const opened = await openServiceRpcPayloadResolvingLocalKey(record, envelope)
  if (!opened.ok) {
    console.warn(
      `[IngestionPollTrigger] result-open-on-host failed. request_handshake=${envelope.handshake_id} code=${opened.code}`,
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
  // Host AI sealed inference inner types — decline (no ack) so dispatch reaches the inference handlers.
  if (
    innerType === HOST_AI_INFERENCE_REQUEST_INNER_TYPE ||
    innerType === HOST_AI_INFERENCE_RESULT_INNER_TYPE ||
    innerType === HOST_AI_INFERENCE_ERROR_INNER_TYPE
  ) {
    console.log(
      `[IngestionPollTrigger] result-handler declining host-ai inner type=${innerType} — yielding to inference handler`,
    )
    return false
  }
  // This handler ONLY claims ingestion-poll RESULT/ERROR wires. Every other sealed inner type the
  // host (or sandbox) may legitimately receive on this shared dispatch — notably
  // `host_ai_inference_request_v1` (sandbox→host inference) and the inference result/error types —
  // must DECLINE here (return false, NO ack) so the dispatch falls through to its owning handler
  // later in the chain. The owning handler emits its own ack. Using the broad host-receive permit
  // set as the claim predicate caused inference requests to be swallowed here as "invalid poll wire".
  if (innerType !== 'ingestion_poll_result' && innerType !== 'ingestion_poll_error') {
    console.log(
      `[IngestionPollTrigger] result-handler declining non-poll inner type=${innerType || '(empty)'} — yielding to next handler`,
    )
    return false
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
