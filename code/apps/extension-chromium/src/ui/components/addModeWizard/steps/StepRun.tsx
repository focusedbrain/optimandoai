/**
 * Wizard step: optional periodic scan interval.
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { CUSTOM_MODE_INTERVAL_PRESET_OPTIONS } from '../../../../shared/ui/customModeIntervalPresets'
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
  const intErr = fieldErrors.intervalSeconds
  const val = data.intervalSeconds

  return (
    <div style={wizardFieldColumnStyle()}>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: t.textMuted, lineHeight: 1.45 }}>
        Chat and manual scan are always available. Optionally choose an interval to also run a periodic scan on that
        schedule.
      </p>
      <div>
        <label htmlFor="cmw-interval" style={labelStyle(t)}>
          Periodic scan interval{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <select
          id="cmw-interval"
          value={val == null ? '' : String(val)}
          onChange={(e) => {
            const v = e.target.value
            setData({ intervalSeconds: v === '' ? null : Number(v) })
          }}
          style={inputStyleWithError(
            { ...inputStyle(t), fontSize: 13, minHeight: 36, cursor: 'pointer' },
            t,
            intErr,
          )}
          aria-invalid={intErr ? true : undefined}
          aria-describedby={intErr ? 'cmw-interval-err' : undefined}
        >
          <option value="">None</option>
          {CUSTOM_MODE_INTERVAL_PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <WizardFieldError id="cmw-interval-err" message={intErr} t={t} />
      </div>
    </div>
  )
}
