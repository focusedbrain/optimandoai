/**
 * Sandbox → Host Ollama over LAN (`ollama_direct`): `POST {base}/api/chat` only.
 * Does not use BEAP, P2P, or sandbox-local Ollama.
 */

import { bareOllamaModelNameForApi } from '../../../src/lib/hostInferenceModelIds'
import { InternalInferenceErrorCode } from './errors'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import { classifyOllamaDirectFetchTransportFailure } from './sandboxOllamaDirectTransport'
import { refreshSandboxOllamaDirectFromHostCapabilities } from './sandboxOllamaDirectCapsRefresh'

export type SbxHostAiOllamaDirectChatLogPayload = {
  handshake_id: string
  current_device_id: string
  peer_host_device_id: string
  base_url: string
  model: string
  ok: boolean
  http_status: number | null
  error_code: string | null
  duration_ms: number
}

type OllamaChatResponseBody = { message?: { content?: string }; model?: string; error?: unknown }

export function logSbxHostAiOllamaDirectChat(p: SbxHostAiOllamaDirectChatLogPayload): void {
  console.log(`[SBX_HOST_AI_OLLAMA_DIRECT_CHAT] ${JSON.stringify(p)}`)
}

function looksLikeOllamaModelNotFound(httpStatus: number, bodyText: string, parsed: { error?: unknown } | null): boolean {
  if (httpStatus === 404) return true
  const errStr =
    typeof parsed?.error === 'string'
      ? parsed.error
      : parsed?.error != null && typeof parsed.error === 'object' && 'message' in (parsed.error as object)
        ? String((parsed.error as { message?: unknown }).message ?? '')
        : ''
  const combined = `${bodyText}\n${errStr}`.toLowerCase()
  return (
    /model[\s\S]{0,80}not\s+found/i.test(combined) ||
    /unknown model/i.test(combined) ||
    /file does not exist/i.test(combined)
  )
}

export async function executeSandboxHostAiOllamaDirectChat(
  p: {
    handshakeId: string
    currentDeviceId: string
    peerHostDeviceId: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    model: string | undefined
    timeoutMs: number
    temperature?: number
    max_tokens?: number
    responseFormat?: 'json'
    /** When true, transport-level failures do not trigger a caps refresh + single retry. */
    _ollamaDirectRetryConsumed?: boolean
  },
): Promise<
  | { ok: true; output: string; model: string; duration_ms: number }
  | { ok: false; code: string; message: string }
> {
  const hid = String(p.handshakeId ?? '').trim()
  const peer = String(p.peerHostDeviceId ?? '').trim()
  const cur = String(p.currentDeviceId ?? '').trim()
  const originalModelId = typeof p.model === 'string' ? p.model.trim() : ''
  const modelReq = bareOllamaModelNameForApi(p.model)
  const t0 = Date.now()

  const cand = getSandboxOllamaDirectRouteCandidate(hid)
  console.log(
    `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_ENTRY] ${JSON.stringify({
      handshake_id: hid,
      base_url: typeof cand?.base_url === 'string' ? cand.base_url.trim() : null,
      original_model_id: originalModelId || null,
      bare_model_name: modelReq || null,
      has_messages: Array.isArray(p.messages) && p.messages.length > 0,
      peer_host_device_id: peer || null,
      endpoint_owner_device_id:
        typeof cand?.endpoint_owner_device_id === 'string' ? cand.endpoint_owner_device_id.trim() : null,
      cand_peer_host_device_id:
        typeof cand?.peer_host_device_id === 'string' ? cand.peer_host_device_id.trim() : null,
      timestamp: new Date().toISOString(),
    })}`,
  )
  const baseRaw = cand?.base_url?.trim() ?? ''
  const failLog = (
    ok: boolean,
    http_status: number | null,
    error_code: string | null,
  ): void => {
    logSbxHostAiOllamaDirectChat({
      handshake_id: hid,
      current_device_id: cur,
      peer_host_device_id: peer,
      base_url: baseRaw || '(missing)',
      model: modelReq || '(missing)',
      ok,
      http_status,
      error_code,
      duration_ms: Date.now() - t0,
    })
  }

  if (!peer || !cur) {
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_BAIL] ${JSON.stringify({
        handshake_id: hid,
        reason: 'missing_peer_or_sandbox_device_id',
        detail: { peer_present: !!peer, current_device_present: !!cur },
      })}`,
    )
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'missing peer or sandbox device id',
    }
  }

  if (
    !cand ||
    !baseRaw ||
    cand.peer_host_device_id !== peer ||
    cand.endpoint_owner_device_id !== peer
  ) {
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_BAIL] ${JSON.stringify({
        handshake_id: hid,
        reason: 'invalid_endpoint_or_peer_mismatch',
        detail: {
          has_candidate: !!cand,
          base_present: !!baseRaw,
          cand_peer_host_device_id: cand?.peer_host_device_id ?? null,
          cand_endpoint_owner_device_id: cand?.endpoint_owner_device_id ?? null,
          expected_peer_host_device_id: peer,
        },
      })}`,
    )
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'no validated ollama_direct endpoint for handshake',
    }
  }

  if (!modelReq) {
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_BAIL] ${JSON.stringify({
        handshake_id: hid,
        reason: 'model_required',
        detail: { model_param: typeof p.model === 'string' ? p.model : null },
      })}`,
    )
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'model required',
    }
  }

  const base = baseRaw.replace(/\/$/, '')
  let chatUrl: string
  try {
    const u = new URL(base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      console.log(
        `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_BAIL] ${JSON.stringify({
          handshake_id: hid,
          reason: 'base_url_protocol_not_http',
          detail: { protocol: u.protocol, base },
        })}`,
      )
      failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
      return {
        ok: false,
        code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
        message: 'invalid base URL protocol',
      }
    }
    chatUrl = `${base}/api/chat`
  } catch (urlErr) {
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_BAIL] ${JSON.stringify({
        handshake_id: hid,
        reason: 'base_url_parse_failed',
        detail: { base_raw: baseRaw, error_message: (urlErr as Error)?.message ?? String(urlErr) },
      })}`,
    )
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'invalid base URL',
    }
  }

  const body: Record<string, unknown> = {
    model: modelReq,
    messages: p.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  }
  const opts: Record<string, number> = {}
  if (typeof p.temperature === 'number' && Number.isFinite(p.temperature)) opts.temperature = p.temperature
  if (p.responseFormat === 'json' && opts.temperature == null) opts.temperature = 0
  if (typeof p.max_tokens === 'number' && Number.isFinite(p.max_tokens) && p.max_tokens > 0) {
    opts.num_predict = Math.floor(p.max_tokens)
  }
  if (p.responseFormat === 'json') body.format = 'json'
  if (Object.keys(opts).length > 0) body.options = opts

  try {
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_FETCH_BEGIN] ${JSON.stringify({
        url: chatUrl,
        method: 'POST',
        timestamp: new Date().toISOString(),
      })}`,
    )
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), Math.max(5_000, Math.min(p.timeoutMs, 600_000)))
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    clearTimeout(timer)
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_FETCH_RESPONSE] ${JSON.stringify({
        url: chatUrl,
        http_status: res.status,
        ok: res.ok,
        timestamp: new Date().toISOString(),
      })}`,
    )
    const text = await res.text()
    let parsed: OllamaChatResponseBody | null = null
    try {
      parsed = text ? (JSON.parse(text) as OllamaChatResponseBody) : null
    } catch {
      parsed = null
    }

    if (!res.ok) {
      const nf = looksLikeOllamaModelNotFound(res.status, text, parsed)
      const code = nf
        ? InternalInferenceErrorCode.OLLAMA_DIRECT_MODEL_NOT_FOUND
        : InternalInferenceErrorCode.OLLAMA_DIRECT_CHAT_UNREACHABLE
      failLog(false, res.status, code)
      return {
        ok: false,
        code,
        message: nf ? 'model not found on Host Ollama' : `HTTP ${res.status}`,
      }
    }

    if (parsed?.error != null && looksLikeOllamaModelNotFound(200, text, parsed)) {
      const code = InternalInferenceErrorCode.OLLAMA_DIRECT_MODEL_NOT_FOUND
      failLog(false, res.status, code)
      return { ok: false, code, message: 'model not found on Host Ollama' }
    }

    const out = (parsed?.message?.content ?? '').trim() || 'No response from model.'
    const modelOut = typeof parsed?.model === 'string' && parsed.model.trim() ? parsed.model.trim() : modelReq
    failLog(true, res.status, null)
    return { ok: true, output: out, model: modelOut, duration_ms: Date.now() - t0 }
  } catch (e) {
    console.log(
      `[SBX_HOST_AI_OLLAMA_DIRECT_CHAT_FETCH_ERROR] ${JSON.stringify({
        url: typeof chatUrl !== 'undefined' ? chatUrl : null,
        error_name: (e as Error)?.name,
        error_message: (e as Error)?.message,
        timestamp: new Date().toISOString(),
      })}`,
    )
    const trig = classifyOllamaDirectFetchTransportFailure(e)
    if (trig && !p._ollamaDirectRetryConsumed) {
      const oldUrl = baseRaw
      const capOk = (await refreshSandboxOllamaDirectFromHostCapabilities({ handshakeId: hid })).ok
      const newCand = getSandboxOllamaDirectRouteCandidate(hid)
      const newUrl = newCand?.base_url?.trim() ?? ''
      console.log(
        `[SBX_HOST_AI_OLLAMA_DIRECT_ENDPOINT_REFRESH] ${JSON.stringify({
          handshake_id: hid,
          old_url: oldUrl || null,
          new_url: newUrl || null,
          trigger_reason: trig,
          caps_refresh_ok: capOk,
          path: 'ollama_direct_chat',
        })}`,
      )
      return executeSandboxHostAiOllamaDirectChat({ ...p, _ollamaDirectRetryConsumed: true })
    }
    const msg = (e as Error)?.message ?? String(e)
    const aborted = (e as Error)?.name === 'AbortError' || /abort/i.test(msg)
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_CHAT_UNREACHABLE)
    return {
      ok: false,
      code: aborted ? InternalInferenceErrorCode.REQUEST_TIMEOUT : InternalInferenceErrorCode.OLLAMA_DIRECT_CHAT_UNREACHABLE,
      message: aborted ? 'timeout' : msg || 'fetch failed',
    }
  }
}
