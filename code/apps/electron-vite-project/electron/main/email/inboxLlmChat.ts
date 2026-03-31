/**
 * Unified inbox LLM calls — same provider stack as handshake / hybrid search (aiProviders + ocrRouter keys).
 */

import { getProvider, type AIProvider, type UserRagSettings } from '../handshake/aiProviders'
import { ocrRouter } from '../ocr/router'
import type { VisionProvider } from '../ocr/types'

export const INBOX_LLM_TIMEOUT_MS = 45_000

const LLM_TIMEOUT_PREFIX = 'LLM_TIMEOUT'

// ─── Session-scoped provider cache ───
// Resolves config + constructs provider + resolves model once (Ollama: listModels),
// then reuses for subsequent inbox LLM calls until TTL or clear.
// Cleared at Auto-Sort session boundaries (see ipc `clearInboxLlmResolutionCache`).

let _providerCache: {
  instance: AIProvider
  settings: UserRagSettings
  modelName: string | null
  cachedAt: number
} | null = null

const PROVIDER_CACHE_TTL_MS = 60_000

export function clearInboxLlmResolutionCache(): void {
  _providerCache = null
}

/** Alias for docs / callers that refer to “LLM cache” (same as `clearInboxLlmResolutionCache`). */
export const clearInboxLlmCache = clearInboxLlmResolutionCache

export class InboxLlmTimeoutError extends Error {
  constructor(message = `${LLM_TIMEOUT_PREFIX}: inbox LLM exceeded ${INBOX_LLM_TIMEOUT_MS}ms`) {
    super(message)
    this.name = 'InboxLlmTimeoutError'
  }
}

const VISION_TO_RAG: Record<VisionProvider, UserRagSettings> = {
  OpenAI: { provider: 'openai' },
  Claude: { provider: 'anthropic' },
  Gemini: { provider: 'google' },
  Grok: { provider: 'xai' },
}

function firstCloudRagSettings(): UserRagSettings | null {
  const providers = ocrRouter.getAvailableProviders()
  const first = providers[0]
  return first ? VISION_TO_RAG[first] : null
}

/**
 * Resolve provider/model for inbox using Backend (OCR) cloud preference + API keys, with Ollama fallback.
 */
export function resolveInboxLlmSettings(): UserRagSettings {
  const cfg = ocrRouter.getCloudConfig()
  const pref = cfg?.preference ?? 'local'

  if (!cfg || pref === 'local') {
    return { provider: 'ollama' }
  }

  if (pref === 'cloud') {
    const cloud = firstCloudRagSettings()
    if (cloud) return cloud
    return { provider: 'ollama' }
  }

  // auto: prefer cloud when any key is configured
  const cloud = firstCloudRagSettings()
  if (cloud) return cloud
  return { provider: 'ollama' }
}

async function getCachedProvider(): Promise<{
  provider: AIProvider
  settings: UserRagSettings
  modelName: string | null
}> {
  const now = Date.now()
  if (_providerCache && now - _providerCache.cachedAt < PROVIDER_CACHE_TTL_MS) {
    return {
      provider: _providerCache.instance,
      settings: _providerCache.settings,
      modelName: _providerCache.modelName,
    }
  }

  const settings = resolveInboxLlmSettings()
  const getApiKey = (p: string) => ocrRouter.getApiKey(p as VisionProvider)
  const provider = getProvider(settings, getApiKey)

  let modelName: string | null = null
  if (settings.provider.toLowerCase() === 'ollama') {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const models = await ollamaManager.listModels()
    if (models.length === 0) {
      throw new Error('No LLM model installed. Install a local model or configure a cloud API key in Backend settings.')
    }
    modelName = models[0].name
  } else {
    modelName = settings.model ?? null
  }

  _providerCache = {
    instance: provider,
    settings,
    modelName,
    cachedAt: now,
  }

  return { provider, settings, modelName }
}

export async function isLlmAvailable(): Promise<boolean> {
  try {
    const { settings, modelName } = await getCachedProvider()
    if (settings.provider.toLowerCase() === 'ollama') {
      return modelName !== null
    }
    // Cloud: assume available if we built a provider (errors surface at call time)
    return true
  } catch {
    return false
  }
}

/** True when advisory stream should use Ollama NDJSON (otherwise use one-shot unified chat). */
export async function inboxSupportsOllamaStream(): Promise<boolean> {
  try {
    const { settings, modelName } = await getCachedProvider()
    return settings.provider.toLowerCase() === 'ollama' && modelName !== null
  } catch {
    return false
  }
}

export interface InboxLlmChatParams {
  system: string
  user: string
  timeoutMs?: number
}

/**
 * Non-stream chat for inbox classify / summarize / draft / analyze.
 */
export async function inboxLlmChat(params: InboxLlmChatParams): Promise<string> {
  const { system, user, timeoutMs = INBOX_LLM_TIMEOUT_MS } = params
  const { provider, modelName } = await getCachedProvider()

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const text = await provider.generateChat(messages, {
      ...(modelName ? { model: modelName } : {}),
      stream: false,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    const trimmed = typeof text === 'string' ? text.trim() : ''
    return trimmed || 'No response from model.'
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    const aborted =
      controller.signal.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(String(err.message))))
    if (aborted) {
      throw new InboxLlmTimeoutError()
    }
    throw err
  }
}
