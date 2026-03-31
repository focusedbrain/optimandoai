/**
 * Unified inbox LLM calls — same provider stack as handshake / hybrid search (aiProviders + ocrRouter keys).
 */

import { getProvider, type UserRagSettings } from '../handshake/aiProviders'
import { ocrRouter } from '../ocr/router'
import { DEBUG_AUTOSORT_DIAGNOSTICS, autosortDiagLog } from '../autosortDiagnostics'
import type { VisionProvider } from '../ocr/types'
import { DEBUG_ACTIVE_OLLAMA_MODEL } from '../llm/activeOllamaModelStore'

export const INBOX_LLM_TIMEOUT_MS = 45_000

/**
 * Set to true during debugging to see every isLlmAvailable / inboxLlmChat call in the console.
 * Keep false in production — these fire once per message in every bulk classify run.
 */
const DEBUG_AI_DIAGNOSTICS = false

const LLM_TIMEOUT_PREFIX = 'LLM_TIMEOUT'

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const name = 'name' in e ? String((e as Error).name) : ''
  return name === 'AbortError'
}

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
  if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ isLlmAvailable CALLED', new Date().toISOString())
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

// ── Resolved LLM context (for bulk/batch callers) ────────────────────────────

/**
 * A pre-resolved LLM context — contains the model name and provider that a
 * batch caller already looked up once. Pass this into inboxLlmChat() /
 * classifySingleMessage() to skip redundant listModels() calls per message.
 */
export interface ResolvedLlmContext {
  /** Model name as returned by Ollama (e.g. "gemma3:12b") or a cloud model id. */
  model: string
  /** Provider id — "ollama", "openai", "anthropic", "google", "xai", "cloudai", etc. */
  provider: string
}

/**
 * Resolve the inbox LLM context once for an entire batch run.
 * Returns null if no LLM is available (no model installed, no API key).
 * Use the returned ResolvedLlmContext to avoid N×listModels() for N messages.
 *
 * **Active Ollama model:** Each call reads the current persisted preference (via
 * `getEffectiveChatModelName`). A model switch applies to the **next** `preResolveInboxLlm()`
 * invocation — e.g. the **next IPC batch chunk** or **next** single-message run — not to
 * in-flight work already holding a `resolvedContext` from an earlier pre-resolve.
 */
export async function preResolveInboxLlm(): Promise<ResolvedLlmContext | null> {
  const settings = resolveInboxLlmSettings()
  const providerLower = settings.provider.toLowerCase()

  if (providerLower === 'ollama') {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const model = await ollamaManager.getEffectiveChatModelName()
    if (!model) return null
    if (DEBUG_ACTIVE_OLLAMA_MODEL) {
      console.warn('[ActiveOllamaModel] preResolveInboxLlm →', model)
    }
    return { model, provider: 'ollama' }
  }

  // Cloud provider: verify the API key is present
  const vp = visionForRagSettings(settings)
  if (!vp) return null
  const key = ocrRouter.getApiKey(vp)
  if (typeof key !== 'string' || !key.trim()) return null
  return { model: settings.model ?? '', provider: settings.provider }
}

export interface InboxLlmChatParams {
  system: string
  user: string
  timeoutMs?: number
  /**
   * When provided by a bulk caller (e.g. classifySingleMessage from aiCategorize),
   * inboxLlmChat skips the listModels() lookup and uses this pre-resolved model/provider.
   * This prevents N parallel messages from each firing their own /api/tags request.
   */
  resolvedContext?: ResolvedLlmContext
}

/**
 * Non-stream chat for inbox classify / summarize / draft / analyze.
 */
export async function inboxLlmChat(params: InboxLlmChatParams): Promise<string> {
  const { system, user, timeoutMs = INBOX_LLM_TIMEOUT_MS, resolvedContext } = params
  if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ inboxLlmChat CALLED', new Date().toISOString(), {
    caller: new Error().stack?.split('\n')[2]?.trim(),
    model: resolvedContext?.model ?? '(will resolve)',
    skipLookup: resolvedContext != null,
  })

  const settings: UserRagSettings = resolvedContext
    ? { provider: resolvedContext.provider }
    : resolveInboxLlmSettings()
  const getApiKey = (p: string) => ocrRouter.getApiKey(p as VisionProvider)
  const provider = getProvider(settings, getApiKey)

  let modelOverride: string | undefined
  if (resolvedContext) {
    // Fast path: caller already did the listModels() lookup — skip it entirely.
    modelOverride = resolvedContext.model
  } else if (provider.id === 'ollama') {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const resolved = await ollamaManager.getEffectiveChatModelName()
    if (!resolved) {
      throw new Error('No LLM model installed. Install a local model or configure a cloud API key in Backend settings.')
    }
    modelOverride = resolved
    if (DEBUG_ACTIVE_OLLAMA_MODEL) {
      console.warn('[ActiveOllamaModel] inboxLlmChat ollama model →', resolved)
    }
  } else {
    modelOverride = settings.model
  }

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]

  const ac = new AbortController()
  let outerTimeoutFired = false
  const timeoutId = setTimeout(() => {
    outerTimeoutFired = true
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      autosortDiagLog('inboxLlmChat:outer-timeout', { timeoutMs, action: 'AbortController.abort' })
    }
    ac.abort()
  }, timeoutMs)

  if (DEBUG_AUTOSORT_DIAGNOSTICS) {
    autosortDiagLog('inboxLlmChat:fetch-started', { timeoutMs, providerId: provider.id })
  }

  try {
    const text = await provider.generateChat(messages, {
      model: modelOverride,
      stream: false,
      signal: ac.signal,
    })
    clearTimeout(timeoutId)
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      autosortDiagLog('inboxLlmChat:completed', {
        providerId: provider.id,
        signalAborted: ac.signal.aborted,
      })
    }
    const trimmed = typeof text === 'string' ? text.trim() : ''
    return trimmed || 'No response from model.'
  } catch (e) {
    clearTimeout(timeoutId)
    const abortErr = isAbortError(e)
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      autosortDiagLog('inboxLlmChat:settled', {
        outerTimeoutFired,
        isAbortError: abortErr,
        signalAborted: ac.signal.aborted,
        mapsToInboxTimeout: ac.signal.aborted && (abortErr || outerTimeoutFired),
      })
    }
    if (ac.signal.aborted && (abortErr || outerTimeoutFired)) {
      throw new InboxLlmTimeoutError()
    }
    throw e
  }
}
