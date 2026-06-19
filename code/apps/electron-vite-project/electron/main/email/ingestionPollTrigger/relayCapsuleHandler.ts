/**
 * Sandbox-side handler for inbound sealed_service_rpc_v1 relay capsules (A4).
 *
 * Open (A1) → validate inner type → idempotent poll run → seal result (A1) → relay send.
 * INV-ENCRYPT: both directions sealed; relay never sees plaintext counts/ids.
 * INV-RELAY-BLIND: routing + ciphertext only on the wire.
 */

import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'
import { getHandshakeRecord } from '../../handshake/db'
import type { HandshakeRecord, SSOSession } from '../../handshake/types'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { assertSandboxMayReceiveSealedServiceRpcInnerType, assertSandboxMaySealServiceRpcInnerType } from '../../sandbox/sandboxOutboundPolicy'
import {
  openServiceRpcPayload,
  sealServiceRpcPayload,
  type SealedServiceRpcEnvelope,
} from '../../serviceRpc/sealedServiceRpc'
import {
  DEFAULT_POLL_IDEMPOTENCY_TTL_MS,
  getPollOutcomeFromIdempotencyCache,
  storePollOutcomeInIdempotencyCache,
} from './pollIdempotencyCache'
import { handleIngestionPollRequest, type IngestionPollReceiverDeps } from './receiver'
import {
  buildSealedServiceRpcRelayCapsule,
  sendSealedServiceRpcViaCoordinationRelay,
  type SealedRelayCapsuleSender,
  type SealedRelaySendResult,
} from './relaySend'
import {
  INGESTION_POLL_SCHEMA_VERSION,
  isValidIngestionPollBaseEnvelope,
  type IngestionPollErrorWire,
  type IngestionPollRequestWire,
  type IngestionPollResultWire,
} from './wire'

export function isSealedServiceRpcRelayCapsule(capsule: Record<string, unknown>): boolean {
  const ct = typeof capsule.capsule_type === 'string' ? capsule.capsule_type.trim() : ''
  return ct === SEALED_SERVICE_RPC_CAPSULE_TYPE
}

export function parseSealedServiceRpcEnvelopeFromRelayCapsule(
  capsule: Record<string, unknown>,
): SealedServiceRpcEnvelope | null {
  if (!isSealedServiceRpcRelayCapsule(capsule)) return null
  const envelope: SealedServiceRpcEnvelope = {
    envelope_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
    schema_version: 1,
    handshake_id: typeof capsule.handshake_id === 'string' ? capsule.handshake_id.trim() : '',
    sender_device_id: typeof capsule.sender_device_id === 'string' ? capsule.sender_device_id.trim() : '',
    receiver_device_id: typeof capsule.receiver_device_id === 'string' ? capsule.receiver_device_id.trim() : '',
    sender_ephemeral_x25519_pub_b64:
      typeof capsule.sender_ephemeral_x25519_pub_b64 === 'string' ? capsule.sender_ephemeral_x25519_pub_b64.trim() : '',
    salt_b64: typeof capsule.salt_b64 === 'string' ? capsule.salt_b64.trim() : '',
    nonce_b64: typeof capsule.nonce_b64 === 'string' ? capsule.nonce_b64.trim() : '',
    ciphertext_b64: typeof capsule.ciphertext_b64 === 'string' ? capsule.ciphertext_b64.trim() : '',
  }
  if (
    !envelope.handshake_id ||
    !envelope.sender_device_id ||
    !envelope.receiver_device_id ||
    !envelope.sender_ephemeral_x25519_pub_b64 ||
    !envelope.salt_b64 ||
    !envelope.nonce_b64 ||
    !envelope.ciphertext_b64
  ) {
    return null
  }
  return envelope
}

export type IngestionPollRelayCapsuleContext = {
  relayMessageId: string
  capsule: Record<string, unknown>
  db: unknown
  ssoSession: SSOSession
  sendAck: (ids: string[]) => void
  getOidcToken: () => Promise<string | null>
}

export type IngestionPollRelayHandlerDeps = {
  getRecord?: (db: unknown, handshakeId: string) => HandshakeRecord | null | undefined
  receiverDeps?: Partial<IngestionPollReceiverDeps>
  sendSealedRelay?: (
    db: unknown,
    record: HandshakeRecord,
    envelope: SealedServiceRpcEnvelope,
    deps?: { sendCapsule?: SealedRelayCapsuleSender; getOidcToken?: () => Promise<string | null> },
  ) => Promise<SealedRelaySendResult>
  idempotencyTtlMs?: number
}

let handlerDepsOverride: IngestionPollRelayHandlerDeps | null = null

export function _setIngestionPollRelayHandlerDepsForTests(deps: IngestionPollRelayHandlerDeps | null): void {
  handlerDepsOverride = deps
}

function buildProtocolErrorWire(
  envelope: SealedServiceRpcEnvelope,
  localDeviceId: string,
  requestId: string,
  code: string,
  message: string,
): IngestionPollErrorWire {
  return {
    type: 'ingestion_poll_error',
    schema_version: INGESTION_POLL_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: envelope.handshake_id,
    sender_device_id: localDeviceId,
    target_device_id: envelope.sender_device_id,
    created_at: new Date().toISOString(),
    code,
    message,
  }
}

async function sealAndSendPollOutcome(
  db: unknown,
  record: HandshakeRecord,
  localDeviceId: string,
  hostDeviceId: string,
  outcome: IngestionPollResultWire | IngestionPollErrorWire,
  ctx: IngestionPollRelayCapsuleContext,
  deps: IngestionPollRelayHandlerDeps,
): Promise<void> {
  const sealPermit = assertSandboxMaySealServiceRpcInnerType(outcome.type)
  if (!sealPermit.ok) {
    console.warn(
      `[IngestionPollTrigger] sealed relay response blocked by egress inner-type gate. request_id=${outcome.request_id} inner=${sealPermit.innerType}`,
    )
    return
  }

  const sealed = sealServiceRpcPayload(record, {
    handshake_id: record.handshake_id,
    sender_device_id: localDeviceId,
    receiver_device_id: hostDeviceId,
    plaintextJson: outcome,
  })
  if (!sealed.ok) {
    console.warn(
      `[IngestionPollTrigger] sealed relay response seal failed. request_id=${outcome.request_id} code=${sealed.code}`,
    )
    return
  }

  const capsule = buildSealedServiceRpcRelayCapsule(sealed.envelope)
  if ('type' in capsule && capsule.type !== undefined) {
    console.warn('[IngestionPollTrigger] invariant: sealed relay capsule must not expose inner type on wire')
  }

  const sendSealedRelay = deps.sendSealedRelay ?? sendSealedServiceRpcViaCoordinationRelay
  const sent = await sendSealedRelay(db, record, sealed.envelope, {
    getOidcToken: ctx.getOidcToken,
  })

  if (!sent.ok) {
    console.warn(
      `[IngestionPollTrigger] sealed relay response send failed. request_id=${outcome.request_id} code=${sent.code}`,
    )
    return
  }

  console.log(
    `[IngestionPollTrigger] sealed relay response sent. request_id=${outcome.request_id} inner=${outcome.type} handshake=${record.handshake_id}`,
  )
}

async function executePollWithIdempotency(
  req: IngestionPollRequestWire,
  localDeviceId: string,
  deps: IngestionPollReceiverDeps,
  ttlMs: number,
): Promise<IngestionPollResultWire | IngestionPollErrorWire> {
  const cached = getPollOutcomeFromIdempotencyCache(req.request_id)
  if (cached) {
    console.log(
      `[IngestionPollTrigger] idempotent replay — cached outcome, no provider re-fetch. request_id=${req.request_id}`,
    )
    return cached
  }

  const outcome = await handleIngestionPollRequest(req, localDeviceId, deps)
  storePollOutcomeInIdempotencyCache(req.request_id, outcome, ttlMs)
  return outcome
}

/**
 * Handle one inbound sealed_service_rpc_v1 capsule on the sandbox.
 * Always ACKs the relay message when this function runs (sealed path consumed).
 */
export async function handleIngestionPollRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
  deps: IngestionPollRelayHandlerDeps = handlerDepsOverride ?? {},
): Promise<void> {
  const envelope = parseSealedServiceRpcEnvelopeFromRelayCapsule(ctx.capsule)
  if (!envelope) {
    console.warn('[IngestionPollTrigger] sealed relay capsule missing required envelope fields')
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  const localDeviceId = getInstanceId().trim()
  if (envelope.receiver_device_id !== localDeviceId) {
    console.warn(
      `[IngestionPollTrigger] sealed relay capsule wrong receiver. expected=${localDeviceId} got=${envelope.receiver_device_id}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  const getRecord = deps.getRecord ?? ((db, hid) => getHandshakeRecord(db as never, hid))
  const record = getRecord(ctx.db, envelope.handshake_id)
  if (!record) {
    console.warn(`[IngestionPollTrigger] sealed relay — handshake not found. handshake=${envelope.handshake_id}`)
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  const opened = openServiceRpcPayload(record, envelope)
  if (!opened.ok) {
    console.warn(
      `[IngestionPollTrigger] sealed relay open failed — not running poll. handshake=${envelope.handshake_id} code=${opened.code}`,
    )
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  let inner: unknown
  try {
    inner = JSON.parse(opened.plaintextJson)
  } catch {
    const err = buildProtocolErrorWire(envelope, localDeviceId, envelope.handshake_id, 'E_INGESTION_POLL_PROTOCOL', 'inner JSON invalid')
    await sealAndSendPollOutcome(ctx.db, record, localDeviceId, envelope.sender_device_id, err, ctx, deps)
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  const innerType = inner && typeof inner === 'object' && !Array.isArray(inner) ? String((inner as Record<string, unknown>).type ?? '') : ''
  const receiveGate = assertSandboxMayReceiveSealedServiceRpcInnerType(innerType)
  if (!receiveGate.ok) {
    console.warn(
      `[IngestionPollTrigger] sealed relay forbidden inner type — not running poll. inner=${receiveGate.innerType}`,
    )
    const requestId =
      inner && typeof inner === 'object' && typeof (inner as Record<string, unknown>).request_id === 'string'
        ? String((inner as Record<string, unknown>).request_id)
        : envelope.handshake_id
    const err = buildProtocolErrorWire(
      envelope,
      localDeviceId,
      requestId,
      receiveGate.code,
      receiveGate.message,
    )
    await sealAndSendPollOutcome(ctx.db, record, localDeviceId, envelope.sender_device_id, err, ctx, deps)
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  if (!isValidIngestionPollBaseEnvelope(inner) || inner.type !== 'ingestion_poll_request') {
    const err = buildProtocolErrorWire(
      envelope,
      localDeviceId,
      envelope.handshake_id,
      'E_INGESTION_POLL_PROTOCOL',
      'inner envelope is not a valid ingestion_poll_request',
    )
    await sealAndSendPollOutcome(ctx.db, record, localDeviceId, envelope.sender_device_id, err, ctx, deps)
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  const req = inner as IngestionPollRequestWire
  const receiverDeps: IngestionPollReceiverDeps = {
    db: ctx.db,
    getRecord: (hid) => getRecord(ctx.db, hid),
    ...deps.receiverDeps,
  }

  const ttlMs = deps.idempotencyTtlMs ?? DEFAULT_POLL_IDEMPOTENCY_TTL_MS
  const outcome = await executePollWithIdempotency(req, localDeviceId, receiverDeps, ttlMs)
  await sealAndSendPollOutcome(ctx.db, record, localDeviceId, envelope.sender_device_id, outcome, ctx, deps)
  ctx.sendAck([ctx.relayMessageId])
}

export async function tryHandleIngestionPollRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
  deps?: IngestionPollRelayHandlerDeps,
): Promise<boolean> {
  if (!isSealedServiceRpcRelayCapsule(ctx.capsule)) return false
  await handleIngestionPollRelayCapsule(ctx, deps ?? handlerDepsOverride ?? {})
  return true
}
