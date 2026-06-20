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
import { planSandboxHostChatExecution, type BeapContentAiTask } from '../internalInference/beapContentAiRoute'
import { isEffectiveSandboxSideForAiExecution } from '../llm/resolveAiExecutionContext'
import type { AiExecutionContext } from '../llm/aiExecutionTypes'
import { bareOllamaModelNameForApi } from '../../../src/lib/hostInferenceModelIds'
import {
  assertGpuInferenceAvailable,
  assertGpuInferenceAvailableForRemoteOllama,
  isLikelyLoopbackOrigin,
} from '../inference/inferenceGate'

const LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434'

export type InboxOllamaGpuChatGate =
  | { kind: 'local' }
  | { kind: 'remote'; origin: string; modelBare: string }

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
    gpuChatGate: InboxOllamaGpuChatGate
    /** IPC / caller cancellation — merged with inner timeout controller */
    abortSignal?: AbortSignal
    responseFormat?: 'json'
    expectedSchemaKeys?: string[]
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
  let finalText = ''
  let sawDone = false
  try {
    if (opts.gpuChatGate.kind === 'local') {
      await assertGpuInferenceAvailable()
    } else {
      await assertGpuInferenceAvailableForRemoteOllama(
        opts.gpuChatGate.origin,
        opts.gpuChatGate.modelBare,
      )
    }
    const requestOptions = opts.responseFormat === 'json'
      ? { temperature: 0, top_p: 0.9, num_predict: 1024 }
      : undefined
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
      body.options = requestOptions
    }
    logStreamEvent('ANALYSIS_REQUEST_OPTIONS', {
      requestId: opts.diag.requestId ?? null,
      model: modelId,
      format: opts.responseFormat ?? null,
      stream: true,
      temperature: requestOptions?.temperature ?? null,
      num_predict: requestOptions?.num_predict ?? null,
      top_p: requestOptions?.top_p ?? null,
      max_tokens: null,
      messageCount: 2,
      systemPromptLen: systemPrompt.length,
      userPromptLen: userPrompt.length,
      expectedSchemaKeys: opts.expectedSchemaKeys ?? [],
    })
    const bodyRaw = JSON.stringify(body)
    const __auditBodyParsed = (() => {
      try {
        return JSON.parse(bodyRaw) as unknown
      } catch {
        return null
      }
    })()
    console.log(
      `[INBOX_AUDIT_REQ_BODY] ${JSON.stringify({
        surface: 'inbox_ai_analyze_stream',
        url,
        method: 'POST',
        body_full: __auditBodyParsed,
        body_raw: bodyRaw,
        body_length: bodyRaw.length,
      })}`,
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyRaw,
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
            finalText += chunk
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
          finalText += chunk
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
    logStreamEvent('ANALYSIS_STREAM_FINAL_SAMPLE', {
      requestId: opts.diag.requestId ?? null,
      cumulativeChars,
      first120: finalText.slice(0, 120),
      last120: finalText.slice(-120),
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
  const expectedSchemaKeys = [
    'needsReply',
    'needsReplyReason',
    'summary',
    'urgencyScore',
    'urgencyReason',
    'actionItems',
    'archiveRecommendation',
    'archiveReason',
    'scamStatus',
    'scamFindings',
  ]

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
      gpuChatGate: { kind: 'local' },
      abortSignal: streamOpts?.abortSignal,
      responseFormat: 'json',
      expectedSchemaKeys,
    })
    return
  }

  const task = contentTask ?? { kind: 'analysis' as const }
  const responseFormat = task.kind === 'analysis' ? 'json' : undefined
  const plan = planSandboxHostChatExecution(execCtx ?? null, task)
  if (plan.mode === 'blocked') {
    throw new Error(plan.message)
  }

  /**
   * Fail-closed guard (item 4): a cross-device Sandbox→Host context (handshakeId present) must NEVER be
   * silently served by the Sandbox's own 127.0.0.1 loopback. If a paired remote selection somehow resolved
   * to a `local_ollama` plan, surface a loud routing error instead of masquerading + hanging ~45s. Genuine
   * local selections (no handshakeId) keep using loopback below.
   */
  if (plan.mode === 'local_ollama' && execCtx?.handshakeId?.trim()) {
    throw new InferenceRoutingUnavailableError(
      'cross_device_caps_not_accepted',
      'sealed_required_no_local_masquerade',
    )
  }

  /**
   * Cross-device Sandbox→Host inference goes over the **sealed relay** transport (whole-response
   * capsule). There is no plaintext LAN stream. The sealed result is yielded as a single chunk —
   * the IPC consumer concatenates chunks, so a one-shot final result is tolerated (no UI change).
   */
  if (plan.mode === 'sealed_host') {
    const hid = execCtx?.handshakeId?.trim()
    if (!hid) {
      throw new InferenceRoutingUnavailableError('no_local_ollama_no_cross_device_host')
    }
    console.log(
      `[HOST_AI_SEALED_INFERENCE_SEND] surface=inbox_ai_analyze_stream handshake=${hid} requestId=${
        streamOpts?.requestId ?? 'null'
      } model=${bareModel}`,
    )
    const { runSandboxHostInferenceChat } = await import('../internalInference/sandboxHostChat')
    const out = await runSandboxHostInferenceChat({
      handshakeId: hid,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: bareModel,
      timeoutMs: INBOX_LLM_TIMEOUT_MS,
      ...(responseFormat === 'json' ? { responseFormat: 'json' as const, temperature: 0 } : {}),
    })
    if (!out.ok) {
      const e = new Error(out.message || out.code || 'Host inference failed')
      ;(e as Error & { inboxFailureCode?: string }).inboxFailureCode = out.code
      throw e
    }
    const text = typeof out.output === 'string' ? out.output : ''
    console.log(
      `[INBOX_SEALED_ANALYSIS_RESULT] ${JSON.stringify({
        surface: 'inbox_ai_analyze_stream',
        requestId: streamOpts?.requestId ?? null,
        handshakeId: hid,
        outputChars: text.length,
      })}`,
    )
    if (text) yield text
    return
  }

  /**
   * `local_ollama` — the Sandbox's OWN loopback Ollama (127.0.0.1). Loopback is host-internal,
   * not a Sandbox→Host LAN plane, so streaming here is allowed.
   */
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

  if (target.kind !== 'local_sandbox') {
    // A cross-device target must never be reached over plaintext LAN — only the sealed path above
    // may talk to the Host. Fail closed rather than fall back to a 192.168.x:11434 stream.
    throw new InferenceRoutingUnavailableError(
      'cross_device_caps_not_accepted',
      'cross_device_requires_sealed_transport',
    )
  }

  logSandboxInferenceSend(target, 'inbox_ai_stream')

  const tb = target.baseUrl.trim().replace(/\/$/, '')
  const gpuChatGate: InboxOllamaGpuChatGate = isLikelyLoopbackOrigin(tb)
    ? { kind: 'local' }
    : { kind: 'remote', origin: tb, modelBare: bareModel }
  yield* streamOllamaChatNdjsonFromBaseUrl(tb, systemPrompt, userPrompt, bareModel, {
    diag: baseDiag('local_sandbox', tb),
    gpuChatGate,
    abortSignal: streamOpts?.abortSignal,
    responseFormat,
    expectedSchemaKeys,
  })
}
