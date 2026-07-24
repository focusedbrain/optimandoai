/**
 * Shared llama-server HTTP origin list (loopback only; Electron often lacks PATH for CLI).
 */

import { DEFAULT_LLAMACPP_PORT, HOST_AI_DEFAULT_LOCAL_LLAMACPP_BASE } from './localLlmPaths'

export function collectLlamacppHttpBasesFromEnv(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (u: string) => {
    const t = u.replace(/\/$/, '')
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  const raw = (process.env.LLAMACPP_HOST ?? process.env.LLAMACPP_SERVER_URL ?? '').trim()
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
        const portPart = colon > 0 ? raw.slice(colon + 1) : String(DEFAULT_LLAMACPP_PORT)
        if (hostPart === '0.0.0.0') {
          hostPart = '127.0.0.1'
        }
        push(`http://${hostPart}:${portPart}`)
      }
    } catch {
      /* malformed LLAMACPP_HOST */
    }
  }
  push(HOST_AI_DEFAULT_LOCAL_LLAMACPP_BASE)
  push(`http://localhost:${DEFAULT_LLAMACPP_PORT}`)
  return out
}
