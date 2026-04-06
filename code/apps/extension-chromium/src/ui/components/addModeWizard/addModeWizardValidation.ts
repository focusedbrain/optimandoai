/**
 * Step-level and per-field validation for the Add Mode wizard (maps to CustomModeDraft).
 * Inline errors power field-level highlights; validateAddModeWizardStep drives step gating and review.
 */

import type { CustomModeDraft } from '../../../shared/ui/customModeTypes'
import { getScopeUrlsDraftText, isValidCustomModeScopeUrlLine } from '../../../shared/ui/customModeTypes'
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
    case 1: {
      const p = (data.modelProvider ?? 'ollama').trim().toLowerCase()
      if (p === 'ollama') {
        const ep = data.endpoint?.trim() ?? ''
        if (!ep) out.endpoint = 'Enter the Ollama endpoint URL.'
        else if (!isValidHttpUrl(ep)) out.endpoint = 'Enter a valid http(s) URL.'
        const mn = data.modelName?.trim() ?? ''
        if (!mn) out.modelName = 'Select an installed model.'
        else {
          const tags = (data.metadata as { _ollamaTags?: string[] } | undefined)?._ollamaTags
          if (tags && tags.length > 0 && !tags.includes(mn)) {
            out.modelName = 'Pick an installed model from the list (or fix the endpoint).'
          }
        }
      } else if (!data.modelName?.trim()) {
        out.modelName = 'Enter a model name.'
      }
      return out
    }
    case 3: {
      if (!data.searchFocus?.trim()) out.searchFocus = 'Describe what this mode should look for.'
      const md = data.metadata as Record<string, unknown> | undefined
      const scopeText = getScopeUrlsDraftText(md)
      for (const line of scopeText.split('\n')) {
        if (!isValidCustomModeScopeUrlLine(line)) {
          out.scopeUrls = 'Each line must be a valid http(s) URL or host pattern.'
          break
        }
      }
      return out
    }
    case 4: {
      const n = data.intervalMinutes
      if (n !== null && n !== undefined && (!Number.isFinite(n) || n < 1)) {
        out.intervalMinutes = 'Use at least 1 minute, or leave empty for no periodic scan.'
      }
      return out
    }
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
      const p = (data.modelProvider ?? 'ollama').trim().toLowerCase()
      if (p === 'ollama') {
        const ep = data.endpoint?.trim() ?? ''
        if (!ep) return 'Enter the Ollama endpoint URL.'
        if (!isValidHttpUrl(ep)) return 'Enter a valid http(s) URL for the endpoint.'
        const mn = data.modelName?.trim() ?? ''
        if (!mn) return 'Select an installed model.'
        const tags = (data.metadata as { _ollamaTags?: string[] } | undefined)?._ollamaTags
        if (tags && tags.length > 0 && !tags.includes(mn)) {
          return 'Pick an installed model from the list (or fix the endpoint).'
        }
        return null
      }
      if (!data.modelName?.trim()) return 'Enter a model name.'
      return null
    }
    case 2:
      return null
    case 3: {
      if (!data.searchFocus?.trim()) return 'Describe what this mode should look for.'
      const md = data.metadata as Record<string, unknown> | undefined
      const scopeText = getScopeUrlsDraftText(md)
      for (const line of scopeText.split('\n')) {
        if (!isValidCustomModeScopeUrlLine(line)) {
          return 'Each scope URL line must be a valid http(s) URL or host pattern.'
        }
      }
      return null
    }
    case 4: {
      const n = data.intervalMinutes
      if (n !== null && n !== undefined && (!Number.isFinite(n) || n < 1)) {
        return 'Use at least 1 minute, or leave empty for no periodic scan.'
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
