/**
 * Sandbox-side: seal and send Host AI inference request via coordination relay.
 *
 * Mirrors relaySend.ts pattern (proven for ingestion poll).
 * INV-ENCRYPT: prompt sealed before POST; relay sees routing + ciphertext only.
 */

import { randomUUID } from 'crypto'
import { getHandshakeRecord } from '../handshake/db'
import type { HandshakeRecord } from '../handshake/types'
import {
  sealServiceRpcPayload,
} from '../serviceRpc/sealedServiceRpc'
import {
  buildSealedServiceRpcRelayCapsule,
  sendSealedServiceRpcViaCoordinationRelay,
} from '../email/ingestionPollTrigger/relaySend'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import {
  assertRecordForServiceRpc,
  deriveInternalHostAiPeerRoles,
} from './policy'
import { InternalInferenceErrorCode } from './errors'
import {
  registerInternalInferenceRequest,
  type PendingResult,
} from './pendingRequests'
import { assertSandboxMaySealServiceRpcInnerType } from '../sandbox/sandboxOutboundPolicy'
import {
  HOST_AI_INFERENCE_REQUEST_INNER_TYPE,
  HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
  assertInferencePayloadWithinCapsuleLimit,
  type HostAiInferenceRequestRelayWire,
} from './hostAiSealedInferenceRelayWire'

const L = '[HOST_AI_SEALED_INFERENCE_SEND]'

export type SealedInferenceSendResult =
  | { ok: true; request_id: string; promise: Promise<PendingResult> }
  | { ok: false; code: string; message: string }

export async function sendSealedHostAiInferenceRequest(params: {
  handshakeId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  options?: { temperature?: number; max_tokens?: number }
  timeoutMs: number
}): Promise<SealedInferenceSendResult> {
  const hid = String(params.handshakeId ?? '').trim()
  if (!hid) {
    return { ok: false, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'handshakeId required' }
  }

  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'no db' }
  }

  const record = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    return { ok: false, code: ar.code, message: 'policy' }
  }

  const localDeviceId = getInstanceId().trim()
  const roles = deriveInternalHostAiPeerRoles(ar.record, localDeviceId)
  if (!roles.ok || roles.localRole !== 'sandbox') {
    return { ok: false, code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE, message: 'not sandbox role' }
  }

  const hostDeviceId = roles.peerCoordinationDeviceId
  if (!hostDeviceId) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'no host device id' }
  }

  const sealPermit = assertSandboxMaySealServiceRpcInnerType(HOST_AI_INFERENCE_REQUEST_INNER_TYPE)
  if (!sealPermit.ok) {
    return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN, message: 'egress gate denied' }
  }

  const requestId = randomUUID()
  const now = Date.now()
  const expiresAt = new Date(now + params.timeoutMs).toISOString()

  const innerWire: HostAiInferenceRequestRelayWire = {
    type: HOST_AI_INFERENCE_REQUEST_INNER_TYPE,
    schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: hid,
    sender_device_id: localDeviceId,
    receiver_device_id: hostDeviceId,
    model: params.model?.trim() || undefined,
    messages: params.messages,
    options: params.options,
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt,
  }

  const plaintextJson = JSON.stringify(innerWire)
  if (!assertInferencePayloadWithinCapsuleLimit(plaintextJson)) {
    return { ok: false, code: 'PAYLOAD_SIZE_EXCEEDED', message: 'request exceeds sealed capsule limit' }
  }

  const sealed = sealServiceRpcPayload(ar.record, {
    handshake_id: hid,
    sender_device_id: localDeviceId,
    receiver_device_id: hostDeviceId,
    plaintextJson: innerWire as unknown as Record<string, unknown>,
  })
  if (!sealed.ok) {
    return { ok: false, code: sealed.code, message: sealed.message }
  }

  console.log(
    `[PHASE3_SEALED_BOUNDARY] sandbox_seal_ok handshake=${hid} host_device=${hostDeviceId} request_id=${requestId}`,
  )

  const promise = registerInternalInferenceRequest(requestId, params.timeoutMs)

  const sent = await sendSealedServiceRpcViaCoordinationRelay(db, ar.record, sealed.envelope, {})
  if (!sent.ok) {
    console.log(
      `[PHASE3_SEALED_BOUNDARY] sandbox_relay_post_failed handshake=${hid} request_id=${requestId} code=${sent.code}`,
    )
    return { ok: false, code: sent.code, message: sent.message }
  }

  console.log(
    `[PHASE3_SEALED_BOUNDARY] sandbox_relay_post_ok handshake=${hid} request_id=${requestId} (sealed path — no WebRTC session ensure)`,
  )

  console.log(`${L} sent request_id=${requestId} handshake=${hid} model=${params.model?.trim() || 'default'}`)
  return { ok: true, request_id: requestId, promise }
}
