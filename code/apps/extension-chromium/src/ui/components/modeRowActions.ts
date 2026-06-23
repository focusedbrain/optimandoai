/**
 * Shared edit/delete affordances for persisted mode rows (custom + built-in).
 */

import { WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT } from './wrMultiTrigger/WrMultiTriggerBar'
import type { CustomModeDefinition } from '../../shared/ui/customModeTypes'
import { isModeDeletable } from '../../shared/ui/customModeTypes'

export function openModeEditWizard(modeId: string): void {
  const id = modeId?.trim()
  if (!id) return
  try {
    window.dispatchEvent(
      new CustomEvent(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, { detail: { editModeId: id } }),
    )
  } catch {
    /* noop */
  }
}

export function confirmDeleteMode(
  def: CustomModeDefinition | undefined,
  removeMode: (id: string) => void,
): boolean {
  if (!def || !isModeDeletable(def)) return false
  const label = def.name?.trim() || 'Untitled'
  if (!window.confirm(`Delete mode "${label}"? This cannot be undone.`)) return false
  removeMode(def.id)
  return true
}
