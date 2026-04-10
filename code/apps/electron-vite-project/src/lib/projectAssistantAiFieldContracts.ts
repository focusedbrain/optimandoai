/**
 * **Project Assistant / ProjectOptimizationPanel — AI insert DOM contract**
 *
 * `HybridSearch` calls `window.__wrdeskInsertDraft`; this panel inserts into fields located via:
 * - `[data-field="title" | "description" | "goals"]` — inline form inputs (see `flashFieldEl`)
 * - `[data-milestone-id="<uuid>"]` — milestone body textareas (see `flashMilestoneEl`)
 *
 * Keep selectors centralized here so refactors (ActiveAutomationWorkspace, etc.) do not drift
 * from `querySelector` usage in flash helpers or from HybridSearch expectations.
 */

/** `data-field` values on the inline project form that participate in AI insert + flash. */
export const PROJECT_ASSISTANT_DATA_FIELD_IDS = ['title', 'description', 'goals'] as const
export type ProjectAssistantDataFieldId = (typeof PROJECT_ASSISTANT_DATA_FIELD_IDS)[number]

/** Selector for a single project field control — must match `data-field` on inputs/textareas in POP. */
export function projectAssistantDataFieldSelector(dataField: string): string {
  return `[data-field="${dataField}"]`
}

/** Selector for a milestone textarea — must match `data-milestone-id` on milestone rows in POP. */
export function projectAssistantMilestoneSelector(milestoneId: string): string {
  return `[data-milestone-id="${milestoneId}"]`
}

/**
 * DEV-only: after connecting a field to AI, verify the expected node exists next frame.
 * If the UI is recomposed without these attributes, inserts still run but flash / resize may no-op.
 */
export function devAssertProjectAssistantAiDomHook(
  kind: 'data-field' | 'data-milestone-id',
  id: string,
): void {
  if (!import.meta.env.DEV) return
  requestAnimationFrame(() => {
    const sel =
      kind === 'data-field' ? projectAssistantDataFieldSelector(id) : projectAssistantMilestoneSelector(id)
    if (!document.querySelector(sel)) {
      console.warn(
        `[ProjectAssistant][DEV] Missing DOM hook for ${kind}="${id}" — AI post-insert flash may no-op.`,
      )
    }
  })
}
