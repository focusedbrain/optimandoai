/**
 * WR Chat session history for the Add Mode wizard (merged sessions table + session_* KV).
 * Proxied through the service worker so X-Launch-Secret matches other orchestrator calls.
 */

export type OrchestratorSessionListEntry = {
  id: string
  name: string
}

type WizardSessionsResponse = {
  ok?: boolean
  sessions?: OrchestratorSessionListEntry[]
  error?: string
}

/**
 * Returns sessions from orchestrator history, sorted by name. [] if unreachable.
 */
export async function fetchOrchestratorSessionsForWizard(): Promise<OrchestratorSessionListEntry[]> {
  try {
    return await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'GET_ORCHESTRATOR_SESSIONS_FOR_WIZARD' },
          (resp: WizardSessionsResponse | undefined) => {
            if (chrome.runtime.lastError) {
              console.warn('[fetchOrchestratorSessionsForWizard]', chrome.runtime.lastError.message)
              resolve([])
              return
            }
            if (resp?.ok && Array.isArray(resp.sessions)) {
              resolve(resp.sessions)
              return
            }
            if (resp?.error) {
              console.warn('[fetchOrchestratorSessionsForWizard]', resp.error)
            }
            resolve([])
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
