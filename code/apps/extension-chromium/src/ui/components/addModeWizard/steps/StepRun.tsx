/**
 * Wizard step: run mode and interval.
 */

import React from 'react'
import type { CustomModeDraft, CustomRunMode } from '../../../../shared/ui/customModeTypes'
import { coerceRunMode } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { RUN_MODE_VALUES, WIZARD_RUN_MODES } from '../wizardConstants'
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
  const runModeSafe = coerceRunMode(data.runMode, RUN_MODE_VALUES)
  const isInterval = runModeSafe === 'interval'
  const intErr = fieldErrors.intervalMinutes

  return (
    <div style={wizardFieldColumnStyle()}>
      <div>
        <label htmlFor="cmw-runmode" style={labelStyle(t)}>
          Run mode
        </label>
        <select
          id="cmw-runmode"
          value={runModeSafe}
          onChange={(e) => {
            const runMode = e.target.value as CustomRunMode
            setData({
              runMode,
              intervalMinutes: runMode === 'interval' ? data.intervalMinutes ?? 5 : null,
            })
          }}
          style={{ ...inputStyle(t), cursor: 'pointer' }}
        >
          {WIZARD_RUN_MODES.map((rm) => (
            <option key={rm.value} value={rm.value}>
              {rm.label}
            </option>
          ))}
        </select>
      </div>
      {isInterval ? (
        <div>
          <label htmlFor="cmw-interval" style={labelStyle(t)}>
            Interval (minutes) <span aria-hidden="true">*</span>
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
            placeholder="5"
            style={inputStyleWithError(inputStyle(t), t, intErr)}
            aria-invalid={intErr ? true : undefined}
            aria-describedby={intErr ? 'cmw-interval-err' : undefined}
            aria-required
          />
          <WizardFieldError id="cmw-interval-err" message={intErr} t={t} />
        </div>
      ) : null}
    </div>
  )
}
