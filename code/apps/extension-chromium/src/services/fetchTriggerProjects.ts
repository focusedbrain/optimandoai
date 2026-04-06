import type { TriggerProjectEntry } from '../types/triggerTypes'
import { ensureLaunchSecretForElectronHttp, fetchWithElectronHttpReady } from './ensureLaunchSecretForElectronHttp'

const BASE_URL = 'http://127.0.0.1:51248'

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | null) => {
        if (chrome.runtime.lastError) {
          resolveElectronFallback(resolve)
        } else {
          const s = resp?.secret?.trim() ? resp.secret : null
          if (s) resolve(s)
          else resolveElectronFallback(resolve)
        }
      })
    } catch {
      resolveElectronFallback(resolve)
    }
  })
}

function resolveElectronFallback(resolve: (v: string | null) => void): void {
  try {
    const pqHeaders = (window as unknown as { handshakeView?: { pqHeaders?: () => Promise<Record<string, string>> } })
      .handshakeView?.pqHeaders
    if (typeof pqHeaders === 'function') {
      void pqHeaders()
        .then((h) => resolve(h?.['X-Launch-Secret']?.trim() || null))
        .catch(() => resolve(null))
    } else {
      resolve(null)
    }
  } catch {
    resolve(null)
  }
}

function buildHeaders(secret: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' }
}

/**
 * Fetches icon-allocated projects for the multi-trigger bar (Electron → extension).
 * Returns [] on any failure (no throw).
 */
export async function fetchTriggerProjects(): Promise<TriggerProjectEntry[]> {
  try {
    await ensureLaunchSecretForElectronHttp()
    const secret = await getLaunchSecret()
    const res = await fetchWithElectronHttpReady(() =>
      fetch(`${BASE_URL}/api/projects/trigger-list`, {
        method: 'GET',
        headers: buildHeaders(secret),
        signal: AbortSignal.timeout(15_000),
      }),
    )
    if (!res.ok) return []
    const data: unknown = await res.json().catch(() => null)
    if (!Array.isArray(data)) return []
    const out: TriggerProjectEntry[] = []
    for (const row of data) {
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      const projectId = typeof o.projectId === 'string' ? o.projectId : ''
      const title = typeof o.title === 'string' ? o.title : ''
      const icon = typeof o.icon === 'string' ? o.icon : ''
      if (!projectId.trim() || !icon.trim()) continue
      const entry: TriggerProjectEntry = {
        projectId: projectId.trim(),
        title: title.trim() || 'Untitled project',
        icon: icon.trim(),
      }
      if (typeof o.activeMilestoneTitle === 'string' && o.activeMilestoneTitle.trim()) {
        entry.activeMilestoneTitle = o.activeMilestoneTitle.trim()
      }
      if (Array.isArray(o.linkedSessionIds)) {
        const linked = o.linkedSessionIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        if (linked.length) entry.linkedSessionIds = linked
      }
      out.push(entry)
    }
    return out
  } catch {
    return []
  }
}
