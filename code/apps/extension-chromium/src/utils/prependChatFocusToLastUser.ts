/** Prepends hidden context to the last user message in an LLM message array (does not alter UI chat bubbles). */
export function prependHiddenContextToLastUserContent<T extends { role: string; content?: string }>(
  messages: T[],
  prefix: string,
): T[] {
  const out = messages.map((m) => ({ ...m }))
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      const c = out[i].content ?? ''
      out[i] = { ...out[i], content: `${prefix}\n\n${c}` }
      break
    }
  }
  return out
}
