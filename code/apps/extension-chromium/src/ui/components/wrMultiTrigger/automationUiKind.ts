/**
 * UI-only classification for multi-trigger bar dropdown rows.
 * Does not affect `TriggerFunctionId`, HTTP, persistence, or chat focus — use for styling, tests, or future UI.
 *
 * Derivation:
 * - `watchdog` → **monitor** (Scam Watchdog)
 * - `auto-optimizer` → **project_assistant** (project optimizer rows from `fetchTriggerProjects`)
 * - **neutral** — “+ Add Automation” and any row not mapped here yet (e.g. custom automation entry points stay neutral until product defines a mapping)
 * - **action** — reserved for future rows; not derived from current `TriggerFunctionId` variants
 */
import type { TriggerFunctionId } from '../../../types/triggerTypes'

export type AutomationUiKind = 'monitor' | 'action' | 'project_assistant' | 'neutral'

/** Classifies a trigger dropdown row from its existing `TriggerFunctionId` (no backend changes). */
export function automationUiKindFromTriggerFunctionId(fid: TriggerFunctionId): AutomationUiKind {
  if (fid.type === 'watchdog') return 'monitor'
  if (fid.type === 'auto-optimizer') return 'project_assistant'
  return 'neutral'
}

/** UI kind for the “+ Add Automation” list row (not a `TriggerFunctionId`). */
export const ADD_AUTOMATION_ROW_UI_KIND: AutomationUiKind = 'neutral'

/** UI kind for the “+ Add Project WIKI” list row (desktop Analysis workspace). */
export const ADD_PROJECT_ASSISTANT_ROW_UI_KIND: AutomationUiKind = 'neutral'
