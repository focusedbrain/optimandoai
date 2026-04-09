/**
 * Opens display grids for an orchestrator session from the Electron Analysis dashboard using the
 * SAME path as session history / auto-opt: `window.analysisDashboard.presentOrchestratorDisplayGrid`
 * → main WebSocket → extension background mirrors blob to `chrome.storage.local` →
 * `maybePresentOrchestratorDisplayGridSession` (see background.ts PRESENT_ORCHESTRATOR_DISPLAY_GRID).
 *
 * The extension background applies the "grid tab already open" guard via `findOpenSessionSurface`.
 */

import { WRDESK_OPTIMIZATION_GUARD_TOAST } from './wrdeskUiEvents'
import { fetchOrchestratorSession, type OrchestratorSessionJson } from './orchestratorSessionClient'

/** Passed to preload → extension; background uses for logging when skipping duplicate grids. */
export type SessionGridPresentSource =
  | 'auto-optimization'
  | 'auto-optimization-start'
  | 'dashboard-session-icon'
  | 'dashboard-snapshot-prep'

/**
 * Fetches session JSON from SQLite (HTTP GET), then asks the Chrome extension to mirror + present grids.
 * Returns the session JSON for callers that need it (e.g. optimization pipeline) without a second fetch.
 */
export async function openSessionDisplayGridsFromDashboard(
  sessionKey: string,
  source: SessionGridPresentSource,
): Promise<{ ok: true; sessionJson: OrchestratorSessionJson } | { ok: false; message: string }> {
  const sk = sessionKey.trim()
  if (!sk) {
    return { ok: false, message: 'No session key' }
  }

  const fetched = await fetchOrchestratorSession(sk)
  if (!fetched.ok) {
    return { ok: false, message: fetched.message }
  }
  const sessionJson = fetched.data

  try {
    const dash = window.analysisDashboard
    if (typeof dash?.presentOrchestratorDisplayGrid === 'function') {
      dash.presentOrchestratorDisplayGrid(sk, sessionJson as Record<string, unknown>, source)
      console.log(`[SessionGrids] Requested display grids for "${sk}" (source=${source})`)
      return { ok: true, sessionJson }
    }
    return { ok: false, message: 'analysisDashboard.presentOrchestratorDisplayGrid is not available' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[SessionGrids] presentOrchestratorDisplayGrid failed:', msg)
    try {
      window.dispatchEvent(
        new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
          detail: { message: `Could not open session display grids: ${msg}`, variant: 'warning' },
        }),
      )
    } catch {
      /* noop */
    }
    return { ok: false, message: msg }
  }
}
