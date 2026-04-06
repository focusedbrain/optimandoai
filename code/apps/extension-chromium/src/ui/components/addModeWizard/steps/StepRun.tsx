/**
 * Wizard step: optional periodic scan interval.
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { inputStyleWithError, wizardFieldColumnStyle } from '../wizardStyles'
import { WizardFieldError } from './WizardFieldError'

export function StepRun({
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
  const intErr = fieldErrors.intervalMinutes

  return (
    <div style={wizardFieldColumnStyle()}>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: t.textMuted, lineHeight: 1.45 }}>
        Chat and manual scan are always available. Optionally set an interval (minutes) to also run a periodic scan on
        that schedule.
      </p>
      <div>
        <label htmlFor="cmw-interval" style={labelStyle(t)}>
          Periodic scan interval (minutes){' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <input
          id="cmw-interval"
          type="number"
          min={1}
          step={1}
          value={data.intervalMinutes ?? ''}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') {
              setData({ intervalMinutes: null })
              return
            }
            const n = parseInt(v, 10)
            setData({ intervalMinutes: Number.isFinite(n) ? Math.max(1, n) : null })
          }}
          placeholder="Leave empty for no schedule"
          style={inputStyleWithError(inputStyle(t), t, intErr)}
          aria-invalid={intErr ? true : undefined}
          aria-describedby={intErr ? 'cmw-interval-err' : undefined}
        />
        <WizardFieldError id="cmw-interval-err" message={intErr} t={t} />
      </div>
    </div>
  )
}
