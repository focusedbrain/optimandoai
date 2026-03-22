/**
 * Full-screen AutoSort session review with category/urgency charts and AI highlights.
 */

import { useEffect, useState, useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import './handshakeViewTypes'

const CATEGORY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  important: '#ea580c',
  pending_review: '#d97706',
  normal: '#3b82f6',
  newsletter: '#8b5cf6',
  spam: '#94a3b8',
  irrelevant: '#94a3b8',
}

const URGENCY_BUCKET_META: { name: string; fill: string; min: number; max: number }[] = [
  { name: 'Low', fill: '#94a3b8', min: 1, max: 3 },
  { name: 'Medium', fill: '#3b82f6', min: 4, max: 6 },
  { name: 'High', fill: '#d97706', min: 7, max: 8 },
  { name: 'Critical', fill: '#dc2626', min: 9, max: 10 },
]

function formatCategoryLabel(cat: string): string {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function bucketUrgency(score: number | null | undefined): number {
  const u = typeof score === 'number' && !Number.isNaN(score) ? Math.round(score) : 5
  if (u <= 3) return 0
  if (u <= 6) return 1
  if (u <= 8) return 2
  return 3
}

type SessionRow = {
  id?: string
  started_at?: string
  completed_at?: string
  total_messages?: number
  urgent_count?: number
  pending_review_count?: number
  pending_delete_count?: number
  archived_count?: number
  error_count?: number
  duration_ms?: number | null
  ai_summary_json?: string | null
  status?: string
}

type MessageRow = {
  id: string
  sort_category?: string | null
  urgency_score?: number | null
  from_name?: string | null
  from_address?: string | null
  subject?: string | null
  pending_delete?: number | null
  pending_review_at?: string | null
  archived?: number | null
}

type AiSummaryParsed = {
  headline?: string
  urgent_highlights?: Array<{
    idx?: number
    from?: string
    subject?: string
    reason?: string
    action?: string
    message_id?: string
  }>
  review_highlights?: Array<{
    idx?: number
    from?: string
    subject?: string
    reason?: string
    action?: string
    message_id?: string
  }>
  patterns_note?: string
}

export interface AutoSortSessionReviewProps {
  sessionId: string
  onClose: () => void
  onNavigateToMessage: (messageId: string) => void
}

export function AutoSortSessionReview({
  sessionId,
  onClose,
  onNavigateToMessage,
}: AutoSortSessionReviewProps) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<SessionRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const api = window.autosortSession
        if (!api?.getSession || !api?.getSessionMessages) {
          if (!cancelled) setSession(null)
          return
        }
        const [s, msgs] = await Promise.all([api.getSession(sessionId), api.getSessionMessages(sessionId)])
        if (cancelled) return
        setSession((s as SessionRow) ?? null)
        setMessages(Array.isArray(msgs) ? (msgs as MessageRow[]) : [])
      } catch {
        if (!cancelled) setSession(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const aiSummary = useMemo((): AiSummaryParsed | null => {
    const raw = session?.ai_summary_json
    if (!raw || typeof raw !== 'string') return null
    try {
      return JSON.parse(raw) as AiSummaryParsed
    } catch {
      return null
    }
  }, [session?.ai_summary_json])

  const summaryJsonInvalid = Boolean(session?.ai_summary_json && !aiSummary)

  const categoryData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of messages) {
      const cat = (m.sort_category || 'unknown').trim() || 'unknown'
      counts.set(cat, (counts.get(cat) || 0) + 1)
    }
    return Array.from(counts.entries()).map(([name, value]) => ({
      name: formatCategoryLabel(name),
      value,
      color: CATEGORY_COLORS[name] ?? '#64748b',
    }))
  }, [messages])

  const urgencyBarData = useMemo(() => {
    const buckets = [0, 0, 0, 0]
    for (const m of messages) {
      const idx = bucketUrgency(m.urgency_score ?? null)
      buckets[idx] += 1
    }
    return URGENCY_BUCKET_META.map((b, i) => ({
      name: b.name,
      count: buckets[i],
      fill: b.fill,
    }))
  }, [messages])

  const stats = useMemo(() => {
    const s = session
    if (s && typeof s.total_messages === 'number') {
      return {
        urgent: s.urgent_count ?? 0,
        review: s.pending_review_count ?? 0,
        delete: s.pending_delete_count ?? 0,
        archived: s.archived_count ?? 0,
        errors: s.error_count ?? 0,
      }
    }
    return {
      urgent: messages.filter(
        (m) => m.sort_category === 'urgent' || (m.urgency_score != null && m.urgency_score >= 7)
      ).length,
      review: messages.filter((m) => m.sort_category === 'pending_review' || !!m.pending_review_at).length,
      delete: messages.filter((m) => !!m.pending_delete).length,
      archived: messages.filter((m) => !!m.archived).length,
      errors: 0,
    }
  }, [session, messages])

  const metaLine = useMemo(() => {
    if (!session) return ''
    const started = session.started_at ? new Date(session.started_at).toLocaleString() : '—'
    const total = session.total_messages ?? messages.length
    const dur =
      typeof session.duration_ms === 'number' ? `${Math.round(session.duration_ms / 1000)}s` : '—'
    return `${started} · ${total} messages · ${dur}`
  }, [session, messages.length])

  if (loading) {
    return (
      <div className="session-review-overlay" onClick={onClose} role="presentation">
        <div className="session-review-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <p className="session-review-loading">Loading session…</p>
        </div>
      </div>
    )
  }

  if (!session?.id) {
    return (
      <div className="session-review-overlay" onClick={onClose} role="presentation">
        <div className="session-review-panel session-review-panel--error" onClick={(e) => e.stopPropagation()}>
          <p>Session not found</p>
          <button type="button" className="session-review-close-inline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const urgentHighlights = aiSummary?.urgent_highlights?.length ? aiSummary.urgent_highlights : []
  const reviewHighlights = aiSummary?.review_highlights?.length ? aiSummary.review_highlights : []

  return (
    <div className="session-review-overlay" onClick={onClose} role="presentation">
      <div className="session-review-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="session-review-header">
          <div>
            <h2 className="session-review-title">AutoSort Session Review</h2>
            <p className="session-review-meta">{metaLine}</p>
          </div>
          <button type="button" className="session-review-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {summaryJsonInvalid && (
          <p className="session-review-parse-warn">Could not parse saved AI summary JSON.</p>
        )}

        {aiSummary?.headline ? (
          <div className="session-review-headline">{aiSummary.headline}</div>
        ) : null}

        <div className="session-review-stats">
          <div className="stat-chip stat-chip--urgent">
            <span className="stat-chip-value">{stats.urgent}</span>
            <span className="stat-chip-label">Urgent</span>
          </div>
          <div className="stat-chip stat-chip--review">
            <span className="stat-chip-value">{stats.review}</span>
            <span className="stat-chip-label">Review</span>
          </div>
          <div className="stat-chip stat-chip--delete">
            <span className="stat-chip-value">{stats.delete}</span>
            <span className="stat-chip-label">Delete</span>
          </div>
          <div className="stat-chip stat-chip--archived">
            <span className="stat-chip-value">{stats.archived}</span>
            <span className="stat-chip-label">Archived</span>
          </div>
          {stats.errors > 0 ? (
            <div className="stat-chip stat-chip--errors">
              <span className="stat-chip-value">{stats.errors}</span>
              <span className="stat-chip-label">Errors</span>
            </div>
          ) : null}
        </div>

        <div className="session-review-charts">
          <div className="session-chart-card">
            <h3 className="session-chart-title">Category Breakdown</h3>
            {categoryData.length === 0 ? (
              <p className="session-chart-empty">No category data</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="session-chart-card">
            <h3 className="session-chart-title">Urgency Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={urgencyBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} width={32} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {urgencyBarData.map((entry, index) => (
                    <Cell key={`urg-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {urgentHighlights.length > 0 ? (
          <section className="session-review-section session-review-section--urgent">
            <h3 className="section-heading">Urgent Highlights</h3>
            <ul className="highlight-list">
              {urgentHighlights.map((h, i) => (
                <li key={`u-${i}`} className="highlight-card highlight-card--urgent">
                  <div className="highlight-card-head">
                    <strong>{h.from || 'Unknown'}</strong>
                    <span className="highlight-subj">{h.subject || '(No subject)'}</span>
                  </div>
                  {h.reason ? <p className="highlight-reason">{h.reason}</p> : null}
                  {h.action ? <p className="highlight-action">{h.action}</p> : null}
                  {h.message_id ? (
                    <button
                      type="button"
                      className="highlight-link"
                      onClick={() => onNavigateToMessage(h.message_id!)}
                    >
                      Open message
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {reviewHighlights.length > 0 ? (
          <section className="session-review-section session-review-section--review">
            <h3 className="section-heading">Review Highlights</h3>
            <ul className="highlight-list">
              {reviewHighlights.map((h, i) => (
                <li key={`r-${i}`} className="highlight-card highlight-card--review">
                  <div className="highlight-card-head">
                    <strong>{h.from || 'Unknown'}</strong>
                    <span className="highlight-subj">{h.subject || '(No subject)'}</span>
                  </div>
                  {h.reason ? <p className="highlight-reason">{h.reason}</p> : null}
                  {h.action ? <p className="highlight-action">{h.action}</p> : null}
                  {h.message_id ? (
                    <button
                      type="button"
                      className="highlight-link"
                      onClick={() => onNavigateToMessage(h.message_id!)}
                    >
                      Open message
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {aiSummary?.patterns_note ? (
          <p className="session-review-note">{aiSummary.patterns_note}</p>
        ) : null}
      </div>
    </div>
  )
}
