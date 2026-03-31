/**
 * Full-screen AutoSort session review with category/urgency charts.
 * Message lists come from DB rows; AI summary supplies headline and patterns_note only.
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
import type { SessionReviewMessageRow } from '../lib/inboxSessionReviewOpen'
import {
  aggregateReceivedByDay,
  aggregateReplyNeededForSessionReview,
  aggregateTopSenders,
  formatSessionReviewReceivedAtShort,
  SENDER_BAR_COLORS,
} from '../lib/autoSortSessionReviewCharts'

const MESSAGES_PER_PAGE = 50

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

function MessageListRow({
  msg,
  onNavigate,
}: {
  msg: SessionReviewMessageRow
  onNavigate: (msg: SessionReviewMessageRow) => void
}) {
  const sender = msg.from_name || msg.from_address || 'Unknown'
  const subject = msg.subject || '(No subject)'
  const category = (msg.sort_category || 'unknown').replace(/_/g, ' ')
  const urgency = msg.urgency_score ?? 0
  const reason = (msg.sort_reason || '').trim()
  const receivedLabel = formatSessionReviewReceivedAtShort(msg.received_at)

  return (
    <div
      className="session-msg-row"
      onClick={() => onNavigate(msg)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate(msg)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="session-msg-main">
        <div className="session-msg-line1">
          <span className="session-msg-sender">{sender}</span>
          <span className="session-msg-date" title="Received">
            {receivedLabel}
          </span>
          <span className="session-msg-subject">{subject}</span>
        </div>
        {reason ? <p className="session-msg-reason">{reason}</p> : null}
      </div>
      <div className="session-msg-meta">
        <span className={`session-msg-cat session-msg-cat--${msg.sort_category || 'unknown'}`}>{category}</span>
        {urgency >= 7 ? <span className="session-msg-urgency">⚡ {urgency}</span> : null}
      </div>
      <button
        type="button"
        className="highlight-link session-msg-open"
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(msg)
        }}
      >
        Open message
      </button>
    </div>
  )
}

type AiSummaryParsed = {
  headline?: string
  patterns_note?: string
}

export interface AutoSortSessionReviewProps {
  sessionId: string
  onClose: () => void
  onNavigateToMessage: (msg: SessionReviewMessageRow) => void
}

export function AutoSortSessionReview({
  sessionId,
  onClose,
  onNavigateToMessage,
}: AutoSortSessionReviewProps) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<SessionRow | null>(null)
  const [messages, setMessages] = useState<SessionReviewMessageRow[]>([])
  const [otherMessagesExpanded, setOtherMessagesExpanded] = useState(false)
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE)
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
        setMessages(Array.isArray(msgs) ? (msgs as SessionReviewMessageRow[]) : [])
        setVisibleCount(MESSAGES_PER_PAGE)
        setOtherMessagesExpanded(false)
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

  const replyNeededData = useMemo(() => aggregateReplyNeededForSessionReview(messages), [messages])

  const topSendersData = useMemo(() => aggregateTopSenders(messages), [messages])

  const receivedDayData = useMemo(() => aggregateReceivedByDay(messages), [messages])

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
      review: messages.filter(
        (m) =>
          m.sort_category === 'pending_review' ||
          m.sort_category === 'important' ||
          !!m.pending_review_at,
      ).length,
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

  const messageGroups = useMemo(() => {
    const urgent: SessionReviewMessageRow[] = []
    const pendingReview: SessionReviewMessageRow[] = []
    const other: SessionReviewMessageRow[] = []

    for (const m of messages) {
      const isUrgent = m.sort_category === 'urgent' || (m.urgency_score != null && m.urgency_score >= 7)
      const isPendingReview =
        m.sort_category === 'pending_review' || m.sort_category === 'important' || !!m.pending_review_at

      if (isUrgent) {
        urgent.push(m)
      } else if (isPendingReview) {
        pendingReview.push(m)
      } else {
        other.push(m)
      }
    }

    urgent.sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0))
    pendingReview.sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0))

    return { urgent, pendingReview, other }
  }, [messages])

  if (loading) {
    return (
      <div className="session-review-overlay" onClick={onClose} role="presentation">
        <div
          className="session-review-panel session-review-panel--loading"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <p className="session-review-loading">Loading session…</p>
        </div>
      </div>
    )
  }

  if (!session?.id) {
    return (
      <div className="session-review-overlay" onClick={onClose} role="presentation">
        <div
          className="session-review-panel session-review-panel--error"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <p>Session not found</p>
          <button type="button" className="session-review-close-inline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

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

        <div className="session-review-body">
          <div className="session-review-main">
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
                <span className="stat-chip-label">Pending Review</span>
              </div>
              <div className="stat-chip stat-chip--delete">
                <span className="stat-chip-value">{stats.delete}</span>
                <span className="stat-chip-label">Pending Delete</span>
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

            {messageGroups.urgent.length > 0 ? (
              <section className="session-review-section">
                <h3 className="section-heading section-heading--urgent">
                  ⚡ Urgent Messages ({messageGroups.urgent.length})
                </h3>
                <div className="session-msg-list">
                  {messageGroups.urgent.map((m) => (
                    <MessageListRow key={m.id} msg={m} onNavigate={onNavigateToMessage} />
                  ))}
                </div>
              </section>
            ) : null}

            {messageGroups.pendingReview.length > 0 ? (
              <section className="session-review-section">
                <h3 className="section-heading section-heading--review">
                  🔍 Pending Review ({messageGroups.pendingReview.length})
                </h3>
                <div className="session-msg-list">
                  {messageGroups.pendingReview.map((m) => (
                    <MessageListRow key={m.id} msg={m} onNavigate={onNavigateToMessage} />
                  ))}
                </div>
              </section>
            ) : null}

            {messageGroups.other.length > 0 ? (
              <section className="session-review-section">
                <button
                  type="button"
                  className="session-other-toggle"
                  onClick={() => {
                    setOtherMessagesExpanded((prev) => !prev)
                    setVisibleCount(MESSAGES_PER_PAGE)
                  }}
                >
                  <span>
                    {otherMessagesExpanded ? '▾' : '▸'} Other Messages ({messageGroups.other.length})
                  </span>
                  <span className="session-other-hint">
                    {otherMessagesExpanded ? 'Click to collapse' : 'Pending Delete, Archived, Normal…'}
                  </span>
                </button>
                {otherMessagesExpanded ? (
                  <div className="session-msg-list">
                    {messageGroups.other.slice(0, visibleCount).map((m) => (
                      <MessageListRow key={m.id} msg={m} onNavigate={onNavigateToMessage} />
                    ))}
                    {visibleCount < messageGroups.other.length ? (
                      <button
                        type="button"
                        className="session-load-more"
                        onClick={() => setVisibleCount((prev) => prev + MESSAGES_PER_PAGE)}
                      >
                        Load more ({messageGroups.other.length - visibleCount} remaining)
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {aiSummary?.patterns_note ? (
              <p className="session-review-note">{aiSummary.patterns_note}</p>
            ) : null}
          </div>

          <aside className="session-review-sidebar" aria-label="Session charts">
            <div className="session-chart-card">
              <h3 className="session-chart-title">Category Breakdown</h3>
              {categoryData.length === 0 ? (
                <p className="session-chart-empty">No category data</p>
              ) : (
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
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
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={urgencyBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {urgencyBarData.map((entry, index) => (
                      <Cell key={`urg-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="session-chart-card">
              <h3 className="session-chart-title">Reply needed</h3>
              {replyNeededData.length === 0 ? (
                <p className="session-chart-empty">No messages</p>
              ) : (
                <ResponsiveContainer width="100%" height={128}>
                  <PieChart>
                    <Pie
                      data={replyNeededData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={48}
                      paddingAngle={2}
                    >
                      {replyNeededData.map((entry, index) => (
                        <Cell key={`reply-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="session-chart-card">
              <h3 className="session-chart-title">Top senders</h3>
              {topSendersData.length === 0 ? (
                <p className="session-chart-empty">No sender data</p>
              ) : (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart
                    layout="vertical"
                    data={topSendersData}
                    margin={{ top: 4, right: 10, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={78} tick={{ fontSize: 9 }} interval={0} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {topSendersData.map((entry, index) => (
                        <Cell key={`snd-${index}`} fill={SENDER_BAR_COLORS[index % SENDER_BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="session-chart-card">
              <h3 className="session-chart-title">Received (by day)</h3>
              {receivedDayData.length === 0 ? (
                <p className="session-chart-empty">No received dates</p>
              ) : (
                <ResponsiveContainer width="100%" height={132}>
                  <BarChart data={receivedDayData} margin={{ top: 8, right: 8, left: 2, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                    <YAxis allowDecimals={false} width={24} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {receivedDayData.map((entry, index) => (
                        <Cell key={`day-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
