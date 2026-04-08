/**
 * WR Chat session history for the Add Mode wizard.
 * Uses the same source as the sidepanel: GET_ALL_SESSIONS_FROM_SQLITE (orchestrator KV + Chrome fallback).
 * In Electron (dashboard), falls back to HTTP when `chrome.runtime.sendMessage` is not available yet.
 */

export type OrchestratorSessionListEntry = {
  id: string
  name: string
}

const ORCH_HTTP = 'http://127.0.0.1:51248'

async function fetchOrchestratorSessionsForWizardViaHttp(): Promise<OrchestratorSessionListEntry[]> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    try {
      const fn = (globalThis as unknown as { handshakeView?: { pqHeaders?: () => Promise<Record<string, string>> } })
        .handshakeView?.pqHeaders
      if (typeof fn === 'function') {
        const h = await fn()
        if (h && typeof h === 'object') {
          for (const [k, v] of Object.entries(h)) {
            if (typeof v === 'string') headers[k] = v
          }
        }
      }
    } catch {
      /* still try unauthenticated fetch */
    }
    const r = await fetch(`${ORCH_HTTP}/api/orchestrator/get-all`, { headers })
    if (!r.ok) return []
    const result = (await r.json()) as { data?: Record<string, unknown> }
    const allData = result.data || {}
    const out: OrchestratorSessionListEntry[] = []
    for (const [key, value] of Object.entries(allData)) {
      if (!key.startsWith('session_') && !key.startsWith('archive_session_')) continue
      out.push({ id: key, name: displayNameForSessionKey(key, value) })
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return out
  } catch {
    return []
  }
}

function displayNameForSessionKey(key: string, data: unknown): string {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const alias =
    typeof d.sessionAlias === 'string' && d.sessionAlias.trim() !== ''
      ? d.sessionAlias.trim()
      : null
  const internal =
    typeof d.tabName === 'string' && d.tabName.trim()
      ? d.tabName.trim()
      : typeof d.sessionName === 'string' && d.sessionName.trim()
        ? d.sessionName.trim()
        : typeof d.name === 'string' && d.name.trim()
          ? d.name.trim()
          : key
  const base = alias ?? internal
  return key.startsWith('archive_session_') ? `Archived: ${base}` : base
}

/**
 * Returns sessions from the same store as WR Chat session pickers (SQLite via host + Chrome mirror).
 * Sorted by display name.
 */
export async function fetchOrchestratorSessionsForWizard(): Promise<OrchestratorSessionListEntry[]> {
  const rt = typeof chrome !== 'undefined' ? chrome.runtime : undefined
  if (!rt?.sendMessage) {
    return fetchOrchestratorSessionsForWizardViaHttp()
  }
  try {
    return await new Promise((resolve) => {
      try {
        rt.sendMessage(
          { type: 'GET_ALL_SESSIONS_FROM_SQLITE' },
          (response: { success?: boolean; sessions?: Record<string, unknown> } | undefined) => {
            if (chrome.runtime.lastError) {
              console.warn('[fetchOrchestratorSessionsForWizard]', chrome.runtime.lastError.message)
              void fetchOrchestratorSessionsForWizardViaHttp().then(resolve)
              return
            }
            if (!response?.success || !response.sessions || typeof response.sessions !== 'object') {
              void fetchOrchestratorSessionsForWizardViaHttp().then(resolve)
              return
            }
            const out: OrchestratorSessionListEntry[] = []
            for (const [key, value] of Object.entries(response.sessions)) {
              if (!key.startsWith('session_') && !key.startsWith('archive_session_')) continue
              out.push({ id: key, name: displayNameForSessionKey(key, value) })
            }
            out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            resolve(out)
          },
        )
      } catch (e) {
        console.warn('[fetchOrchestratorSessionsForWizard]', e)
        void fetchOrchestratorSessionsForWizardViaHttp().then(resolve)
      }
    })
  } catch {
    return fetchOrchestratorSessionsForWizardViaHttp()
  }
}
