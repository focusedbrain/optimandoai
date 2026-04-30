/**
 * Inbox NDJSON `/api/chat` streaming with Sandbox resolver routing (cross-device LAN `ollama_direct`).
 * Uses ledger-aware sandbox detection (same as {@link resolveAiExecutionContextForLlm}) — persisted
 * orchestrator `host` must not force `127.0.0.1` when the coordination ledger proves sandbox↔host.
 */

import { INBOX_LLM_TIMEOUT_MS } from './inboxLlmChat'
import {
  InferenceRoutingUnavailableError,
  logSandboxInferenceSend,
} from '../internalInference/chatWithContextRagOllamaGeneration'
import { resolveSandboxInferenceTarget } from '../internalInference/resolveSandboxInferenceTarget'
import { getSandboxOllamaDirectRouteCandidate } from '../internalInference/sandboxHostAiOllamaDirectCandidate'
import { planSandboxHostChatExecution, type BeapContentAiTask } from '../internalInference/beapContentAiRoute'
import { isEffectiveSandboxSideForAiExecution } from '../llm/resolveAiExecutionContext'
import type { AiExecutionContext } from '../llm/aiExecutionTypes'
import { bareOllamaModelNameForApi } from '../../../src/lib/hostInferenceModelIds'

const LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434'

export type InboxOllamaStreamFetchDiag = {
  surface: string
  requestId?: string
  lane?: string
  baseUrl: string
  url: string
  model: string
  handshakeId?: string
  timeoutMs: number
  signalAbortedOuter?: boolean
  signalAbortedTimeout?: boolean
}

function mergeAbortSignals(outer: AbortSignal | undefined, inner: AbortSignal): AbortSignal {
  if (!outer) return inner
  try {
    const anySig = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
    if (typeof anySig === 'function') {
      return anySig([outer, inner])
    }
  } catch {
    /* fall through */
  }
  const merged = new AbortController()
  const forward = () => merged.abort()
  if (outer.aborted) {
    forward()
    return merged.signal
  }
  outer.addEventListener('abort', forward, { once: true })
  inner.addEventListener('abort', forward, { once: true })
  return merged.signal
}

function logStreamFetchErr(err: unknown, diag: InboxOllamaStreamFetchDiag): void {
  const e = err instanceof Error ? err : new Error(String(err))
  const cause = e && typeof e === 'object' && 'cause' in e ? (e as Error & { cause?: unknown }).cause : undefined
  const c =
    cause && typeof cause === 'object'
      ? (cause as { code?: unknown; errno?: unknown; address?: unknown; port?: unknown })
      : {}
  console.error(
    '[INBOX_OLLAMA_STREAM_FETCH_FAILED]',
    JSON.stringify({
      name: e.name,
      message: e.message,
      cause_code: typeof c.code === 'string' || typeof c.code === 'number' ? c.code : undefined,
      cause_errno: typeof c.errno === 'number' ? c.errno : undefined,
      cause_address: typeof c.address === 'string' ? c.address : undefined,
      cause_port: typeof c.port === 'number' ? c.port : undefined,
      url: diag.url,
      baseUrl: diag.baseUrl,
      model: diag.model,
      surface: diag.surface,
      requestId: diag.requestId ?? null,
    }),
  )
}

function logStreamEvent(name: string, payload: Record<string, unknown>): void {
  console.log(`[${name}] ${JSON.stringify(payload)}`)
}

async function* streamOllamaChatNdjsonFromBaseUrl(
  baseUrl: string,
  systemPrompt: string,
  userPrompt: string,
  modelId: string,
  opts: {
    diag: InboxOllamaStreamFetchDiag
    /** IPC / caller cancellation — merged with inner timeout controller */
    abortSignal?: AbortSignal
    responseFormat?: 'json'
  },
): AsyncGenerator<string, void, undefined> {
  const normalizedBase = baseUrl.trim().replace(/\/$/, '')
  const url = `${normalizedBase}/api/chat`
  const innerAc = new AbortController()
  const timeoutId = setTimeout(() => innerAc.abort(), opts.diag.timeoutMs)
  const fetchSignal = mergeAbortSignals(opts.abortSignal, innerAc.signal)
  const diagBefore = {
    ...opts.diag,
    baseUrl: normalizedBase,
    url,
    signalAbortedOuter: opts.abortSignal?.aborted === true,
    signalAbortedTimeout: innerAc.signal.aborted,
  }
  console.log('[INBOX_OLLAMA_STREAM_FETCH_BEGIN]', JSON.stringify(diagBefore))
  let lineCount = 0
  let chunkCount = 0
  let cumulativeChars = 0
  let sawDone = false
  try {
    const body: Record<string, unknown> = {
      model: modelId,
      stream: true,
      keep_alive: '2m',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }
    if (opts.responseFormat === 'json') {
      body.format = 'json'
      body.options = { temperature: 0 }
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: fetchSignal,
    })
    logStreamEvent('INBOX_OLLAMA_STREAM_RESPONSE', {
      ...diagBefore,
      http_status: response.status,
      ok: response.ok,
      has_body: !!response.body,
      response_format: opts.responseFormat ?? null,
    })
    if (!response.ok || !response.body) throw new Error(`Stream failed HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        logStreamEvent('INBOX_OLLAMA_STREAM_READER_CLOSE', {
          requestId: opts.diag.requestId ?? null,
          lineCount,
          chunkCount,
          cumulativeChars,
          sawDone,
        })
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        lineCount += 1
        if (lineCount === 1) {
          logStreamEvent('INBOX_OLLAMA_STREAM_FIRST_LINE', {
            requestId: opts.diag.requestId ?? null,
            lineChars: line.length,
            linePrefix: line.slice(0, 120),
          })
        }
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
          if (parsed.done === true) {
            sawDone = true
            logStreamEvent('INBOX_OLLAMA_STREAM_DONE', {
              requestId: opts.diag.requestId ?? null,
              lineCount,
              chunkCount,
              cumulativeChars,
            })
          }
          if (parsed.message?.content) {
            const chunk = parsed.message.content
            chunkCount += 1
            cumulativeChars += chunk.length
            logStreamEvent('INBOX_OLLAMA_STREAM_CHUNK', {
              requestId: opts.diag.requestId ?? null,
              chunkCount,
              chunkChars: chunk.length,
              cumulativeChars,
            })
            yield chunk
          }
        } catch {
          /* partial line */
        }
      }
    }
    if (buffer.trim()) {
      lineCount += 1
      try {
        const parsed = JSON.parse(buffer) as { message?: { content?: string }; done?: boolean }
        if (parsed.done === true) {
          sawDone = true
          logStreamEvent('INBOX_OLLAMA_STREAM_DONE', {
            requestId: opts.diag.requestId ?? null,
            lineCount,
            chunkCount,
            cumulativeChars,
          })
        }
        if (parsed.message?.content) {
          const chunk = parsed.message.content
          chunkCount += 1
          cumulativeChars += chunk.length
          logStreamEvent('INBOX_OLLAMA_STREAM_CHUNK', {
            requestId: opts.diag.requestId ?? null,
            chunkCount,
            chunkChars: chunk.length,
            cumulativeChars,
          })
          yield chunk
        }
      } catch {
        /* partial */
      }
    }
    logStreamEvent('INBOX_OLLAMA_STREAM_FINAL_LENGTH', {
      requestId: opts.diag.requestId ?? null,
      lineCount,
      chunkCount,
      cumulativeChars,
      sawDone,
    })
  } catch (err: unknown) {
    logStreamFetchErr(err, { ...opts.diag, baseUrl: normalizedBase, url })
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort) {
      if (opts.abortSignal?.aborted) {
        logStreamEvent('INBOX_OLLAMA_STREAM_ABORTED', {
          requestId: opts.diag.requestId ?? null,
          lineCount,
          chunkCount,
          cumulativeChars,
          reason: 'outer_abort',
        })
        throw new Error('LLM_ABORTED')
      }
      logStreamEvent('INBOX_OLLAMA_STREAM_TIMEOUT', {
        requestId: opts.diag.requestId ?? null,
        lineCount,
        chunkCount,
        cumulativeChars,
        timeoutMs: opts.diag.timeoutMs,
      })
      throw new Error('LLM_TIMEOUT: response exceeded 45s')
    }
    logStreamEvent('INBOX_OLLAMA_STREAM_ERROR', {
      requestId: opts.diag.requestId ?? null,
      lineCount,
      chunkCount,
      cumulativeChars,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

function resolveStreamBase(execCtx: AiExecutionContext | null | undefined, planMode: string): string {
  let streamBase = (execCtx?.baseUrl ?? '').trim().replace(/\/$/, '')
  if (!streamBase && execCtx?.handshakeId?.trim() && planMode === 'ollama_direct') {
    const cand = getSandboxOllamaDirectRouteCandidate(execCtx.handshakeId.trim())
    streamBase = (cand?.base_url ?? '').trim().replace(/\/$/, '')
  }
  return streamBase
}

/**
 * Replaces deprecated `OLLAMA_BASE_URL` streaming for inbox analyze: routes sandbox traffic through
 * {@link resolveSandboxInferenceTarget} when LAN base is unknown.
 */
export async function* streamInboxOllamaAnalyzeWithSandboxRouting(
  systemPrompt: string,
  userPrompt: string,
  modelId: string,
  execCtx?: AiExecutionContext | null,
  contentTask?: BeapContentAiTask,
  streamOpts?: { abortSignal?: AbortSignal; requestId?: string },
): AsyncGenerator<string, void, undefined> {
  const bareModel = bareOllamaModelNameForApi(modelId)
  const effectiveSandbox = await isEffectiveSandboxSideForAiExecution()

  const baseDiag = (lane: string | undefined, baseUrl: string): InboxOllamaStreamFetchDiag => ({
    surface: 'inbox_ai_analyze_stream',
    requestId: streamOpts?.requestId,
    lane,
    baseUrl,
    url: `${baseUrl.replace(/\/$/, '')}/api/chat`,
    model: bareModel,
    handshakeId: execCtx?.handshakeId?.trim() || undefined,
    timeoutMs: INBOX_LLM_TIMEOUT_MS,
    signalAbortedOuter: streamOpts?.abortSignal?.aborted,
  })

  /** Exclusive host machine (no ledger sandbox peer): historical local-only stream */
  if (!effectiveSandbox) {
    yield* streamOllamaChatNdjsonFromBaseUrl(LOCAL_OLLAMA_BASE, systemPrompt, userPrompt, bareModel, {
      diag: baseDiag('local', LOCAL_OLLAMA_BASE),
      abortSignal: streamOpts?.abortSignal,
      responseFormat: 'json',
    })
    return
  }

  const task = contentTask ?? { kind: 'analysis' as const }
  const responseFormat = task.kind === 'analysis' ? 'json' : undefined
  const plan = planSandboxHostChatExecution(execCtx ?? null, task)
  if (plan.mode === 'blocked') {
    throw new Error(plan.message)
  }

  const streamBase = resolveStreamBase(execCtx, plan.mode)

  /** LAN Ollama direct — never downgrade to localhost when remote lane is ready */
  if (
    execCtx?.lane === 'ollama_direct' &&
    execCtx.ollamaDirectReady === true &&
    streamBase &&
    plan.mode === 'ollama_direct'
  ) {
    yield* streamOllamaChatNdjsonFromBaseUrl(streamBase, systemPrompt, userPrompt, bareModel, {
      diag: baseDiag('ollama_direct', streamBase),
      abortSignal: streamOpts?.abortSignal,
      responseFormat,
    })
    return
  }

  if (plan.mode === 'ollama_direct' && streamBase) {
    yield* streamOllamaChatNdjsonFromBaseUrl(streamBase, systemPrompt, userPrompt, bareModel, {
      diag: baseDiag('ollama_direct', streamBase),
      abortSignal: streamOpts?.abortSignal,
      responseFormat,
    })
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

  const tb = target.baseUrl.trim().replace(/\/$/, '')
  yield* streamOllamaChatNdjsonFromBaseUrl(tb, systemPrompt, userPrompt, bareModel, {
    diag: baseDiag(target.kind === 'local_sandbox' ? 'local_sandbox' : 'cross_device', tb),
    abortSignal: streamOpts?.abortSignal,
    responseFormat,
  })
}
