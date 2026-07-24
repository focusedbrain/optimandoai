export type OpenAiChatCompletionsSseParseResult =
  | { kind: 'delta'; content: string }
  | { kind: 'done' }
  | null

/** Parse one OpenAI chat-completions SSE line (`data: …` framing). */
export function parseOpenAiChatCompletionsSseLine(line: string): OpenAiChatCompletionsSseParseResult {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return { kind: 'done' }
  try {
    const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
    const delta = obj.choices?.[0]?.delta?.content ?? ''
    return delta ? { kind: 'delta', content: delta } : null
  } catch {
    return null
  }
}
