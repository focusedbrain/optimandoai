import type { ChatFocusMode } from '../types/triggerTypes'
import type { ChatFocusMeta } from '../stores/chatFocusStore'

/** Must match `useProjectStore` persist key (`wr-desk-projects`) — used to read description/goals when focus meta is incomplete. */
const WR_DESK_PROJECTS_KEY = 'wr-desk-projects'

type DeskLookup = { description: string; goals: string } | 'no_store' | 'not_found'

/** Same persisted shape as Electron `useProjectStore` (wr-desk-projects) — extension has no direct store import. */
function loadProjectFromWrDeskLocalStorage(projectId: string): DeskLookup {
  try {
    if (typeof localStorage === 'undefined') return 'no_store'
    const raw = localStorage.getItem(WR_DESK_PROJECTS_KEY)
    if (!raw) return 'no_store'
    const parsed = JSON.parse(raw) as {
      state?: { projects?: Array<{ id: string; description?: string; goals?: string }> }
    }
    const projects = parsed?.state?.projects
    if (!Array.isArray(projects)) return 'no_store'
    const p = projects.find((x) => x && x.id === projectId)
    if (!p) return 'not_found'
    return { description: p.description ?? '', goals: p.goals ?? '' }
  } catch {
    return 'no_store'
  }
}

/**
 * Resolves description/goals: focus meta snapshot first, then persisted WR Desk project store
 * (same shape as useProjectStore persist).
 */
function resolveDescriptionGoals(
  projectId: string,
  focusMeta: ChatFocusMeta | null,
): { description: string; goals: string } | null {
  const md = focusMeta?.projectDescription
  const mg = focusMeta?.projectGoals
  if (md !== undefined || mg !== undefined) {
    return { description: md ?? '', goals: mg ?? '' }
  }
  const desk = loadProjectFromWrDeskLocalStorage(projectId)
  if (desk === 'no_store') return { description: '', goals: '' }
  if (desk === 'not_found') return null
  return desk
}

export function getChatFocusLlmPrefix(state: {
  chatFocusMode: ChatFocusMode
  focusMeta: ChatFocusMeta | null
}): string | null {
  const { chatFocusMode: m, focusMeta } = state
  if (m.mode === 'default') return null
  if (m.mode === 'scam-watchdog') {
    return '[System context: User has Scam Watchdog automation focus. Analyze input for potential scam, fraud, or phishing indicators.]'
  }
  if (m.mode === 'custom-automation') {
    const name = m.modeName?.trim() || 'custom automation'
    return `[System context: User has pinned automation focus: "${name}". Follow that automation's purpose and detection focus in your responses.]`
  }
  if (m.mode === 'auto-optimizer') {
    const projectId = m.projectId
    const projectTitle = m.projectTitle?.trim() || focusMeta?.projectTitle?.trim() || 'project'
    const resolved = resolveDescriptionGoals(projectId, focusMeta)
    if (resolved === null) {
      console.warn(
        '[chatFocusLlmPrefix] Auto-optimization context skipped: project not found for id',
        projectId,
      )
      return null
    }
    const milestoneTitle = (m.milestoneTitle ?? focusMeta?.activeMilestoneTitle)?.trim() || 'None'
    const runId = m.runId?.trim() || 'manual'
    const desc = resolved.description
    const goals = resolved.goals
    return `[Auto-Optimization Context]
Project: ${projectTitle}
Description: ${desc}
Goals: ${goals}
Active milestone: ${milestoneTitle}
Run ID: ${runId}
---

`
  }
  return null
}
