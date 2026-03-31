/**
 * AI Provider Abstraction for RAG Pipeline
 *
 * Supports multiple providers for both embeddings and chat.
 * User selects provider (Ollama or CloudAI); both embedding and chat route to that provider.
 */

import type { LocalEmbeddingService } from './embeddings'

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

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama'
  private baseUrl: string
  private embedModel: string
  private chatModel: string

  constructor(options?: { baseUrl?: string; embedModel?: string; chatModel?: string }) {
    this.baseUrl = options?.baseUrl ?? OLLAMA_BASE
    this.embedModel = options?.embedModel ?? DEFAULT_EMBED_MODEL
    this.chatModel = options?.chatModel ?? DEFAULT_CHAT_MODEL
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/api/embed`
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
  }

  async generateChat(messages: Message[], options?: GenerateChatOptions): Promise<string> {
    if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ OllamaProvider.generateChat CALLED', new Date().toISOString())
    const model = options?.model ?? this.chatModel
    const stream = options?.stream ?? false
    const send = options?.send ?? (() => {})

    if (stream && send) {
      const { streamOllamaChat } = await import('./llmStream')
      const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
      const userMsg = messages.find(m => m.role === 'user')?.content ?? ''
      return streamOllamaChat(model, systemMsg, userMsg, send)
    }

    const _t0 = Date.now()
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '2m',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`)
    const data = await res.json()
    // Always log inference latency — one line per call, essential for diagnosing slowdowns.
    const _promptChars = messages.reduce((s, m) => s + m.content.length, 0)
    console.log(`[LLM] ${model}: ${Date.now() - _t0}ms, ~${_promptChars}ch prompt`)
    return data.message?.content ?? 'No response from model.'
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
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

    if (provider === 'openai') {
      return this._chatOpenAI(messages, model, apiKey, stream, send)
    }
    if (provider === 'anthropic') {
      return this._chatAnthropic(messages, model, apiKey, stream, send)
    }
    if (provider === 'google') {
      return this._chatGoogle(messages, model, apiKey, stream, send)
    }
    if (provider === 'xai') {
      return this._chatXai(messages, model, apiKey, stream, send)
    }
    throw new Error(`Unsupported cloud provider: ${provider}`)
  }

  private async _chatOpenAI(
    messages: Message[],
    model: string,
    apiKey: string,
    stream: boolean,
    send: StreamSender
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
      body: JSON.stringify({ model, messages: messages.map(m => ({ role: m.role, content: m.content })) }),
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
    send: StreamSender
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
    send: StreamSender
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
    send: StreamSender
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

export function getProvider(settings: UserRagSettings, getApiKey?: (p: string) => string | undefined): AIProvider {
  const providerLower = (settings.provider ?? 'ollama').toLowerCase()

  if (providerLower === 'ollama') {
    return new OllamaProvider({ chatModel: settings.model })
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

  return new OllamaProvider({ chatModel: settings.model })
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
