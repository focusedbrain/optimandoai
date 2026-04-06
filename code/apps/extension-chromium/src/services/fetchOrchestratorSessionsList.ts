/**
 * WR Chat session history for the Add Mode wizard.
 * Uses the same source as the sidepanel: GET_ALL_SESSIONS_FROM_SQLITE (orchestrator KV + Chrome fallback).
 */

export type OrchestratorSessionListEntry = {
  id: string
  name: string
}

function displayNameForSessionKey(key: string, data: unknown): string {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const base =
    typeof d.sessionName === 'string' && d.sessionName.trim()
      ? d.sessionName.trim()
      : typeof d.name === 'string' && d.name.trim()
        ? d.name.trim()
        : typeof d.tabName === 'string' && d.tabName.trim()
          ? d.tabName.trim()
          : key
  return key.startsWith('archive_session_') ? `Archived: ${base}` : base
}

/**
 * Returns sessions from the same store as WR Chat session pickers (SQLite via host + Chrome mirror).
 * Sorted by display name.
 */
export async function fetchOrchestratorSessionsForWizard(): Promise<OrchestratorSessionListEntry[]> {
  try {
    return await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'GET_ALL_SESSIONS_FROM_SQLITE' },
          (response: { success?: boolean; sessions?: Record<string, unknown> } | undefined) => {
            if (chrome.runtime.lastError) {
              console.warn('[fetchOrchestratorSessionsForWizard]', chrome.runtime.lastError.message)
              resolve([])
              return
            }
            if (!response?.success || !response.sessions || typeof response.sessions !== 'object') {
              resolve([])
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
        resolve([])
      }
    })
  } catch {
    return []
  }
}
