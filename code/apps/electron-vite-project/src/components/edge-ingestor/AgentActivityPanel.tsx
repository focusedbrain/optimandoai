/**
 * Verification server activity — structured Agent log stream (PR7).
 */

import { useMemo, useState } from 'react'
import { useAgentActivity, type AgentActivityEvent } from '../../hooks/useAgentActivity.js'

const levelColor: Record<string, string> = {
  debug: '#94a3b8',
  info: '#2563eb',
  warn: '#d97706',
  error: '#dc2626',
  critical: '#7f1d1d',
}

function formatWhen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export interface AgentActivityPanelProps {
  handshakeId: string | null | undefined
}

export function AgentActivityPanel({ handshakeId }: AgentActivityPanelProps) {
  const { events, reachability, lastError, loading, refresh } = useAgentActivity(handshakeId)
  const [codeFilter, setCodeFilter] = useState('')
  const [showDebug, setShowDebug] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (!showDebug && ev.level === 'debug') return false
      if (codeFilter.trim() && !ev.event_code.includes(codeFilter.trim())) return false
      return true
    })
  }, [events, showDebug, codeFilter])

  const exportJson = async () => {
    const api = (window as { edgeAgent?: { exportActivity?: (q: unknown) => Promise<unknown> } })
      .edgeAgent
    if (!api?.exportActivity || !handshakeId) return
    const res = (await api.exportActivity({ handshake_id: handshakeId })) as {
      ok?: boolean
      data?: AgentActivityEvent[]
    }
    if (!res.ok || !res.data) return
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `verification-server-activity-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!handshakeId) {
    return (
      <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 0' }}>
        Pair a verification server to view activity.
      </p>
    )
  }

  return (
    <div style={{ marginTop: 12 }} data-testid="agent-activity-panel">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>Verification server activity</strong>
        {reachability === 'unreachable' && (
          <span style={{ fontSize: 11, color: '#b45309' }}>Agent unreachable{lastError ? `: ${lastError}` : ''}</span>
        )}
        {reachability === 'reachable' && (
          <span style={{ fontSize: 11, color: '#15803d' }}>Connected</span>
        )}
        <button type="button" style={{ fontSize: 11 }} onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
        <button type="button" style={{ fontSize: 11 }} onClick={() => void exportJson()}>
          Export JSON…
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          placeholder="Filter event_code"
          value={codeFilter}
          onChange={(e) => setCodeFilter(e.target.value)}
          style={{ fontSize: 11, padding: '4px 8px', flex: '1 1 140px' }}
        />
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
          Show debug
        </label>
      </div>
      {filtered.length === 0 ? (
        <p style={{ fontSize: 12, color: '#64748b' }}>
          {loading ? 'Connecting to your verification server…' : 'No activity yet.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflow: 'auto' }}>
          {filtered.map((ev) => (
            <li
              key={ev.event_id}
              style={{
                borderBottom: '1px solid rgba(15,23,42,0.08)',
                padding: '6px 0',
                fontSize: 11,
              }}
            >
              <button
                type="button"
                onClick={() => setExpanded(expanded === ev.event_id ? null : ev.event_id)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'block',
                  width: '100%',
                }}
              >
                <span style={{ color: levelColor[ev.level] ?? '#334155', fontWeight: 600 }}>
                  {ev.level}
                </span>{' '}
                <span title={ev.timestamp_iso}>{formatWhen(ev.timestamp_iso)}</span> ·{' '}
                <span style={{ color: '#64748b' }}>{ev.source}</span> — {ev.message}
                <div style={{ color: '#94a3b8', fontSize: 10 }}>{ev.event_code}</div>
              </button>
              {expanded === ev.event_id && (
                <pre
                  style={{
                    margin: '6px 0 0',
                    padding: 8,
                    background: 'rgba(15,23,42,0.04)',
                    borderRadius: 6,
                    fontSize: 10,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(ev.fields, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
      <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
        Export may contain detailed operational data from your verification server. Review before sharing.
      </p>
    </div>
  )
}
