/**
 * Sandbox → Host internal inference (non-streaming chat).
 */

import { randomUUID } from 'crypto'
import { getHandshakeRecord } from '../handshake/db'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { requestHostCompletion } from './transport/internalInferenceTransport'
import {
  decideInternalInferenceTransport,
  buildHostAiTransportDeciderInputAsync,
} from './transport/decideInternalInferenceTransport'
import { decideHostAiIntentRoute } from './transport/transportDecide'
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
  resolveInternalInferenceByRequestId,
} from './pendingRequests'
import { executeSandboxHostAiOllamaDirectChat } from './sandboxHostAiOllamaDirectChat'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceRequestWire } from './types'

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
  /** Pending timeout + `expires_at` on wire. Defaults to 120s. */
  timeoutMs?: number
  /** LAN Host Ollama — `POST /api/chat` only; skips BEAP and P2P. */
  execution_transport?: 'ollama_direct'
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
  const fP2p = getP2pInferenceFlags()
  const odDirect = params.execution_transport === 'ollama_direct'
  const peerHostId = peerCoordinationDeviceId(r) ?? ''
  if (!peerHostId) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE, message: 'peer device' }
  }

  /**
   * LAN `ollama_direct` — bypass `decideInternalInferenceTransport` / BEAP endpoint gates entirely.
   * Renderer sets `execution_transport: 'ollama_direct'` only for ODL selector rows after local readiness checks.
   */
  if (odDirect) {
    const mlog = (params.model ?? '').trim()
    console.log(
      `[HOST_AI_CHAT_ROUTE] handshake=${hid} model=${mlog} lane=ollama_direct ollamaDirectReady=true beapReady=false`,
    )

    const requestId = randomUUID()
    const requestTimeoutMs = clampTimeoutMs(params.timeoutMs)
    const promise = registerInternalInferenceRequest(requestId, requestTimeoutMs)
    console.log(
      `[SBX_HOST_CHAT_OLLAMA_DIRECT_INVOKING] ${JSON.stringify({
        handshake_id: hid,
        request_id: requestId,
        peer_host_device_id: peerHostId,
        model: mlog || null,
        timeout_ms: requestTimeoutMs,
        timestamp: new Date().toISOString(),
      })}`,
    )
    let out: Awaited<ReturnType<typeof executeSandboxHostAiOllamaDirectChat>>
    try {
      out = await executeSandboxHostAiOllamaDirectChat({
        handshakeId: hid,
        currentDeviceId: getInstanceId(),
        peerHostDeviceId: peerHostId,
        messages: params.messages,
        model: params.model?.trim(),
        timeoutMs: requestTimeoutMs,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
      })
    } catch (invokeErr) {
      console.log(
        `[SBX_HOST_CHAT_OLLAMA_DIRECT_BAIL] ${JSON.stringify({
          handshake_id: hid,
          request_id: requestId,
          reason: 'executeSandboxHostAiOllamaDirectChat_threw',
          error_name: (invokeErr as Error)?.name,
          error_message: (invokeErr as Error)?.message ?? String(invokeErr),
          timestamp: new Date().toISOString(),
        })}`,
      )
      throw invokeErr
    }
    if (!out.ok) {
      resolveInternalInferenceByRequestId(requestId, { kind: 'error', code: out.code, message: out.message })
    } else {
      resolveInternalInferenceByRequestId(requestId, {
        kind: 'result',
        output: out.output,
        model: out.model,
        duration_ms: out.duration_ms,
      })
    }
    try {
      const pr = await promise
      if (pr.kind === 'error') {
        return { ok: false, code: pr.code, message: pr.message }
      }
      return {
        ok: true,
        request_id: requestId,
        output: pr.output,
        model: pr.model ?? params.model ?? 'host',
        duration_ms: pr.duration_ms,
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string; code?: string }
      console.log(
        `[SBX_HOST_CHAT_OLLAMA_DIRECT_BAIL] ${JSON.stringify({
          handshake_id: hid,
          request_id: requestId,
          reason: 'pending_promise_await_rejected',
          error_name: err?.name,
          error_message: err?.message ?? String(e),
          code: err?.code ?? null,
          timestamp: new Date().toISOString(),
        })}`,
      )
      const code = (e && (e as { code?: string }).code) || InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE
      return { ok: false, code, message: err?.message ?? String(e) }
    }
  }

  const decChat = decideInternalInferenceTransport(
    await buildHostAiTransportDeciderInputAsync({
      operationContext: 'request',
      db,
      handshakeRecord: r,
      featureFlags: fP2p,
    }),
  )
  const endpointGateOk = decChat.p2pTransportEndpointOpen
  const ic = decideHostAiIntentRoute(hid, 'request', endpointGateOk)
  const transportLog = ic.choice.selected === 'unavailable' ? 'null' : String(ic.choice.selected)
  const canChatRoute = ic.choice.selected !== 'unavailable'
  const fcRoute = decChat.failureCode == null ? 'null' : String(decChat.failureCode)
  console.log(
    `[HOST_AI_CHAT_ROUTE] handshake=${hid} status=${decChat.selectorPhase} lane=beap canChat=${canChatRoute} transport=${transportLog} failureCode=${fcRoute}`,
  )

  if (!endpointGateOk) {
    console.log(
      `[HOST_AI_CHAT_BLOCKED] handshake=${hid} reason=p2p_endpoint_gate_failure failureCode=${fcRoute}`,
    )
    const d = assertP2pEndpointDirect(db, r.p2p_endpoint)
    const fallbackMsg =
      decChat.userSafeReason?.trim() ||
      'Host AI transport is not ready. Confirm pairing on both devices, advertise a Host BEAP endpoint where required, then use Refresh (↻) in the model list.'
    return {
      ok: false,
      code: d.ok ? decChat.failureCode ?? InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED : d.code,
      message: fallbackMsg,
    }
  }

  if (
    fP2p.p2pInferenceEnabled &&
    fP2p.p2pInferenceWebrtcEnabled &&
    fP2p.p2pInferenceSignalingEnabled &&
    fP2p.p2pInferenceRequestOverP2p
  ) {
    const { ensureHostAiP2pSession } = await import('./p2pSession/p2pInferenceSessionManager')
    const { waitForP2pDataChannelOrTimeout } = await import('./p2pSession/p2pSessionWait')
    await ensureHostAiP2pSession(hid, 'host_inference_chat')
    await waitForP2pDataChannelOrTimeout(hid, 10_000)
  }

  const now = Date.now()
  const requestId = randomUUID()
  const requestTimeoutMs = clampTimeoutMs(params.timeoutMs)
  const promise = registerInternalInferenceRequest(requestId, requestTimeoutMs)
  const options: { temperature?: number; max_tokens?: number } = {}
  if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
    options.temperature = params.temperature
  }
  if (typeof params.max_tokens === 'number' && Number.isFinite(params.max_tokens) && params.max_tokens > 0) {
    options.max_tokens = Math.floor(params.max_tokens)
  }

  const wire: InternalInferenceRequestWire = {
    type: 'internal_inference_request',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: r.handshake_id,
    sender_device_id: getInstanceId(),
    target_device_id: peerHostId,
    transport_policy: 'direct_only',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + requestTimeoutMs).toISOString(),
    stream: false,
    messages: params.messages,
    model: params.model?.trim() || undefined,
    options: Object.keys(options).length > 0 ? options : undefined,
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
    return {
      ok: true,
      request_id: requestId,
      output: pr.output,
      model: pr.model ?? wire.model ?? 'host',
      duration_ms: pr.duration_ms,
    }
  } catch (e: any) {
    const code = (e && e.code) || InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE
    return { ok: false, code, message: e?.message ?? String(e) }
  }
}
