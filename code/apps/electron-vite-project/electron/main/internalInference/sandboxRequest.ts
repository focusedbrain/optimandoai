/**
 * Sandbox → Host direct P2P inference skeleton (pong / echo test, no Ollama).
 */

import { randomUUID } from 'crypto'
import { getHandshakeRecord } from '../handshake/db'
import { getInstanceId, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { postServiceEnvelopeDirect } from './directSend'
import { InternalInferenceErrorCode } from './errors'
import {
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  peerCoordinationDeviceId,
} from './policy'
import {
  registerInternalInferenceRequest,
  rejectInternalInferenceByRequestId,
} from './pendingRequests'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceRequestWire } from './types'

export type SandboxPongTestResult =
  | { ok: true; request_id: string; output: string }
  | { ok: false; code: string; message: string }

export async function runSandboxPongTestFromHostHandshake(handshakeId: string): Promise<SandboxPongTestResult> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'no db' }
  }
  const hid = typeof handshakeId === 'string' ? handshakeId.trim() : ''
  if (!hid) {
    return { ok: false, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'handshakeId' }
  }
  if (!isSandboxMode()) {
    return { ok: false, code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE, message: 'not sandbox' }
  }
  const record = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    if (ar.code === InternalInferenceErrorCode.POLICY_FORBIDDEN) {
      if (record && record.state !== 'ACTIVE') {
        return { ok: false, code: ar.code, message: 'not active' }
      }
      if (record?.handshake_type !== 'internal') {
        return { ok: false, code: ar.code, message: 'not internal' }
      }
    }
    if (ar.code === InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE) {
      return { ok: false, code: ar.code, message: 'no record' }
    }
    return { ok: false, code: ar.code, message: 'policy' }
  }
  const r = ar.record
  const role = assertSandboxRequestToHost(r)
  if (!role.ok) {
    return { ok: false, code: role.code, message: 'role' }
  }
  const direct = assertP2pEndpointDirect(db, r.p2p_endpoint)
  if (!direct.ok) {
    return {
      ok: false,
      code: direct.code,
      message: 'direct peer URL required',
    }
  }

  const requestId = randomUUID()
  const peerHostId = peerCoordinationDeviceId(r) ?? ''
  if (!peerHostId) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'peer device' }
  }

  const now = Date.now()
  const promise = registerInternalInferenceRequest(requestId)
  const wire: InternalInferenceRequestWire = {
    type: 'internal_inference_request',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: r.handshake_id,
    sender_device_id: getInstanceId(),
    target_device_id: peerHostId,
    transport_policy: 'direct_only',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 120_000).toISOString(),
    stream: false,
    messages: [{ role: 'user', content: 'ping' }],
  }
  const ep = r.p2p_endpoint?.trim() ?? ''
  const post = await postServiceEnvelopeDirect(
    wire,
    ep,
    r.handshake_id,
    r.counterparty_p2p_token,
    {
      request_id: requestId,
      sender_device_id: wire.sender_device_id,
      target_device_id: wire.target_device_id,
      message_type: 'internal_inference_request',
    },
  )
  if (!post.ok) {
    rejectInternalInferenceByRequestId(
      requestId,
      Object.assign(new Error(post.error), { code: post.code }),
    )
  }
  try {
    const pr = await promise
    if (pr.kind === 'error') {
      return { ok: false, code: pr.code, message: pr.message }
    }
    return { ok: true, request_id: requestId, output: pr.output }
  } catch (e: any) {
    const code = (e && e.code) || InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE
    return { ok: false, code, message: e?.message ?? String(e) }
  }
}
