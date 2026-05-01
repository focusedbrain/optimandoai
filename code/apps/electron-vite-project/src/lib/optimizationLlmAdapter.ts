/**
 * Thin LlmSendFn adapter over the same HTTP contract as WR Chat:
 * POST http://127.0.0.1:51248/api/llm/chat
 * Body: { modelId, messages, provider?, apiKey? }
 * Response: { ok, data?: { content: string } }
 *
 * Does not import extension processFlow — mirrors PopupChatView / dashboard fetch shape.
 */

import type { LlmSendFn } from '../types/optimizationTypes'

const DEFAULT_BASE_URL = 'http://127.0.0.1:51248'

function readCloudApiKeyFromLocalStorage(provider: string): string | null {
  try {
    const raw = localStorage.getItem('optimando-cloud-api-keys')
    if (!raw) return null
    const keys = JSON.parse(raw) as Record<string, string>
    const v = keys[provider]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

/** Same pattern as `wrChatDashboardChrome` / extension embed: PQ headers include X-Launch-Secret. */
export async function defaultDashboardLlmHeaders(): Promise<Record<string, string>> {
  try {
    const fn = window.handshakeView?.pqHeaders
    if (typeof fn !== 'function') {
      return { 'Content-Type': 'application/json' }
    }
    const h = await fn()
    const out: Record<string, string> = { 'Content-Type': 'application/json' }
    if (h && typeof h === 'object') {
      for (const [k, v] of Object.entries(h)) {
        if (typeof v === 'string') out[k] = v
      }
    }
    return out
  } catch {
    return { 'Content-Type': 'application/json' }
  }
}

export type OptimizationLlmAdapterOptions = {
  baseUrl?: string
  /** Defaults to {@link defaultDashboardLlmHeaders} when omitted. */
  getHeaders?: () => Promise<Record<string, string>>
  /** Used when `model` argument is empty. */
  defaultModelId?: string
  fetchImpl?: typeof fetch
}

/**
 * Returns an LlmSendFn that delegates to POST /api/llm/chat (same route as WR Chat).
 */
export function createOptimizationLlmSend(options?: OptimizationLlmAdapterOptions): LlmSendFn {
  const baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const fetchFn = options?.fetchImpl ?? fetch
  const getHeaders = options?.getHeaders ?? defaultDashboardLlmHeaders
  const defaultModelId = (options?.defaultModelId ?? 'llama3.2').trim()

  return async (messages, provider, model) => {
    const headers = await getHeaders()
    const modelId = (model && model.trim()) || defaultModelId || ''
    const body: Record<string, unknown> = {
      modelId,
      messages,
    }
    const p = provider?.trim()
    if (p) {
      body.provider = p
      const apiKey = readCloudApiKeyFromLocalStorage(p)
      if (apiKey) body.apiKey = apiKey
    }

    const res = await fetchFn(`${baseUrl}/api/llm/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const json = (await res.json().catch(() => null)) as {
      ok?: boolean
      data?: { content?: string }
      error?: string
    } | null

    if (!res.ok) {
      throw new Error(json?.error || `${res.status} ${res.statusText}`)
    }
    if (json?.ok === false) {
      throw new Error(json?.error || 'LLM request rejected')
    }
    const content = json?.data?.content
    return typeof content === 'string' ? content : ''
  }
}
