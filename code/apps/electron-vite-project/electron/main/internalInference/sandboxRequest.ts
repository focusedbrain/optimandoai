/**
 * Sandbox → Host inference skeleton (pong / echo test). Routes over the **sealed relay**
 * transport — no plaintext LAN path. Trust/role gates unchanged (INV-HOSTAI-FROZEN).
 */

import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeRecord } from '../handshake/db'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { InternalInferenceErrorCode } from './errors'
import {
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
} from './policy'

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
  const role = assertSandboxRequestToHost(ar.record)
  if (!role.ok) {
    return { ok: false, code: role.code, message: 'role' }
  }

  const { sendSealedHostAiInferenceRequest } = await import('./hostAiSealedInferenceRelaySend')
  const send = await sendSealedHostAiInferenceRequest({
    handshakeId: hid,
    messages: [{ role: 'user', content: 'ping' }],
    timeoutMs: 120_000,
  })
  if (!send.ok) {
    return { ok: false, code: send.code, message: send.message }
  }
  try {
    const pr = await send.promise
    if (pr.kind === 'error') {
      return { ok: false, code: pr.code, message: pr.message }
    }
    return { ok: true, request_id: send.request_id, output: pr.output }
  } catch (e: any) {
    const code = (e && e.code) || InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE
    return { ok: false, code, message: e?.message ?? String(e) }
  }
}
