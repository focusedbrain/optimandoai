/**
 * build038 — shared extraction of assistant text from llama-server (OpenAI-compatible)
 * chat responses.
 *
 * With `--jinja` + reasoning enabled, llama-server separates thinking into
 * `message.reasoning_content`; depending on template/budget interplay the final answer can
 * arrive with an empty `content` while the useful text sits in `reasoning_content`.
 * Every consumer must go through this helper so:
 *  1. `reasoning_content` is used as a fallback when `content` is empty, and
 *  2. a truly empty response is reported as empty (callers decide to throw) instead of
 *     being silently coerced to a placeholder like "No response from model." that then
 *     fails downstream JSON parsing in confusing ways.
 */

export type LlamaChatMessageLike = {
  content?: unknown
  reasoning_content?: unknown
}

export type ExtractedLlamaChatContent = {
  /** Best-effort assistant text ('' when the model produced nothing usable). */
  content: string
  /** True when `content` was empty and `reasoning_content` was used instead. */
  usedReasoningFallback: boolean
  /** True when both fields were empty/absent — callers should treat as an LLM error. */
  empty: boolean
}

export function extractLlamaChatContent(
  message: LlamaChatMessageLike | null | undefined,
): ExtractedLlamaChatContent {
  const content = typeof message?.content === 'string' ? message.content : ''
  if (content.trim().length > 0) {
    return { content, usedReasoningFallback: false, empty: false }
  }
  const reasoning = typeof message?.reasoning_content === 'string' ? message.reasoning_content : ''
  if (reasoning.trim().length > 0) {
    return { content: reasoning, usedReasoningFallback: true, empty: false }
  }
  return { content: '', usedReasoningFallback: false, empty: true }
}

/** Standard error message for an empty model response (kept in one place for tests/UI). */
export const EMPTY_LLM_RESPONSE_ERROR =
  'The local model returned an empty response — retry, or switch Response style to "Fast & direct" in Backend Configuration.'
