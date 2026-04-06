/**
 * When an orchestrator session gains `displayGrids`, open the grid tab(s), open the side panel,
 * and signal the sidepanel to focus WR Chat (docked, pinned) and switch to the matching mode
 * (custom mode or auto-optimizer project when linked to this session).
 */

const GRID_PRESENT_SIG_PREFIX = 'orchestrator_grid_present_sig:'

function gridFingerprint(grids: unknown[]): string {
  if (!Array.isArray(grids)) return ''
  return grids
    .map((g) => {
      const o = g && typeof g === 'object' ? (g as Record<string, unknown>) : {}
      const sid = typeof o.sessionId === 'string' ? o.sessionId : ''
      const layout = typeof o.layout === 'string' ? o.layout : ''
      return `${sid}:${layout}`
    })
    .sort()
    .join('|')
}

function computeNextBoxNumber(session: Record<string, unknown>): number {
  let max = 0
  const boxes = session.agentBoxes
  if (Array.isArray(boxes)) {
    for (const box of boxes) {
      if (!box || typeof box !== 'object') continue
      const b = box as Record<string, unknown>
      const n = Number(b.boxNumber ?? b.number ?? 0)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const grids = session.displayGrids
  if (Array.isArray(grids)) {
    for (const g of grids) {
      if (!g || typeof g !== 'object') continue
      const cfg = (g as Record<string, unknown>).config as Record<string, unknown> | undefined
      const slots = cfg?.slots
      if (slots && typeof slots === 'object') {
        for (const slot of Object.values(slots)) {
          if (!slot || typeof slot !== 'object') continue
          const n = Number((slot as Record<string, unknown>).boxNumber ?? 0)
          if (Number.isFinite(n) && n > max) max = n
        }
      }
    }
  }
  return max + 1
}

/**
 * After a successful orchestrator write with `displayGrids`, open grid UI and WR Chat presentation.
 * Idempotent per grid fingerprint (repeated saves with the same grids do not re-open tabs).
 */
export async function maybePresentOrchestratorDisplayGridSession(
  sessionKey: string,
  session: Record<string, unknown>,
): Promise<void> {
  const grids = session.displayGrids
  if (!Array.isArray(grids) || grids.length === 0) return

  const sig = gridFingerprint(grids)
  const sigKey = GRID_PRESENT_SIG_PREFIX + sessionKey
  try {
    const prev = await chrome.storage.local.get(sigKey)
    if (prev[sigKey] === sig) return
    await chrome.storage.local.set({ [sigKey]: sig })
  } catch {
    /* continue — best-effort */
  }

  const themeRaw = await chrome.storage.local.get('optimando-ui-theme')
  const theme =
    typeof themeRaw['optimando-ui-theme'] === 'string' && themeRaw['optimando-ui-theme'].trim()
      ? String(themeRaw['optimando-ui-theme']).trim()
      : 'dark'

  const nextBoxNumber = computeNextBoxNumber(session)

  try {
    await chrome.storage.local.set({
      orchestrator_wrchat_present_request: {
        sessionKey,
        at: Date.now(),
        source: 'display-grid',
      },
    })
  } catch {
    /* non-fatal */
  }

  let firstTabId: number | undefined
  for (let i = 0; i < grids.length; i++) {
    const g = grids[i]
    if (!g || typeof g !== 'object') continue
    const o = g as Record<string, unknown>
    const layout = typeof o.layout === 'string' && o.layout.trim() ? o.layout.trim() : '4-slot'
    const sessionId =
      typeof o.sessionId === 'string' && o.sessionId.trim()
        ? o.sessionId.trim()
        : `grid-${sessionKey}-${i}`

    const params = new URLSearchParams({
      layout,
      session: sessionId,
      theme,
      sessionKey,
      nextBoxNumber: String(nextBoxNumber + i),
    })
    const url = chrome.runtime.getURL(`grid-display-v2.html?${params.toString()}`)
    try {
      const tab = await chrome.tabs.create({ url, active: i === 0 })
      if (i === 0 && typeof tab?.id === 'number') firstTabId = tab.id
    } catch (e) {
      console.warn('[presentOrchestratorDisplayGridSession] tabs.create failed:', e)
    }
  }

  if (typeof firstTabId === 'number' && chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.open({ tabId: firstTabId })
    } catch (e) {
      console.warn('[presentOrchestratorDisplayGridSession] sidePanel.open failed:', e)
    }
  }
}
