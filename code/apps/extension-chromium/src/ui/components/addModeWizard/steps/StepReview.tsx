/**
 * Wizard step: read-only summary before save.
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import {
  getDiffWatchFoldersDraftText,
  getScopeUrlsDraftText,
  getCustomModeTriggerBarIcon,
} from '../../../../shared/ui/customModeTypes'
import { formatCustomModeIntervalPresetLabel } from '../../../../shared/ui/customModeIntervalPresets'
import { safeDraftString } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens } from '../../../../shared/ui/lightboxTheme'
import { wizardReviewRowStyle } from '../wizardStyles'

export function StepReview({
  data,
  t,
}: {
  data: CustomModeDraft
  t: ReturnType<typeof getThemeTokens>
}) {
  const sid = typeof data.sessionId === 'string' ? data.sessionId.trim() : ''
  const sessionName =
    typeof (data.metadata as { _sessionLabel?: string } | undefined)?._sessionLabel === 'string'
      ? (data.metadata as { _sessionLabel: string })._sessionLabel.trim()
      : ''
  const sessionLabel = sessionName
    ? sessionName
    : sid
      ? `Linked session: ${sid.slice(0, 28)}${sid.length > 28 ? '…' : ''}`
      : 'None (default WR Chat session)'
  const intervalLine =
    data.intervalSeconds != null && data.intervalSeconds >= 1
      ? formatCustomModeIntervalPresetLabel(data.intervalSeconds)
      : '—'

  const nameSafe = safeDraftString(data.name).trim()
  const modelSafe = safeDraftString(data.modelName).trim()
  const focusSafe = safeDraftString(data.searchFocus).trim()
  const md = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : undefined
  const wrName =
    md && typeof md.wrExpertFileName === 'string' && md.wrExpertFileName.trim()
      ? md.wrExpertFileName.trim()
      : ''
  const wrLoaded = Boolean(md?.wrExpertProfile && typeof md.wrExpertProfile === 'object')
  const scopeUrlsReview = getScopeUrlsDraftText(md).trim()
  const diffFolderReview =
    getDiffWatchFoldersDraftText(md)
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('; ') || '—'

  const triggerBarReview = getCustomModeTriggerBarIcon(md) || '—'

  const rows: { k: string; v: string }[] = [
    { k: 'Name', v: nameSafe || '—' },
    { k: 'Description', v: safeDraftString(data.description).trim() || '—' },
    { k: 'Icon', v: (typeof data.icon === 'string' && data.icon.trim()) || '—' },
    { k: 'Header menu icon', v: triggerBarReview },
    { k: 'Provider', v: safeDraftString(data.modelProvider) || '—' },
    {
      k: 'Model',
      v: modelSafe || 'Active WR Chat model (no preset)',
    },
    ...(String(data.modelProvider ?? '').toLowerCase() === 'ollama'
      ? [{ k: 'Endpoint', v: safeDraftString(data.endpoint).trim() || '—' }]
      : []),
    { k: 'Session', v: sessionLabel },
    { k: 'Detection focus', v: focusSafe || '—' },
    {
      k: 'WR Expert profile',
      v: wrLoaded ? (wrName ? `Loaded: ${wrName}` : 'Loaded (parsed rules)') : '—',
    },
    { k: 'Scope URLs', v: scopeUrlsReview || '—' },
    { k: 'Diff watch folders', v: diffFolderReview },
    { k: 'Ignore patterns', v: safeDraftString(data.ignoreInstructions).trim() || '—' },
    { k: 'Periodic scan', v: intervalLine },
  ]

  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: t.textMuted }}>
        Review your automation before saving. Use Back to edit a step.
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
