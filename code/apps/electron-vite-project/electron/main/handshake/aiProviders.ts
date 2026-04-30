/**
 * AI Provider Abstraction for RAG Pipeline
 *
 * Supports multiple providers for both embeddings and chat.
 * User selects provider (Ollama or CloudAI); both embedding and chat route to that provider.
 */

import type { LocalEmbeddingService } from './embeddings'
import type { AiExecutionLane } from '../llm/aiExecutionTypes'
import { readStoredAiExecutionContext } from '../llm/aiExecutionContextStore'
import { getSandboxOllamaDirectRouteCandidate } from '../internalInference/sandboxHostAiOllamaDirectCandidate'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { DEBUG_AUTOSORT_DIAGNOSTICS, autosortDiagLog } from '../autosortDiagnostics'
import {
  DEBUG_OLLAMA_RUNTIME_TRACE,
  nsToMs,
  ollamaRuntimeGetInFlight,
  ollamaRuntimeInFlightDelta,
  ollamaRuntimeLog,
  ollamaRuntimeRecordChatTiming,
  type OllamaRuntimeRequestTrace,
} from '../llm/ollamaRuntimeDiagnostics'

/**
 * Set true only during local debugging.
 * In production these lines run once per LLM call — keep them silent.
 */
const DEBUG_AI_DIAGNOSTICS = false

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type StreamSender = (channel: string, payload: unknown) => void

export interface GenerateChatOptions {
  model?: string
  stream?: boolean
  /** When stream=true, used to send tokens to the client. */
  send?: StreamSender
  /** When aborted (e.g. inbox LLM outer timeout), non-stream fetches cancel immediately. */
  signal?: AbortSignal
  /** Sampling temperature (Ollama `options.temperature`, OpenAI `temperature`, etc.). */
  temperature?: number
  /** Ollama `/api/chat` response format, e.g. `json` for strict analysis tasks. */
  responseFormat?: 'json'
  /** Inbox bulk classify correlation when `DEBUG_OLLAMA_RUNTIME_TRACE`. */
  runtimeTrace?: OllamaRuntimeRequestTrace
  /**
   * Ollama `/api/chat` `keep_alive` (default `'2m'`). Bulk autosort passes longer TTL so
   * pauses between chunks are less likely to unload the model from GPU/RAM.
   */
  ollamaKeepAlive?: string
}

export interface AIProvider {
  readonly id: string
  generateEmbedding(text: string): Promise<number[]>
  generateChat(messages: Message[], options?: GenerateChatOptions): Promise<string>
}

// ── Ollama Provider ─────────────────────────────────────────────────────────

const OLLAMA_BASE = 'http://127.0.0.1:11434'
const DEFAULT_EMBED_MODEL = 'nomic-embed-text'
const DEFAULT_CHAT_MODEL = 'llama3.1:8b'

export type OllamaProviderOptions = {
  baseUrl?: string
  /** Default chat model when `chatModel` is omitted (alias). */
  model?: string
  chatModel?: string
  embedModel?: string
  lane?: AiExecutionLane
  handshakeId?: string
  peerDeviceId?: string
}

type OllamaProviderOperation = 'chat' | 'embedding' | 'tags'

function handshakeForLog(h?: string): string | null {
  const t = typeof h === 'string' ? h.trim() : ''
  return t || null
}

function formatCauseChain(err: unknown, depth = 0): string {
  if (depth > 5) return '(truncated)'
  if (err == null) return ''
  if (err instanceof Error) {
    const sub = err.cause !== undefined ? formatCauseChain(err.cause, depth + 1) : ''
    return sub ? `${err.name}: ${err.message} | ${sub}` : `${err.name}: ${err.message}`
  }
  try {
    const s = JSON.stringify(err)
    return s && s !== '{}' ? s : String(err)
  } catch {
    return String(err)
  }
}

function logOllamaProviderRequest(p: {
  lane: AiExecutionLane
  operation: OllamaProviderOperation
  baseUrl: string
  model: string
  handshake: string | null
  requestUrl: string
}): void {
  console.log(
    `[OLLAMA_PROVIDER_REQUEST] lane=${p.lane} operation=${p.operation} baseUrl=${p.baseUrl} model=${p.model} handshake=${p.handshake ?? 'null'} url=${p.requestUrl}`,
  )
}

function logOllamaProviderError(p: {
  lane: AiExecutionLane
  operation: OllamaProviderOperation
  baseUrl: string
  model: string
  handshake: string | null
  requestUrl: string
  err: unknown
}): void {
  const name =
    p.err instanceof Error
      ? p.err.name
      : typeof p.err === 'object' && p.err != null && 'name' in p.err
        ? String((p.err as { name?: unknown }).name ?? 'unknown')
        : 'non_error_throw'
  let message: string
  if (p.err instanceof Error) {
    message = p.err.message
  } else if (typeof p.err === 'object' && p.err != null) {
    try {
      const j = JSON.stringify(p.err)
      message = j && j !== '{}' ? j : String(p.err)
    } catch {
      message = String(p.err)
    }
  } else {
    message = String(p.err)
  }
  const stack = p.err instanceof Error ? p.err.stack ?? '' : ''
  const cause =
    p.err instanceof Error && p.err.cause !== undefined ? formatCauseChain(p.err.cause) : ''
  console.error(
    `[OLLAMA_PROVIDER_ERROR] lane=${p.lane} operation=${p.operation} baseUrl=${p.baseUrl} model=${p.model} handshake=${p.handshake ?? 'null'} requestUrl=${p.requestUrl} errorName=${name} errorMessage=${message} cause=${cause || '(none)'}\nerrorStack=${stack || '(none)'}`,
  )
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama'
  private baseUrl: string
  private embedModel: string
  private chatModel: string
  private lane: AiExecutionLane
  private handshakeId?: string
  private peerDeviceId?: string

  /** Embedding model passed to `/api/embed` — used when routing sandbox embeddings cross-device. */
  getOllamaEmbedModel(): string {
    return this.embedModel
  }

  getOllamaChatModel(): string {
    return this.chatModel
  }

  getOllamaLane(): AiExecutionLane {
    return this.lane
  }

  getOllamaBaseUrl(): string {
    return this.baseUrl
  }

  getOllamaPeerDeviceId(): string | undefined {
    return this.peerDeviceId
  }

  getOllamaHandshakeId(): string | undefined {
    return this.handshakeId
  }

  constructor(options?: OllamaProviderOptions) {
    const chatFromOpts = options?.chatModel?.trim() || options?.model?.trim()
    this.baseUrl = (options?.baseUrl ?? OLLAMA_BASE).replace(/\/$/, '')
    this.embedModel = options?.embedModel?.trim() || DEFAULT_EMBED_MODEL
    this.chatModel = chatFromOpts || DEFAULT_CHAT_MODEL
    this.lane = options?.lane ?? 'local'
    this.handshakeId = options?.handshakeId?.trim() || undefined
    this.peerDeviceId = options?.peerDeviceId?.trim() || undefined
  }

  private logHandshake(): string | null {
    return handshakeForLog(this.handshakeId)
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/api/embed`
    logOllamaProviderRequest({
      lane: this.lane,
      operation: 'embedding',
      baseUrl: this.baseUrl,
      model: this.embedModel,
      handshake: this.logHandshake(),
      requestUrl: url,
    })
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embedModel,
          input: text || ' ',
        }),
      })
      if (!response.ok) {
        throw new Error(`Ollama embedding failed: ${response.status} ${response.statusText}`)
      }
      const data = (await response.json()) as { embedding?: number[]; embeddings?: Array<{ embedding?: number[] }> }
      const raw = data.embedding ?? data.embeddings?.[0]?.embedding ?? data.embeddings?.[0]
      if (!Array.isArray(raw)) {
        throw new Error('Ollama embedding response missing embedding array')
      }
      return raw
    } catch (e: unknown) {
      logOllamaProviderError({
        lane: this.lane,
        operation: 'embedding',
        baseUrl: this.baseUrl,
        model: this.embedModel,
        handshake: this.logHandshake(),
        requestUrl: url,
        err: e,
      })
      throw e
    }
  }

  async generateChat(messages: Message[], options?: GenerateChatOptions): Promise<string> {
    if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ OllamaProvider.generateChat CALLED', new Date().toISOString())
    const model = options?.model ?? this.chatModel
    const stream = options?.stream ?? false
    const send = options?.send ?? (() => {})

    if (stream && send) {
      const streamUrl = `${this.baseUrl}/api/chat`
      logOllamaProviderRequest({
        lane: this.lane,
        operation: 'chat',
        baseUrl: this.baseUrl,
        model,
        handshake: this.logHandshake(),
        requestUrl: streamUrl,
      })
      const { streamOllamaChat } = await import('./llmStream')
      const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
      const userMsg = messages.find(m => m.role === 'user')?.content ?? ''
      const _pc = systemMsg.length + userMsg.length
      const _tStream = Date.now()
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        autosortDiagLog('OllamaProvider.generateChat:stream-start', { model, promptCharsApprox: _pc })
      }
      try {
        return await streamOllamaChat(model, systemMsg, userMsg, send, this.baseUrl)
      } catch (e: unknown) {
        logOllamaProviderError({
          lane: this.lane,
          operation: 'chat',
          baseUrl: this.baseUrl,
          model,
          handshake: this.logHandshake(),
          requestUrl: streamUrl,
          err: e,
        })
        throw e
      } finally {
        if (DEBUG_AUTOSORT_DIAGNOSTICS) {
          autosortDiagLog('OllamaProvider.generateChat:stream-end', {
            model,
            durationMs: Date.now() - _tStream,
            outcome: 'stream_completed_or_threw',
            promptCharsApprox: _pc,
          })
        }
      }
    }

    const chatUrl = `${this.baseUrl}/api/chat`
    logOllamaProviderRequest({
      lane: this.lane,
      operation: 'chat',
      baseUrl: this.baseUrl,
      model,
      handshake: this.logHandshake(),
      requestUrl: chatUrl,
    })
    const _t0 = Date.now()
    const _promptChars = messages.reduce((s, m) => s + m.content.length, 0)
    let outcome: 'completed' | 'http_error' | 'aborted' | 'error' = 'completed'
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      autosortDiagLog('OllamaProvider.generateChat:fetch-start', {
        model,
        promptCharsApprox: _promptChars,
        hasAbortSignal: !!options?.signal,
      })
    }
    const trace = options?.runtimeTrace
    const inFlightBeforeThisRequest = ollamaRuntimeGetInFlight()
    const inflightAfterStart = ollamaRuntimeInFlightDelta(1)
    const tStartIso = new Date().toISOString()
    if (DEBUG_OLLAMA_RUNTIME_TRACE) {
      ollamaRuntimeLog('OllamaProvider.generateChat:start', {
        tStart: tStartIso,
        model,
        providerId: this.id,
        baseUrl: this.baseUrl,
        inFlightAtRequestStart: inFlightBeforeThisRequest,
        inFlightAfterThisStarts: inflightAfterStart,
        promptCharsApprox: _promptChars,
        hasAbortSignal: !!options?.signal,
        bulkAutosort: trace?.source === 'bulk_autosort',
        runId: trace?.runId ?? null,
        chunkIndex: trace?.chunkIndex ?? null,
        batchIndex: trace?.batchIndex ?? null,
      })
    }
    try {
      const res = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options?.signal,
        body: JSON.stringify({
          model,
          stream: false,
          keep_alive: options?.ollamaKeepAlive ?? '2m',
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          ...(options?.responseFormat ? { format: options.responseFormat } : {}),
          ...(options?.temperature !== undefined
            ? { options: { temperature: options.temperature } }
            : {}),
        }),
      })
      if (!res.ok) {
        outcome = 'http_error'
        throw new Error(`Ollama ${res.status}: ${res.statusText}`)
      }
      const data = (await res.json()) as {
        message?: { content?: string }
        model?: string
        total_duration?: number
        load_duration?: number
        prompt_eval_count?: number
        eval_count?: number
      }
      const wallMs = Date.now() - _t0
      const inflightBeforeDec = ollamaRuntimeGetInFlight()
      if (DEBUG_OLLAMA_RUNTIME_TRACE) {
        ollamaRuntimeLog('OllamaProvider.generateChat:done', {
          outcome: 'ok',
          tStart: tStartIso,
          tEnd: new Date().toISOString(),
          model,
          responseModel: data.model,
          wallMs,
          /** Still includes this request; see `inFlightAfterThisCompletes` on :flightEnd. */
          inFlightBeforeDecode: inflightBeforeDec,
          /** Ollama server time vs client wall clock (queue/wait ≈ wallMs − totalDurationMs when both defined). */
          ollamaTotalDurationMs: nsToMs(data.total_duration),
          ollamaLoadDurationMs: nsToMs(data.load_duration),
          promptEvalCount: data.prompt_eval_count,
          evalCount: data.eval_count,
          bulkAutosort: trace?.source === 'bulk_autosort',
          runId: trace?.runId ?? null,
          chunkIndex: trace?.chunkIndex ?? null,
          batchIndex: trace?.batchIndex ?? null,
        })
      }
      if (DEBUG_AI_DIAGNOSTICS) {
        console.log(`[LLM] ${model}: ${wallMs}ms, ~${_promptChars}ch prompt`)
      }
      ollamaRuntimeRecordChatTiming(wallMs, data.total_duration, data.load_duration)
      return data.message?.content ?? 'No response from model.'
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as Error).name) : ''
      const fetchAborted = name === 'AbortError'
      if (DEBUG_OLLAMA_RUNTIME_TRACE) {
        ollamaRuntimeLog('OllamaProvider.generateChat:error', {
          tStart: tStartIso,
          tEnd: new Date().toISOString(),
          model,
          durationMs: Date.now() - _t0,
          outcome: fetchAborted ? 'aborted_or_timeout' : outcome === 'http_error' ? 'http_error' : 'error',
          fetchAborted,
          /** True when `signal` aborted the client `fetch`; Ollama may still run briefly until it sees disconnect. */
          httpClientAbortPropagated: fetchAborted,
          err: e instanceof Error ? e.message : String(e),
          bulkAutosort: trace?.source === 'bulk_autosort',
          runId: trace?.runId ?? null,
          chunkIndex: trace?.chunkIndex ?? null,
          batchIndex: trace?.batchIndex ?? null,
          inFlightAtError: ollamaRuntimeGetInFlight(),
        })
      }
      if (outcome === 'completed') {
        if (name === 'AbortError') {
          outcome = 'aborted'
          if (DEBUG_AUTOSORT_DIAGNOSTICS) {
            autosortDiagLog('OllamaProvider.generateChat:fetch-aborted', { model, durationMs: Date.now() - _t0 })
          }
        } else outcome = 'error'
      }
      logOllamaProviderError({
        lane: this.lane,
        operation: 'chat',
        baseUrl: this.baseUrl,
        model,
        handshake: this.logHandshake(),
        requestUrl: chatUrl,
        err: e,
      })
      throw e
    } finally {
      ollamaRuntimeInFlightDelta(-1)
      if (DEBUG_OLLAMA_RUNTIME_TRACE) {
        ollamaRuntimeLog('OllamaProvider.generateChat:flightEnd', {
          model,
          inFlightAfterThisCompletes: ollamaRuntimeGetInFlight(),
          bulkAutosort: trace?.source === 'bulk_autosort',
          runId: trace?.runId ?? null,
          chunkIndex: trace?.chunkIndex ?? null,
          batchIndex: trace?.batchIndex ?? null,
        })
      }
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        const end = Date.now()
        autosortDiagLog('OllamaProvider.generateChat', {
          model,
          startMs: _t0,
          endMs: end,
          durationMs: end - _t0,
          outcome,
          promptCharsApprox: _promptChars,
        })
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    const url = `${this.baseUrl}/api/tags`
    logOllamaProviderRequest({
      lane: this.lane,
      operation: 'tags',
      baseUrl: this.baseUrl,
      model: '(n/a)',
      handshake: this.logHandshake(),
      requestUrl: url,
    })
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch (e: unknown) {
      logOllamaProviderError({
        lane: this.lane,
        operation: 'tags',
        baseUrl: this.baseUrl,
        model: '(n/a)',
        handshake: this.logHandshake(),
        requestUrl: url,
        err: e,
      })
      return false
    }
  }
}

// ── CloudAI Provider ────────────────────────────────────────────────────────

type CloudChatProvider = 'openai' | 'anthropic' | 'google' | 'xai'

const CLOUD_MODEL_MAP: Record<CloudChatProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-pro',
  xai: 'grok-2-1212',
}

/** Cloud embeddings use OpenAI text-embedding-3-small when OpenAI key is available. */
const OPENAI_EMBED_MODEL = 'text-embedding-3-small'

export class CloudAIProvider implements AIProvider {
  readonly id = 'cloudai'
  private getApiKey: (provider: string) => string | undefined
  private chatProvider: CloudChatProvider
  private chatModel: string

  constructor(options: {
    getApiKey: (provider: string) => string | undefined
    chatProvider?: CloudChatProvider
    chatModel?: string
  }) {
    this.getApiKey = options.getApiKey
    this.chatProvider = options.chatProvider ?? 'openai'
    this.chatModel = options.chatModel ?? CLOUD_MODEL_MAP[this.chatProvider]
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = this.getApiKey('OpenAI')
    if (!apiKey) {
      throw new Error('OpenAI API key required for cloud embeddings')
    }
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_EMBED_MODEL,
        input: text || ' ',
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI embedding failed: ${res.status} ${err}`)
    }
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
    const embedding = data.data?.[0]?.embedding
    if (!Array.isArray(embedding)) {
      throw new Error('OpenAI embedding response missing embedding array')
    }
    return embedding
  }

  async generateChat(messages: Message[], options?: GenerateChatOptions): Promise<string> {
    if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ CloudAIProvider.generateChat CALLED', new Date().toISOString())
    const model = options?.model ?? this.chatModel
    const stream = options?.stream ?? false
    const send = options?.send ?? (() => {})

    const provider = this.chatProvider
    const apiKey = this.getApiKey(
      provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Claude' : provider === 'google' ? 'Gemini' : 'Grok'
    )
    if (!apiKey) {
      throw new Error(`No API key for ${provider}`)
    }

    const signal = options?.signal
    if (provider === 'openai') {
      return this._chatOpenAI(messages, model, apiKey, stream, send, signal, options?.temperature)
    }
    if (provider === 'anthropic') {
      return this._chatAnthropic(messages, model, apiKey, stream, send, signal)
    }
    if (provider === 'google') {
      return this._chatGoogle(messages, model, apiKey, stream, send, signal)
    }
    if (provider === 'xai') {
      return this._chatXai(messages, model, apiKey, stream, send, signal)
    }
    throw new Error(`Unsupported cloud provider: ${provider}`)
  }

  private async _chatOpenAI(
    messages: Message[],
    model: string,
    apiKey: string,
    stream: boolean,
    send: StreamSender,
    signal?: AbortSignal,
    temperature?: number,
  ): Promise<string> {
    if (stream && send) {
      const { streamOpenAIChat } = await import('./llmStream')
      const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
      const userMsg = messages.find(m => m.role === 'user')?.content ?? ''
      return streamOpenAIChat(model, systemMsg, userMsg, apiKey, send)
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...(temperature !== undefined ? { temperature } : {}),
      }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? 'No response from model.'
  }

  private async _chatAnthropic(
    messages: Message[],
    model: string,
    apiKey: string,
    stream: boolean,
    send: StreamSender,
    signal?: AbortSignal,
  ): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
    const userMsg = messages.find(m => m.role === 'user')?.content ?? ''

    if (stream && send) {
      const { streamAnthropicChat } = await import('./llmStream')
      return streamAnthropicChat(model, systemMsg, userMsg, apiKey, send)
    }
    const combined = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: combined }],
      }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? 'No response from model.'
  }

  private async _chatGoogle(
    messages: Message[],
    model: string,
    apiKey: string,
    stream: boolean,
    send: StreamSender,
    signal?: AbortSignal,
  ): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
    const userMsg = messages.find(m => m.role === 'user')?.content ?? ''

    if (stream && send) {
      const { streamGoogleChat } = await import('./llmStream')
      return streamGoogleChat(model, systemMsg, userMsg, apiKey, send)
    }
    const combined = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: combined }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
        ...(signal ? { signal } : {}),
      }
    )
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from model.'
  }

  private async _chatXai(
    messages: Message[],
    model: string,
    apiKey: string,
    stream: boolean,
    send: StreamSender,
    signal?: AbortSignal,
  ): Promise<string> {
    if (stream && send) {
      const { streamXaiChat } = await import('./llmStream')
      const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
      const userMsg = messages.find(m => m.role === 'user')?.content ?? ''
      return streamXaiChat(model, systemMsg, userMsg, apiKey, send)
    }
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: messages.map(m => ({ role: m.role, content: m.content })) }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) throw new Error(`xAI ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? 'No response from model.'
  }

  /** Check if embeddings are available (OpenAI key present). */
  hasEmbeddingSupport(): boolean {
    return !!this.getApiKey('OpenAI')
  }
}

// ── Provider Factory ────────────────────────────────────────────────────────

export interface UserRagSettings {
  provider: string
  model?: string
  /** For cloud: which sub-provider (openai, anthropic, google, xai). Defaults from provider. */
  chatProvider?: string
}

function ollamaOptionsFromUserAndDisk(settings: UserRagSettings): OllamaProviderOptions {
  const cm = settings.model?.trim()
  const base: OllamaProviderOptions = {
    ...(cm ? { chatModel: cm, model: cm } : {}),
    lane: 'local',
  }
  if (!isSandboxMode()) {
    return base
  }
  const stored = readStoredAiExecutionContext()
  if (!stored || stored.lane !== 'ollama_direct' || !stored.handshakeId?.trim()) {
    return base
  }
  let bUrl = stored.baseUrl?.trim().replace(/\/$/, '')
  if (!bUrl) {
    const cand = getSandboxOllamaDirectRouteCandidate(stored.handshakeId.trim())
    bUrl = cand?.base_url?.trim().replace(/\/$/, '') ?? ''
  }
  if (!bUrl) {
    return base
  }
  return {
    ...base,
    baseUrl: bUrl,
    lane: 'ollama_direct',
    handshakeId: stored.handshakeId,
    peerDeviceId: stored.peerDeviceId,
  }
}

export function getProvider(settings: UserRagSettings, getApiKey?: (p: string) => string | undefined): AIProvider {
  const providerLower = (settings.provider ?? 'ollama').toLowerCase()

  if (providerLower === 'ollama') {
    return new OllamaProvider(ollamaOptionsFromUserAndDisk(settings))
  }

  const cloudProviders = ['openai', 'anthropic', 'google', 'xai', 'cloudai']
  if (cloudProviders.includes(providerLower)) {
    const chatProvider: CloudChatProvider =
      providerLower === 'cloudai'
        ? (settings.chatProvider as CloudChatProvider) ?? 'openai'
        : providerLower as CloudChatProvider
    const getKey = getApiKey ?? (() => undefined)
    return new CloudAIProvider({
      getApiKey: getKey,
      chatProvider: ['openai', 'anthropic', 'google', 'xai'].includes(chatProvider) ? chatProvider : 'openai',
      chatModel: settings.model,
    })
  }

  return new OllamaProvider(ollamaOptionsFromUserAndDisk(settings))
}

// ── Adapter for existing embedding consumers ─────────────────────────────────

/** Adapt AIProvider to LocalEmbeddingService for semantic search. */
export function toEmbeddingService(provider: AIProvider): LocalEmbeddingService {
  return {
    modelId: provider.id,
    async generateEmbedding(text: string): Promise<Float32Array> {
      const arr = await provider.generateEmbedding(text)
      return new Float32Array(arr)
    },
  }
}
