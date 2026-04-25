/**
 * Host-only: run Ollama for internal Sandbox inference. No cloud, no inbox defaults.
 * Does not log message content.
 */

import { ollamaManager } from './ollama-manager'
import { InboxLlmTimeoutError } from '../email/inboxLlmChat'

export interface InternalHostInferenceMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RunInternalHostOllamaParams {
  messages: InternalHostInferenceMessage[]
  requestedModel: string | undefined
  /**
   * If non-empty, requested model (when provided) must be in this set and installed.
   * If empty, use requested model if set, else active Ollama chat model (if installed).
   */
  modelAllowlist: string[]
  signal: AbortSignal
  temperature?: number
  maxTokens?: number
  timeoutMs: number
}

export interface RunInternalHostOllamaResult {
  text: string
  model: string
  usage?: { prompt_eval_count?: number; eval_count?: number }
  durationMs: number
}

export async function resolveModelForInternalInference(
  requested: string | undefined,
  allowlist: string[],
): Promise<{ model: string } | { error: 'MODEL_UNAVAILABLE' }> {
  const installed = await ollamaManager.listModels()
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

  if (allowlist.length === 1) {
    return { model: allowlist[0]! }
  }

  if (allowlist.length > 0) {
    return { model: allowlist[0]! }
  }

  const active = await ollamaManager.getEffectiveChatModelName()
  if (active && names.has(active)) {
    return { model: active }
  }
  const first = installed[0]?.name
  return first ? { model: first } : { error: 'MODEL_UNAVAILABLE' }
}

/**
 * Non-streaming Ollama /api/chat for internal inference. No cloud path.
 */
export async function runInternalHostOllamaInference(
  params: RunInternalHostOllamaParams,
): Promise<RunInternalHostOllamaResult> {
  const running = await ollamaManager.isRunning()
  if (!running) {
    const err = new Error('OLLAMA_UNAVAILABLE')
    ;(err as any).code = 'OLLAMA_UNAVAILABLE'
    throw err
  }

  const res = await resolveModelForInternalInference(params.requestedModel, params.modelAllowlist)
  if ('error' in res) {
    const err = new Error('MODEL_UNAVAILABLE')
    ;(err as any).code = 'MODEL_UNAVAILABLE'
    throw err
  }
  const model = res.model
  const base = ollamaManager.getBaseUrl()
  const t0 = Date.now()

  const ollamaOptions: Record<string, number> = {}
  if (params.temperature !== undefined) ollamaOptions.temperature = params.temperature
  if (params.maxTokens !== undefined) ollamaOptions.num_predict = params.maxTokens

  const body: Record<string, unknown> = {
    model,
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
    keep_alive: '2m',
  }
  if (Object.keys(ollamaOptions).length > 0) {
    body.options = ollamaOptions
  }

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
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`)
    }
    const data = (await response.json()) as {
      message?: { content?: string }
      model?: string
      prompt_eval_count?: number
      eval_count?: number
    }
    const text = (data.message?.content ?? '').trim() || 'No response from model.'
    clearTimeout(timer)
    return {
      text,
      model: data.model ?? model,
      usage: {
        prompt_eval_count: data.prompt_eval_count,
        eval_count: data.eval_count,
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
      const err = new Error('OLLAMA_UNAVAILABLE')
      ;(err as any).code = 'OLLAMA_UNAVAILABLE'
      throw err
    }
    const err = new Error('INTERNAL_INFERENCE_FAILED')
    ;(err as any).code = 'INTERNAL_INFERENCE_FAILED'
    ;(err as any).cause = e
    throw err
  }
}
