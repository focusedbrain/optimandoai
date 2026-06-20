/**
 * Sandbox → Host internal inference (sealed relay transport — whole-response capsules).
 * INV-ENCRYPT: prompt/completion only inside sealed_service_rpc_v1 ciphertext.
 * INV-HOSTAI-FROZEN: trust/role/policy unchanged — only transport swapped.
 */

import { getHandshakeRecord } from '../handshake/db'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { InternalInferenceErrorCode } from './errors'
import {
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  peerCoordinationDeviceId,
} from './policy'

export interface SandboxHostChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type SandboxHostChatResult =
  | { ok: true; request_id: string; output: string; model: string; duration_ms?: number }
  | { ok: false; code: string; message: string }

const DEFAULT_INTERNAL_INFERENCE_TIMEOUT_MS = 120_000

function clampTimeoutMs(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    return DEFAULT_INTERNAL_INFERENCE_TIMEOUT_MS
  }
  return Math.min(Math.max(Math.floor(v), 5_000), 600_000)
}

export async function runSandboxHostInferenceChat(params: {
  handshakeId: string
  messages: SandboxHostChatMessage[]
  model?: string
  temperature?: number
  max_tokens?: number
  responseFormat?: 'json'
  /** Pending timeout + `expires_at` on wire. Defaults to 120s. */
  timeoutMs?: number
}): Promise<SandboxHostChatResult> {
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'no db' }
  }
  const hid = String(params.handshakeId ?? '').trim()
  if (!hid) {
    return { ok: false, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'handshakeId' }
  }
  if (!Array.isArray(params.messages) || params.messages.length < 1) {
    return { ok: false, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'messages' }
  }
  for (const m of params.messages) {
    if (!m || (m.role !== 'system' && m.role !== 'user' && m.role !== 'assistant')) {
      return { ok: false, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'message role' }
    }
    if (typeof m.content !== 'string') {
      return { ok: false, code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE, message: 'message content' }
    }
  }

  const record = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    console.log(
      `[HOST_AI_CHAT_BLOCKED] handshake=${hid} reason=ledger_assert_${ar.code} failureCode=${ar.code}`,
    )
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
    console.log(`[HOST_AI_CHAT_BLOCKED] handshake=${hid} reason=sandbox_host_role_gate failureCode=${role.code}`)
    return { ok: false, code: role.code, message: 'Sandbox must be paired to a Host device for Host AI chat.' }
  }
  const peerHostId = peerCoordinationDeviceId(r) ?? ''
  if (!peerHostId) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'peer device' }
  }

  const mlog = (params.model ?? '').trim()
  const requestTimeoutMs = clampTimeoutMs(params.timeoutMs)
  const options: { temperature?: number; max_tokens?: number } = {}
  if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
    options.temperature = params.temperature
  }
  if (typeof params.max_tokens === 'number' && Number.isFinite(params.max_tokens) && params.max_tokens > 0) {
    options.max_tokens = Math.floor(params.max_tokens)
  }

  console.log(
    `[AI_REQUEST_BEGIN] ${JSON.stringify({
      origin: 'sandbox_host_chat',
      selectedModelId: mlog || null,
      selectionSource: null,
      hostActiveModelId: null,
      resolvedModelId: mlog || null,
      executionTransport: 'sealed_relay',
      handshakeId: hid,
      routeKind: 'sealed_relay',
    })}`,
  )

  const { sendSealedHostAiInferenceRequest } = await import('./hostAiSealedInferenceRelaySend')
  const sendResult = await sendSealedHostAiInferenceRequest({
    handshakeId: hid,
    messages: params.messages,
    model: params.model?.trim(),
    options: Object.keys(options).length > 0 ? options : undefined,
    timeoutMs: requestTimeoutMs,
  })

  if (!sendResult.ok) {
    console.log(
      `[AI_REQUEST_ERROR] ${JSON.stringify({
        origin: 'sandbox_host_chat',
        modelId: mlog || null,
        errorCode: sendResult.code,
        errorMessage: sendResult.message,
      })}`,
    )
    return { ok: false, code: sendResult.code, message: sendResult.message }
  }

  try {
    const pr = await sendResult.promise
    if (pr.kind === 'error') {
      console.log(
        `[AI_REQUEST_ERROR] ${JSON.stringify({
          origin: 'sandbox_host_chat',
          modelId: mlog || null,
          errorCode: pr.code,
          errorMessage: pr.message,
        })}`,
      )
      return { ok: false, code: pr.code, message: pr.message }
    }
    console.log(
      `[AI_RENDERER_RESPONSE_RECEIVED] ${JSON.stringify({
        origin: 'sandbox_host_chat',
        modelId: pr.model ?? params.model ?? null,
        outputLength: String(pr.output ?? '').length,
      })}`,
    )
    return {
      ok: true,
      request_id: sendResult.request_id,
      output: pr.output,
      model: pr.model ?? params.model ?? 'host',
      duration_ms: pr.duration_ms,
    }
  } catch (e: any) {
    const code = (e && e.code) || InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED
    return { ok: false, code, message: e?.message ?? String(e) }
  }
}

