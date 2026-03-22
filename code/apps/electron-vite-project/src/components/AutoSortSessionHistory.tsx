/**
 * List of past AutoSort sessions — open review or delete.
 */

import { useEffect, useState, useCallback } from 'react'
import './handshakeViewTypes'

type SessionRow = {
  id: string
  started_at?: string | null
  completed_at?: string | null
  total_messages?: number | null
  urgent_count?: number | null
  pending_review_count?: number | null
  duration_ms?: number | null
  status?: string | null
}

export interface AutoSortSessionHistoryProps {
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}

export function AutoSortSessionHistory({ onClose, onOpenSession }: AutoSortSessionHistoryProps) {
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<SessionRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const api = window.autosortSession
      if (!api?.listSessions) {
        setSessions([])
        return
      }
      const rows = await api.listSessions(100)
      setSessions(Array.isArray(rows) ? (rows as SessionRow[]) : [])
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await window.autosortSession?.deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.error('[AutoSort] deleteSession failed:', err)
    }
  }

  return (
    <div className="session-review-overlay" onClick={onClose} role="presentation">
      <div className="session-history-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="session-history-header">
          <h2 className="session-history-title">AutoSort History</h2>
          <button type="button" className="session-review-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {loading ? (
          <p className="session-history-loading">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="session-history-empty">
            No AutoSort sessions recorded yet. Run AI Auto-Sort to create your first session.
          </p>
        ) : (
          <div className="session-history-list">
            {sessions.map((row) => {
              const started = row.started_at ? new Date(row.started_at) : null
              const dateStr = started
                ? `${started.toLocaleDateString()} ${started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                : '—'
              const durSec =
                typeof row.duration_ms === 'number' && row.duration_ms >= 0
                  ? Math.round(row.duration_ms / 1000)
                  : null
              const total = row.total_messages ?? 0
              const urgent = row.urgent_count ?? 0
              const review = row.pending_review_count ?? 0

              return (
                <div
                  key={row.id}
                  className="session-history-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenSession(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenSession(row.id)
                    }
                  }}
                >
                  <div className="session-history-info">
                    <div className="session-history-top-line">
                      <span className="session-history-date">{dateStr}</span>
                      {durSec != null ? <span className="session-history-duration">{durSec}s</span> : null}
                    </div>
                    <div className="session-history-badges">
                      <span className="sh-badge sh-badge-total">{total} messages</span>
                      {urgent > 0 ? <span className="sh-badge sh-badge-urgent">{urgent} urgent</span> : null}
                      {review > 0 ? <span className="sh-badge sh-badge-review">{review} review</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="session-history-delete"
                    title="Delete session"
                    aria-label="Delete session"
                    onClick={(e) => void handleDelete(e, row.id)}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
