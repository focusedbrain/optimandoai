/**
 * Read-only aggregation for Analysis dashboard (`inbox:dashboardSnapshot`).
 * Uses the same WHERE builder as `inbox:listMessages` for inbox tab totals.
 */

import type { InboxListFilterOptions } from './inboxWhereClause'
import { buildInboxMessagesWhereClause } from './inboxWhereClause'

export type DashboardSnapshotAutosortMessageRow = {
  messageId: string
  fromName: string | null
  fromAddress: string | null
  subject: string | null
  receivedAt: string | null
  sortCategory: string | null
  urgencyScore: number | null
  needsReply: number | null
  sortReason: string | null
  pendingReviewAt: string | null
  pendingDelete: number | null
  archived: number | null
  handshakeId: string | null
  accountId: string | null
  lastAutosortSessionId: string
}

export type DashboardSnapshotAiSummary = {
  headline: string
  patternsNote: string
}

export type DashboardSnapshotLatestSession = {
  sessionId: string
  startedAt: string
  completedAt: string | null
  status: string
  totalMessages: number
  urgentCount: number
  pendingReviewCount: number
  pendingDeleteCount: number
  archivedCount: number
  errorCount: number
  durationMs: number | null
  aiSummary: DashboardSnapshotAiSummary | null
}

export type InboxDashboardSnapshotCollectResult = {
  assembledAt: string
  inboxTabs: {
    all: number
    urgent: number
    pending_delete: number
    pending_review: number
    archived: number
  }
  /**
   * `filter: 'all'` (main inbox) intersected with `messageKind`:
   * - nativeBeap: handshake slice (`handshake` kind — see `inboxWhereClause`)
   * - depackagedEmail: depackaged slice
   * These are two separate COUNTs; they do not necessarily sum to `inboxTabs.all`.
   */
  messageKindOnMainInbox: {
    nativeBeap: number
    depackagedEmail: number
  }
  /**
   * Histogram of `sort_category` for messages tied to the latest completed session.
   * Null when no completed session exists.
   */
  autosortCategoryCounts: Array<{ category: string; count: number }> | null
  latestCompletedAutosort: DashboardSnapshotLatestSession | null
  /**
   * From latest completed session only: rows that are “urgent” by triage
   * (same idea as `workflowFilterFromSessionReviewRow` in renderer):
   * `sort_category` trim lower === `urgent` OR `urgency_score >= 7`.
   * Ordered by urgency desc, then received_at desc. Excludes `deleted = 1`.
   */
  latestSessionUrgentMessages: DashboardSnapshotAutosortMessageRow[]
  /** Messages with stored BEAP package JSON (PoAE lives on package in product). */
  poaePackageHistory: Array<{
    messageId: string
    receivedAt: string | null
    fromName: string | null
    fromAddress: string | null
    subject: string | null
    sourceType: string | null
    handshakeId: string | null
  }>
  poaePackageHistoryTruncated: boolean
  poaePackageHistoryLimit: number
}

const DEFAULT_URGENT_LIMIT = 25
/** Recent rows with `beap_package_json` for Analysis PoAE archive (LIMIT+1 truncation probe). */
const POAE_PACKAGE_HISTORY_LIMIT = 25

function countInbox(db: any, options: InboxListFilterOptions): number {
  const { where, params } = buildInboxMessagesWhereClause(options)
  const row = db.prepare(`SELECT COUNT(*) as total FROM inbox_messages ${where}`).get(...params) as { total?: number }
  return typeof row?.total === 'number' ? row.total : 0
}

function parseAiSummaryJson(raw: string | null | undefined): DashboardSnapshotAiSummary | null {
  if (raw == null || String(raw).trim() === '') return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const headline = typeof o.headline === 'string' ? o.headline.trim() : ''
    const patterns =
      typeof o.patterns_note === 'string'
        ? o.patterns_note.trim()
        : typeof o.patternsNote === 'string'
          ? o.patternsNote.trim()
          : ''
    if (!headline && !patterns) return null
    return { headline: headline || '', patternsNote: patterns || '' }
  } catch {
    return null
  }
}

/**
 * @param db — open better-sqlite3 database (inbox messages + autosort_sessions).
 */
export function collectReadOnlyDashboardSnapshot(
  db: any,
  opts?: { urgentMessageLimit?: number },
): InboxDashboardSnapshotCollectResult {
  const urgentLimit = Math.min(100, Math.max(1, opts?.urgentMessageLimit ?? DEFAULT_URGENT_LIMIT))

  const inboxTabs = {
    all: countInbox(db, { filter: 'all' }),
    urgent: countInbox(db, { filter: 'urgent' }),
    pending_delete: countInbox(db, { filter: 'pending_delete' }),
    pending_review: countInbox(db, { filter: 'pending_review' }),
    archived: countInbox(db, { filter: 'archived' }),
  }

  const messageKindOnMainInbox = {
    nativeBeap: countInbox(db, { filter: 'all', messageKind: 'handshake' }),
    depackagedEmail: countInbox(db, { filter: 'all', messageKind: 'depackaged' }),
  }

  const sessionRow = db
    .prepare(
      `SELECT id, started_at, completed_at, total_messages, urgent_count, pending_review_count,
              pending_delete_count, archived_count, error_count, duration_ms, status, ai_summary_json
       FROM autosort_sessions
       WHERE status = ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get('completed') as
    | {
        id: string
        started_at: string
        completed_at: string | null
        total_messages: number
        urgent_count: number
        pending_review_count: number
        pending_delete_count: number
        archived_count: number
        error_count: number
        duration_ms: number | null
        status: string
        ai_summary_json: string | null
      }
    | undefined

  let autosortCategoryCounts: Array<{ category: string; count: number }> | null = null
  let latestCompletedAutosort: DashboardSnapshotLatestSession | null = null
  let latestSessionUrgentMessages: DashboardSnapshotAutosortMessageRow[] = []

  const poaeFetchLimit = POAE_PACKAGE_HISTORY_LIMIT + 1
  const poaeRawRows = db
    .prepare(
      `SELECT id, from_address, from_name, subject, received_at, source_type, handshake_id
       FROM inbox_messages
       WHERE deleted = 0
         AND beap_package_json IS NOT NULL
         AND TRIM(COALESCE(beap_package_json, '')) != ''
       ORDER BY datetime(received_at) DESC
       LIMIT ?`,
    )
    .all(poaeFetchLimit) as Array<{
    id: string
    from_address: string | null
    from_name: string | null
    subject: string | null
    received_at: string | null
    source_type: string | null
    handshake_id: string | null
  }>

  const poaePackageHistoryTruncated = poaeRawRows.length > POAE_PACKAGE_HISTORY_LIMIT
  const poaeSlice = poaePackageHistoryTruncated
    ? poaeRawRows.slice(0, POAE_PACKAGE_HISTORY_LIMIT)
    : poaeRawRows
  const poaePackageHistory = poaeSlice.map((r) => ({
    messageId: r.id,
    receivedAt: r.received_at,
    fromName: r.from_name,
    fromAddress: r.from_address,
    subject: r.subject,
    sourceType: r.source_type,
    handshakeId: r.handshake_id,
  }))

  if (sessionRow) {
    const sessionId = sessionRow.id
    latestCompletedAutosort = {
      sessionId,
      startedAt: sessionRow.started_at,
      completedAt: sessionRow.completed_at ?? null,
      status: sessionRow.status,
      totalMessages: sessionRow.total_messages,
      urgentCount: sessionRow.urgent_count,
      pendingReviewCount: sessionRow.pending_review_count,
      pendingDeleteCount: sessionRow.pending_delete_count,
      archivedCount: sessionRow.archived_count,
      errorCount: sessionRow.error_count,
      durationMs: sessionRow.duration_ms ?? null,
      aiSummary: parseAiSummaryJson(sessionRow.ai_summary_json),
    }

    const catRows = db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(sort_category), ''), '(uncategorized)') AS cat, COUNT(*) AS c
         FROM inbox_messages
         WHERE last_autosort_session_id = ? AND deleted = 0
         GROUP BY cat
         ORDER BY c DESC`,
      )
      .all(sessionId) as Array<{ cat: string; c: number }>

    autosortCategoryCounts = catRows.map((r) => ({ category: r.cat, count: r.c }))

    const urgentRows = db
      .prepare(
        `SELECT id, from_address, from_name, subject, received_at, sort_category, urgency_score,
                needs_reply, sort_reason, pending_review_at, pending_delete, archived,
                handshake_id, account_id, last_autosort_session_id
         FROM inbox_messages
         WHERE last_autosort_session_id = ?
           AND deleted = 0
           AND (
             LOWER(TRIM(COALESCE(sort_category, ''))) = 'urgent'
             OR (urgency_score IS NOT NULL AND urgency_score >= 7)
           )
         ORDER BY COALESCE(urgency_score, -1) DESC, received_at DESC
         LIMIT ?`,
      )
      .all(sessionId, urgentLimit) as Array<{
        id: string
        from_address: string | null
        from_name: string | null
        subject: string | null
        received_at: string | null
        sort_category: string | null
        urgency_score: number | null
        needs_reply: number | null
        sort_reason: string | null
        pending_review_at: string | null
        pending_delete: number | null
        archived: number | null
        handshake_id: string | null
        account_id: string | null
        last_autosort_session_id: string
      }>

    latestSessionUrgentMessages = urgentRows.map((r) => ({
      messageId: r.id,
      fromName: r.from_name,
      fromAddress: r.from_address,
      subject: r.subject,
      receivedAt: r.received_at,
      sortCategory: r.sort_category,
      urgencyScore: r.urgency_score,
      needsReply: r.needs_reply,
      sortReason: r.sort_reason,
      pendingReviewAt: r.pending_review_at,
      pendingDelete: r.pending_delete,
      archived: r.archived,
      handshakeId: r.handshake_id,
      accountId: r.account_id,
      lastAutosortSessionId: r.last_autosort_session_id,
    }))
  }

  return {
    assembledAt: new Date().toISOString(),
    inboxTabs,
    messageKindOnMainInbox,
    autosortCategoryCounts,
    latestCompletedAutosort,
    latestSessionUrgentMessages,
    poaePackageHistory,
    poaePackageHistoryTruncated,
    poaePackageHistoryLimit: POAE_PACKAGE_HISTORY_LIMIT,
  }
}
