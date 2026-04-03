/**
 * Align dashboard WR Chat with extension sidepanel: same session discovery as
 * `sidepanel.tsx` (GET_ALL_SESSIONS_FROM_SQLITE → most recent by `session.timestamp`),
 * then mirror `optimando-active-session-key` / `optimando-global-active-session`
 * so `processFlow.getCurrentSessionKeyAsync()` and sync helpers see the same key
 * as `chrome.storage.local` via the dashboard chrome shim.
 */

import { wrChatDashboardDebug, wrChatDashboardWarn } from './wrChatDashboardLog'

type SessionsResponse = { success?: boolean; sessions?: Record<string, unknown> }

function sendGetAllSessions(): Promise<SessionsResponse | null> {
  return new Promise((resolve) => {
    try {
      const w = globalThis as unknown as { chrome?: typeof chrome }
      if (!w.chrome?.runtime?.sendMessage) {
        resolve(null)
        return
      }
      w.chrome.runtime.sendMessage({ type: 'GET_ALL_SESSIONS_FROM_SQLITE' }, (response: unknown) => {
        resolve((response as SessionsResponse) ?? null)
      })
    } catch {
      resolve(null)
    }
  })
}

/** Same as sidepanel `loadSessionDataFromStorage`: most recent `session.timestamp`. */
function pickMostRecentSessionKey(sessions: Record<string, unknown>): string | null {
  let mostRecentKey: string | null = null
  let mostRecentTime = 0
  for (const [key, session] of Object.entries(sessions)) {
    const s = session as { timestamp?: string } | null
    if (s && typeof s.timestamp === 'string') {
      const t = new Date(s.timestamp).getTime()
      if (!Number.isNaN(t) && t > mostRecentTime) {
        mostRecentTime = t
        mostRecentKey = key
      }
    }
  }
  return mostRecentKey
}

export async function ensureOrchestratorSessionForDashboard(): Promise<void> {
  try {
    const res = await sendGetAllSessions()
    if (!res) {
      wrChatDashboardWarn(
        'GET_ALL_SESSIONS_FROM_SQLITE did not run — ensure chrome shim is installed before bootstrap',
      )
      return
    }
    if (!res.success || !res.sessions) {
      wrChatDashboardWarn('GET_ALL_SESSIONS_FROM_SQLITE not successful', res)
      return
    }

    const sessions = res.sessions
    const keys = Object.keys(sessions)
    if (keys.length === 0) {
      try {
        localStorage.removeItem('optimando-active-session-key')
        localStorage.removeItem('optimando-global-active-session')
      } catch {
        /* noop */
      }
      wrChatDashboardDebug('No sessions in SQLite/storage mirror — Butler-only chat; cleared active session keys')
      return
    }

    let pick = pickMostRecentSessionKey(sessions)
    if (!pick && keys.length > 0) {
      pick = [...keys].sort()[0]
      wrChatDashboardDebug('No session.timestamp on rows; using first key (lexicographic):', pick)
    }
    if (!pick) {
      return
    }

    localStorage.setItem('optimando-active-session-key', pick)
    localStorage.setItem('optimando-global-active-session', pick)
    wrChatDashboardDebug('Active session key set (sidepanel parity):', pick)
  } catch (e) {
    wrChatDashboardWarn('Session bootstrap failed (non-fatal):', e instanceof Error ? e.message : e)
  }
}
