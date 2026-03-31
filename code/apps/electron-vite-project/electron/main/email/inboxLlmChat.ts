/**
 * Unified inbox LLM calls — same provider stack as handshake / hybrid search (aiProviders + ocrRouter keys).
 */

import { getProvider, type UserRagSettings } from '../handshake/aiProviders'
import { ocrRouter } from '../ocr/router'
import type { VisionProvider } from '../ocr/types'

export const INBOX_LLM_TIMEOUT_MS = 45_000

const LLM_TIMEOUT_PREFIX = 'LLM_TIMEOUT'

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
 * Exported for IPC paths that need a single `listModels` pass (e.g. advisory stream).
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

function visionForRagSettings(settings: UserRagSettings): VisionProvider | null {
  const p = settings.provider.toLowerCase()
  if (p === 'openai') return 'OpenAI'
  if (p === 'anthropic') return 'Claude'
  if (p === 'google') return 'Gemini'
  if (p === 'xai') return 'Grok'
  if (p === 'cloudai') {
    const cp = (settings.chatProvider ?? 'openai').toLowerCase()
    if (cp === 'openai') return 'OpenAI'
    if (cp === 'anthropic') return 'Claude'
    if (cp === 'google') return 'Gemini'
    if (cp === 'xai') return 'Grok'
  }
  return null
}

export async function isLlmAvailable(): Promise<boolean> {
  console.warn('⚡ isLlmAvailable CALLED', new Date().toISOString())
  const settings = resolveInboxLlmSettings()
  if (settings.provider.toLowerCase() === 'ollama') {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const models = await ollamaManager.listModels()
    return models.length > 0
  }
  const vp = visionForRagSettings(settings)
  if (!vp) return false
  const key = ocrRouter.getApiKey(vp)
  return typeof key === 'string' && key.trim().length > 0
}

/** True when advisory stream should use Ollama NDJSON (otherwise use one-shot unified chat). */
export async function inboxSupportsOllamaStream(): Promise<boolean> {
  const settings = resolveInboxLlmSettings()
  if (settings.provider.toLowerCase() !== 'ollama') return false
  const { ollamaManager } = await import('../llm/ollama-manager')
  const models = await ollamaManager.listModels()
  return models.length > 0
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
  console.warn('⚡ inboxLlmChat CALLED', new Date().toISOString(), {
    caller: new Error().stack?.split('\n')[2]?.trim(),
  })
  const { system, user, timeoutMs = INBOX_LLM_TIMEOUT_MS } = params
  const settings = resolveInboxLlmSettings()
  const getApiKey = (p: string) => ocrRouter.getApiKey(p as VisionProvider)
  const provider = getProvider(settings, getApiKey)

  let modelOverride: string | undefined
  if (provider.id === 'ollama') {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const models = await ollamaManager.listModels()
    if (models.length === 0) {
      throw new Error('No LLM model installed. Install a local model or configure a cloud API key in Backend settings.')
    }
    modelOverride = models[0].name
  } else {
    modelOverride = settings.model
  }

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]

  const chatWork = provider.generateChat(messages, {
    model: modelOverride,
    stream: false,
  })

  const timeoutWork = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new InboxLlmTimeoutError()), timeoutMs)
  })

  const text = await Promise.race([chatWork, timeoutWork])
  const trimmed = typeof text === 'string' ? text.trim() : ''
  return trimmed || 'No response from model.'
}
