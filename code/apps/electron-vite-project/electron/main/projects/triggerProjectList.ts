import { getMainBrowserWindow } from '../mainWindowAccessor'

export type TriggerProjectEntry = {
  projectId: string
  title: string
  icon: string
  activeMilestoneTitle?: string
  /** Orchestrator session keys linked for auto-optimization (extension matches WR Chat session). */
  linkedSessionIds?: string[]
}

/**
 * Reads persisted **`useProjectStore`** data from the renderer (**localStorage key `wr-desk-projects`**)
 * and returns projects that have an icon (for the extension multi-trigger bar).
 *
 * Must stay aligned with Zustand persist output from `useProjectStore` (`name: 'wr-desk-projects'`).
 * If the key or `{ state: { projects } }` shape changes, update this parser and any extension-side readers.
 */
export async function readTriggerProjectEntriesFromRenderer(): Promise<TriggerProjectEntry[]> {
  const wc = getMainBrowserWindow()?.webContents
  if (!wc) return []
  try {
    const raw = await wc.executeJavaScript(`(function(){
      try { return localStorage.getItem('wr-desk-projects') || '' } catch (e) { return '' }
    })()`)
    if (!raw || typeof raw !== 'string') return []
    const parsed = JSON.parse(raw) as { state?: { projects?: unknown[] } } | null
    const projects = parsed?.state?.projects
    if (!Array.isArray(projects)) return []
    const out: TriggerProjectEntry[] = []
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
    return out
  } catch (e) {
    console.error('[triggerProjectList]', e)
    return []
  }
}
