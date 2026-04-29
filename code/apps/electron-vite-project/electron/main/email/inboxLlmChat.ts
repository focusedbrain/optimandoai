/**
 * Unified inbox LLM calls — same provider stack as handshake / hybrid search (aiProviders + ocrRouter keys).
 */

import { getProvider, type UserRagSettings } from '../handshake/aiProviders'
import { ocrRouter } from '../ocr/router'
import { DEBUG_AUTOSORT_DIAGNOSTICS, autosortDiagLog } from '../autosortDiagnostics'
import type { VisionProvider } from '../ocr/types'
import { DEBUG_ACTIVE_OLLAMA_MODEL } from '../llm/activeOllamaModelStore'
import {
  DEBUG_OLLAMA_RUNTIME_TRACE,
  ollamaRuntimeLog,
  type OllamaRuntimeRequestTrace,
} from '../llm/ollamaRuntimeDiagnostics'
import type { AiExecutionContext } from '../llm/aiExecutionTypes'
import { NO_AI_MODEL_SELECTED, isEffectiveSandboxSideForAiExecution, resolveAiExecutionContextForLlm } from '../llm/resolveAiExecutionContext'
import type { BeapContentAiTask } from '../internalInference/beapContentAiRoute'

export const INBOX_LLM_TIMEOUT_MS = 45_000

/**
 * Set to true during debugging to see every isLlmAvailable / inboxLlmChat call in the console.
 * Keep false in production — these fire once per message in every bulk classify run.
 */
const DEBUG_AI_DIAGNOSTICS = false

/** Set env `DEBUG_INBOX_LLM=1` to log provider resolution for inbox LLM (main process). */
const DEBUG_INBOX_LLM_SETTINGS = process.env.DEBUG_INBOX_LLM === '1'

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

  let settings: UserRagSettings
  if (!cfg || pref === 'local') {
    settings = { provider: 'ollama' }
  } else if (pref === 'cloud') {
    const cloud = firstCloudRagSettings()
    settings = cloud ? cloud : { provider: 'ollama' }
  } else {
    const cloud = firstCloudRagSettings()
    settings = cloud ? cloud : { provider: 'ollama' }
  }

  if (DEBUG_INBOX_LLM_SETTINGS) {
    const cloud = firstCloudRagSettings()
    console.log('[INBOX-LLM] resolveInboxLlmSettings:', {
      hasCloudConfig: !!cfg,
      preference: pref,
      cloudProvidersAvailable: ocrRouter.getAvailableProviders().length,
      chosenProvider: settings.provider,
      path: settings.provider === 'ollama' ? 'ollama' : 'cloud',
      firstCloud: cloud ? cloud.provider : null,
    })
  }

  return settings
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
    const r = await resolveAiExecutionContextForLlm()
    return r.ok
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
  const r = await resolveAiExecutionContextForLlm()
  if (!r.ok) return false
  /** BEAP lane uses HTTP stream only when LAN Ollama direct is ready; otherwise one-shot host chat. */
  if (r.ctx.lane === 'beap') {
    return r.ctx.ollamaDirectReady === true
  }
  return true
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
  /** Set when `provider === 'ollama'` — sandbox Host routing + LAN base. */
  aiExecution?: AiExecutionContext
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
    const r = await resolveAiExecutionContextForLlm()
    if (!r.ok) return null
    if (DEBUG_ACTIVE_OLLAMA_MODEL) {
      console.warn('[ActiveOllamaModel] preResolveInboxLlm →', r.ctx.model, r.ctx.lane)
    }
    return { model: r.ctx.model, provider: 'ollama', aiExecution: r.ctx }
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
   * inboxLlmChat skips redundant resolver work and uses this pre-resolved model/provider.
   */
  resolvedContext?: ResolvedLlmContext
  /**
   * Explicit routing (e.g. AI-ANALYZE-STREAM) — skips `resolveAiExecutionContextForLlm` when set.
   */
  aiExecution?: AiExecutionContext
  /** Optional correlation for DEBUG_OLLAMA_RUNTIME_TRACE (bulk auto-sort). */
  llmTrace?: OllamaRuntimeRequestTrace
  /**
   * Sandbox → Host: classify call for LAN `ollama_direct` vs BEAP transport ({@link planSandboxHostChatExecution}).
   */
  contentTask?: BeapContentAiTask
}

/**
 * Non-stream chat for inbox classify / summarize / draft / analyze.
 */
export async function inboxLlmChat(params: InboxLlmChatParams): Promise<string> {
  const {
    system,
    user,
    timeoutMs = INBOX_LLM_TIMEOUT_MS,
    resolvedContext,
    aiExecution: aiExecutionParam,
    llmTrace,
    contentTask,
  } = params
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

  let aiExecution: AiExecutionContext | undefined =
    aiExecutionParam ?? resolvedContext?.aiExecution
  let modelOverride: string | undefined = resolvedContext?.model

  if (provider.id === 'ollama') {
    if (!aiExecution) {
      const r = await resolveAiExecutionContextForLlm()
      if (!r.ok) {
        throw new Error(r.error)
      }
      aiExecution = r.ctx
    }
    modelOverride = (modelOverride ?? aiExecution.model).trim()
    if (!modelOverride) {
      throw new Error(NO_AI_MODEL_SELECTED)
    }
    if (DEBUG_ACTIVE_OLLAMA_MODEL) {
      console.warn('[ActiveOllamaModel] inboxLlmChat ollama →', modelOverride, aiExecution.lane)
    }
  } else {
    modelOverride = resolvedContext?.model ?? settings.model
  }

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]

  if (provider.id === 'ollama' && aiExecution && (await isEffectiveSandboxSideForAiExecution())) {
    if (aiExecution.lane === 'ollama_direct' || aiExecution.lane === 'beap') {
      const { planSandboxHostChatExecution } = await import('../internalInference/beapContentAiRoute')
      const plan = planSandboxHostChatExecution(aiExecution, contentTask ?? { kind: 'other' })
      if (plan.mode === 'blocked') {
        const e = new Error(plan.message)
        ;(e as Error & { inboxFailureCode?: string }).inboxFailureCode = plan.code
        throw e
      }
      const hid = aiExecution.handshakeId?.trim()
      if (!hid) {
        throw new Error(NO_AI_MODEL_SELECTED)
      }
      const { runSandboxHostInferenceChat } = await import('../internalInference/sandboxHostChat')
      const out = await runSandboxHostInferenceChat({
        handshakeId: hid,
        messages,
        model: modelOverride,
        timeoutMs,
        execution_transport: plan.mode === 'ollama_direct' ? 'ollama_direct' : undefined,
      })
      if (!out.ok) {
        const e = new Error(out.message || out.code || 'Host inference failed')
        ;(e as Error & { inboxFailureCode?: string }).inboxFailureCode = out.code
        throw e
      }
      const trimmed = typeof out.output === 'string' ? out.output.trim() : ''
      return trimmed || 'No response from model.'
    }
  }

  if (provider.id === 'ollama' && aiExecution) {
    const { OllamaProvider } = await import('../handshake/aiProviders')
    const ollamaProv = new OllamaProvider({
      baseUrl: aiExecution.baseUrl ?? 'http://127.0.0.1:11434',
      model: modelOverride,
      chatModel: modelOverride,
      lane: aiExecution.lane,
      handshakeId: aiExecution.handshakeId,
      peerDeviceId: aiExecution.peerDeviceId,
    })
    const ac = new AbortController()
    let outerTimeoutFired = false
    const timeoutId = setTimeout(() => {
      outerTimeoutFired = true
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        autosortDiagLog('inboxLlmChat:outer-timeout', { timeoutMs, action: 'AbortController.abort' })
      }
      if (DEBUG_OLLAMA_RUNTIME_TRACE) {
        ollamaRuntimeLog('inboxLlmChat:timeout_abortSignal', {
          timeoutMs,
          providerId: 'ollama',
          model: modelOverride,
          httpClientAbort: true,
          ...llmTrace,
        })
      }
      ac.abort()
    }, timeoutMs)
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      autosortDiagLog('inboxLlmChat:fetch-started', { timeoutMs, providerId: 'ollama' })
    }
    try {
      const bulkOllamaAutosort = llmTrace?.source === 'bulk_autosort'
      const text = await ollamaProv.generateChat(messages, {
        model: modelOverride,
        stream: false,
        signal: ac.signal,
        runtimeTrace: llmTrace,
        ...(bulkOllamaAutosort ? { ollamaKeepAlive: '15m' as const } : {}),
      })
      clearTimeout(timeoutId)
      const trimmed = typeof text === 'string' ? text.trim() : ''
      return trimmed || 'No response from model.'
    } catch (e) {
      clearTimeout(timeoutId)
      const abortErr = isAbortError(e)
      if (ac.signal.aborted && (abortErr || outerTimeoutFired)) {
        throw new InboxLlmTimeoutError()
      }
      throw e
    }
  }

  if (provider.id !== 'ollama') {
    const ac = new AbortController()
    let outerTimeoutFired = false
    const timeoutId = setTimeout(() => {
      outerTimeoutFired = true
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        autosortDiagLog('inboxLlmChat:outer-timeout', { timeoutMs, action: 'AbortController.abort' })
      }
      if (DEBUG_OLLAMA_RUNTIME_TRACE) {
        ollamaRuntimeLog('inboxLlmChat:timeout_abortSignal', {
          timeoutMs,
          providerId: provider.id,
          model: modelOverride,
          httpClientAbort: true,
          ...llmTrace,
        })
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
        runtimeTrace: llmTrace,
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
      if (DEBUG_OLLAMA_RUNTIME_TRACE && (abortErr || ac.signal.aborted)) {
        ollamaRuntimeLog('inboxLlmChat:settled', {
          outcome: outerTimeoutFired && abortErr ? 'timeout' : abortErr ? 'aborted' : 'error',
          isAbortError: abortErr,
          signalAborted: ac.signal.aborted,
          outerTimeoutFired,
          mapsToInboxTimeout: ac.signal.aborted && (abortErr || outerTimeoutFired),
          providerId: provider.id,
          model: modelOverride,
          ...llmTrace,
        })
      }
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

  throw new Error('inboxLlmChat: unsupported ollama configuration')
}
