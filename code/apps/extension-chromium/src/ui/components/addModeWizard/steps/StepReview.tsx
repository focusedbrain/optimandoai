/**
 * Wizard step: read-only summary before save.
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { coerceRunMode, safeDraftString } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens } from '../../../../shared/ui/lightboxTheme'
import { RUN_MODE_VALUES, WIZARD_RUN_MODES, WIZARD_SESSION_MODES } from '../wizardConstants'
import { wizardReviewRowStyle } from '../wizardStyles'

export function StepReview({
  data,
  t,
}: {
  data: CustomModeDraft
  t: ReturnType<typeof getThemeTokens>
}) {
  const sid = typeof data.sessionId === 'string' ? data.sessionId.trim() : ''
  const sessionLabel = sid
    ? `Pinned: ${sid.slice(0, 24)}${sid.length > 24 ? '…' : ''}`
    : 'Default'

  const sessionModeLabel =
    WIZARD_SESSION_MODES.find((s) => s.value === data.sessionMode)?.label ?? String(data.sessionMode ?? '—')
  const runModeSafe = coerceRunMode(data.runMode, RUN_MODE_VALUES)
  const runLabel = WIZARD_RUN_MODES.find((r) => r.value === runModeSafe)?.label ?? String(data.runMode ?? '—')
  const intervalLine =
    runModeSafe === 'interval' && data.intervalMinutes != null
      ? `${data.intervalMinutes} min`
      : '—'

  const nameSafe = safeDraftString(data.name).trim()
  const modelSafe = safeDraftString(data.modelName).trim()
  const focusSafe = safeDraftString(data.searchFocus).trim()

  const rows: { k: string; v: string }[] = [
    { k: 'Name', v: nameSafe || '—' },
    { k: 'Description', v: safeDraftString(data.description).trim() || '—' },
    { k: 'Icon', v: (typeof data.icon === 'string' && data.icon.trim()) || '—' },
    { k: 'Provider', v: safeDraftString(data.modelProvider) || '—' },
    { k: 'Model', v: modelSafe || '—' },
    ...(String(data.modelProvider ?? '').toLowerCase() === 'ollama'
      ? [{ k: 'Endpoint', v: safeDraftString(data.endpoint).trim() || '—' }]
      : []),
    { k: 'Session', v: sessionLabel },
    { k: 'Session mode', v: sessionModeLabel },
    { k: 'Focus', v: focusSafe || '—' },
    { k: 'Ignore', v: safeDraftString(data.ignoreInstructions).trim() || '—' },
    { k: 'Run', v: runLabel },
    { k: 'Interval', v: intervalLine },
  ]

  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: t.textMuted }}>
        Review your mode before saving. Use Back to edit a step.
      </p>
      <div style={{ borderTop: `1px solid ${t.border}` }}>
        {rows.map((r) => (
          <div key={r.k} style={wizardReviewRowStyle(t)}>
            <span style={{ color: t.textMuted, fontWeight: 600 }}>{r.k}</span>
            <span style={{ color: t.text, wordBreak: 'break-word' }}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
