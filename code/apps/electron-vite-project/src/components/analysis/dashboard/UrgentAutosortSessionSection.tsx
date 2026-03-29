/**
 * Urgent messages from the latest completed Auto-Sort session — compact command-center triage.
 */

import '../../handshakeViewTypes'
import type { AnalysisDashboardAutosortMessageRef, AnalysisDashboardSnapshot } from '../../../types/analysisDashboardSnapshot'
import {
  workflowFilterFromSessionReviewRow,
  type SessionReviewMessageRow,
} from '../../../lib/inboxSessionReviewOpen'
import type { InboxFilter } from '../../../stores/useEmailInboxStore'
import './UrgentAutosortSessionSection.css'

const VISIBLE_URGENT_CAP = 10

export type OpenInboxMessagePayload = {
  messageId: string
  workflowTab: InboxFilter['filter']
}

export interface UrgentAutosortSessionSectionProps {
  onOpenInboxMessage?: (payload: OpenInboxMessagePayload) => void
  snapshot: AnalysisDashboardSnapshot | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}

function toSessionReviewRow(m: AnalysisDashboardAutosortMessageRef): SessionReviewMessageRow {
  return {
    id: m.messageId,
    received_at: m.receivedAt,
    sort_category: m.sortCategory,
    urgency_score: m.urgencyScore,
    needs_reply: m.needsReply,
    sort_reason: m.sortReason,
    from_name: m.fromName,
    from_address: m.fromAddress,
    subject: m.subject,
    pending_delete: m.pendingDelete,
    pending_review_at: m.pendingReviewAt,
    archived: m.archived,
  }
}

/** Short stamp for scanning (e.g. Mar 29, 2:30 PM) */
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

/**
 * One line, ≤ ~100 chars: model reason if any, else category/score fallback.
 */
function compactUrgentReason(m: AnalysisDashboardAutosortMessageRef): string {
  const reason = (m.sortReason ?? '').trim().replace(/\s+/g, ' ')
  if (reason) {
    return reason.length > 100 ? `${reason.slice(0, 97)}…` : reason
  }
  const cat = (m.sortCategory ?? '').trim().toLowerCase()
  const u = m.urgencyScore
  if (cat === 'urgent') {
    return typeof u === 'number' && !Number.isNaN(u) ? `Urgent queue · score ${u}/10` : 'Urgent queue'
  }
  if (typeof u === 'number' && !Number.isNaN(u) && u >= 7) {
    return `High priority · ${u}/10`
  }
  if (cat) return `Flagged · ${cat.replace(/_/g, ' ')}`
  return 'Flagged in this sort'
}

/** Review / workflow signals for scanning (reply, pending review, delete, scheduled). */
function triageMetaLine(m: AnalysisDashboardAutosortMessageRef): string | null {
  const parts: string[] = []
  if ((m.needsReply ?? 0) === 1) parts.push('Reply needed')
  const cat = (m.sortCategory ?? '').trim().toLowerCase()
  if (cat === 'pending_review') parts.push('Pending review')
  if ((m.pendingDelete ?? 0) === 1) parts.push('Pending delete')
  if (m.pendingReviewAt != null && String(m.pendingReviewAt).trim() !== '') parts.push('Review scheduled')
  if (parts.length === 0) return null
  return parts.join(' · ')
}

export function UrgentAutosortSessionSection({
  onOpenInboxMessage,
  snapshot,
  loading,
  error,
  onRefresh,
}: UrgentAutosortSessionSectionProps) {
  const latest = snapshot?.autosort?.latestSession ?? null
  const messages = (snapshot?.autosort?.urgentSessionMessages ?? []).slice(0, VISIBLE_URGENT_CAP)
  const sessionId = latest?.sessionId ?? null
  const sessionCompleted = latest?.completedAt ?? null
  const sessionTotals = latest?.totalMessages ?? null
  const totalUrgentFetched = snapshot?.autosort?.urgentSessionMessages?.length ?? 0

  const runContext =
    sessionId == null
      ? null
      : [sessionCompleted ? formatTimeCompact(sessionCompleted) : null, typeof sessionTotals === 'number' ? `${sessionTotals} msg` : null]
          .filter(Boolean)
          .join(' · ')

  return (
    <section className="urgent-triage" aria-labelledby="urgent-triage-heading">
      <div className="urgent-triage__head">
        <div className="urgent-triage__head-text">
          <h2 id="urgent-triage-heading" className="urgent-triage__title">
            Urgent queue
          </h2>
          {runContext ? <p className="urgent-triage__meta">{runContext}</p> : null}
        </div>
        <button type="button" className="urgent-triage__btn urgent-triage__btn--ghost" disabled={loading} onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>

      <div className="urgent-triage__body">
        {loading ? (
          <p className="urgent-triage__empty">Loading…</p>
        ) : error ? (
          <>
            <p className="urgent-triage__error">{error}</p>
            <p className="urgent-triage__hint">Use Refresh</p>
          </>
        ) : sessionId == null ? (
          <p className="urgent-triage__empty">No sort session · run Auto-Sort first.</p>
        ) : messages.length === 0 ? (
          <p className="urgent-triage__empty">No urgent rows in latest run.</p>
        ) : (
          <>
            <ul className="urgent-triage__list" aria-label="Urgent from latest sort">
              {messages.map((m) => {
                const { line: whoLine, full: whoFull } = participantDisplay(m)
                const subj = (m.subject ?? '').trim() || '(No subject)'
                const reason = compactUrgentReason(m)
                const meta = triageMetaLine(m)
                const tab = workflowFilterFromSessionReviewRow(toSessionReviewRow(m))
                const receivedIso = m.receivedAt ?? undefined
                const openTitle = onOpenInboxMessage
                  ? `Open in Inbox · tab: ${tab.replace(/_/g, ' ')}`
                  : 'Available when opened from the full app'

                return (
                  <li key={m.messageId} className="urgent-triage__row">
                    <div className="urgent-triage__main">
                      <div className="urgent-triage__row1">
                        <span className="urgent-triage__who" title={whoFull}>
                          {whoLine}
                        </span>
                        <time className="urgent-triage__when" dateTime={receivedIso}>
                          {formatTimeCompact(m.receivedAt)}
                        </time>
                      </div>
                      <p className="urgent-triage__subj" title={subj}>
                        {subj}
                      </p>
                      <p className="urgent-triage__reason">
                        <span className="urgent-triage__reason-k">Why</span>
                        {reason}
                      </p>
                      {meta ? (
                        <p className="urgent-triage__flags" title="Workflow signals from this message">
                          {meta}
                        </p>
                      ) : null}
                    </div>
                    <div className="urgent-triage__action">
                      <button
                        type="button"
                        className="urgent-triage__btn urgent-triage__btn--open"
                        disabled={!onOpenInboxMessage}
                        title={openTitle}
                        onClick={() =>
                          onOpenInboxMessage?.({
                            messageId: m.messageId,
                            workflowTab: tab,
                          })
                        }
                      >
                        Open
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {totalUrgentFetched >= VISIBLE_URGENT_CAP ? (
              <p className="urgent-triage__cap">Cap {VISIBLE_URGENT_CAP} · urgency order</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
