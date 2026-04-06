/**
 * Wizard step: session preset, session ID, session mode.
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { coerceSessionMode } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
import { SESSION_MODE_VALUES, WIZARD_SESSION_MODES } from '../wizardConstants'
import { wizardFieldColumnStyle } from '../wizardStyles'

export function StepSession({
  data,
  setData,
  t,
}: {
  data: CustomModeDraft
  setData: (patch: Partial<CustomModeDraft>) => void
  t: ReturnType<typeof getThemeTokens>
}) {
  const hasSessionId = Boolean(data.sessionId?.trim())
  const preset = hasSessionId ? 'custom' : 'default'
  const sessionModeValid = coerceSessionMode(data.sessionMode, SESSION_MODE_VALUES)

  return (
    <div style={wizardFieldColumnStyle()}>
      <div>
        <label htmlFor="cmw-session-preset" style={labelStyle(t)}>
          Session
        </label>
        <select
          id="cmw-session-preset"
          value={preset}
          onChange={(e) => {
            if (e.target.value === 'default') setData({ sessionId: null })
            else setData({ sessionId: data.sessionId || '' })
          }}
          style={{ ...inputStyle(t), cursor: 'pointer' }}
        >
          <option value="default">Default (no specific session ID)</option>
          <option value="custom">Pin a session ID…</option>
        </select>
      </div>
      {preset === 'custom' ? (
        <div>
          <label htmlFor="cmw-session-id" style={labelStyle(t)}>
            Session ID
          </label>
          <input
            id="cmw-session-id"
            type="text"
            value={data.sessionId ?? ''}
            onChange={(e) => setData({ sessionId: e.target.value.trim() ? e.target.value : null })}
            placeholder="Paste or enter a session UUID"
            style={inputStyle(t)}
            autoComplete="off"
          />
        </div>
      ) : null}
      <div>
        <span style={labelStyle(t)}>Session mode</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {WIZARD_SESSION_MODES.map((sm) => {
            const checked = sessionModeValid === sm.value
            return (
              <label
                key={sm.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${checked ? t.accentColor : t.border}`,
                  background: checked ? t.cardBg : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="cmw-session-mode"
                  checked={checked}
                  onChange={() => setData({ sessionMode: sm.value })}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: t.text }}>{sm.label}</span>
                  <span style={{ fontSize: 11, color: t.textMuted }}>{sm.hint}</span>
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
