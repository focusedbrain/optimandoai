/**
 * Step-level and per-field validation for the Add Mode wizard (maps to CustomModeDraft).
 * Inline errors power field-level highlights; validateAddModeWizardStep drives step gating and review.
 */

import type { CustomModeDraft } from '../../../shared/ui/customModeTypes'
import type { AddModeWizardStepIndex } from './addModeWizardTypes'

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export type InlineFieldErrors = Partial<Record<string, string>>

/** Per-field messages for inline validation (current step only). */
export function getInlineFieldErrorsForStep(
  stepIndex: AddModeWizardStepIndex,
  data: CustomModeDraft,
): InlineFieldErrors {
  const out: InlineFieldErrors = {}
  switch (stepIndex) {
    case 0:
      if (!data.name?.trim()) out.name = 'Enter a mode name.'
      return out
    case 1:
      if (!data.modelName?.trim()) out.modelName = 'Enter a model name.'
      {
        const p = (data.modelProvider ?? 'ollama').trim().toLowerCase()
        if (p === 'ollama') {
          const ep = data.endpoint?.trim() ?? ''
          if (!ep) out.endpoint = 'Enter the Ollama endpoint URL.'
          else if (!isValidHttpUrl(ep)) out.endpoint = 'Enter a valid http(s) URL.'
        }
      }
      return out
    case 3:
      if (!data.searchFocus?.trim()) out.searchFocus = 'Describe what this mode should look for.'
      return out
    case 4:
      if (data.runMode === 'interval') {
        const n = data.intervalMinutes
        if (n === null || n === undefined || !Number.isFinite(n) || n < 1) {
          out.intervalMinutes = 'Set an interval of at least 1 minute.'
        }
      }
      return out
    default:
      return out
  }
}

export function validateAddModeWizardStep(
  stepIndex: AddModeWizardStepIndex,
  data: CustomModeDraft,
): string | null {
  switch (stepIndex) {
    case 0: {
      if (!data.name?.trim()) return 'Enter a mode name.'
      return null
    }
    case 1: {
      if (!data.modelName?.trim()) return 'Enter a model name.'
      const p = (data.modelProvider ?? 'ollama').trim().toLowerCase()
      if (p === 'ollama') {
        const ep = data.endpoint?.trim() ?? ''
        if (!ep) return 'Enter the Ollama endpoint URL.'
        if (!isValidHttpUrl(ep)) return 'Enter a valid http(s) URL for the endpoint.'
      }
      return null
    }
    case 2:
      return null
    case 3: {
      if (!data.searchFocus?.trim()) return 'Describe what this mode should look for.'
      return null
    }
    case 4: {
      if (data.runMode === 'interval') {
        const n = data.intervalMinutes
        if (n === null || n === undefined || !Number.isFinite(n) || n < 1) {
          return 'Set an interval of at least 1 minute.'
        }
      }
      return null
    }
    case 5: {
      for (let i = 0; i < 5; i++) {
        const err = validateAddModeWizardStep(i as AddModeWizardStepIndex, data)
        if (err) return err
      }
      return null
    }
    default:
      return null
  }
}

export function isAddModeWizardDraftValid(data: CustomModeDraft): boolean {
  for (let i = 0; i < 5; i++) {
    if (validateAddModeWizardStep(i as AddModeWizardStepIndex, data) !== null) return false
  }
  return true
}
