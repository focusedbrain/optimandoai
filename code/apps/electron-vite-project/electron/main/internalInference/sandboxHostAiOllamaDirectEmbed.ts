/**
 * Sandbox → Host Ollama over LAN (`ollama_direct`): `POST {base}/api/embed` only.
 * Mirrors {@link executeSandboxHostAiOllamaDirectChat} for embeddings.
 */

import { InternalInferenceErrorCode } from './errors'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import { classifyOllamaDirectFetchTransportFailure } from './sandboxOllamaDirectTransport'
import { refreshSandboxOllamaDirectFromHostCapabilities } from './sandboxOllamaDirectCapsRefresh'

export type SbxHostAiOllamaDirectEmbedLogPayload = {
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

export function logSbxHostAiOllamaDirectEmbed(p: SbxHostAiOllamaDirectEmbedLogPayload): void {
  console.log(`[SBX_HOST_AI_OLLAMA_DIRECT_EMBED] ${JSON.stringify(p)}`)
}

function parseEmbeddingJson(text: string): number[] | null {
  let parsed: { embedding?: number[]; embeddings?: Array<{ embedding?: number[] }> } | null = null
  try {
    parsed = text ? (JSON.parse(text) as typeof parsed) : null
  } catch {
    return null
  }
  const raw = parsed?.embedding ?? parsed?.embeddings?.[0]?.embedding ?? parsed?.embeddings?.[0]
  return Array.isArray(raw) ? raw : null
}

export async function executeSandboxHostAiOllamaDirectEmbed(
  p: {
    handshakeId: string
    currentDeviceId: string
    peerHostDeviceId: string
    model: string
    input: string
    timeoutMs: number
    _ollamaDirectRetryConsumed?: boolean
  },
): Promise<{ ok: true; embedding: number[] } | { ok: false; code: string; message: string }> {
  const hid = String(p.handshakeId ?? '').trim()
  const peer = String(p.peerHostDeviceId ?? '').trim()
  const cur = String(p.currentDeviceId ?? '').trim()
  const modelReq = typeof p.model === 'string' ? p.model.trim() : ''
  const t0 = Date.now()

  const cand = getSandboxOllamaDirectRouteCandidate(hid)
  const baseRaw = cand?.base_url?.trim() ?? ''
  const failLog = (ok: boolean, http_status: number | null, error_code: string | null): void => {
    logSbxHostAiOllamaDirectEmbed({
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
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'missing peer or sandbox device id',
    }
  }

  if (!cand || !baseRaw || cand.peer_host_device_id !== peer || cand.endpoint_owner_device_id !== peer) {
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'no validated ollama_direct endpoint for handshake',
    }
  }

  if (!modelReq) {
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'model required',
    }
  }

  const base = baseRaw.replace(/\/$/, '')
  let embedUrl: string
  try {
    const u = new URL(base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
      return {
        ok: false,
        code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
        message: 'invalid base URL protocol',
      }
    }
    embedUrl = `${base}/api/embed`
  } catch {
    failLog(false, null, InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT)
    return {
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
      message: 'invalid base URL',
    }
  }

  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), Math.max(5_000, Math.min(p.timeoutMs, 600_000)))
    const res = await fetch(embedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: modelReq,
        input: p.input || ' ',
      }),
      signal: ac.signal,
    })
    clearTimeout(timer)
    const text = await res.text()
    const emb = parseEmbeddingJson(text)

    if (!res.ok || !emb) {
      failLog(false, res.status, InternalInferenceErrorCode.OLLAMA_DIRECT_CHAT_UNREACHABLE)
      return {
        ok: false,
        code: InternalInferenceErrorCode.OLLAMA_DIRECT_CHAT_UNREACHABLE,
        message: `HTTP ${res.status}`,
      }
    }

    failLog(true, res.status, null)
    return { ok: true, embedding: emb }
  } catch (e) {
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
          path: 'ollama_direct_embed',
        })}`,
      )
      return executeSandboxHostAiOllamaDirectEmbed({ ...p, _ollamaDirectRetryConsumed: true })
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
