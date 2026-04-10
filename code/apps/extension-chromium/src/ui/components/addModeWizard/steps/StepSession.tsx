/**
 * Wizard step: link this custom mode to a WR Chat session from orchestrator history.
 * Session mode (shared/dedicated/fresh) is not exposed — routing matches other WR Chat modes (icon + speech bubble).
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { fetchOrchestratorSessionsForWizard } from '../../../../services/fetchOrchestratorSessionsList'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
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
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setHint(null)
    try {
      const list = await fetchOrchestratorSessionsForWizard()
      setSessions(list)
      if (list.length === 0) {
        setHint(
          'No sessions in history yet — open WR Chat at least once, or ensure WR Desk is running.',
        )
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type === 'SESSION_DISPLAY_NAME_UPDATED') void load()
    }
    chrome.runtime.onMessage.addListener(onMsg as Parameters<typeof chrome.runtime.onMessage.addListener>[0])
    return () => chrome.runtime.onMessage.removeListener(onMsg as Parameters<typeof chrome.runtime.onMessage.addListener>[0])
  }, [load])

  /** Custom modes always use shared session semantics; speech-bubble focus selects the mode like other triggers. */
  useEffect(() => {
    setData({ sessionMode: 'shared' })
  }, [setData])

  const currentId = typeof data.sessionId === 'string' ? data.sessionId.trim() : ''
  const selectValue =
    currentId && sessions.some((s) => s.id === currentId)
      ? currentId
      : currentId
        ? `__orphan__:${currentId}`
        : ''

  return (
    <div style={wizardFieldColumnStyle()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor="cmw-session-history" style={labelStyle(t)}>
          WR Chat session
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            ...inputStyle(t),
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            width: 'auto',
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>
        Optional: tie this automation to a session from your history so WR Chat uses that thread when you select it
        (same flow as other automations — pick the icon, then use the speech bubble to focus WR Chat).
      </p>
      {hint ? <p style={{ margin: '0 0 8px', fontSize: 11, color: t.textMuted }}>{hint}</p> : null}
      <select
        id="cmw-session-history"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value
          if (v.startsWith('__orphan__:')) return
          if (v === '') {
            setData({
              sessionId: null,
              sessionMode: 'shared',
              metadata: { _sessionLabel: '' },
            })
            return
          }
          const row = sessions.find((s) => s.id === v)
          setData({
            sessionId: v,
            sessionMode: 'shared',
            metadata: { _sessionLabel: row?.name ?? v },
          })
        }}
        disabled={loading && sessions.length === 0}
        style={{ ...inputStyle(t), cursor: 'pointer' }}
      >
        <option value="">
          {loading && sessions.length === 0 ? 'Loading sessions…' : 'None — default WR Chat session'}
        </option>
        {selectValue.startsWith('__orphan__:') ? (
          <option value={selectValue} disabled>
            {currentId.slice(0, 20)}
            {currentId.length > 20 ? '…' : ''} (not in current history)
          </option>
        ) : null}
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  )
}
