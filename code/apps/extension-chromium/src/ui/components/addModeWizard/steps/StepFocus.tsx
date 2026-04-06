/**
 * Wizard step: search focus and ignore instructions.
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { safeDraftString } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens, labelStyle } from '../../../../shared/ui/lightboxTheme'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { inputStyleWithError, wizardFieldColumnStyle, wizardTextareaStyle } from '../wizardStyles'
import { WizardFieldError } from './WizardFieldError'

export function StepFocus({
  data,
  setData,
  t,
  fieldErrors,
}: {
  data: CustomModeDraft
  setData: (patch: Partial<CustomModeDraft>) => void
  t: ReturnType<typeof getThemeTokens>
  fieldErrors: InlineFieldErrors
}) {
  const sfErr = fieldErrors.searchFocus
  return (
    <div style={wizardFieldColumnStyle()}>
      <div>
        <label htmlFor="cmw-focus" style={labelStyle(t)}>
          What this mode should look for <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="cmw-focus"
          value={safeDraftString(data.searchFocus)}
          onChange={(e) => setData({ searchFocus: e.target.value })}
          placeholder="Topics, signals, or goals the assistant should prioritize in this mode…"
          style={inputStyleWithError(wizardTextareaStyle(t), t, sfErr)}
          aria-invalid={sfErr ? true : undefined}
          aria-describedby={sfErr ? 'cmw-focus-err' : undefined}
          aria-required
        />
        <WizardFieldError id="cmw-focus-err" message={sfErr} t={t} />
      </div>
      <div>
        <label htmlFor="cmw-ignore" style={labelStyle(t)}>
          Ignore instructions{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <textarea
          id="cmw-ignore"
          value={safeDraftString(data.ignoreInstructions)}
          onChange={(e) => setData({ ignoreInstructions: e.target.value })}
          placeholder="What to deprioritize or skip (noise, off-topic areas)…"
          style={wizardTextareaStyle(t)}
        />
      </div>
    </div>
  )
}
