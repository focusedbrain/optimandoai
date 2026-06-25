/**
 * Orchestrator session JSON via HTTP GET (same bridge as dashboard optimization).
 */

import { ensureLaunchSecretForElectronHttp } from './ensureLaunchSecretForElectronHttp'

export type OrchestratorSessionJson = Record<string, unknown>

export type FetchOrchestratorSessionResult =
  | { ok: true; data: OrchestratorSessionJson }
  | { ok: false; message: string }

const ORCH_HTTP = 'http://127.0.0.1:51248'

async function orchestratorGetHeaders(): Promise<Record<string, string>> {
  await ensureLaunchSecretForElectronHttp()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const secret = await new Promise<string>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string | null } | undefined) => {
          if (chrome.runtime.lastError) {
            resolve('')
            return
          }
          resolve(resp?.secret?.trim() ?? '')
        })
      })
      if (secret) headers['X-Launch-Secret'] = secret
    }
  } catch {
    /* fall through */
  }
  try {
    const fn = (globalThis as unknown as { handshakeView?: { pqHeaders?: () => Promise<Record<string, string>> } })
      .handshakeView?.pqHeaders
    if (typeof fn === 'function') {
      const h = await fn()
      if (h && typeof h === 'object') {
        for (const [k, v] of Object.entries(h)) {
          if (typeof v === 'string' && v.trim()) headers[k] = v
        }
      }
    }
  } catch {
    /* noop */
  }
  return headers
}

export async function fetchOrchestratorSession(sessionKey: string): Promise<FetchOrchestratorSessionResult> {
  const sk = sessionKey.trim()
  if (!sk) {
    return { ok: false, message: 'No session key' }
  }
  const headers = await orchestratorGetHeaders()
  try {
    const r = await fetch(`${ORCH_HTTP}/api/orchestrator/get?key=${encodeURIComponent(sk)}`, { headers })
    if (!r.ok) {
      return {
        ok: false,
        message: `Orchestrator GET failed (${r.status} ${r.statusText}) for session key "${sk}"`,
      }
    }
    const body = (await r.json()) as {
      success?: boolean
      data?: OrchestratorSessionJson
      error?: string
    }
    if (body.success === false) {
      return {
        ok: false,
        message: `Orchestrator GET rejected for "${sk}": ${body.error ?? 'unknown error'}`,
      }
    }
    const data = body?.data ?? null
    if (!data) {
      return { ok: false, message: `Orchestrator returned no session data for key "${sk}"` }
    }
    return { ok: true, data }
  } catch (e) {
    const hint = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `Orchestrator GET network error for key "${sk}": ${hint}` }
  }
}
