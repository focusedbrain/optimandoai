/**
 * LLM Streaming — Server-side token streaming for chat responses.
 * Supports Ollama (NDJSON), OpenAI (SSE), xAI (SSE), Anthropic (SSE), Google (SSE).
 */

import {
  DEBUG_OLLAMA_RUNTIME_TRACE,
  ollamaRuntimeGetInFlight,
  ollamaRuntimeInFlightDelta,
  ollamaRuntimeLog,
} from '../llm/ollamaRuntimeDiagnostics'

export type StreamSender = (channel: string, payload: unknown) => void
export type OnToken = (token: string) => void

/** Stream tokens from Ollama chat API (NDJSON). */
export async function streamOllamaChat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  send: StreamSender,
): Promise<string> {
  const t0 = Date.now()
  const inflightStart = ollamaRuntimeInFlightDelta(1)
  if (DEBUG_OLLAMA_RUNTIME_TRACE) {
    ollamaRuntimeLog('streamOllamaChat:start', { model, inFlight: inflightStart })
  }
  try {
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3',
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`)
    if (!res.body) throw new Error('Ollama response has no body')

    let full = ''
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed) as { message?: { content?: string }; response?: string; done?: boolean }
          const delta = obj.message?.content ?? obj.response ?? ''
          if (delta) {
            full += delta
            send('handshake:chatStreamToken', { token: delta })
          }
        } catch (parseErr) {
          console.warn('Invalid NDJSON line skipped:', line)
        }
      }
    }
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer.trim()) as { message?: { content?: string }; response?: string }
        const delta = obj.message?.content ?? obj.response ?? ''
        if (delta) {
          full += delta
          send('handshake:chatStreamToken', { token: delta })
        }
      } catch (parseErr) {
        console.warn('Invalid NDJSON line skipped:', buffer.trim())
      }
    }
    if (DEBUG_OLLAMA_RUNTIME_TRACE) {
      ollamaRuntimeLog('streamOllamaChat:done', {
        model,
        wallMs: Date.now() - t0,
        inFlight: ollamaRuntimeGetInFlight(),
        promptCharsApprox: systemPrompt.length + userPrompt.length,
      })
    }
    return full || 'No response from model.'
  } catch (streamErr: any) {
    if (DEBUG_OLLAMA_RUNTIME_TRACE) {
      ollamaRuntimeLog('streamOllamaChat:error', {
        model,
        wallMs: Date.now() - t0,
        err: streamErr instanceof Error ? streamErr.message : String(streamErr),
      })
    }
    console.error('Streaming error:', streamErr)
    throw new Error('ollama_stream_failed')
  } finally {
    ollamaRuntimeInFlightDelta(-1)
  }
}

/** Stream tokens from OpenAI chat completions (SSE). */
export async function streamOpenAIChat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  send: StreamSender,
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  if (!res.body) throw new Error('OpenAI response has no body')

  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const obj = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
          const delta = obj.choices?.[0]?.delta?.content ?? ''
          if (delta) {
            full += delta
            send('handshake:chatStreamToken', { token: delta })
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  return full || 'No response from model.'
}

/** Stream tokens from xAI chat completions (SSE, same format as OpenAI). */
export async function streamXaiChat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  send: StreamSender,
): Promise<string> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'grok-2-1212',
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  if (!res.ok) throw new Error(`xAI ${res.status}: ${await res.text()}`)
  if (!res.body) throw new Error('xAI response has no body')

  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const obj = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
          const delta = obj.choices?.[0]?.delta?.content ?? ''
          if (delta) {
            full += delta
            send('handshake:chatStreamToken', { token: delta })
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  return full || 'No response from model.'
}

/** Stream tokens from Anthropic Messages API (SSE, content_block_delta with text_delta). */
export async function streamAnthropicChat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  send: StreamSender,
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      stream: true,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  if (!res.body) throw new Error('Anthropic response has no body')

  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue
        try {
          const obj = JSON.parse(data) as {
            type?: string
            delta?: { type?: string; text?: string }
          }
          if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && obj.delta.text) {
            full += obj.delta.text
            send('handshake:chatStreamToken', { token: obj.delta.text })
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  }
  if (buffer.trim() && buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim()
    if (data && data !== '[DONE]') {
      try {
        const obj = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } }
        if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && obj.delta.text) {
          full += obj.delta.text
          send('handshake:chatStreamToken', { token: obj.delta.text })
        }
      } catch {
        /* skip */
      }
    }
  }
  return full || 'No response from model.'
}

/** Stream tokens from Google Gemini streamGenerateContent (SSE). */
export async function streamGoogleChat(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  send: StreamSender,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-pro'}:streamGenerateContent?alt=sse&key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      generationConfig: { maxOutputTokens: 1024 },
    }),
  })
  if (!res.ok) throw new Error(`Google ${res.status}: ${await res.text()}`)
  if (!res.body) throw new Error('Google response has no body')

  let full = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (!data) continue
        try {
          const obj = JSON.parse(data) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
          }
          const text = obj.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          if (text) {
            full += text
            send('handshake:chatStreamToken', { token: text })
          }
        } catch {
          /* skip malformed */
        }
      }
    }
  }
  if (buffer.trim() && buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim()
    if (data) {
      try {
        const obj = JSON.parse(data) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }
        const text = obj.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (text) {
          full += text
          send('handshake:chatStreamToken', { token: text })
        }
      } catch {
        /* skip */
      }
    }
  }
  return full || 'No response from model.'
}

// ── Unified streaming interface ─────────────────────────────────────────────

export type LLMProvider = 'ollama' | 'openai' | 'anthropic' | 'google' | 'xai'

export interface StreamLLMParams {
  model: string
  systemPrompt: string
  userPrompt: string
  apiKey?: string
}

/**
 * Unified streaming interface. Streams tokens to the UI via onToken.
 * Returns the full accumulated response.
 */
export async function streamLLMResponse(
  provider: LLMProvider,
  params: StreamLLMParams,
  onToken: OnToken,
): Promise<string> {
  const send: StreamSender = (ch, payload) => {
    if (ch === 'handshake:chatStreamToken' && payload && typeof payload === 'object' && 'token' in payload) {
      const t = (payload as { token: string }).token
      if (t) onToken(t)
    }
  }

  switch (provider) {
    case 'ollama':
      return streamOllamaChat(params.model, params.systemPrompt, params.userPrompt, send)
    case 'openai':
      if (!params.apiKey) throw new Error('OpenAI requires apiKey')
      return streamOpenAIChat(params.model, params.systemPrompt, params.userPrompt, params.apiKey, send)
    case 'xai':
      if (!params.apiKey) throw new Error('xAI requires apiKey')
      return streamXaiChat(params.model, params.systemPrompt, params.userPrompt, params.apiKey, send)
    case 'anthropic':
      if (!params.apiKey) throw new Error('Anthropic requires apiKey')
      return streamAnthropicChat(params.model, params.systemPrompt, params.userPrompt, params.apiKey, send)
    case 'google':
      if (!params.apiKey) throw new Error('Google requires apiKey')
      return streamGoogleChat(params.model, params.systemPrompt, params.userPrompt, params.apiKey, send)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}
