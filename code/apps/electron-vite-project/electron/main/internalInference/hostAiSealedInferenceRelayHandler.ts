/**
 * Host-side handler for inbound sealed Host AI inference REQUEST capsules.
 *
 * Open (A1) → validate inner type → run Ollama (unchanged execution core) → seal result (A1) → relay send.
 * INV-ENCRYPT: prompt/completion only inside ciphertext; relay never sees plaintext.
 * INV-HOSTAI-FROZEN: trust/role/policy unchanged — only transport swapped.
 */

import { getHandshakeRecord } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import { getInstanceId, isHostMode } from '../orchestrator/orchestratorModeStore'
import {
  openServiceRpcPayloadResolvingLocalKey,
  sealServiceRpcPayload,
  type SealedServiceRpcEnvelope,
} from '../serviceRpc/sealedServiceRpc'
import {
  parseSealedServiceRpcEnvelopeFromRelayCapsule,
  type IngestionPollRelayCapsuleContext,
} from '../email/ingestionPollTrigger/relayCapsuleHandler'
import {
  sendSealedServiceRpcViaCoordinationRelay,
} from '../email/ingestionPollTrigger/relaySend'
import { assertRecordForServiceRpc, deriveInternalHostAiPeerRoles } from './policy'
import { runHostInternalInference, buildHostInferenceErrorWire } from './hostInferenceExecute'
import { InternalInferenceErrorCode } from './errors'
import {
  HOST_AI_INFERENCE_REQUEST_INNER_TYPE,
  HOST_AI_INFERENCE_RESULT_INNER_TYPE,
  HOST_AI_INFERENCE_ERROR_INNER_TYPE,
  HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
  parseHostAiInferenceRequestFromPlaintext,
  assertInferencePayloadWithinCapsuleLimit,
  isHostAiInferenceRequestRelayInnerType,
  type HostAiInferenceResultRelayWire,
  type HostAiInferenceErrorRelayWire,
} from './hostAiSealedInferenceRelayWire'

const L = '[HOST_AI_SEALED_INFERENCE_RELAY]'

function innerTypeFromPlaintext(plaintextJson: string): string | null {
  try {
    const o = JSON.parse(plaintextJson) as { type?: unknown }
    return typeof o.type === 'string' ? o.type.trim() : null
  } catch {
    return null
  }
}

/**
 * Handle one inbound sealed_service_rpc_v1 capsule containing host_ai_inference_request_v1.
 * Host-only. Returns true if consumed (including drops with ack).
 */
export async function tryHandleHostAiSealedInferenceRequestRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
): Promise<boolean> {
  if (!isHostMode()) return false

  const envelope = parseSealedServiceRpcEnvelopeFromRelayCapsule(ctx.capsule)
  if (!envelope) return false

  const localDeviceId = getInstanceId().trim()
  if (envelope.receiver_device_id !== localDeviceId) return false

  const record = getHandshakeRecord(ctx.db as any, envelope.handshake_id)
  if (!record) {
    console.warn(`${L} drop reason=no_handshake handshake=${envelope.handshake_id}`)
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const opened = await openServiceRpcPayloadResolvingLocalKey(record, envelope)
  if (!opened.ok) {
    console.warn(`${L} drop reason=open_failed code=${opened.code} handshake=${envelope.handshake_id}`)
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const innerType = innerTypeFromPlaintext(opened.plaintextJson)
  if (!innerType || !isHostAiInferenceRequestRelayInnerType(innerType)) {
    return false
  }

  ctx.sendAck([ctx.relayMessageId])

  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    console.warn(`${L} drop reason=policy code=${ar.code} handshake=${envelope.handshake_id}`)
    return true
  }

  const parsed = parseHostAiInferenceRequestFromPlaintext(opened.plaintextJson)
  if (!parsed.ok) {
    console.warn(`${L} drop reason=wire_invalid handshake=${envelope.handshake_id}`)
    return true
  }

  const req = parsed.wire
  const t0 = Date.now()

  if (req.expires_at) {
    const exp = Date.parse(req.expires_at)
    if (!Number.isNaN(exp) && t0 > exp) {
      console.log(`${L} drop reason=expired request_id=${req.request_id} handshake=${req.handshake_id}`)
      await sealAndSendInferenceOutcome(ctx.db, ar.record, localDeviceId, envelope.sender_device_id, {
        type: HOST_AI_INFERENCE_ERROR_INNER_TYPE,
        schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
        request_id: req.request_id,
        handshake_id: req.handshake_id,
        sender_device_id: localDeviceId,
        receiver_device_id: envelope.sender_device_id,
        code: InternalInferenceErrorCode.REQUEST_EXPIRED,
        message: 'expired',
        retryable: false,
        duration_ms: Date.now() - t0,
      }, ctx)
      return true
    }
  }

  const roles = deriveInternalHostAiPeerRoles(ar.record, localDeviceId)
  if (!roles.ok || roles.localRole !== 'host') {
    console.warn(`${L} drop reason=role_mismatch handshake=${req.handshake_id}`)
    return true
  }

  console.log(`${L} request_received request_id=${req.request_id} handshake=${req.handshake_id}`)

  const inferResult = await runHostInternalInference({
    handshakeId: req.handshake_id,
    requestId: req.request_id,
    modelRequested: req.model,
    messages: req.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: req.options as { temperature?: number; max_tokens?: number } | undefined,
    peerDeviceId: envelope.sender_device_id,
    hostDeviceId: localDeviceId,
  })

  const wire = inferResult.wire
  let outcome: HostAiInferenceResultRelayWire | HostAiInferenceErrorRelayWire

  if (wire.type === 'internal_inference_result') {
    const outputJson = JSON.stringify({
      type: HOST_AI_INFERENCE_RESULT_INNER_TYPE,
      schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
      request_id: req.request_id,
      handshake_id: req.handshake_id,
      sender_device_id: localDeviceId,
      receiver_device_id: envelope.sender_device_id,
      model: wire.model,
      output: wire.output,
      duration_ms: wire.duration_ms,
    })
    if (!assertInferencePayloadWithinCapsuleLimit(outputJson)) {
      outcome = {
        type: HOST_AI_INFERENCE_ERROR_INNER_TYPE,
        schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
        request_id: req.request_id,
        handshake_id: req.handshake_id,
        sender_device_id: localDeviceId,
        receiver_device_id: envelope.sender_device_id,
        code: 'PAYLOAD_SIZE_EXCEEDED',
        message: 'completion exceeds sealed capsule limit',
        retryable: false,
        duration_ms: wire.duration_ms,
      }
    } else {
      outcome = {
        type: HOST_AI_INFERENCE_RESULT_INNER_TYPE,
        schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
        request_id: req.request_id,
        handshake_id: req.handshake_id,
        sender_device_id: localDeviceId,
        receiver_device_id: envelope.sender_device_id,
        model: wire.model,
        output: wire.output,
        duration_ms: wire.duration_ms,
      }
    }
  } else {
    outcome = {
      type: HOST_AI_INFERENCE_ERROR_INNER_TYPE,
      schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
      request_id: req.request_id,
      handshake_id: req.handshake_id,
      sender_device_id: localDeviceId,
      receiver_device_id: envelope.sender_device_id,
      code: wire.code,
      message: wire.message,
      retryable: wire.retryable,
      duration_ms: wire.duration_ms,
    }
  }

  await sealAndSendInferenceOutcome(ctx.db, ar.record, localDeviceId, envelope.sender_device_id, outcome, ctx)
  console.log(`${L} response_sent request_id=${req.request_id} type=${outcome.type} handshake=${req.handshake_id}`)
  return true
}

async function sealAndSendInferenceOutcome(
  db: unknown,
  record: HandshakeRecord,
  localDeviceId: string,
  peerDeviceId: string,
  outcome: HostAiInferenceResultRelayWire | HostAiInferenceErrorRelayWire,
  ctx: IngestionPollRelayCapsuleContext,
): Promise<void> {
  const sealed = sealServiceRpcPayload(record, {
    handshake_id: record.handshake_id,
    sender_device_id: localDeviceId,
    receiver_device_id: peerDeviceId,
    plaintextJson: outcome as unknown as Record<string, unknown>,
  })
  if (!sealed.ok) {
    console.warn(`${L} seal_failed code=${sealed.code} request_id=${outcome.request_id}`)
    return
  }

  const sent = await sendSealedServiceRpcViaCoordinationRelay(db, record, sealed.envelope, {
    getOidcToken: ctx.getOidcToken,
  })
  if (!sent.ok) {
    console.warn(`${L} relay_send_failed code=${sent.code} request_id=${outcome.request_id}`)
  }
}
