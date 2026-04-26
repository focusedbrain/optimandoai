/**
 * Sandbox → Host direct P2P inference skeleton (pong / echo test, no Ollama).
 */

import { randomUUID } from 'crypto'
import { getHandshakeRecord } from '../handshake/db'
import { getInstanceId, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { requestHostCompletion } from './transport/internalInferenceTransport'
import { decideInternalInferenceTransport, buildHostAiTransportDeciderInput } from './transport/decideInternalInferenceTransport'
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
  const fP2p = getP2pInferenceFlags()
  const endpointGateOk = decideInternalInferenceTransport(
    buildHostAiTransportDeciderInput({
      operationContext: 'request',
      db,
      handshakeRecord: r,
      featureFlags: fP2p,
    }),
  ).p2pTransportEndpointOpen
  if (!endpointGateOk) {
    const d = assertP2pEndpointDirect(db, r.p2p_endpoint)
    return {
      ok: false,
      code: d.ok ? InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED : d.code,
      message: 'no valid P2P transport endpoint',
    }
  }

  const requestId = randomUUID()
  const peerHostId = peerCoordinationDeviceId(r) ?? ''
  if (!peerHostId) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'peer device' }
  }

  if (
    fP2p.p2pInferenceEnabled &&
    fP2p.p2pInferenceWebrtcEnabled &&
    fP2p.p2pInferenceSignalingEnabled &&
    fP2p.p2pInferenceRequestOverP2p
  ) {
    const { ensureHostAiP2pSession } = await import('./p2pSession/p2pInferenceSessionManager')
    const { waitForP2pDataChannelOrTimeout } = await import('./p2pSession/p2pSessionWait')
    await ensureHostAiP2pSession(hid, 'pong_test')
    await waitForP2pDataChannelOrTimeout(hid, 10_000)
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
  const post = await requestHostCompletion(r.handshake_id, wire, { record: r })
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
