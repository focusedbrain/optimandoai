/**
 * Find whether an orchestrator session is already represented by an open tab or sidepanel context.
 */

export type SessionSurface =
  | { kind: 'grid_tab'; tabId: number; gridSessionParam: string }
  | { kind: 'sidepanel_only' }

function urlMatchesSessionKey(url: string | undefined, sessionKey: string): boolean {
  if (!url || !sessionKey.trim()) return false
  try {
    const u = new URL(url)
    const sk = u.searchParams.get('sessionKey') ?? ''
    const sess = u.searchParams.get('session') ?? ''
    if (sk === sessionKey) return true
    if (sess && url.includes(sessionKey)) return true
    return url.includes(`sessionKey=${encodeURIComponent(sessionKey)}`) || url.includes(sessionKey)
  } catch {
    return url.includes(sessionKey)
  }
}

function isGridDisplayUrl(url: string | undefined): boolean {
  if (!url) return false
  return (
    url.includes('grid-display-v2.html') ||
    url.includes('grid-display.html') ||
    url.includes('/grid-display')
  )
}

/**
 * @param sessionKey — Orchestrator session key (same as linked WR Chat session id / storage key).
 */
export async function findOpenSessionSurface(sessionKey: string): Promise<SessionSurface | null> {
  const sk = sessionKey.trim()
  if (!sk) return null

  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.discarded) continue
      const url = tab.url
      if (!isGridDisplayUrl(url)) continue
      if (!urlMatchesSessionKey(url, sk)) continue
      if (typeof tab.id !== 'number') continue
      let gridSessionParam = ''
      try {
        const u = new URL(url!)
        gridSessionParam = u.searchParams.get('session') ?? u.searchParams.get('sessionKey') ?? sk
      } catch {
        gridSessionParam = sk
      }
      return { kind: 'grid_tab', tabId: tab.id, gridSessionParam }
    }
  } catch (e) {
    console.warn('[sessionSurfaceResolver] chrome.tabs.query failed:', e)
  }

  try {
    const stored = await chrome.storage.local.get('optimando-active-session-key')
    const active = stored['optimando-active-session-key']
    if (typeof active === 'string' && active.trim() === sk) {
      return { kind: 'sidepanel_only' }
    }
  } catch (e) {
    console.warn('[sessionSurfaceResolver] storage read failed:', e)
  }

  return null
}
