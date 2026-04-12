/**
 * Sandbox-side HTTP client for host inference API (replaces local Ollama when in sandbox mode).
 */

import { getAccessToken } from '../../../src/auth/session'
import { getOrchestratorMode, getSandboxHostUrl } from './orchestratorModeStore'

const CHAT_TIMEOUT_MS = 120_000
const HEALTH_TIMEOUT_MS = 5_000

function sanitizeMessagesForInference(
  messages: Array<{ role: string; content: any; [key: string]: any }>,
): Array<{ role: string; content: string }> {
  return messages.map((msg) => {
    // Only pass role and content — strip ALL other fields
    const content = typeof msg.content === 'string' ? msg.content : ''

    // Safety check: reject if content looks like base64 image data
    if (content.startsWith('data:image/') || content.startsWith('/9j/') || content.startsWith('iVBOR')) {
      throw new Error(
        'SECURITY: Image data detected in message content — blocked. OCR must extract text before inference.',
      )
    }

    // Enforce maximum content length (512KB of text ~ a very long document)
    if (content.length > 524_288) {
      throw new Error('Message content exceeds maximum length for sandbox inference')
    }

    return {
      role: msg.role === 'system' || msg.role === 'assistant' ? msg.role : 'user',
      content,
    }
  })
}

function chatUrl(hostUrl: string): string {
  return `${hostUrl.replace(/\/$/, '')}/api/inference/chat`
}

function inferenceStatusUrl(hostUrl: string): string {
  return `${hostUrl.replace(/\/$/, '')}/api/orchestrator/inference-status`
}

export async function sandboxChat(
  messages: Array<{ role: string; content: any; [key: string]: any }>,
  modelId?: string,
): Promise<{ ok: boolean; data?: { content: string; model: string }; error?: string }> {
  const hostUrl = getSandboxHostUrl()
  if (!hostUrl) {
    return { ok: false, error: 'No host configured' }
  }

  const accessToken = getAccessToken()
  if (!accessToken || !accessToken.trim()) {
    return { ok: false, error: 'Not authenticated — please log in' }
  }

  // Defense-in-depth: even though the host also rejects images,
  // the sandbox must strip/block image data before it reaches the network.
  // The security boundary is: only text leaves the sandbox, ever.
  let safeMessages: Array<{ role: string; content: string }>
  try {
    safeMessages = sanitizeMessagesForInference(messages)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  const body: { messages: typeof safeMessages; modelId?: string } = { messages: safeMessages }
  if (typeof modelId === 'string' && modelId.trim()) {
    body.modelId = modelId.trim()
  }

  const url = chatUrl(hostUrl)
  console.log('[sandboxInference] POST', url, '(chat)', { mode: getOrchestratorMode().mode })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    })

    console.log('[sandboxInference] chat response status:', res.status)

    if (res.status === 401) {
      return { ok: false, error: 'Authentication failed — token may be expired' }
    }
    if (res.status === 403) {
      return { ok: false, error: 'Host rejected request — check permissions' }
    }
    if (res.status === 429) {
      return { ok: false, error: 'Rate limited by host — try again shortly' }
    }
    if (res.status === 502) {
      return { ok: false, error: 'Host inference failed — Ollama may be down' }
    }

    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      return { ok: false, error: `Host returned non-JSON (${res.status})` }
    }

    if (res.ok && payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>
      if (p.ok === true && p.data && typeof p.data === 'object') {
        const d = p.data as Record<string, unknown>
        const content = typeof d.content === 'string' ? d.content : null
        const model = typeof d.model === 'string' ? d.model : null
        if (content != null && model != null) {
          return { ok: true, data: { content, model } }
        }
      }
    }

    const errMsg =
      payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
        ? String((payload as Record<string, unknown>).error)
        : `Request failed (${res.status})`
    return { ok: false, error: errMsg }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, error: 'Host inference timed out' }
    }
    console.warn('[sandboxInference] chat network error:', e instanceof Error ? e.message : String(e))
    return { ok: false, error: `Cannot reach host at ${hostUrl}` }
  }
}

export async function checkHostConnection(): Promise<{
  ok: boolean
  inference?: { available: boolean; model: string | null }
  error?: string
}> {
  const hostUrl = getSandboxHostUrl()
  if (!hostUrl) {
    return { ok: false, error: 'No host configured' }
  }

  const accessToken = getAccessToken()
  if (!accessToken || !accessToken.trim()) {
    return { ok: false, error: 'Not authenticated — please log in' }
  }

  const url = inferenceStatusUrl(hostUrl)
  console.log('[sandboxInference] GET', url, '(inference-status)', { mode: getOrchestratorMode().mode })

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })

    console.log('[sandboxInference] inference-status response status:', res.status)

    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, error: 'Authentication failed — token may be expired' }
      }
      return { ok: false, error: `Host returned ${res.status}` }
    }

    let data: unknown
    try {
      data = await res.json()
    } catch {
      return { ok: false, error: 'Invalid JSON from host' }
    }

    if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>
      const inf = o.inference
      if (inf != null && typeof inf === 'object') {
        const i = inf as Record<string, unknown>
        const available = i.available === true
        const model: string | null = typeof i.model === 'string' ? i.model : null
        return {
          ok: true,
          inference: { available, model },
        }
      }
    }

    return { ok: true }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out' }
    }
    console.warn('[sandboxInference] inference-status network error:', e instanceof Error ? e.message : String(e))
    return { ok: false, error: `Cannot reach host at ${hostUrl}` }
  }
}
