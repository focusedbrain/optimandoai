/**
 * Shared Ollama HTTP origin list (Electron often lacks PATH for CLI; probes must use URLs).
 */

export function collectOllamaHttpBasesFromEnv(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (u: string) => {
    const t = u.replace(/\/$/, '')
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  const raw = (process.env.OLLAMA_HOST ?? '').trim()
  if (raw) {
    try {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const u = new URL(raw)
        if (u.hostname === '0.0.0.0') {
          u.hostname = '127.0.0.1'
        }
        push(u.origin)
      } else {
        const colon = raw.lastIndexOf(':')
        let hostPart = colon > 0 ? raw.slice(0, colon) : raw
        const portPart = colon > 0 ? raw.slice(colon + 1) : '11434'
        if (hostPart === '0.0.0.0') {
          hostPart = '127.0.0.1'
        }
        push(`http://${hostPart}:${portPart}`)
      }
    } catch {
      /* malformed OLLAMA_HOST */
    }
  }
  push('http://127.0.0.1:11434')
  push('http://localhost:11434')
  return out
}
