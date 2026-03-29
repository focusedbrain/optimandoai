/**
 * UrgentMessagesPanel — premium urgent message triage for WR Desk™.
 *
 * Drop-in replacement for UrgentAutosortSessionSection with identical props.
 * Same logic (workflowFilterFromSessionReviewRow, compactUrgentReason, etc.)
 * with a premium visual overhaul: urgency score bars, hover elevation, skeletons.
 *
 * DO NOT modify UrgentAutosortSessionSection.tsx — this is a parallel component.
 * Swap into AnalysisCanvas in Prompt 5.
 */

import '../../handshakeViewTypes'
import type {
  AnalysisDashboardAutosortMessageRef,
  AnalysisDashboardSnapshot,
} from '../../../types/analysisDashboardSnapshot'
import {
  workflowFilterFromSessionReviewRow,
  type SessionReviewMessageRow,
} from '../../../lib/inboxSessionReviewOpen'
import type { InboxFilter } from '../../../stores/useEmailInboxStore'
import type { OpenInboxMessagePayload } from './UrgentAutosortSessionSection'
import '../../../styles/dashboard-tokens.css'
import '../../../styles/dashboard-base.css'
import './UrgentMessagesPanel.css'

// ── Props (identical to UrgentAutosortSessionSection) ─────────────────────────

export interface UrgentMessagesPanelProps {
  snapshot: AnalysisDashboardSnapshot | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onOpenInboxMessage?: (payload: OpenInboxMessagePayload) => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VISIBLE_URGENT_CAP = 10

// ── Helpers (same logic as UrgentAutosortSessionSection) ──────────────────────

function toSessionReviewRow(m: AnalysisDashboardAutosortMessageRef): SessionReviewMessageRow {
  return {
    id:               m.messageId,
    received_at:      m.receivedAt,
    sort_category:    m.sortCategory,
    urgency_score:    m.urgencyScore,
    needs_reply:      m.needsReply,
    sort_reason:      m.sortReason,
    from_name:        m.fromName,
    from_address:     m.fromAddress,
    subject:          m.subject,
    pending_delete:   m.pendingDelete,
    pending_review_at: m.pendingReviewAt,
    archived:         m.archived,
  }
}

function formatTimeCompact(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function participantDisplay(m: AnalysisDashboardAutosortMessageRef): { line: string; full: string } {
  const name = (m.fromName ?? '').trim()
  const addr = (m.fromAddress ?? '').trim()
  const full = name && addr ? `${name} · ${addr}` : name || addr || 'Unknown sender'
  const line = name || addr || 'Unknown sender'
  return { line, full }
}

function compactUrgentReason(m: AnalysisDashboardAutosortMessageRef): string {
  const reason = (m.sortReason ?? '').trim().replace(/\s+/g, ' ')
  if (reason) return reason.length > 100 ? `${reason.slice(0, 97)}…` : reason
  const cat = (m.sortCategory ?? '').trim().toLowerCase()
  const u = m.urgencyScore
  if (cat === 'urgent') {
    return typeof u === 'number' && !Number.isNaN(u) ? `Urgent queue · score ${u}/10` : 'Urgent queue'
  }
  if (typeof u === 'number' && !Number.isNaN(u) && u >= 7) return `High priority · ${u}/10`
  if (cat) return `Flagged · ${cat.replace(/_/g, ' ')}`
  return 'Flagged in this sort'
}

function triageMetaLine(m: AnalysisDashboardAutosortMessageRef): string | null {
  const parts: string[] = []
  if ((m.needsReply ?? 0) === 1) parts.push('Reply needed')
  const cat = (m.sortCategory ?? '').trim().toLowerCase()
  if (cat === 'pending_review') parts.push('Pending review')
  if ((m.pendingDelete ?? 0) === 1) parts.push('Pending delete')
  if (m.pendingReviewAt != null && String(m.pendingReviewAt).trim() !== '') parts.push('Review scheduled')
  return parts.length > 0 ? parts.join(' · ') : null
}

function sessionIdShort(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}

/**
 * Maps a 0–10 urgency score to a CSS modifier class.
 * Returns 'mid' when score is null (unknown priority).
 */
function scoreLevel(score: number | null | undefined): 'low' | 'mid' | 'high' {
  if (score === null || score === undefined) return 'mid'
  if (score <= 3) return 'low'
  if (score <= 6) return 'mid'
  return 'high'
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="upm__skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="upm__skeleton-row">
          <span className="dash-skeleton upm__skeleton-score" />
          <div className="upm__skeleton-content">
            <span className="dash-skeleton" style={{ height: '11px', width: '55%' }} />
            <span className="dash-skeleton" style={{ height: '11px', width: '80%' }} />
            <span className="dash-skeleton" style={{ height: '9px', width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────

function MessageRow({
  m,
  onOpen,
}: {
  m: AnalysisDashboardAutosortMessageRef
  onOpen?: (payload: OpenInboxMessagePayload) => void
}) {
  const { line: senderLine, full: senderFull } = participantDisplay(m)
  const subject = (m.subject ?? '').trim() || '(No subject)'
  const reason  = compactUrgentReason(m)
  const meta    = triageMetaLine(m)
  const level   = scoreLevel(m.urgencyScore)
  const score   = m.urgencyScore

  const tab: InboxFilter['filter'] = workflowFilterFromSessionReviewRow(toSessionReviewRow(m))
  const canOpen = typeof onOpen === 'function'
  const heightPct = score !== null && score !== undefined
    ? `${Math.round((score / 10) * 100)}%`
    : '50%'
  const isCritical = score !== null && score !== undefined && score >= 8

  function handleActivate() {
    if (!canOpen) return
    onOpen({ messageId: m.messageId, workflowTab: tab })
  }

  return (
    <li
      className={[
        'upm__row',
        !canOpen ? 'upm__row--disabled' : '',
        isCritical ? 'upm__row--critical' : '',
      ].filter(Boolean).join(' ')}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-label={canOpen ? `Open: ${senderLine} — ${subject}` : undefined}
      title={canOpen ? `Open in Inbox · tab: ${tab.replace(/_/g, ' ')}` : undefined}
      onClick={handleActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivate() } }}
    >
      {/* Vertical urgency bar */}
      <div className="upm__score-col" aria-label={`Urgency ${score ?? '?'}/10`}>
        <div className="upm__score-bar-track">
          <div
            className={`upm__score-bar-fill upm__score-bar-fill--${level}`}
            style={{ height: heightPct }}
          />
        </div>
        {score !== null && score !== undefined && (
          <span className="upm__score-num">{score}</span>
        )}
      </div>

      {/* Message content */}
      <div className="upm__content">
        <div className="upm__row1">
          <span className="upm__sender" title={senderFull}>{senderLine}</span>
          <time className="upm__when" dateTime={m.receivedAt ?? undefined}>
            {formatTimeCompact(m.receivedAt)}
          </time>
        </div>
        <p className="upm__subject" title={subject}>{subject}</p>
        <p className="upm__reason">
          <span className="upm__reason-k">Why</span>{reason}
        </p>
        {meta && <p className="upm__flags">{meta}</p>}
      </div>
    </li>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function UrgentMessagesPanel({
  snapshot,
  loading,
  error,
  onRefresh,
  onOpenInboxMessage,
}: UrgentMessagesPanelProps) {
  const latest   = snapshot?.autosort?.latestSession ?? null
  const messages = (snapshot?.autosort?.urgentSessionMessages ?? []).slice(0, VISIBLE_URGENT_CAP)
  const totalFetched = snapshot?.autosort?.urgentSessionMessages?.length ?? 0
  const sessionId    = latest?.sessionId ?? null

  const sessionCtx =
    sessionId != null
      ? [
          sessionIdShort(sessionId),
          latest?.completedAt ? formatTimeCompact(latest.completedAt) : null,
          typeof latest?.totalMessages === 'number' ? `${latest.totalMessages} msg` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  const badgeMod = messages.length > 0 ? 'threat' : 'clear'

  return (
    <section className="upm" aria-labelledby="upm-heading">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="upm__head">
        <div className="upm__head-left">
          <h2 id="upm-heading" className="upm__title">Priority Inbox</h2>
          <span className={`upm__badge upm__badge--${badgeMod}`} aria-live="polite">
            {loading ? '…' : messages.length}
          </span>
        </div>
        <div className="upm__head-actions">
          <button
            type="button"
            className={`upm__refresh-btn${loading ? ' upm__refresh-btn--spinning' : ''}`}
            disabled={loading}
            onClick={() => void onRefresh()}
            aria-label="Refresh urgent messages"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Session context line ────────────────────────────────────────── */}
      {sessionCtx && !loading && (
        <div className="upm__session-ctx" aria-label="Sort session context">
          <span className="upm__session-id">{sessionCtx}</span>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading ? (
        <SkeletonRows count={4} />
      ) : error ? (
        <div className="upm__empty">
          <p className="upm__error-text">{error}</p>
          <button type="button" className="dash-btn-ghost dash-btn-sm" onClick={() => void onRefresh()}>
            Retry
          </button>
        </div>
      ) : sessionId === null ? (
        <div className="upm__empty">
          <span className="upm__empty-icon" aria-hidden>⚡</span>
          <p className="upm__empty-text">No sort session — run Auto-Sort first</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="upm__empty">
          <span className="upm__empty-icon" aria-hidden>✓</span>
          <p className="upm__empty-text">No urgent messages from latest sort</p>
        </div>
      ) : (
        <>
          <ul className="upm__list" aria-label="Urgent messages from latest sort">
            {messages.map((m) => (
              <MessageRow key={m.messageId} m={m} onOpen={onOpenInboxMessage} />
            ))}
          </ul>
          {totalFetched >= VISIBLE_URGENT_CAP && (
            <p className="upm__cap">Showing top {VISIBLE_URGENT_CAP} · ordered by urgency score</p>
          )}
        </>
      )}
    </section>
  )
}
