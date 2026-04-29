/**
 * Inbox NDJSON `/api/chat` streaming with Sandbox resolver routing (cross-device LAN `ollama_direct`).
 * Host/`!isSandboxMode` behavior matches the historical hard-coded `127.0.0.1:11434` path.
 */

import { INBOX_LLM_TIMEOUT_MS } from './inboxLlmChat'
import {
  InferenceRoutingUnavailableError,
  logSandboxInferenceSend,
} from '../internalInference/chatWithContextRagOllamaGeneration'
import { resolveSandboxInferenceTarget } from '../internalInference/resolveSandboxInferenceTarget'
import { getSandboxOllamaDirectRouteCandidate } from '../internalInference/sandboxHostAiOllamaDirectCandidate'
import { planSandboxHostChatExecution, type BeapContentAiTask } from '../internalInference/beapContentAiRoute'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import type { AiExecutionContext } from '../llm/aiExecutionTypes'

const LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434'

async function* streamOllamaChatNdjsonFromBaseUrl(
  baseUrl: string,
  systemPrompt: string,
  userPrompt: string,
  modelId: string,
): AsyncGenerator<string, void, undefined> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), INBOX_LLM_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        keep_alive: '2m',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok || !response.body) throw new Error('Stream failed')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string } }
          if (parsed.message?.content) {
            yield parsed.message.content
          }
        } catch {
          /* partial line */
        }
      }
    }
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer) as { message?: { content?: string } }
        if (parsed.message?.content) {
          yield parsed.message.content
        }
      } catch {
        /* partial */
      }
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort) throw new Error('LLM_TIMEOUT: response exceeded 45s')
    throw err
  }
}

/**
 * Replaces deprecated `OLLAMA_BASE_URL` streaming for inbox analyze: routes sandbox traffic through
 * {@link resolveSandboxInferenceTarget}.
 */
export async function* streamInboxOllamaAnalyzeWithSandboxRouting(
  systemPrompt: string,
  userPrompt: string,
  modelId: string,
  execCtx?: AiExecutionContext | null,
  contentTask?: BeapContentAiTask,
): AsyncGenerator<string, void, undefined> {
  if (!isSandboxMode()) {
    yield* streamOllamaChatNdjsonFromBaseUrl(LOCAL_OLLAMA_BASE, systemPrompt, userPrompt, modelId)
    return
  }

  const task = contentTask ?? { kind: 'analysis' as const }
  const plan = planSandboxHostChatExecution(execCtx ?? null, task)
  if (plan.mode === 'blocked') {
    throw new Error(plan.message)
  }

  let streamBase = (execCtx?.baseUrl ?? '').trim().replace(/\/$/, '')
  if (!streamBase && execCtx?.handshakeId?.trim() && plan.mode === 'ollama_direct') {
    const cand = getSandboxOllamaDirectRouteCandidate(execCtx.handshakeId.trim())
    streamBase = (cand?.base_url ?? '').trim().replace(/\/$/, '')
  }

  if (plan.mode === 'ollama_direct' && streamBase) {
    yield* streamOllamaChatNdjsonFromBaseUrl(streamBase, systemPrompt, userPrompt, modelId)
    return
  }

  const target = await resolveSandboxInferenceTarget({
    handshakeId: execCtx?.handshakeId,
  })

  if (target.kind === 'unavailable') {
    if (target.reason === 'no_local_ollama_no_cross_device_host') {
      throw new InferenceRoutingUnavailableError('no_local_ollama_no_cross_device_host')
    }
    if (target.reason === 'cross_device_caps_not_accepted') {
      throw new InferenceRoutingUnavailableError('cross_device_caps_not_accepted', target.detail)
    }
    throw new InferenceRoutingUnavailableError('local_probe_error', target.detail)
  }

  logSandboxInferenceSend(target, 'inbox_ai_stream')

  if (target.kind === 'local_sandbox') {
    yield* streamOllamaChatNdjsonFromBaseUrl(target.baseUrl, systemPrompt, userPrompt, modelId)
    return
  }

  yield* streamOllamaChatNdjsonFromBaseUrl(target.baseUrl, systemPrompt, userPrompt, modelId)
}
