import { getMainBrowserWindow } from '../mainWindowAccessor'

export type TriggerProjectEntry = {
  projectId: string
  title: string
  icon: string
  activeMilestoneTitle?: string
  /** Orchestrator session keys linked for auto-optimization (extension matches WR Chat session). */
  linkedSessionIds?: string[]
}

export type TriggerComposerShortcutId =
  | 'emailComposer'
  | 'beapComposer'
  | 'letterComposer'
  | 'documentActions'
  | 'smartSummary'

export type TriggerComposerEntry = {
  composerId: TriggerComposerShortcutId
  title: string
  icon: string
  launchMode: string
}

export type TriggerListPayload = {
  projects: TriggerProjectEntry[]
  composerShortcuts: TriggerComposerEntry[]
}

/**
 * Reads persisted **`useProjectStore`** data from the renderer (**localStorage key `wr-desk-projects`**)
 * and returns projects that have an icon (for the extension multi-trigger bar), plus composer shortcuts
 * when **`state.composerIcons`** has a non-empty emoji for allocated dashboard shortcuts.
 *
 * Must stay aligned with Zustand persist output from `useProjectStore` (`name: 'wr-desk-projects'`).
 * If the key or `{ state: { projects } }` shape changes, update this parser and any extension-side readers.
 */
export async function readTriggerListFromRenderer(): Promise<TriggerListPayload> {
  const wc = getMainBrowserWindow()?.webContents
  if (!wc) return { projects: [], composerShortcuts: [] }
  try {
    const raw = await wc.executeJavaScript(`(function(){
      try { return localStorage.getItem('wr-desk-projects') || '' } catch (e) { return '' }
    })()`)
    if (!raw || typeof raw !== 'string') return { projects: [], composerShortcuts: [] }
    const parsed = JSON.parse(raw) as {
      state?: { projects?: unknown[]; composerIcons?: Record<string, unknown> }
    } | null
    const projects = parsed?.state?.projects
    const composerIcons = parsed?.state?.composerIcons
    const out: TriggerProjectEntry[] = []
    if (Array.isArray(projects)) {
      for (const p of projects) {
        if (!p || typeof p !== 'object') continue
        const o = p as Record<string, unknown>
        const id = typeof o.id === 'string' ? o.id : ''
        const title = typeof o.title === 'string' ? o.title : ''
        const icon = typeof o.icon === 'string' ? o.icon : ''
        if (!id || !icon.trim()) continue
        const milestones = Array.isArray(o.milestones) ? o.milestones : []
        let activeTitle: string | undefined
        for (const m of milestones) {
          if (m && typeof m === 'object' && (m as { isActive?: boolean }).isActive === true) {
            const t = (m as { title?: string }).title
            if (typeof t === 'string' && t.trim()) {
              activeTitle = t.trim()
              break
            }
          }
        }
        if (!activeTitle) {
          for (const m of milestones) {
            if (m && typeof m === 'object' && !(m as { completed?: boolean }).completed) {
              const t = (m as { title?: string }).title
              if (typeof t === 'string' && t.trim()) {
                activeTitle = t.trim()
                break
              }
            }
          }
        }
        const entry: TriggerProjectEntry = {
          projectId: id,
          title: title.trim() || 'Untitled project',
          icon: icon.trim(),
        }
        if (activeTitle) entry.activeMilestoneTitle = activeTitle
        const linked = Array.isArray(o.linkedSessionIds)
          ? (o.linkedSessionIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : []
        if (linked.length) entry.linkedSessionIds = linked
        out.push(entry)
      }
    }

    const composerEntries: TriggerComposerEntry[] = []
    const icons =
      composerIcons && typeof composerIcons === 'object' && !Array.isArray(composerIcons)
        ? (composerIcons as Record<string, unknown>)
        : {}
    const emailIcon = typeof icons.emailComposer === 'string' ? icons.emailComposer : ''
    if (emailIcon.trim()) {
      composerEntries.push({
        composerId: 'emailComposer',
        title: 'Email Composer',
        icon: emailIcon.trim(),
        launchMode: 'dashboard-email-compose',
      })
    }
    const beapIcon = typeof icons.beapComposer === 'string' ? icons.beapComposer : ''
    if (beapIcon.trim()) {
      composerEntries.push({
        composerId: 'beapComposer',
        title: 'BEAP Composer',
        icon: beapIcon.trim(),
        launchMode: 'dashboard-beap-draft',
      })
    }
    const letterIcon = typeof icons.letterComposer === 'string' ? icons.letterComposer : ''
    if (letterIcon.trim()) {
      composerEntries.push({
        composerId: 'letterComposer',
        title: 'Letter Composer',
        icon: letterIcon.trim(),
        launchMode: 'dashboard-letter-compose',
      })
    }
    const docIcon = typeof icons.documentActions === 'string' ? icons.documentActions : ''
    if (docIcon.trim()) {
      composerEntries.push({
        composerId: 'documentActions',
        title: 'Document Actions',
        icon: docIcon.trim(),
        launchMode: 'dashboard-bulk-inbox',
      })
    }
    const summaryIcon = typeof icons.smartSummary === 'string' ? icons.smartSummary : ''
    if (summaryIcon.trim()) {
      composerEntries.push({
        composerId: 'smartSummary',
        title: 'Smart Summary',
        icon: summaryIcon.trim(),
        launchMode: 'dashboard-smart-summary',
      })
    }

    return { projects: out, composerShortcuts: composerEntries }
  } catch (e) {
    console.error('[triggerProjectList]', e)
    return { projects: [], composerShortcuts: [] }
  }
}

/** @deprecated Prefer `readTriggerListFromRenderer` for the full payload. */
export async function readTriggerProjectEntriesFromRenderer(): Promise<TriggerProjectEntry[]> {
  const { projects } = await readTriggerListFromRenderer()
  return projects
}
