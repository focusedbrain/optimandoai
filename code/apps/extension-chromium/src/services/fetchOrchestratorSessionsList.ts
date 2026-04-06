/**
 * WR Chat session history from the orchestrator DB (same source as project linking).
 * GET /api/orchestrator/sessions on WR Desk HTTP (127.0.0.1:51248).
 */

import { ensureLaunchSecretForElectronHttp, fetchWithElectronHttpReady } from './ensureLaunchSecretForElectronHttp'

const BASE_URL = 'http://127.0.0.1:51248'

export type OrchestratorSessionListEntry = {
  id: string
  name: string
}

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | null) => {
        if (chrome.runtime.lastError) {
          resolve(null)
        } else {
          resolve(resp?.secret?.trim() ? resp.secret : null)
        }
      })
    } catch {
      resolve(null)
    }
  })
}

function buildHeaders(secret: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' }
}

/**
 * Returns sessions from orchestrator history, sorted by name. [] if unreachable.
 */
export async function fetchOrchestratorSessionsForWizard(): Promise<OrchestratorSessionListEntry[]> {
  try {
    await ensureLaunchSecretForElectronHttp()
    const secret = await getLaunchSecret()
    const res = await fetchWithElectronHttpReady(() =>
      fetch(`${BASE_URL}/api/orchestrator/sessions`, {
        method: 'GET',
        headers: buildHeaders(secret),
        signal: AbortSignal.timeout(20_000),
      }),
    )
    if (!res.ok) return []
    const body: unknown = await res.json().catch(() => null)
    if (!body || typeof body !== 'object') return []
    const o = body as Record<string, unknown>
    const raw = o.data ?? o
    const list = Array.isArray(raw) ? raw : Array.isArray(o.data) ? o.data : []
    const out: OrchestratorSessionListEntry[] = []
    for (const row of list) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id.trim() : ''
      if (!id) continue
      const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id
      out.push({ id, name })
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return out
  } catch {
    return []
  }
}
