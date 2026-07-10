/**
 * Host-only: run local llama.cpp for internal Sandbox inference. No cloud, no inbox defaults.
 * Does not log message content.
 */

import { localLlmManager } from './local-llm-manager'
import { InboxLlmTimeoutError } from '../email/inboxLlmChat'
import { assertGpuInferenceAvailable } from '../inference/inferenceGate'
import { extractLlamaChatContent } from './llamaChatResponseContent'

export interface InternalHostInferenceMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RunInternalHostLocalLlmParams {
  messages: InternalHostInferenceMessage[]
  requestedModel: string | undefined
  /**
   * If non-empty, requested model (when provided) must be in this set and installed.
   * If empty, use requested model if set, else active local chat model (if installed).
   */
  modelAllowlist: string[]
  signal: AbortSignal
  temperature?: number
  maxTokens?: number
  timeoutMs: number
}

/** @deprecated Use RunInternalHostLocalLlmParams */
export type RunInternalHostOllamaParams = RunInternalHostLocalLlmParams

export interface RunInternalHostLocalLlmResult {
  text: string
  model: string
  usage?: { prompt_eval_count?: number; eval_count?: number }
  durationMs: number
}

/** @deprecated Use RunInternalHostLocalLlmResult */
export type RunInternalHostOllamaResult = RunInternalHostLocalLlmResult

export async function resolveModelForInternalInference(
  requested: string | undefined,
  allowlist: string[],
): Promise<{ model: string } | { error: 'MODEL_UNAVAILABLE' }> {
  const installed = await localLlmManager.listModels()
  const names = new Set(installed.map((m) => m.name))

  if (installed.length === 0) {
    return { error: 'MODEL_UNAVAILABLE' }
  }

  if (allowlist.length > 0) {
    for (const id of allowlist) {
      if (!names.has(id)) {
        return { error: 'MODEL_UNAVAILABLE' }
      }
    }
  }

  const req = requested?.trim()
  if (req) {
    if (!names.has(req)) {
      return { error: 'MODEL_UNAVAILABLE' }
    }
    if (allowlist.length > 0 && !allowlist.includes(req)) {
      return { error: 'MODEL_UNAVAILABLE' }
    }
    return { model: req }
  }

  if (allowlist.length > 0) {
    const active = await localLlmManager.getEffectiveChatModelName()
    if (active && names.has(active) && allowlist.includes(active)) {
      return { model: active }
    }
    return { model: allowlist[0]! }
  }

  const active = await localLlmManager.getEffectiveChatModelName()
  if (active && names.has(active)) {
    return { model: active }
  }
  const first = installed[0]?.name
  return first ? { model: first } : { error: 'MODEL_UNAVAILABLE' }
}

/**
 * Non-streaming OpenAI `/v1/chat/completions` for internal inference. No cloud path.
 */
export async function runInternalHostLocalLlmInference(
  params: RunInternalHostLocalLlmParams,
): Promise<RunInternalHostLocalLlmResult> {
  const running = await localLlmManager.isRunning()
  if (!running) {
    const err = new Error('LOCAL_LLM_UNAVAILABLE')
    ;(err as any).code = 'LOCAL_LLM_UNAVAILABLE'
    throw err
  }

  const res = await resolveModelForInternalInference(params.requestedModel, params.modelAllowlist)
  if ('error' in res) {
    const err = new Error('MODEL_UNAVAILABLE')
    ;(err as any).code = 'MODEL_UNAVAILABLE'
    throw err
  }
  const model = res.model
  const base = localLlmManager.getBaseUrl()
  const t0 = Date.now()

  const body: Record<string, unknown> = {
    model,
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  }
  if (params.temperature !== undefined) body.temperature = params.temperature
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), params.timeoutMs)
  if (params.signal.aborted) {
    clearTimeout(timer)
    ac.abort()
  } else {
    params.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      ac.abort()
    }, { once: true })
  }

  try {
    await assertGpuInferenceAvailable()
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    if (!response.ok) {
      throw new Error(`Local LLM HTTP ${response.status}`)
    }
    const data = (await response.json()) as {
      model?: string
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    // build038: reasoning_content fallback; a truly empty response is an inference error, not
    // a fake "No response from model." success (which broke downstream JSON parsing silently).
    const extracted = extractLlamaChatContent(data.choices?.[0]?.message)
    if (extracted.empty) {
      const err = new Error('EMPTY_LLM_RESPONSE')
      ;(err as any).code = 'INTERNAL_INFERENCE_FAILED'
      throw err
    }
    const text = extracted.content.trim()
    clearTimeout(timer)
    return {
      text,
      model: data.model ?? model,
      usage: {
        prompt_eval_count: data.usage?.prompt_tokens,
        eval_count: data.usage?.completion_tokens,
      },
      durationMs: Date.now() - t0,
    }
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof InboxLlmTimeoutError) {
      throw e
    }
    if (params.signal.aborted || (e as Error)?.name === 'AbortError') {
      throw new InboxLlmTimeoutError(`internal inference exceeded ${params.timeoutMs}ms`)
    }
    const msg = (e as Error)?.message ?? String(e)
    if (/fetch|ECONNREFUSED|Failed to fetch|network|HTTP/i.test(msg)) {
      const err = new Error('LOCAL_LLM_UNAVAILABLE')
      ;(err as any).code = 'LOCAL_LLM_UNAVAILABLE'
      throw err
    }
    const err = new Error('INTERNAL_INFERENCE_FAILED')
    ;(err as any).code = 'INTERNAL_INFERENCE_FAILED'
    ;(err as any).cause = e
    throw err
  }
}

/** @deprecated Use runInternalHostLocalLlmInference */
export const runInternalHostOllamaInference = runInternalHostLocalLlmInference
