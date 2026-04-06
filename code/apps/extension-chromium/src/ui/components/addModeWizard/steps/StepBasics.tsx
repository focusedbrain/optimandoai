/**
 * Wizard step: name, description, icon.
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
import { safeDraftString } from '../../../../shared/ui/customModeDisplay'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { WIZARD_MODE_ICONS } from '../wizardConstants'
import { inputStyleWithError, wizardFieldColumnStyle } from '../wizardStyles'
import { WizardFieldError } from './WizardFieldError'

export function StepBasics({
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
  const nameErr = fieldErrors.name
  return (
    <div style={wizardFieldColumnStyle()}>
      <div>
        <label htmlFor="cmw-name" style={labelStyle(t)}>
          Mode name <span aria-hidden="true">*</span>
        </label>
        <input
          id="cmw-name"
          type="text"
          value={safeDraftString(data.name)}
          onChange={(e) => setData({ name: e.target.value })}
          placeholder="e.g. Research assistant"
          style={inputStyleWithError(inputStyle(t), t, nameErr)}
          autoComplete="off"
          aria-invalid={nameErr ? true : undefined}
          aria-describedby={nameErr ? 'cmw-name-err' : undefined}
          aria-required
        />
        <WizardFieldError id="cmw-name-err" message={nameErr} t={t} />
      </div>
      <div>
        <label htmlFor="cmw-desc" style={labelStyle(t)}>
          Short description{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
        </label>
        <input
          id="cmw-desc"
          type="text"
          value={safeDraftString(data.description)}
          onChange={(e) => setData({ description: e.target.value })}
          placeholder="One line — what this mode is for"
          style={inputStyle(t)}
          autoComplete="off"
        />
      </div>
      <div>
        <span style={labelStyle(t)}>Icon</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {WIZARD_MODE_ICONS.map((icon) => {
            const selected = data.icon === icon
            return (
              <button
                key={icon}
                type="button"
                title={icon}
                aria-label={`Select icon ${icon}`}
                aria-pressed={selected}
                onClick={() => setData({ icon })}
                style={{
                  width: 40,
                  height: 40,
                  fontSize: 20,
                  lineHeight: 1,
                  borderRadius: 10,
                  border: selected ? `2px solid ${t.accentColor}` : `1px solid ${t.border}`,
                  background: selected ? t.cardBg : t.inputBg,
                  cursor: 'pointer',
                  padding: 0,
                  boxSizing: 'border-box',
                }}
              >
                {icon}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
