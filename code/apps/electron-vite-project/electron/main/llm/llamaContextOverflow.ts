/**
 * build039 — llama-server context-overflow errors from HTTP / send_error bodies.
 */

const OVERFLOW_RE =
  /request\s*\((\d+)\s*tokens?\)\s*exceeds\s*the\s*available\s*context\s*size\s*\((\d+)\s*tokens?\)/i

export class LlamaContextOverflowError extends Error {
  readonly promptTokens: number | undefined
  readonly slotLimit: number | undefined

  constructor(message: string, promptTokens?: number, slotLimit?: number) {
    super(message)
    this.name = 'LlamaContextOverflowError'
    this.promptTokens = promptTokens
    this.slotLimit = slotLimit
  }
}

export function parseLlamaContextOverflowFromBody(body: string): LlamaContextOverflowError | null {
  const text = body.trim()
  if (!text) return null
  const m = text.match(OVERFLOW_RE)
  if (m) {
    return new LlamaContextOverflowError(
      m[0],
      parseInt(m[1], 10),
      parseInt(m[2], 10),
    )
  }
  if (/exceeds the available context size/i.test(text)) {
    return new LlamaContextOverflowError(text)
  }
  return null
}

export function isLlamaContextOverflowError(err: unknown): err is LlamaContextOverflowError {
  if (err instanceof LlamaContextOverflowError) return true
  if (err instanceof Error && OVERFLOW_RE.test(err.message)) return true
  if (err instanceof Error && /exceeds the available context size/i.test(err.message)) return true
  return false
}

export function contextOverflowDetails(err: unknown): { promptTokens?: number; slotLimit?: number } {
  if (err instanceof LlamaContextOverflowError) {
    return { promptTokens: err.promptTokens, slotLimit: err.slotLimit }
  }
  if (err instanceof Error) {
    const m = err.message.match(OVERFLOW_RE)
    if (m) {
      return { promptTokens: parseInt(m[1], 10), slotLimit: parseInt(m[2], 10) }
    }
  }
  return {}
}
