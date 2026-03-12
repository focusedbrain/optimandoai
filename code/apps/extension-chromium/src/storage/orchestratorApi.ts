/**
 * Orchestrator/Electron HTTP API — always via Background Script.
 * No direct localhost fetch from content/UI (avoids CORS/block).
 */

export type OrchestratorApiMethod = 'GET' | 'POST'

export interface OrchestratorApiResult {
  ok: boolean
  status?: number
  data?: any
  error?: string
}

/**
 * Call Electron HTTP API via background script (no direct fetch from content/UI).
 */
export function orchestratorApiFetch(
  endpoint: string,
  method: OrchestratorApiMethod = 'GET',
  body?: any
): Promise<OrchestratorApiResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'Request timeout' })
    }, 5000)
    chrome.runtime.sendMessage(
      { type: 'ORCHESTRATOR_HTTP_API', endpoint, method, body },
      (response: OrchestratorApiResult | undefined) => {
        clearTimeout(timeout)
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || 'Extension error' })
          return
        }
        if (!response) {
          resolve({ ok: false, error: 'No response' })
          return
        }
        resolve(response)
      }
    )
  })
}
