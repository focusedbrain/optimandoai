/**
 * Detect unsaved draft changes for cancel confirmation.
 */

import type { CustomModeDraft } from '../../../shared/ui/customModeTypes'
import { defaultCustomModeDraft } from '../../../shared/ui/customModeTypes'

export function isCustomModeDraftDirty(draft: CustomModeDraft): boolean {
  const base = defaultCustomModeDraft()
  const keys = Object.keys(base) as (keyof CustomModeDraft)[]
  for (const k of keys) {
    if (k === 'metadata') {
      const dm = draft.metadata
      const bm = base.metadata
      if (dm != null && typeof dm === 'object' && Object.keys(dm).length > 0) return true
      if (bm != null && typeof bm === 'object' && Object.keys(bm).length > 0) return false
      continue
    }
    if (draft[k] !== base[k]) return true
  }
  return false
}
