/**
 * EmailInboxBulkView — Bulk grid view: [Message Card | AI Output Field] per row (50/50).
 * Toolbar: Select all, bulk actions, infinite scroll (next page). Batch size “All” = entire current tab (drained fetch + id list), not one page.
 * Collapsible provider section at top for account management.
 *
 * AI Auto-Sort: runs only on explicit toolbar / per-row actions (never from effects). Classify → immediate moves; no preview countdown.
 */

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import {
  useEmailInboxStore,
  activeEmailAccountIdsForSync,
  type InboxMessage,
  type SubFocus,
} from '../stores/useEmailInboxStore'
import { useShallow } from 'zustand/react/shallow'
import EmailMessageDetail from './EmailMessageDetail'
import EmailComposeOverlay from './EmailComposeOverlay'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import { ConnectEmailLaunchSource, useConnectEmailFlow } from '@ext/shared/email/connectEmailFlow'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import { SyncFailureBanner } from './SyncFailureBanner'
import EmailInboxSyncControls from './EmailInboxSyncControls'
import LinkWarningDialog from './LinkWarningDialog'
import { extractLinkParts } from '../utils/safeLinks'
import type {
  AiOutputs,
  AutosortRetainKind,
  BulkAiResult,
  BulkAiResultEntry,
  BulkRecommendedAction,
  NormalInboxAiResult,
  SortCategory,
} from '../types/inboxAi'
import { tryParseAnalysis, tryParsePartialAnalysis } from '../utils/parseInboxAiJson'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import { InboxUrgencyMeter } from './InboxUrgencyMeter'
import { reconcileInboxClassification } from '../lib/inboxClassificationReconcile'
import { BulkInboxAttachmentsStrip } from './BulkInboxAttachmentsStrip'
import '../components/handshakeViewTypes'

const MUTED = '#64748b'

/** Remote orchestrator queue row indicator (latest row per message from list query). */
function RemoteSyncStatusDot({ msg }: { msg: InboxMessage }) {
  const st = msg.remote_queue_status
  if (st == null || st === '') return null
  let color = '#eab308'
  if (st === 'completed') color = '#22c55e'
  if (st === 'failed') color = '#ef4444'
  const title =
    st === 'failed' && msg.remote_queue_last_error
      ? msg.remote_queue_last_error
      : `${msg.remote_queue_operation ?? '?'} · ${st}`
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}

type QueueStatusRow = { operation?: string; status?: string; c?: number }
type QueueAccountStatusRow = { account_id?: string | null; status?: string; c?: number }
type QueueByAccountSummaryRow = {
  accountId: string
  label: string
  provider?: string
  pending: number
  processing: number
  completed: number
  failed: number
  total: number
}
type QueueMsgRow = {
  operation?: string
  last_error?: string | null
  attempts?: number
  email_message_id?: string
  status?: string
  created_at?: string
  updated_at?: string
}

function aggregateLifecycleOpCounts(byOp: QueueStatusRow[]): Record<
  string,
  { pending: number; failed: number }
> {
  const base = ['archive', 'pending_delete', 'pending_review', 'urgent']
  const out: Record<string, { pending: number; failed: number }> = {}
  for (const o of base) out[o] = { pending: 0, failed: 0 }
  for (const row of byOp ?? []) {
    const op = String(row.operation ?? '')
    if (!out[op]) out[op] = { pending: 0, failed: 0 }
    const c = Number(row.c) || 0
    if (row.status === 'pending') out[op].pending += c
    if (row.status === 'failed') out[op].failed += c
  }
  return out
}

function countStatus(byStatus: QueueStatusRow[], s: string): number {
  const row = (byStatus ?? []).find((x) => x.status === s)
  return Number(row?.c) || 0
}

/** Plain-language remote sync line for the debug panel (honest, no fake ETAs). IMAP is pull-only — no remote queue rows. */
function buildRemoteSyncUserSummary(byStatus: QueueStatusRow[]): { line: string } {
  const pending = countStatus(byStatus, 'pending')
  const processing = countStatus(byStatus, 'processing')
  const active = pending + processing
  if (active === 0) {
    return { line: 'Remote folder sync: idle — no moves queued. ✓' }
  }
  return {
    line: `Remote sync: in progress — ${active} move(s) queued (Gmail / Microsoft 365 / Zoho).`,
  }
}

/** Samples for ETA: `completed` trend over ~30s while debug panel polls. */
type RemoteDrainSample = { t: number; completed: number; pending: number; processing: number }

function formatDrainEtaLine(history: RemoteDrainSample[], pending: number, processing: number): string | null {
  const now = Date.now()
  const windowMs = 30_000
  const h = history.filter((x) => now - x.t <= windowMs)
  if (h.length < 2) return null
  const first = h[0]
  const last = h[h.length - 1]
  const dtSec = (last.t - first.t) / 1000
  if (dtSec < 3) return null
  const dComp = last.completed - first.completed
  if (dComp <= 0) return null
  const ratePerSec = dComp / dtSec
  const backlog = pending + processing
  if (backlog <= 0) return null
  const etaSec = backlog / ratePerSec
  if (!Number.isFinite(etaSec) || etaSec < 0) return null
  if (etaSec > 72 * 3600) return null
  const mins = Math.ceil(etaSec / 60)
  if (mins <= 1) return '~1 minute remaining at current rate'
  return `~${mins} minutes remaining at current rate`
}

/**
 * Urgency cutoff (1–10): at or above this score, bulk Auto-Sort does not auto-move mail.
 * Kept in sync with “Time-sensitive” in getUrgencyBadgeText.
 */
const BULK_AUTO_SORT_URGENCY_THRESHOLD = 7

/** Brief pause after painting classification so auto-moved rows read as “sorted” before they leave (not a 5s preview). */
const SORT_LIVE_FEEDBACK_DWELL_MS = 72

function sortFeedbackPaintDwell(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, SORT_LIVE_FEEDBACK_DWELL_MS)
      })
    })
  })
}

/** Mark a classified row as intentionally left in the inbox after Auto-Sort (not a failure). */
function withAutosortRetained(
  entry: BulkAiResult,
  kind: AutosortRetainKind,
  explanation: string
): BulkAiResultEntry {
  return {
    ...entry,
    autosortOutcome: 'retained',
    autosortRetainKind: kind,
    autosortRetainExplanation: explanation,
  }
}

function emptyRetainedCounts(): Record<AutosortRetainKind, number> {
  return {
    urgent_threshold: 0,
    keep_for_manual_action: 0,
    draft_reply_ready: 0,
    classified_no_auto_move: 0,
  }
}

function mergeRetainedCounts(
  a: Record<AutosortRetainKind, number>,
  b: Record<AutosortRetainKind, number>
): Record<AutosortRetainKind, number> {
  return {
    urgent_threshold: a.urgent_threshold + b.urgent_threshold,
    keep_for_manual_action: a.keep_for_manual_action + b.keep_for_manual_action,
    draft_reply_ready: a.draft_reply_ready + b.draft_reply_ready,
    classified_no_auto_move: a.classified_no_auto_move + b.classified_no_auto_move,
  }
}

function shortIdForSummary(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…`
}

/** True when bulk triage has both category and recommended action (full structured analysis). */
function hasFullBulkAnalysis(output: BulkAiResultEntry | undefined): boolean {
  return !!(output?.category && output?.recommendedAction)
}

/** Show explicit Analyze when triage is incomplete; hide on failure rows (Retry Auto-Sort covers that). */
function shouldShowBulkAnalyzeButton(output: BulkAiResultEntry | undefined): boolean {
  if (output?.autosortFailure) return false
  return !hasFullBulkAnalysis(output)
}

/** Merge streaming Normal Inbox analysis fields into bulk card state (same JSON shape as aiAnalyzeMessageStream). */
function mergeNormalPartialIntoBulk(
  partial: NormalInboxAiResult,
  prev: BulkAiResultEntry | undefined
): BulkAiResultEntry {
  const adv =
    partial.archiveReason?.trim() || partial.archiveRecommendation
      ? `${partial.archiveRecommendation === 'archive' ? 'Archive' : 'Keep'}${partial.archiveReason?.trim() ? ` — ${partial.archiveReason.trim()}` : ''}`
      : undefined
  const next: BulkAiResultEntry = {
    ...prev,
    bulkAnalysisStreaming: true,
    summary: partial.summary?.trim() ? partial.summary : prev?.summary,
    urgencyScore: partial.urgencyScore,
    urgencyReason: partial.urgencyReason || prev?.urgencyReason,
    needsReply: partial.needsReply,
    needsReplyReason: partial.needsReplyReason || prev?.needsReplyReason,
    actionItems: partial.actionItems?.length ? partial.actionItems : prev?.actionItems,
    draftReply:
      typeof partial.draftReply === 'string' && partial.draftReply.trim()
        ? partial.draftReply
        : prev?.draftReply,
    reason: (partial.urgencyReason || partial.summary || prev?.reason || '').toString().slice(0, 300),
    actionExplanation: adv || prev?.actionExplanation,
  }
  return next
}

/**
 * Build full bulk card state from advisory (Normal Inbox) analysis only — no classify IPC, no auto-moves.
 * Heuristic mapping from stream/non-stream JSON so the structured card can render category + recommended action.
 */
function advisoryNormalToBulkComplete(
  normal: NormalInboxAiResult,
  prev: BulkAiResultEntry | undefined
): BulkAiResultEntry {
  const urgencyScore = Math.max(1, Math.min(10, normal.urgencyScore ?? 5))
  const summary = (normal.summary ?? '').trim().slice(0, 500)
  const baseReason = (
    normal.urgencyReason ||
    normal.needsReplyReason ||
    summary ||
    prev?.reason ||
    'Analyzed.'
  )
    .toString()
    .slice(0, 300)

  let category: SortCategory
  let recommendedAction: BulkRecommendedAction

  if (urgencyScore >= BULK_AUTO_SORT_URGENCY_THRESHOLD) {
    category = 'urgent'
    recommendedAction =
      normal.needsReply && normal.draftReply ? 'draft_reply_ready' : 'keep_for_manual_action'
  } else if (normal.archiveRecommendation === 'archive') {
    category = 'newsletter'
    recommendedAction = 'archive'
  } else if (normal.needsReply && normal.draftReply) {
    category = 'important'
    recommendedAction = 'draft_reply_ready'
  } else if (normal.needsReply) {
    category = 'important'
    recommendedAction = 'keep_for_manual_action'
  } else {
    category = 'normal'
    recommendedAction = 'keep_for_manual_action'
  }

  const draftReply =
    normal.needsReply && typeof normal.draftReply === 'string' && normal.draftReply.trim()
      ? normal.draftReply.slice(0, 4000)
      : undefined

  const advLine =
    normal.archiveReason?.trim() || normal.archiveRecommendation
      ? `${normal.archiveRecommendation === 'archive' ? 'Archive' : 'Keep'}${
          normal.archiveReason?.trim() ? ` — ${normal.archiveReason.trim()}` : ''
        }`
      : ''

  return {
    ...prev,
    category,
    urgencyScore,
    urgencyReason: (normal.urgencyReason || baseReason).toString().slice(0, 300),
    summary: summary || baseReason,
    reason: baseReason,
    needsReply: !!normal.needsReply,
    needsReplyReason: normal.needsReply
      ? (normal.needsReplyReason || 'Reply warranted.').slice(0, 300)
      : 'No reply needed.',
    recommendedAction,
    actionExplanation: (advLine || baseReason).slice(0, 500),
    actionItems: Array.isArray(normal.actionItems) ? normal.actionItems.slice(0, 10) : [],
    draftReply,
    status: 'classified',
    autosortOutcome: undefined,
    autosortRetainKind: undefined,
    autosortRetainExplanation: undefined,
    autosortFailure: undefined,
    failureReason: undefined,
    bulkAnalysisStreaming: undefined,
  }
}

/** Persist shape for `inbox:persistManualBulkAnalysis` (matches classify JSON keys; does not update sort columns). */
function bulkEntryToManualPersistJson(entry: BulkAiResultEntry): string {
  return JSON.stringify({
    category: entry.category ?? 'normal',
    urgencyScore: entry.urgencyScore ?? 5,
    urgencyReason: entry.urgencyReason ?? '',
    summary: entry.summary ?? '',
    reason: entry.reason ?? '',
    needsReply: !!entry.needsReply,
    needsReplyReason: entry.needsReplyReason ?? '',
    recommendedAction: entry.recommendedAction ?? 'keep_for_manual_action',
    actionExplanation: entry.actionExplanation ?? '',
    actionItems: entry.actionItems ?? [],
    draftReply: entry.draftReply ?? null,
    status: entry.status ?? 'classified',
  })
}

/** Aggregated result of one or more `runAiCategorizeForIds` passes (toolbar Auto-Sort). */
export type BulkSortRunAggregate = {
  processedIds: string[]
  failedIds: string[]
  movedIds: string[]
  /** Ids that never reached a terminal outcome before retry fix (should be empty after marking incomplete). */
  missedIds: string[]
  retainedCounts: Record<AutosortRetainKind, number>
}

function formatDate(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

/** Same as `EmailInboxView` InboxMessageRow — compact received time in list cards. */
function formatRelativeDate(isoString: string): string {
  if (!isoString) return '—'
  const d = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffM = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffM < 1) return 'now'
  if (diffM < 60) return `${diffM}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace(/\//g, '.')
}

/** Map persisted sort_category / stored category → classifier labels used by reconcile. */
function sortCategoryToClassifier(cat: string): string {
  const c = (cat || 'normal').toLowerCase()
  if (c === 'important') return 'action_required'
  if (c === 'newsletter') return 'archive'
  if (c === 'spam' || c === 'irrelevant') return 'pending_delete'
  if (c === 'pending_review' || c === 'urgent' || c === 'normal') return c
  return 'normal'
}

function classifierToSortCategory(cat: string): SortCategory {
  const m: Record<string, SortCategory> = {
    pending_delete: 'spam',
    pending_review: 'pending_review',
    archive: 'newsletter',
    urgent: 'urgent',
    action_required: 'important',
    normal: 'normal',
  }
  return m[cat] ?? 'normal'
}

function recommendedActionForClassifier(cat: string, needsReply: boolean): BulkRecommendedAction {
  if (cat === 'pending_delete') return 'pending_delete'
  if (cat === 'pending_review') return 'pending_review'
  if (cat === 'archive') return 'archive'
  if ((cat === 'urgent' || cat === 'action_required') && needsReply) return 'draft_reply_ready'
  return 'keep_for_manual_action'
}

/** Parse persisted ai_analysis_json into BulkAiResultEntry — used when bulkAiOutputs was cleared. */
function parsePersistedAnalysis(json: string | null | undefined, msg?: InboxMessage): BulkAiResultEntry | undefined {
  if (!json || typeof json !== 'string') return undefined
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const hasCategory = !!parsed?.category
    const hasSummary = typeof parsed?.summary === 'string' && parsed.summary.length > 0
    const hasDraftReply = typeof parsed?.draftReply === 'string' && parsed.draftReply.length > 0
    if (!hasCategory && !hasSummary && !hasDraftReply) return undefined

    const rawCategory = (hasCategory ? String(parsed.category) : 'normal') as SortCategory
    let urgencyScore = typeof parsed.urgencyScore === 'number' ? parsed.urgencyScore : 5
    let needsReply = !!parsed.needsReply
    const reason = String(parsed.reason ?? '')
    const summary = String(parsed.summary ?? '')
    const urgencyReason = String(parsed.urgencyReason ?? '')

    let classifierCat = sortCategoryToClassifier(rawCategory)
    if (msg) {
      const reco = reconcileInboxClassification(
        {
          category: classifierCat,
          urgency: urgencyScore,
          needsReply,
          reason: reason || urgencyReason,
          summary,
        },
        { subject: msg.subject ?? '', body: msg.body_text ?? '' }
      )
      classifierCat = reco.category
      urgencyScore = reco.urgency
      needsReply = reco.needsReply
    }

    const displayCategory = classifierToSortCategory(classifierCat)
    const recommendedAction = recommendedActionForClassifier(classifierCat, needsReply)

    return {
      category: displayCategory,
      urgencyScore,
      urgencyReason,
      summary,
      reason,
      needsReply,
      needsReplyReason: needsReply ? String(parsed.needsReplyReason ?? 'Reply warranted.') : 'No reply needed.',
      recommendedAction,
      actionExplanation: String(parsed.actionExplanation ?? reason ?? ''),
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      draftReply: needsReply ? (typeof parsed.draftReply === 'string' ? parsed.draftReply : undefined) : undefined,
      status: (parsed.status ?? 'classified') as 'classified',
    }
  } catch {
    return undefined
  }
}

/** Fade-out wrapper for the per-row Pending Delete “Undo” chip (UX polish, not the old bulk banner). */
function UndoFadeWrapper({
  children,
  onFadeComplete,
}: {
  children: ReactNode
  onFadeComplete?: () => void
}) {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 8_000)
    const hideTimer = setTimeout(() => {
      setVisible(false)
      onFadeComplete?.()
    }, 10_000)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [onFadeComplete])

  if (!visible) return null
  return (
    <div className="undo-btn-wrapper" data-fading={fading}>
      {children}
    </div>
  )
}

/**
 * Under “Recommended action”: show only positive, meaningful signals.
 * Omits negative filler (e.g. “Answer required: No”) per product UX.
 */
function BulkRecommendedActionMetaFlags({ msg, output }: { msg: InboxMessage; output: BulkAiResultEntry }) {
  const flags: ReactNode[] = []
  if (output.needsReply) {
    flags.push(
      <span key="needs-reply" className="bulk-action-card-meta-flag" role="listitem">
        Answer required: Yes
      </span>
    )
  }
  const ac = msg.attachment_count ?? 0
  if (ac > 0) {
    flags.push(
      <span
        key="attachments"
        className="bulk-action-card-meta-flag"
        role="listitem"
        title={`${ac} attachment${ac === 1 ? '' : 's'}`}
      >
        {ac === 1 ? 'Attachments: Yes' : `Attachments: Yes (${ac})`}
      </span>
    )
  }
  if (flags.length === 0) return null
  return (
    <div className="bulk-action-card-meta-flags" role="list" aria-label="Relevant action signals">
      {flags}
    </div>
  )
}

/** WR Expert modal — edit AI inbox rules (WRExpert.md) */
function WrExpertModal({
  content,
  onChange,
  onSave,
  onResetToDefaults,
  onClose,
  saving,
}: {
  content: string
  onChange: (content: string) => void
  onSave: () => Promise<boolean>
  onResetToDefaults: () => Promise<void>
  onClose: () => void
  saving: boolean
}) {
  const handleSave = useCallback(async () => {
    const ok = await onSave()
    if (ok) onClose()
  }, [onSave, onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg, #0f172a)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))', fontWeight: 700, fontSize: 16 }}>
          WR Expert — Your AI Inbox Rules
        </div>
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Loading…"
          style={{
            flex: 1,
            minHeight: 320,
            padding: 16,
            fontSize: 12,
            fontFamily: 'ui-monospace, monospace',
            lineHeight: 1.5,
            background: 'var(--color-surface, rgba(255,255,255,0.04))',
            border: 'none',
            color: 'var(--color-text, #e2e8f0)',
            resize: 'none',
          }}
          spellCheck={false}
        />
        <div style={{ padding: '12px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)', margin: 0 }}>
            Changes take effect on the next Auto-Sort run.
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)', margin: 0 }}>
            You can also edit WRExpert.md directly in your system&apos;s app data folder with any text editor.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onResetToDefaults}
              disabled={saving}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
                background: 'transparent',
                color: 'var(--color-text-muted, #94a3b8)',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 18px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: 'none',
                background: 'var(--purple-accent, #7c3aed)',
                color: '#fff',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Format deletion info from pending_delete_at + 7 days. Returns e.g. "Deletes on Mar 25" or "Deletes in 6d 18h". */
function formatPendingDeleteInfo(pendingDeleteAt: string | null): string {
  if (!pendingDeleteAt) return 'Deletes in 7d'
  try {
    const markedAt = new Date(pendingDeleteAt).getTime()
    const deleteAt = markedAt + 7 * 24 * 60 * 60 * 1000
    const now = Date.now()
    const msRemaining = deleteAt - now
    if (msRemaining <= 0) return 'Deletes soon'
    const days = Math.floor(msRemaining / (24 * 60 * 60 * 1000))
    const hours = Math.floor((msRemaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
    const mins = Math.floor((msRemaining % (60 * 60 * 1000)) / (60 * 1000))
    if (days >= 2) {
      return `Deletes on ${new Date(deleteAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    }
    if (days >= 1) return `Deletes in ${days}d ${hours}h`
    if (hours >= 1) return `Deletes in ${hours}h`
    return mins > 0 ? `Deletes in ${mins}m` : 'Deletes soon'
  } catch {
    return 'Deletes in 7d'
  }
}

/** Speed-first: Pending Delete first, Archive next, Manual/urgent last. */
const CATEGORY_ORDER: Record<string, number> = {
  spam: 0,
  irrelevant: 1,
  newsletter: 2,
  normal: 3,
  important: 4,
  urgent: 5,
  pending_review: 6,
}

const CATEGORY_BORDER: Record<string, string> = {
  urgent: '#ef4444',
  important: '#f97316',
  normal: '#a855f7',
  newsletter: '#3b82f6',
  spam: '#6b7280',
  irrelevant: '#6b7280',
  pending_review: '#f59e0b',
}

/** Analysis header category chip — omit “normal” and “spam” (spam uses row badge; urgency uses InboxUrgencyMeter only). */
function bulkHeaderCategoryBadge(category: SortCategory | undefined): { label: string; color: string } | null {
  const cat = category ?? 'normal'
  if (cat === 'normal' || cat === 'spam') return null
  const color = CATEGORY_BORDER[cat] ?? '#a855f7'
  const label = cat === 'pending_review' ? 'REVIEW' : cat.toUpperCase()
  return { label, color }
}

/** Structured bulk action card with draft collapse/connect UX (same as Normal Inbox). */
function BulkActionCardStructured({
  msg,
  output,
  isExpanded,
  currentFilter,
  updateDraftReply,
  handleSendDraft,
  handleArchiveOne,
  handleDeleteOne,
  handlePendingDeleteOne,
  handleMoveToPendingReviewOne,
  handleSummarize,
  handleDraftReply,
  handleBulkAnalyze,
  analyzeRunning,
  showAnalyzeButton,
  handleUndoPendingDelete,
  handleUndoPendingReview,
  handleUndoArchived,
  focusedMessageId,
  editingDraftForMessageId,
  subFocus,
  setSubFocus,
  onSelectMessage,
  draftAttachments = [],
  onAddDraftAttachment,
  onRemoveDraftAttachment,
}: {
  msg: InboxMessage
  output: BulkAiResultEntry
  isExpanded: boolean
  currentFilter: 'all' | 'unread' | 'starred' | 'deleted' | 'archived' | 'pending_delete' | 'pending_review' | 'urgent'
  updateDraftReply: (messageId: string, draftReply: string) => void
  handleSendDraft: (msg: InboxMessage, draftBody: string, attachments?: Array<{ name: string; path: string; size: number }>) => void
  handleArchiveOne: (msg: InboxMessage) => void
  handleDeleteOne: (msg: InboxMessage) => void
  handlePendingDeleteOne: (msg: InboxMessage) => void
  handleMoveToPendingReviewOne: (msg: InboxMessage) => void
  handleSummarize: (messageId: string) => void
  handleDraftReply: (messageId: string) => void
  handleBulkAnalyze: (messageId: string) => void
  analyzeRunning: boolean
  showAnalyzeButton: boolean
  handleUndoPendingDelete: (ids: string[]) => void
  handleUndoPendingReview: (messageId: string) => void
  handleUndoArchived: (messageId: string) => void
  focusedMessageId: string | null
  editingDraftForMessageId: string | null
  subFocus: SubFocus
  setSubFocus: (focus: SubFocus) => void
  onSelectMessage?: (messageId: string | null) => void
  draftAttachments?: Array<{ name: string; path: string; size: number }>
  onAddDraftAttachment?: () => void
  onRemoveDraftAttachment?: (index: number) => void
}) {
  const draftExpanded = !!(output.draftReply != null && output.draftReply !== '')
  const isDraftSubFocused = subFocus.kind === 'draft' && subFocus.messageId === msg.id
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false)
  const analysisButtonRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLDivElement>(null)

  const draftRefineConnect = useDraftRefineStore((s) => s.connect)
  const draftRefineDisconnect = useDraftRefineStore((s) => s.disconnect)
  const draftRefineConnected = useDraftRefineStore((s) => s.connected)
  const draftRefineMessageId = useDraftRefineStore((s) => s.messageId)
  const refinedDraftText = useDraftRefineStore((s) => s.refinedDraftText)
  const acceptRefinement = useDraftRefineStore((s) => s.acceptRefinement)
  const manualDraftCompose = useEmailInboxStore((s) => s.bulkDraftManualComposeIds.has(msg.id))
  const removeBulkDraftManualCompose = useEmailInboxStore((s) => s.removeBulkDraftManualCompose)

  /** Close analysis panel on click outside or Escape */
  useEffect(() => {
    if (!isAnalysisOpen) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (analysisButtonRef.current && !analysisButtonRef.current.contains(target)) {
        setIsAnalysisOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsAnalysisOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isAnalysisOpen])

  /** Connect to chat bar for draft refinement — on click or focus (FIX-ISSUE-5).
   * Does NOT call onSelectMessage: draft selection is independent of message selection. */
  const handleDraftRefineConnect = useCallback(() => {
    const text = output.draftReply ?? ''
    if (!text.trim()) return
    const subject = msg.subject ?? null
    draftRefineConnect(msg.id, subject, text, (refined) => {
      updateDraftReply(msg.id, refined)
    })
  }, [msg.id, msg.subject, output.draftReply, updateDraftReply, draftRefineConnect])

  useEffect(() => {
    if (!draftRefineConnected || draftRefineMessageId !== msg.id) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (draftRef.current && !draftRef.current.contains(target)) {
        draftRefineDisconnect()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [draftRefineConnected, draftRefineMessageId, msg.id, draftRefineDisconnect])

  useEffect(() => {
    const id = msg.id
    return () => {
      if (useDraftRefineStore.getState().messageId === id) useDraftRefineStore.getState().disconnect()
    }
  }, [msg.id])

  useEffect(() => {
    if (draftRefineConnected && draftRefineMessageId === msg.id && output.draftReply != null) {
      useDraftRefineStore.getState().updateDraftText(output.draftReply)
    }
  }, [draftRefineConnected, draftRefineMessageId, msg.id, output.draftReply])

  /** Deselecting this draft (toggle off / other row) should drop chat refine scope for this message. */
  useEffect(() => {
    if (isDraftSubFocused) return
    if (draftRefineConnected && draftRefineMessageId === msg.id) {
      draftRefineDisconnect()
    }
  }, [isDraftSubFocused, draftRefineConnected, draftRefineMessageId, msg.id, draftRefineDisconnect])

  const hasFullStructured = hasFullBulkAnalysis(output)
  /** While streaming or waiting for classify, avoid defaulting to draft_reply_ready (misleading actions). */
  const streamClassifying = !!(output.bulkAnalysisStreaming && !hasFullStructured)
  const rec = (streamClassifying
    ? 'keep_for_manual_action'
    : (output.recommendedAction ?? 'draft_reply_ready')) as BulkRecommendedAction
  /** Draft-only or user hit “Draft” after Auto-Sort — full-height composer, no analysis header/recommended row. */
  const hideAnalysisChrome = draftExpanded && ((!hasFullStructured) || manualDraftCompose)
  /** FIX-H4: Undo visibility based SOLELY on current filter. No other conditions. */
  const showUndo = ['pending_delete', 'pending_review', 'archived'].includes(currentFilter)
  const category = (output.category ?? 'normal') as keyof typeof CATEGORY_BORDER
  const borderColor = CATEGORY_BORDER[category] ?? 'transparent'
  const urgency = output.urgencyScore ?? 5
  const needsReplyReason = output.needsReplyReason ?? output.reason ?? ''
  const urgencyReason = output.urgencyReason ?? output.reason ?? ''
  const panelMod = `bulk-action-card-panel--${rec}`
  const effectiveBorderColor = borderColor
  const isConnected = draftRefineConnected && draftRefineMessageId === msg.id

  const summaryTextTrimmed = (output.summary ?? '').trim()
  const showMainSummaryRegion =
    output.loading === 'summary' ||
    output.summaryError === true ||
    summaryTextTrimmed.length > 0 ||
    output.bulkAnalysisStreaming === true

  return (
    <div
      className={`bulk-action-card bulk-action-card--structured ${isExpanded ? 'bulk-action-card--expanded' : ''}${hideAnalysisChrome ? ' bulk-action-card--draft-compose-focus' : ''}`.trim()}
      style={{ borderLeftColor: effectiveBorderColor }}
    >
      {output.autosortOutcome === 'retained' && output.autosortRetainExplanation ? (
        <div
          className="bulk-action-card-autosort-retained"
          role="status"
          aria-label="Auto-Sort note for this message"
        >
          <span className="bulk-action-card-autosort-retained-label">Auto-Sort note</span>
          <span className="bulk-action-card-autosort-retained-text">{output.autosortRetainExplanation}</span>
        </div>
      ) : null}
      {!hideAnalysisChrome ? (
      <div className="bulk-action-card-header">
        {(() => {
          const hb = bulkHeaderCategoryBadge(output.category)
          if (!hb) return null
          return (
            <span className="bulk-action-card-badge" style={{ background: `${hb.color}33`, color: hb.color }}>
              {hb.label}
            </span>
          )
        })()}
        <div className="bulk-action-card-header-urgency-slot">
          <InboxUrgencyMeter score={urgency} variant="compact" />
        </div>
        <div ref={analysisButtonRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            type="button"
            className={`bulk-action-card-btn bulk-action-card-btn-tertiary${isAnalysisOpen ? ' bulk-action-card-analysis-btn--active' : ''}`}
            onClick={() => setIsAnalysisOpen((v) => !v)}
            aria-expanded={isAnalysisOpen}
            aria-haspopup="dialog"
            aria-label={isAnalysisOpen ? 'Close analysis panel' : 'View analysis'}
          >
            Analysis
          </button>
          {isAnalysisOpen && (
            <div
              className="bulk-action-card-analysis-popover"
              role="dialog"
              aria-label="AI analysis"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bulk-action-card-analysis-popover-content">
                {output.needsReply ? (
                  <div className="bulk-action-card-row">
                    <span className="bulk-action-card-row-label">Response needed</span>
                    <div className="bulk-action-card-row-value">
                      <span className="bulk-action-card-response-needed">
                        <span className="bulk-action-card-dot" style={{ background: '#ef4444' }} />
                        Yes — {needsReplyReason || '—'}
                      </span>
                    </div>
                  </div>
                ) : null}
                <div className="bulk-action-card-row">
                  <span className="bulk-action-card-row-label">Summary</span>
                  <div className={`bulk-action-card-row-value bulk-action-card-summary bulk-action-card-summary--expanded`}>
                    {output.summary || '—'}
                  </div>
                </div>
                <div className="bulk-action-card-row">
                  <span className="bulk-action-card-row-label">Urgency</span>
                  <div className="bulk-action-card-row-value">
                    <InboxUrgencyMeter score={urgency} variant="panel" reason={urgencyReason || '—'} />
                  </div>
                </div>
                <div className="bulk-action-card-row">
                  <span className="bulk-action-card-row-label">Action Items</span>
                  <div className="bulk-action-card-row-value">
                    {output.actionItems?.length ? (
                      <ul className="bulk-action-card-action-list">
                        {output.actionItems.map((item, idx) => (
                          <li key={idx} className="bulk-action-card-action-item">{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="bulk-action-card-muted">None.</span>
                    )}
                  </div>
                </div>
                <div className="bulk-action-card-row bulk-action-card-row--recommended">
                  <span className="bulk-action-card-row-label">Recommended Action</span>
                  <div className="bulk-action-card-row-value">
                    {streamClassifying ? (
                      <div
                        className={`bulk-action-card-panel bulk-action-card-panel--recommended ${panelMod}`}
                        style={{ cursor: 'default', opacity: 0.9 }}
                        aria-busy="true"
                      >
                        <span className="bulk-action-card-panel-action">Finalizing triage…</span>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        className={`bulk-action-card-panel bulk-action-card-panel--recommended bulk-action-card-panel--actionable ${panelMod}`}
                        onClick={() => {
                          setIsAnalysisOpen(false)
                          if (rec === 'pending_delete') handlePendingDeleteOne(msg)
                          else if (rec === 'pending_review') handleMoveToPendingReviewOne(msg)
                          else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
                          else if (rec === 'draft_reply_ready' && output.draftReply) handleSendDraft(msg, output.draftReply)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setIsAnalysisOpen(false)
                            if (rec === 'pending_delete') handlePendingDeleteOne(msg)
                            else if (rec === 'pending_review') handleMoveToPendingReviewOne(msg)
                            else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
                            else if (rec === 'draft_reply_ready' && output.draftReply) handleSendDraft(msg, output.draftReply)
                          }
                        }}
                        title="Click or press Enter to apply"
                      >
                        <span className="bulk-action-card-panel-action">
                          {rec === 'pending_delete' && '🗑 Pending Delete'}
                          {rec === 'pending_review' && '⏳ Pending Review'}
                          {rec === 'archive' && '📦 Archive'}
                          {rec === 'keep_for_manual_action' && '✋ Review manually'}
                          {rec === 'draft_reply_ready' && '✉ Send draft reply'}
                        </span>
                      </div>
                    )}
                    {streamClassifying ? null : <BulkRecommendedActionMetaFlags msg={msg} output={output} />}
                    <div className="bulk-action-card-reasoning-box">
                      <span className="bulk-action-card-reasoning-label">Why:</span>
                      <span className="bulk-action-card-reasoning">
                        {streamClassifying ? (
                          <span className="bulk-action-card-muted">Applying bulk classification to this row…</span>
                        ) : (
                          output.actionExplanation || '—'
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      ) : null}
      <div className={`bulk-action-card-sections${draftExpanded ? ' bulk-action-card-sections--has-draft' : ''}`}>
        {showMainSummaryRegion ? (
          <div className="bulk-action-card-main-summary" role="region" aria-label="AI email summary">
            <div className="bulk-action-card-main-summary-head">
              <span className="bulk-action-card-main-summary-title">Summary</span>
            </div>
            {output.loading === 'summary' ? (
              <div className="bulk-action-card-main-summary-loading" aria-live="polite" aria-busy="true">
                <span className="bulk-action-card-main-summary-spinner" aria-hidden />
                Summarizing…
              </div>
            ) : output.summaryError ? (
              <div className="bulk-action-card-main-summary-error" role="alert">
                <span>{output.summaryErrorMessage ?? 'Couldn’t generate a summary.'}</span>
                <button
                  type="button"
                  className="bulk-action-card-main-summary-retry"
                  onClick={() => handleSummarize(msg.id)}
                >
                  Retry
                </button>
              </div>
            ) : output.bulkAnalysisStreaming && !summaryTextTrimmed ? (
              <div className="bulk-action-card-main-summary-body" aria-live="polite" aria-busy="true">
                <span className="bulk-action-card-main-summary-spinner" aria-hidden style={{ verticalAlign: 'middle', marginRight: 8 }} />
                <span className="bulk-action-card-muted">Receiving analysis…</span>
              </div>
            ) : (
              <div className="bulk-action-card-main-summary-body">{output.summary}</div>
            )}
          </div>
        ) : null}
        {output.draftError && (
          <div className="bulk-action-card-error-banner">
            <span>Draft generation failed.</span>
            <button type="button" onClick={() => handleDraftReply(msg.id)}>Retry</button>
          </div>
        )}
        {/* Recommended Action — hidden in draft-compose focus so the editor uses the pane */}
        {!hideAnalysisChrome ? (
        <div className="bulk-action-card-row bulk-action-card-row--recommended">
          <span className="bulk-action-card-row-label">Recommended Action</span>
          <div className="bulk-action-card-row-value">
            {streamClassifying ? (
              <div
                className={`bulk-action-card-panel bulk-action-card-panel--recommended ${panelMod}`}
                style={{ cursor: 'default', opacity: 0.9 }}
                aria-busy="true"
              >
                <span className="bulk-action-card-panel-action">Finalizing triage…</span>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                className={`bulk-action-card-panel bulk-action-card-panel--recommended bulk-action-card-panel--actionable ${panelMod}`}
                onClick={() => {
                  if (rec === 'pending_delete') handlePendingDeleteOne(msg)
                  else if (rec === 'pending_review') handleMoveToPendingReviewOne(msg)
                  else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
                  else if (rec === 'draft_reply_ready' && output.draftReply) handleSendDraft(msg, output.draftReply)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (rec === 'pending_delete') handlePendingDeleteOne(msg)
                    else if (rec === 'pending_review') handleMoveToPendingReviewOne(msg)
                    else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
                    else if (rec === 'draft_reply_ready' && output.draftReply) handleSendDraft(msg, output.draftReply)
                  }
                }}
                title="Click or press Enter to apply"
              >
                <span className="bulk-action-card-panel-action">
                  {rec === 'pending_delete' && '🗑 Pending Delete'}
                  {rec === 'pending_review' && '⏳ Pending Review'}
                  {rec === 'archive' && '📦 Archive'}
                  {rec === 'keep_for_manual_action' && '✋ Review manually'}
                  {rec === 'draft_reply_ready' && '✉ Send draft reply'}
                </span>
              </div>
            )}
            {streamClassifying ? null : <BulkRecommendedActionMetaFlags msg={msg} output={output} />}
            <div className="bulk-action-card-reasoning-box">
              <span className="bulk-action-card-reasoning-label">Why:</span>
              <span className="bulk-action-card-reasoning">
                {streamClassifying ? (
                  <span className="bulk-action-card-muted">Applying bulk classification to this row…</span>
                ) : (
                  output.actionExplanation || '—'
                )}
              </span>
            </div>
          </div>
        </div>
        ) : null}
        {output.draftReply != null && output.draftReply !== '' && (
          <div
            className={[
              isDraftSubFocused ? 'bulk-action-card-row-draft--subfocused' : '',
              'bulk-draft-pane-with-toolbar',
              'flex h-full min-h-0 w-full flex-col',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              width: '100%',
              flex: '1 1 0%',
              boxSizing: 'border-box',
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col" style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
              <div
                ref={draftRef}
                data-subfocus="draft"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return
                  /** Textarea clicks: always select for editing; never toggle off (second tap places caret). */
                  if ((e.target as HTMLElement).closest('textarea')) return
                  if (focusedMessageId !== msg.id) onSelectMessage?.(msg.id)
                  useEmailInboxStore.getState().setEditingDraftForMessageId(msg.id, { toggle: true })
                  if (useEmailInboxStore.getState().editingDraftForMessageId === msg.id) {
                    handleDraftRefineConnect()
                  }
                }}
                className="flex h-full min-h-0 w-full flex-col"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  minHeight: 0,
                  width: '100%',
                  borderRadius: 16,
                  border: isConnected ? '2px solid var(--color-primary, #7c3aed)' : '1px solid #c4b5fd',
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(124, 58, 237, 0.12), 0 1px 2px rgba(0, 0, 0, 0.05)',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  className="bulk-draft-pane-titlebar"
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: isExpanded ? 8 : 6,
                    borderBottom: '1px solid #cbd5e1',
                    background: '#e2e8f0',
                    padding: isExpanded ? '12px 16px' : '6px 10px',
                    borderRadius: '16px 16px 0 0',
                  }}
                >
                  {isDraftSubFocused ? (
                    <span className="bulk-action-card-draft-subfocus-indicator" title="Draft selected — chat scoped to this draft" aria-hidden>
                      ✏️
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontSize: isExpanded ? 11 : 9,
                      fontWeight: 600,
                      letterSpacing: isExpanded ? '0.08em' : '0.06em',
                      textTransform: 'uppercase',
                      color: '#6d28d9',
                    }}
                  >
                    DRAFT — EDIT BEFORE SENDING
                  </span>
                  {(draftExpanded || (hideAnalysisChrome && hasFullStructured)) ? (
                    <span
                      style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexShrink: 0,
                        flexWrap: 'wrap',
                        justifyContent: 'flex-end',
                      }}
                    >
                      {draftExpanded ? (
                        <span className="bulk-action-card-connect-hint" style={{ marginLeft: 0 }}>
                          click to refine with AI ↑
                        </span>
                      ) : null}
                      {hideAnalysisChrome && hasFullStructured ? (
                        <button
                          type="button"
                          className="bulk-draft-show-analysis-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            removeBulkDraftManualCompose(msg.id)
                          }}
                          title="Show category, urgency, and recommended action again"
                        >
                          Show analysis
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {isConnected ? (
                  <span
                    className="bulk-action-card-connect-hint"
                    style={{ display: 'block', flexShrink: 0, padding: '8px 16px 0', fontSize: 11, opacity: 0.55 }}
                  >
                    Connected to chat ↑ — type instructions to refine
                  </span>
                ) : null}
                <div
                  className="flex min-h-0 w-full flex-1 flex-col p-4 bulk-draft-editor-shell"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    width: '100%',
                    padding: isExpanded ? 16 : 6,
                    display: 'flex',
                    flexDirection: 'column',
                    boxSizing: 'border-box',
                  }}
                >
                  <div
                    className="flex min-h-0 w-full flex-1 flex-col bulk-draft-editor-frame"
                    style={{
                      flex: 1,
                      minHeight: 0,
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      borderRadius: 12,
                      border: '1px solid #cbd5e1',
                      background: '#f1f5f9',
                      boxSizing: 'border-box',
                    }}
                  >
                    <textarea
                      className="h-full min-h-[260px] w-full resize-none overflow-y-auto bulk-draft-editor-textarea"
                      value={output.draftReply}
                      onChange={(e) => updateDraftReply(msg.id, e.target.value)}
                      onClick={() => {
                        if (focusedMessageId !== msg.id) onSelectMessage?.(msg.id)
                        useEmailInboxStore.getState().setEditingDraftForMessageId(msg.id)
                        handleDraftRefineConnect()
                      }}
                      onFocus={() => {
                        if (focusedMessageId !== msg.id) onSelectMessage?.(msg.id)
                        useEmailInboxStore.getState().setEditingDraftForMessageId(msg.id)
                        handleDraftRefineConnect()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setSubFocus({ kind: 'none' })
                          e.preventDefault()
                        }
                      }}
                      placeholder="Edit draft before sending…"
                      style={{
                        width: '100%',
                        height: '100%',
                        minHeight: isExpanded ? 260 : 48,
                        flex: 1,
                        resize: 'none',
                        overflowY: 'auto',
                        borderRadius: 12,
                        background: '#f8fafc',
                        padding: isExpanded ? '12px 16px' : '6px 10px',
                        fontSize: isExpanded ? 14 : 12,
                        lineHeight: isExpanded ? 1.6 : 1.45,
                        outline: 'none',
                        border: 'none',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit',
                        color: '#334155',
                      }}
                    />
                  </div>
                </div>
                {refinedDraftText && isConnected ? (
                  <div className="bulk-action-card-refined-preview" style={{ flexShrink: 0, margin: '0 16px 12px' }}>
                    <div className="bulk-action-card-refined-header">
                      <span className="bulk-action-card-refined-label">Suggested refinement:</span>
                      <button
                        type="button"
                        className="bulk-action-card-accept-refinement"
                        onClick={acceptRefinement}
                        title="Apply refined draft"
                        aria-label="Apply refined draft"
                      >
                        ✓ Accept
                      </button>
                    </div>
                    <div className="bulk-action-card-refined-content">{refinedDraftText}</div>
                  </div>
                ) : null}
                {draftAttachments.length > 0 ? (
                  <div className="draft-attachments" style={{ flexShrink: 0, margin: '0 16px 12px' }}>
                    {draftAttachments.map((a, i) => (
                      <div key={i} className="attachment-chip">
                        <span>{a.name}</span>
                        <span className="attachment-size">{Math.round(a.size / 1024)}KB</span>
                        {onRemoveDraftAttachment ? (
                          <button type="button" onClick={() => onRemoveDraftAttachment(i)} aria-label="Remove">
                            ✕
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div
              className="bulk-draft-actions-toolbar-wrap"
              style={{ flexShrink: 0, width: '100%', paddingTop: isExpanded ? 16 : 6, boxSizing: 'border-box' }}
            >
              <div
                className="bulk-draft-actions-toolbar"
                style={{
                  display: 'flex',
                  flexWrap: 'nowrap',
                  overflowX: 'auto',
                  alignItems: 'center',
                  gap: isExpanded ? 8 : 4,
                  paddingTop: isExpanded ? 12 : 6,
                  paddingBottom: isExpanded ? 0 : 2,
                }}
              >
                {showUndo ? (
                  <button
                    type="button"
                    className="bulk-action-card-btn bulk-action-card-btn--secondary"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (currentFilter === 'pending_delete') handleUndoPendingDelete([msg.id])
                      else if (currentFilter === 'pending_review') handleUndoPendingReview(msg.id)
                      else handleUndoArchived(msg.id)
                    }}
                    title="Move back to inbox"
                  >
                    Undo
                  </button>
                ) : null}
                {msg.source_type === 'email_plain' && onAddDraftAttachment ? (
                  <button
                    type="button"
                    className="bulk-action-card-btn bulk-action-card-btn--secondary"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddDraftAttachment()
                    }}
                    title="Add attachment"
                  >
                    📎 Attach
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`bulk-action-card-btn bulk-action-card-btn--primary${rec === 'draft_reply_ready' ? ' bulk-action-card-btn--primary-emphasis' : ''}`}
                  onClick={() => handleSendDraft(msg, output.draftReply ?? '', draftAttachments.length > 0 ? draftAttachments : undefined)}
                >
                  {msg.source_type === 'email_plain' ? 'Send via Email' : 'Send via BEAP'}
                </button>
                {!streamClassifying && rec === 'draft_reply_ready' && output.draftReply ? (
                  <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleArchiveOne(msg)}>
                    Archive
                  </button>
                ) : null}
                {!streamClassifying && (rec === 'archive' || rec === 'keep_for_manual_action') ? (
                  <button type="button" className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis" onClick={() => handleArchiveOne(msg)}>
                    📦 Archive
                  </button>
                ) : null}
                {showAnalyzeButton ? (
                  <button
                    type="button"
                    className="bulk-action-card-btn bulk-action-card-btn--secondary"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleBulkAnalyze(msg.id)
                    }}
                    disabled={analyzeRunning || !!output?.loading}
                    title="Run full AI triage (classify) for this message"
                  >
                    Analyze
                  </button>
                ) : null}
                <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleSummarize(msg.id)} disabled={!!output?.loading} title="Regenerate summary">
                  ✨ Summarize
                </button>
                <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleDraftReply(msg.id)} disabled={!!output?.loading} title="Regenerate draft">
                  ✍ Draft
                </button>
                <button type="button" className="bulk-action-card-btn bulk-action-card-btn-delete" onClick={() => handleDeleteOne(msg)} title="Delete this message">
                  🗑 Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {!(output.draftReply != null && output.draftReply !== '') && (
      <div className="bulk-action-card-buttons">
        {showUndo && (
          <button
            type="button"
            className="bulk-action-card-btn bulk-action-card-btn--secondary"
            onClick={(e) => {
              e.stopPropagation()
              if (currentFilter === 'pending_delete') handleUndoPendingDelete([msg.id])
              else if (currentFilter === 'pending_review') handleUndoPendingReview(msg.id)
              else handleUndoArchived(msg.id)
            }}
            title="Move back to inbox"
          >
            Undo
          </button>
        )}
        {!streamClassifying && rec === 'draft_reply_ready' && output.draftReply && (
          <button
            type="button"
            className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis"
            onClick={() => handleSendDraft(msg, output.draftReply!)}
          >
            ✉ Send via Email
          </button>
        )}
        {!streamClassifying && (rec === 'archive' || rec === 'keep_for_manual_action') && (
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis" onClick={() => handleArchiveOne(msg)}>
            📦 Archive
          </button>
        )}
        {!streamClassifying && rec === 'draft_reply_ready' && output.draftReply && (
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleArchiveOne(msg)}>
            Archive
          </button>
        )}
        <div className="bulk-action-card-buttons-secondary">
          {showAnalyzeButton ? (
            <button
              type="button"
              className="bulk-action-card-btn bulk-action-card-btn--secondary"
              onClick={() => handleBulkAnalyze(msg.id)}
              disabled={analyzeRunning || !!output?.loading}
              title="Run full AI triage (classify) for this message"
            >
              Analyze
            </button>
          ) : null}
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleSummarize(msg.id)} disabled={!!output?.loading} title="Regenerate summary">
            ✨ Summarize
          </button>
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleDraftReply(msg.id)} disabled={!!output?.loading} title="Regenerate draft">
            ✍ Draft
          </button>
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn-delete" onClick={() => handleDeleteOne(msg)} title="Delete this message">
            🗑 Delete
          </button>
        </div>
      </div>
      )}
    </div>
  )
}

/**
 * Derive row badge text from reason, needsReply, and score.
 * Avoid defaulting to "Action Required" for low-urgency / FYI mail (was misleading for marketing).
 */
function getUrgencyBadgeText(reason: string | null | undefined, needsReply: boolean, urgencyScore = 5): string {
  const r = (reason ?? '').toLowerCase()
  if (/\b(payment|invoice|due|bill|amount)\b/.test(r)) return 'Payment Due'
  if (needsReply || /\b(reply|response|answer)\b/.test(r)) return 'Response Expected'
  const promoOrFyi =
    /\b(promotional|newsletter|marketing|unsolicited\s+commercial|advertisement|special offer|no\s+clear\s+action|without\s+clear\s+action|informational only|automated notification|unsubscribe)\b/.test(
      r
    )
  if (promoOrFyi) return 'FYI'
  if (urgencyScore <= 3 && !needsReply) return 'Low priority'
  if (urgencyScore >= BULK_AUTO_SORT_URGENCY_THRESHOLD) return 'Time-sensitive'
  if (urgencyScore >= 4) return 'Review suggested'
  return 'FYI'
}

const CATEGORY_BG: Record<string, string> = {
  urgent: 'rgba(239,68,68,0.05)',
  important: 'rgba(249,115,22,0.05)',
  normal: 'transparent',
  newsletter: 'rgba(59,130,246,0.05)',
  spam: 'rgba(107,114,128,0.08)',
  irrelevant: 'rgba(107,114,128,0.08)',
  pending_review: 'rgba(245,158,11,0.06)',
}

function sortMessagesByCategory(msgs: InboxMessage[]): InboxMessage[] {
  return [...msgs].sort((a, b) => {
    const orderA = CATEGORY_ORDER[a.sort_category ?? 'normal'] ?? 3
    const orderB = CATEGORY_ORDER[b.sort_category ?? 'normal'] ?? 3
    if (orderA !== orderB) return orderA - orderB
    const urgA = a.urgency_score ?? 5
    const urgB = b.urgency_score ?? 5
    if (urgA !== urgB) return urgB - urgA
    return (b.received_at || '').localeCompare(a.received_at || '')
  })
}

export interface EmailInboxBulkViewProps {
  accounts: Array<{ id: string; email: string; status?: string }>
  /** Focused message for chat/search scope; syncs with Hybrid Search */
  selectedMessageId?: string | null
  /** Toggle focus; does not switch views */
  onSelectMessage?: (messageId: string | null) => void
  /** Focused attachment for chat/search scope; syncs with Hybrid Search */
  selectedAttachmentId?: string | null
  /** Toggle attachment focus */
  onSelectAttachment?: (attachmentId: string | null) => void
}

export default function EmailInboxBulkView({
  accounts,
  selectedMessageId: focusedMessageId,
  onSelectMessage,
  selectedAttachmentId,
  onSelectAttachment,
}: EmailInboxBulkViewProps) {
  const {
    messages,
    total,
    loading,
    bulkBackgroundRefresh,
    error,
    lastSyncWarnings,
    bulkBatchSize,
    bulkCompactMode,
    bulkAiOutputs,
    multiSelectIds,
    selectedMessage,
    selectedMessageId,
    filter,
    tabCounts: storeTabCounts,
    bulkHasMore,
    bulkLoadingMore,
    fetchMessages,
    fetchAllMessages,
    selectAllMatchingCurrentFilter,
    refreshMessages,
    setBulkMode,
    setBulkBatchSize,
    setBulkCompactMode,
    syncBulkBatchSizeFromSettings,
    setBulkAiOutputs,
    clearBulkAiOutputsForIds,
    clearPendingDeleteStateForIds,
    setFilter,
    selectMessage,
    selectAttachment,
    toggleMultiSelect,
    clearMultiSelect,
    markRead,
    archiveMessages,
    deleteMessages,
    markPendingDeleteImmediate,
    moveToPendingReviewImmediate,
    setCategory,
    autoSyncEnabled,
    syncing,
    syncAllAccounts,
    toggleAutoSync,
    loadSyncState,
    accountSyncWindowDays,
    patchAccountSyncPreferences,
    editingDraftForMessageId,
    setEditingDraftForMessageId,
    subFocus,
    setSubFocus,
    isSortingActive,
    remoteSyncLog,
    addRemoteSyncLog,
    clearRemoteSyncLog,
  } = useEmailInboxStore(
    useShallow((s) => ({
      messages: s.messages,
      total: s.total,
      loading: s.loading,
      bulkBackgroundRefresh: s.bulkBackgroundRefresh,
      error: s.error,
      lastSyncWarnings: s.lastSyncWarnings,
      bulkBatchSize: s.bulkBatchSize,
      bulkCompactMode: s.bulkCompactMode,
      bulkAiOutputs: s.bulkAiOutputs,
      multiSelectIds: s.multiSelectIds,
      selectedMessage: s.selectedMessage,
      selectedMessageId: s.selectedMessageId,
      filter: s.filter,
      tabCounts: s.tabCounts,
      bulkHasMore: s.bulkHasMore,
      bulkLoadingMore: s.bulkLoadingMore,
      fetchMessages: s.fetchMessages,
      fetchAllMessages: s.fetchAllMessages,
      selectAllMatchingCurrentFilter: s.selectAllMatchingCurrentFilter,
      refreshMessages: s.refreshMessages,
      setBulkMode: s.setBulkMode,
      setBulkBatchSize: s.setBulkBatchSize,
      setBulkCompactMode: s.setBulkCompactMode,
      syncBulkBatchSizeFromSettings: s.syncBulkBatchSizeFromSettings,
      setBulkAiOutputs: s.setBulkAiOutputs,
      clearBulkAiOutputsForIds: s.clearBulkAiOutputsForIds,
      clearPendingDeleteStateForIds: s.clearPendingDeleteStateForIds,
      setFilter: s.setFilter,
      selectMessage: s.selectMessage,
      selectAttachment: s.selectAttachment,
      toggleMultiSelect: s.toggleMultiSelect,
      clearMultiSelect: s.clearMultiSelect,
      markRead: s.markRead,
      archiveMessages: s.archiveMessages,
      deleteMessages: s.deleteMessages,
      markPendingDeleteImmediate: s.markPendingDeleteImmediate,
      moveToPendingReviewImmediate: s.moveToPendingReviewImmediate,
      setCategory: s.setCategory,
      autoSyncEnabled: s.autoSyncEnabled,
      syncing: s.syncing,
      syncAllAccounts: s.syncAllAccounts,
      toggleAutoSync: s.toggleAutoSync,
      loadSyncState: s.loadSyncState,
      accountSyncWindowDays: s.accountSyncWindowDays,
      patchAccountSyncPreferences: s.patchAccountSyncPreferences,
      editingDraftForMessageId: s.editingDraftForMessageId,
      setEditingDraftForMessageId: s.setEditingDraftForMessageId,
      subFocus: s.subFocus,
      setSubFocus: s.setSubFocus,
      isSortingActive: s.isSortingActive,
      remoteSyncLog: s.remoteSyncLog,
      addRemoteSyncLog: s.addRemoteSyncLog,
      clearRemoteSyncLog: s.clearRemoteSyncLog,
    }))
  )

  const primaryAccountId = pickDefaultEmailAccountRowId(accounts)
  const draftRefineConnect = useDraftRefineStore((s) => s.connect)

  const tabCounts = useMemo(() => {
    const t = storeTabCounts ?? {}
    return {
      all: typeof t.all === 'number' ? t.all : 0,
      urgent: typeof t.urgent === 'number' ? t.urgent : 0,
      pending_delete: typeof t.pending_delete === 'number' ? t.pending_delete : 0,
      pending_review: typeof t.pending_review === 'number' ? t.pending_review : 0,
      archived: typeof t.archived === 'number' ? t.archived : 0,
    }
  }, [storeTabCounts])

  useEffect(() => {
    if (primaryAccountId) loadSyncState(primaryAccountId)
  }, [primaryAccountId, loadSyncState])

  useEffect(() => {
    const unsub = window.emailInbox?.onNewMessages?.(() => {
      if (useEmailInboxStore.getState().syncing) return
      void refreshMessages()
    })
    return () => unsub?.()
  }, [refreshMessages])

  useEffect(() => {
    const unsub = window.emailInbox?.onDrainProgress?.((raw) => {
      const p = raw as {
        processed?: number
        pending?: number
        failed?: number
        deferred?: number
        phase?: string
        batchSize?: number
        batchMoved?: number
        batchSkipped?: number
        batchErrors?: number
        batchImapDeferred?: number
      }
      if (p.phase === 'simple_processing') {
        addRemoteSyncLog(`Drain batch: starting up to ${p.batchSize ?? 0} row(s)…`)
        return
      }
      if (p.phase === 'simple_idle' && p.batchSize != null) {
        const moved = p.batchMoved ?? 0
        const skipped = p.batchSkipped ?? 0
        const errors = p.batchErrors ?? p.failed ?? 0
        const imapDef = p.batchImapDeferred ?? 0
        const tail =
          imapDef > 0 ? `, ${imapDef} deferred (IMAP ping)` : ''
        addRemoteSyncLog(
          `Drain: ${p.batchSize} processed (${moved} moved, ${skipped} skipped, ${errors} errors${tail}) | ${p.pending ?? 0} pending`,
        )
        return
      }
      addRemoteSyncLog(
        `Drain: processed=${p.processed ?? 0} pending=${p.pending ?? 0} failed=${p.failed ?? 0} deferred(pull)=${p.deferred ?? 0}`,
      )
    })
    return () => unsub?.()
  }, [addRemoteSyncLog])

  useEffect(() => {
    const unsub = window.emailInbox?.onSimpleDrainRow?.((raw) => {
      const r = raw as {
        status?: string
        op?: string
        msgId?: string
        dest?: string
        error?: string
      }
      const op = r.op ?? '?'
      const msg = String(r.msgId ?? '').slice(0, 8)
      if (r.status === 'moved') {
        addRemoteSyncLog(`MOVED: ${op} → ${r.dest ?? '?'} (msg ${msg})`)
      } else if (r.status === 'skipped') {
        addRemoteSyncLog(`SKIPPED: ${op} → ${r.dest ?? '?'} (msg ${msg})`)
      } else if (r.status === 'error') {
        addRemoteSyncLog(`ERROR: ${op} — ${r.error ?? '?'} (msg ${msg})`)
      }
    })
    return () => unsub?.()
  }, [addRemoteSyncLog])

  const handleSyncWindowChange = useCallback(
    async (days: number) => {
      if (!primaryAccountId) return
      if (days === 0) {
        const ok = window.confirm('Syncing all messages may take a long time. Continue?')
        if (!ok) return
      }
      await patchAccountSyncPreferences(primaryAccountId, { syncWindowDays: days })
    },
    [primaryAccountId, patchAccountSyncPreferences],
  )

  const [remoteSyncBusy, setRemoteSyncBusy] = useState(false)

  /** Enqueue full remote lifecycle reconcile (background drain). */
  const enqueueFullRemoteSync = useCallback(async (): Promise<void> => {
    const fn = window.emailInbox?.fullRemoteSyncAllAccounts
    if (!fn) {
      console.warn('[Inbox] fullRemoteSyncAllAccounts not available (update app)')
      addRemoteSyncLog('Sync: remote reconcile not available — update WR Desk')
      return
    }
    setRemoteSyncBusy(true)
    try {
      const r = await fn()
      if (r?.ok) {
        console.log(
          '[Inbox] Sync Remote enqueued:',
          `accounts=${r.accountCount ?? '?'} enqueued=${r.enqueued ?? 0} skipped=${r.skipped ?? 0}`,
        )
        addRemoteSyncLog(
          `Sync Remote: ${r.enqueued ?? 0} enqueued, ${r.skipped ?? 0} skipped` +
            (typeof r.unmirroredEnqueued === 'number' && r.unmirroredEnqueued > 0
              ? ` (${r.unmirroredEnqueued} backfill unmirrored)`
              : '') +
            (typeof r.orphanPendingCleared === 'number' && r.orphanPendingCleared > 0
              ? `, ${r.orphanPendingCleared} orphan queue row(s) cleared`
              : '') +
            ' — background drain until empty (see 🔧 for pending)',
        )
      } else {
        console.warn('[Inbox] Sync Remote:', r?.error)
        addRemoteSyncLog(`Sync Remote failed: ${r?.error ?? 'unknown'}`)
      }
    } catch (e) {
      console.warn('[Inbox] Sync Remote failed:', e)
      addRemoteSyncLog(`Sync Remote error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRemoteSyncBusy(false)
    }
  }, [addRemoteSyncLog])

  /** Pull from mailbox(es); optionally enqueue remote folder reconcile when at least one OAuth account exists. */
  const handleUnifiedSync = useCallback(async () => {
    const ids = activeEmailAccountIdsForSync(accounts)
    const toSync = ids.length > 0 ? ids : primaryAccountId ? [primaryAccountId] : []
    if (toSync.length === 0) return
    await syncAllAccounts(toSync)
    let shouldEnqueueRemote = true
    if (typeof window.emailAccounts?.listAccounts === 'function') {
      try {
        const res = await window.emailAccounts.listAccounts()
        if (res?.ok && res.data && res.data.length > 0) {
          const allImap = res.data.every((a: { provider?: string }) => {
            const p = a.provider
            return p !== 'gmail' && p !== 'microsoft365' && p !== 'zoho'
          })
          if (allImap) shouldEnqueueRemote = false
        }
      } catch {
        /* keep shouldEnqueueRemote true */
      }
    }
    if (shouldEnqueueRemote) await enqueueFullRemoteSync()
  }, [accounts, primaryAccountId, syncAllAccounts, enqueueFullRemoteSync])

  const [remoteDebugOpen, setRemoteDebugOpen] = useState(false)
  const [remoteDebugLoading, setRemoteDebugLoading] = useState(false)
  const [remoteDebugQueue, setRemoteDebugQueue] = useState<Record<string, unknown> | null>(null)
  /** Optional account filter for `debugMainInboxRows` IPC (empty = all accounts). */
  const [remoteMainInboxAccountId, setRemoteMainInboxAccountId] = useState('')
  const [remoteMainInboxDebug, setRemoteMainInboxDebug] = useState<Record<string, unknown> | null>(null)
  /** IMAP LIST + STATUS + lifecycle exact-match (read-only). */
  const [remoteFolderVerify, setRemoteFolderVerify] = useState<Record<string, unknown> | null>(null)
  const [remoteFolderVerifyLoading, setRemoteFolderVerifyLoading] = useState(false)
  /** Which account the last verify was run for (debug panel). */
  const [remoteFolderVerifyLabel, setRemoteFolderVerifyLabel] = useState<string | null>(null)
  /** Last ~30s of queue snapshots (while debug panel open) for drain ETA. */
  const [remoteDrainHistory, setRemoteDrainHistory] = useState<RemoteDrainSample[]>([])
  const [remoteDebugTestMove, setRemoteDebugTestMove] = useState<{
    enqueue: string
    move: string
    skipReasons?: string[]
    messageRowBeforeEnqueue?: Record<string, unknown> | null
    messageRowAfterDrain?: Record<string, unknown> | null
    queueRows?: Array<Record<string, unknown>>
  } | null>(null)
  /** `inbox:debugAccountMigrationStatus` — gateway ids vs orphan inbox_messages.account_id */
  const [accountMigrationDiag, setAccountMigrationDiag] = useState<Record<string, unknown> | null>(null)
  /** Per-orphan chosen target account id for migrate (defaults to first suggestion in UI). */
  const [orphanMigrateTargetId, setOrphanMigrateTargetId] = useState<Record<string, string>>({})

  const remoteSyncUserSummary = useMemo(() => {
    if (!remoteDebugQueue || typeof remoteDebugQueue !== 'object') return null
    const byStatus = (remoteDebugQueue.byStatus as QueueStatusRow[]) ?? []
    return buildRemoteSyncUserSummary(byStatus)
  }, [remoteDebugQueue])

  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set())
  const [providerSectionExpanded, setProviderSectionExpanded] = useState(false)

  const toggleCardExpand = useCallback((id: string) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])


  const [providerAccounts, setProviderAccounts] = useState<
    Array<{
      id: string
      displayName: string
      email: string
      provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap'
      status: 'active' | 'auth_error' | 'error' | 'disabled'
      lastError?: string
    }>
  >([])
  const [isLoadingProviderAccounts, setIsLoadingProviderAccounts] = useState(true)
  const [selectedProviderAccountId, setSelectedProviderAccountId] = useState<string | null>(null)
  /** True when every listed account is IMAP — unified Sync runs pull only (no remote enqueue). */
  const bulkToolbarPullOnly = useMemo(
    () => providerAccounts.length > 0 && providerAccounts.every((a) => a.provider === 'imap'),
    [providerAccounts],
  )

  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null)
  const [aiSortProgress, setAiSortProgress] = useState<string | null>(null)
  /** One-line summary after a bulk Auto-Sort run (moved / kept / failed counts). */
  const [aiSortOutcomeSummary, setAiSortOutcomeSummary] = useState<string | null>(null)
  /** Shown when user triggers Auto-Sort while a run is already active. */
  const [concurrentSortNotice, setConcurrentSortNotice] = useState<string | null>(null)
  const [showEmailCompose, setShowEmailCompose] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState<InboxMessage | null>(null)
  const [replyDraftBody, setReplyDraftBody] = useState<string>('')
  const [draftAttachmentsForCompose, setDraftAttachmentsForCompose] = useState<Array<{ name: string; path: string; size: number }>>([])
  const [draftAttachmentsByMessage, setDraftAttachmentsByMessage] = useState<Record<string, Array<{ name: string; path: string; size: number }>>>({})
  const composeClickRef = useRef<number>(0)
  const [showWrExpertModal, setShowWrExpertModal] = useState(false)
  const [wrExpertContent, setWrExpertContent] = useState('')
  const [wrExpertSaving, setWrExpertSaving] = useState(false)
  const [shouldSelectAllWhenReady, setShouldSelectAllWhenReady] = useState(false)

  useEffect(() => {
    if (showWrExpertModal && window.emailInbox?.getAiRules) {
      window.emailInbox.getAiRules().then((c) => setWrExpertContent(c ?? ''))
    }
  }, [showWrExpertModal])

  /** Messages animating out (archive / pending delete). Cleared after exit animation. */
  const [removingItems, setRemovingItems] = useState<Map<string, { message: InboxMessage; index: number }>>(new Map())
  const prevMessagesRef = useRef<InboxMessage[]>([])
  const prevFilterRef = useRef<string>(filter.filter)
  /** True while a bulk sort is in flight — synchronous guard before any await (store isSortingActive lags one frame). */
  const isSortingRef = useRef(false)
  /** Per-message guard for explicit “Analyze” so double-clicks don’t start concurrent classify runs. */
  const bulkAnalyzeInFlightRef = useRef<Set<string>>(new Set())
  /** Unsubscribes `onAiAnalyzeChunk` / `onAiAnalyzeError` for per-row streaming. */
  const bulkAnalyzeStreamCleanupRef = useRef<Map<string, () => void>>(new Map())
  /** Bumps when Analyze starts/ends so action rows re-read in-flight state from the ref. */
  const [bulkAnalyzeUiEpoch, setBulkAnalyzeUiEpoch] = useState(0)

  useEffect(() => {
    return () => {
      for (const cleanup of bulkAnalyzeStreamCleanupRef.current.values()) {
        try {
          cleanup()
        } catch {
          /* noop */
        }
      }
      bulkAnalyzeStreamCleanupRef.current.clear()
    }
  }, [])

  const sortedMessages = useMemo(() => sortMessagesByCategory(messages), [messages])

  /** Build display list: current messages + removing items at original positions. */
  const displayMessages = useMemo(() => {
    const base = [...sortedMessages]
    const removing = Array.from(removingItems.entries())
      .map(([id, { message, index }]) => ({ id, message, index }))
      .sort((a, b) => b.index - a.index)
    for (const { message, index } of removing) {
      base.splice(Math.min(index, base.length), 0, message)
    }
    return base
  }, [sortedMessages, removingItems])

  const refreshRemoteDebugQueue = useCallback(
    async (opts?: { silent?: boolean; mainInboxAccountOverride?: string }) => {
      if (!opts?.silent) setRemoteDebugLoading(true)
      try {
        const q = await window.emailInbox?.debugQueueStatus?.()
        setRemoteDebugQueue(q && typeof q === 'object' ? (q as Record<string, unknown>) : null)
        if (q && typeof q === 'object' && typeof (q as { error?: unknown }).error !== 'string') {
          const byStatus = ((q as { byStatus?: QueueStatusRow[] }).byStatus ?? []) as QueueStatusRow[]
          const completed = countStatus(byStatus, 'completed')
          const pending = countStatus(byStatus, 'pending')
          const processing = countStatus(byStatus, 'processing')
          const now = Date.now()
          setRemoteDrainHistory((prev) => {
            const trimmed = prev.filter((x) => now - x.t <= 30_000)
            return [...trimmed, { t: now, completed, pending, processing }]
          })
        }
        const inboxFn = window.emailInbox?.debugMainInboxRows
        if (inboxFn) {
          const accFilter =
            opts?.mainInboxAccountOverride !== undefined
              ? opts.mainInboxAccountOverride
              : remoteMainInboxAccountId.trim() || undefined
          const ir = await inboxFn(accFilter)
          setRemoteMainInboxDebug(ir && typeof ir === 'object' ? (ir as Record<string, unknown>) : null)
        } else {
          setRemoteMainInboxDebug(null)
        }
        const migFn = window.emailInbox?.debugAccountMigrationStatus
        if (migFn) {
          const mig = await migFn()
          if (mig && typeof mig === 'object' && (mig as { ok?: boolean }).ok === true) {
            setAccountMigrationDiag(mig as Record<string, unknown>)
          } else {
            setAccountMigrationDiag(null)
          }
        } else {
          setAccountMigrationDiag(null)
        }
      } finally {
        if (!opts?.silent) setRemoteDebugLoading(false)
      }
    },
    [remoteMainInboxAccountId],
  )

  const openRemoteDebugPanel = useCallback(() => {
    setRemoteDebugOpen(true)
    void refreshRemoteDebugQueue()
  }, [refreshRemoteDebugQueue])

  const handleVerifyImapRemoteFolders = useCallback(
    async (explicitAccountId?: string, accountLabelForUi?: string) => {
      const fn = window.emailInbox?.verifyImapRemoteFolders
      if (!fn) {
        setRemoteFolderVerify({ ok: false, error: 'verifyImapRemoteFolders not in bridge (update app)' })
        setRemoteFolderVerifyLabel(null)
        return
      }
      const aid = (explicitAccountId?.trim() || remoteMainInboxAccountId.trim() || primaryAccountId || '').trim()
      if (!aid) {
        setRemoteFolderVerify({
          ok: false,
          error: 'Use “Verify” next to an IMAP account in Per account (queue), or pick an account in Account filter.',
        })
        setRemoteFolderVerifyLabel(null)
        return
      }
      setRemoteFolderVerifyLabel(accountLabelForUi?.trim() || null)
      setRemoteFolderVerifyLoading(true)
      try {
        const r = await fn(aid)
        const rec = r && typeof r === 'object' ? (r as Record<string, unknown>) : { ok: false, error: 'empty' }
        setRemoteFolderVerify(rec)
        if (rec.ok === false) {
          const err = typeof rec.error === 'string' ? rec.error : 'unknown'
          addRemoteSyncLog(`Verify Remote: FAILED — ${err}`)
        } else {
          addRemoteSyncLog('Verify Remote: OK (folder list loaded)')
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setRemoteFolderVerify({ ok: false, error: msg })
        addRemoteSyncLog(`Verify Remote: FAILED — ${msg}`)
      } finally {
        setRemoteFolderVerifyLoading(false)
      }
    },
    [remoteMainInboxAccountId, primaryAccountId, addRemoteSyncLog],
  )

  useEffect(() => {
    if (!remoteDebugOpen) {
      setRemoteDrainHistory([])
      setRemoteMainInboxDebug(null)
      setAccountMigrationDiag(null)
      setRemoteFolderVerify(null)
      setRemoteFolderVerifyLabel(null)
      return
    }
    const id = window.setInterval(() => {
      void refreshRemoteDebugQueue({ silent: true })
    }, 5_000)
    return () => clearInterval(id)
  }, [remoteDebugOpen, refreshRemoteDebugQueue])

  const handleRetryFailedRemoteQueue = useCallback(
    async (accountId?: string) => {
      const fn = window.emailInbox?.retryFailedRemoteOps
      if (!fn) {
        addRemoteSyncLog('retryFailedRemoteOps not in bridge (update app)')
        return
      }
      setRemoteDebugLoading(true)
      try {
        const r = await fn(accountId)
        if (r?.ok) {
          addRemoteSyncLog(
            accountId
              ? `Retry failed (${accountId.slice(0, 8)}…): ${r.resetCount ?? 0} row(s) reset to pending (drain scheduled)`
              : `Retry failed queue: ${r.resetCount ?? 0} row(s) reset to pending (drain scheduled)`,
          )
        } else {
          addRemoteSyncLog(`Retry failed queue: ${r?.error ?? 'failed'}`)
        }
        await refreshRemoteDebugQueue()
      } finally {
        setRemoteDebugLoading(false)
      }
    },
    [addRemoteSyncLog, refreshRemoteDebugQueue],
  )

  const handleClearFailedRemoteQueue = useCallback(
    async (accountId: string) => {
      const fn = window.emailInbox?.clearFailedRemoteOps
      if (!fn) {
        addRemoteSyncLog('clearFailedRemoteOps not in bridge (update app)')
        return
      }
      setRemoteDebugLoading(true)
      try {
        const r = await fn(accountId)
        if (r?.ok) {
          addRemoteSyncLog(
            `Clear failed (${accountId.slice(0, 8)}…): ${r.deletedCount ?? 0} row(s) removed (orphan / dead session)`,
          )
        } else {
          addRemoteSyncLog(`Clear failed: ${r?.error ?? 'failed'}`)
        }
        await refreshRemoteDebugQueue()
      } finally {
        setRemoteDebugLoading(false)
      }
    },
    [addRemoteSyncLog, refreshRemoteDebugQueue],
  )

  const handleMigrateInboxAccount = useCallback(
    async (fromAccountId: string, toAccountId: string) => {
      const fn = window.emailInbox?.migrateInboxAccountId
      if (!fn) {
        addRemoteSyncLog('migrateInboxAccountId not in bridge (update app)')
        return
      }
      setRemoteDebugLoading(true)
      try {
        const r = (await fn(fromAccountId, toAccountId)) as {
          ok?: boolean
          error?: string
          messagesUpdated?: number
          queueRowsDeleted?: number
        }
        if (r?.ok) {
          addRemoteSyncLog(
            `Inbox migrate: ${fromAccountId.slice(0, 8)}… → ${toAccountId.slice(0, 8)}… — ${r.messagesUpdated ?? 0} message row(s), ${r.queueRowsDeleted ?? 0} queue row(s) removed. Run ☁ Sync Remote.`,
          )
          await refreshMessages()
        } else {
          addRemoteSyncLog(`Inbox migrate failed: ${r?.error ?? 'unknown'}`)
        }
        await refreshRemoteDebugQueue({ silent: true })
      } finally {
        setRemoteDebugLoading(false)
      }
    },
    [addRemoteSyncLog, refreshMessages, refreshRemoteDebugQueue],
  )

  const handleTestMoveOne = useCallback(async () => {
    const id = displayMessages[0]?.id
    if (!id) {
      setRemoteDebugTestMove({ enqueue: 'No message in current view', move: '—', skipReasons: [] })
      setRemoteDebugOpen(true)
      return
    }
    const fn = window.emailInbox?.debugTestMoveOne
    if (!fn) {
      setRemoteDebugTestMove({ enqueue: 'debugTestMoveOne not in bridge', move: '—', skipReasons: [] })
      setRemoteDebugOpen(true)
      return
    }
    setRemoteDebugOpen(true)
    setRemoteDebugLoading(true)
    try {
      const r = (await fn(id)) as {
        ok?: boolean
        error?: string
        enqueue?: { enqueued: number; skipped: number; skipReasons?: string[] }
        drainProcessed?: number
        drainFailed?: number
        lastRow?: { status?: string; last_error?: string | null } | null
        messageRowBeforeEnqueue?: Record<string, unknown> | null
        messageRowAfterDrain?: Record<string, unknown> | null
        queueRowsForMessage?: Array<Record<string, unknown>>
      }
      if (!r?.ok) {
        const enc = `Enqueue: error ${r?.error ?? 'unknown'}`
        setRemoteDebugTestMove({ enqueue: enc, move: '—', skipReasons: [] })
        addRemoteSyncLog(enc)
      } else {
        const enq = r.enqueue
        const reasons = Array.isArray(enq?.skipReasons) ? enq!.skipReasons! : []
        const encLine = `Enqueue result: ${enq?.enqueued ?? 0} enqueued, ${enq?.skipped ?? 0} skipped`
        const row = r.lastRow
        let moveLine: string
        if (!row) moveLine = 'Move result: no queue row (nothing to mirror or skipped)'
        else if (row.status === 'completed') moveLine = 'Move result: OK'
        else if (row.status === 'failed') moveLine = `Move result: FAIL: ${row.last_error ?? 'unknown'}`
        else
          moveLine = `Move result: ${row.status} (batch processed=${r.drainProcessed ?? 0}, failed=${r.drainFailed ?? 0})`
        setRemoteDebugTestMove({
          enqueue: encLine,
          move: moveLine,
          skipReasons: reasons,
          messageRowBeforeEnqueue: r.messageRowBeforeEnqueue ?? null,
          messageRowAfterDrain: r.messageRowAfterDrain ?? null,
          queueRows: r.queueRowsForMessage ?? [],
        })
        const reasonSuffix = reasons.length ? ` · skips: ${reasons.join(' | ')}` : ''
        addRemoteSyncLog(`${encLine} · ${moveLine}${reasonSuffix}`)
      }
      await refreshRemoteDebugQueue()
    } finally {
      setRemoteDebugLoading(false)
    }
  }, [displayMessages, addRemoteSyncLog, refreshRemoteDebugQueue])

  /** Detect removals and add to removingItems for exit animation. Skip when filter changed (view switch). */
  useEffect(() => {
    if (loading) return
    const prev = prevMessagesRef.current
    const prevFilter = prevFilterRef.current
    prevMessagesRef.current = messages
    prevFilterRef.current = filter.filter
    if (prevFilter !== filter.filter) return
    if (prev.length === 0) return
    if (messages.length >= prev.length) return
    const removed = prev.filter((m) => !messages.some((n) => n.id === m.id))
    if (removed.length === 0 || removed.length > 50) return
    const prevSorted = sortMessagesByCategory(prev)
    setRemovingItems((curr) => {
      const next = new Map(curr)
      for (const m of removed) {
        const idx = prevSorted.findIndex((x) => x.id === m.id)
        if (idx >= 0) next.set(m.id, { message: m, index: idx })
      }
      return next
    })
  }, [messages, loading, filter.filter])
  /** Toolbar bulk actions operate on messages only. Count excludes drafts (no draft checkbox). */
  const selectedCount = multiSelectIds.size
  const batchMessages = sortedMessages
  /** “All” batch: header checkbox reflects full tab (total / selectedCount), not only rendered rows. */
  const allInBatchSelected =
    bulkBatchSize === 'all'
      ? total > 0 && selectedCount === total
      : batchMessages.length > 0 && batchMessages.every((m) => multiSelectIds.has(m.id))
  const someInBatchSelected =
    bulkBatchSize === 'all'
      ? selectedCount > 0 && selectedCount < total
      : batchMessages.some((m) => multiSelectIds.has(m.id))

  const handleBatchCheckboxToggle = useCallback(() => {
    void (async () => {
      if (bulkBatchSize === 'all') {
        if (allInBatchSelected || someInBatchSelected) clearMultiSelect()
        else await selectAllMatchingCurrentFilter()
        return
      }
      if (allInBatchSelected || someInBatchSelected) {
        clearMultiSelect()
      } else {
        batchMessages.forEach((m) => {
          if (!multiSelectIds.has(m.id)) toggleMultiSelect(m.id)
        })
      }
    })()
  }, [
    bulkBatchSize,
    allInBatchSelected,
    someInBatchSelected,
    batchMessages,
    multiSelectIds,
    clearMultiSelect,
    toggleMultiSelect,
    selectAllMatchingCurrentFilter,
  ])

  const batchCheckboxRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = batchCheckboxRef.current
    if (el) {
      ;(el as HTMLInputElement & { indeterminate?: boolean }).indeterminate =
        someInBatchSelected && !allInBatchSelected
    }
  }, [someInBatchSelected, allInBatchSelected])

  useEffect(() => {
    setBulkMode(true)
    return () => setBulkMode(false)
  }, [setBulkMode])

  /** Auto-focus first row when messages finish loading — enables immediate keyboard triage. Skip when user explicitly unfocused. */
  const prevLoadingRef = useRef(false)
  useEffect(() => {
    const wasLoading = prevLoadingRef.current
    prevLoadingRef.current = loading
    if (wasLoading && !loading && sortedMessages.length > 0 && !focusedMessageId && onSelectMessage) {
      onSelectMessage(sortedMessages[0].id)
    }
  }, [loading, sortedMessages, focusedMessageId, onSelectMessage])

  /** Scroll focused row into view when focus changes (keyboard nav or click). */
  useEffect(() => {
    if (focusedMessageId) {
      const el = document.querySelector(`[data-msg-id="${focusedMessageId}"]`) as HTMLElement | null
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [focusedMessageId])

  /** When focused message is removed (archived/deleted), focus next available row. */
  useEffect(() => {
    if (
      focusedMessageId &&
      !sortedMessages.some((m) => m.id === focusedMessageId) &&
      sortedMessages.length > 0 &&
      onSelectMessage
    ) {
      onSelectMessage(sortedMessages[0].id)
    }
  }, [focusedMessageId, sortedMessages, onSelectMessage])

  useEffect(() => {
    syncBulkBatchSizeFromSettings()
  }, [syncBulkBatchSizeFromSettings])

  /** Initial load + filter changes handled in store setFilter; mount: first page + tab counts. */
  useEffect(() => {
    void fetchAllMessages()
  }, [fetchAllMessages])

  const bulkScrollContainerRef = useRef<HTMLDivElement>(null)
  const bulkLoadSentinelRef = useRef<HTMLDivElement>(null)

  /** Infinite scroll: load next page when sentinel enters the list scroll area (IntersectionObserver; root = scroll container). */
  useEffect(() => {
    const root = bulkScrollContainerRef.current
    const sentinel = bulkLoadSentinelRef.current
    if (!root || !sentinel || !bulkHasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        const s = useEmailInboxStore.getState()
        if (!s.bulkMode || s.bulkLoadingMore || !s.bulkHasMore) return
        if (s.messages.length >= s.total) return
        void s.loadMoreBulkMessages()
      },
      { root, rootMargin: '0px 0px 120px 0px', threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [bulkHasMore, filter.filter, loading, messages.length])

  /** When user selects batch size “All”, select every ID for the active tab (DB drain), not just the rendered slice. */
  useEffect(() => {
    if (!shouldSelectAllWhenReady) return
    if (bulkBatchSize === 'all') {
      void selectAllMatchingCurrentFilter().finally(() => setShouldSelectAllWhenReady(false))
      return
    }
    if (messages.length > 0) {
      messages.forEach((m) => {
        if (!multiSelectIds.has(m.id)) toggleMultiSelect(m.id)
      })
      setShouldSelectAllWhenReady(false)
    }
  }, [shouldSelectAllWhenReady, bulkBatchSize, messages, multiSelectIds, selectAllMatchingCurrentFilter, toggleMultiSelect])

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) deleteMessages(ids)
    clearMultiSelect()
  }, [multiSelectIds, deleteMessages, clearMultiSelect])

  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) archiveMessages(ids)
    clearMultiSelect()
  }, [multiSelectIds, archiveMessages, clearMultiSelect])

  const handleBulkMoveToPendingReview = useCallback(async () => {
    const ids = Array.from(multiSelectIds)
    if (!ids.length) return
    const ok = await moveToPendingReviewImmediate(ids)
    if (ok) clearMultiSelect()
  }, [multiSelectIds, clearMultiSelect, moveToPendingReviewImmediate])

  const handleBulkCategorize = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) {
      const cat = window.prompt('Category name (or leave empty to clear):')
      if (cat !== null) {
        setCategory(ids, cat)
        clearMultiSelect()
      }
    }
  }, [multiSelectIds, setCategory, clearMultiSelect])

  /** Per-message classify + immediate moves. Callers: toolbar Auto-Sort, per-row Retry only. */
  const runAiCategorizeForIds = useCallback(
    async (
      ids: string[],
      clearSelection: boolean,
      isRetry = false,
      opts?: { manageConcurrencyLock?: boolean; suppressGlobalSortingUi?: boolean; skipEndRefresh?: boolean }
    ): Promise<BulkSortRunAggregate> => {
      const manageConcurrencyLock = opts?.manageConcurrencyLock !== false
      const suppressGlobalSortingUi = opts?.suppressGlobalSortingUi === true
      const skipEndRefresh = opts?.skipEndRefresh === true
      if (manageConcurrencyLock) {
        isSortingRef.current = true
      }
      if (!ids.length || !window.emailInbox?.aiClassifySingle) {
        if (manageConcurrencyLock) {
          isSortingRef.current = false
          useEmailInboxStore.getState().setSortingActive(false)
          setAiSortProgress(null)
        }
        return {
          processedIds: [],
          failedIds: [],
          movedIds: [],
          missedIds: [],
          retainedCounts: emptyRetainedCounts(),
        }
      }
      if (!suppressGlobalSortingUi) {
        useEmailInboxStore.getState().setSortingActive(true)
        setAiSortProgress(`Analyzing ${ids.length} message${ids.length !== 1 ? 's' : ''}…`)
      }
      /** Parallel IPC calls — Ollama queues; 5 keeps GPU fed without huge bursts (was 3). */
      const CONCURRENCY = 5
      const VALID_ACTIONS: BulkRecommendedAction[] = ['pending_delete', 'pending_review', 'archive', 'keep_for_manual_action', 'draft_reply_ready']
      const VALID_CATEGORIES: SortCategory[] = ['urgent', 'important', 'normal', 'newsletter', 'spam', 'irrelevant', 'pending_review']
      const processedIds: string[] = []
      const failedIds: string[] = []
      const movedIds: string[] = []
      const retainedCounts = emptyRetainedCounts()
      try {
        for (let i = 0; i < ids.length; i += CONCURRENCY) {
          const batch = ids.slice(i, i + CONCURRENCY)
          const doneAfterBatch = Math.min(i + batch.length, ids.length)
          if (!suppressGlobalSortingUi) {
            setAiSortProgress(`Analyzing ${doneAfterBatch}/${ids.length}…`)
          }
          const settled = await Promise.allSettled(
            batch.map(async (messageId) => {
              try {
              const result = await window.emailInbox!.aiClassifySingle(messageId)
              if (result.error) {
                failedIds.push(messageId)
                console.warn('[SORT] Failed to analyze message:', messageId, result.error)
                const failureReason =
                  result.error === 'timeout'
                    ? ('timeout' as const)
                    : result.error === 'parse_failed'
                      ? ('parse_failed' as const)
                      : ('llm_error' as const)
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: {
                    summary:
                      failureReason === 'timeout'
                        ? 'Timed out.'
                        : failureReason === 'parse_failed'
                          ? 'AI returned a result that could not be read.'
                          : 'Analysis failed.',
                    autosortFailure: true,
                    failureReason,
                    autosortOutcome: 'failed',
                    status: 'classified',
                  },
                }))
                return
              }
              const category = (VALID_CATEGORIES.includes((result.category ?? '') as SortCategory) ? result.category : 'normal') as SortCategory
              const recommendedAction = (VALID_ACTIONS.includes((result.recommended_action ?? '') as BulkRecommendedAction)
                ? result.recommended_action
                : 'keep_for_manual_action') as BulkRecommendedAction
              const remoteEnq = (result as { remoteEnqueue?: { enqueued: number; skipped: number; skipReasons?: string[] } })
                .remoteEnqueue
              if (remoteEnq) {
                useEmailInboxStore.getState().addRemoteSyncLog(
                  `Classified: ${category}, remote enqueue: ${remoteEnq.enqueued} enqueued / ${remoteEnq.skipped} skipped`,
                )
              }
              const summary = (result.summary ?? '').slice(0, 500)
              const reason = (result.reason ?? '').slice(0, 300)
              const entry: BulkAiResult = {
                category,
                urgencyScore: typeof result.urgency === 'number' ? Math.max(1, Math.min(10, result.urgency)) : 5,
                urgencyReason: reason,
                summary: summary || reason || 'Classified.',
                reason,
                needsReply: !!result.needsReply,
                needsReplyReason: result.needsReply ? 'Reply warranted.' : 'No reply needed.',
                recommendedAction,
                actionExplanation: reason,
                actionItems: [],
                status: 'classified',
              }
              if (result.draftReply && (result.needsReply || recommendedAction === 'draft_reply_ready')) {
                entry.draftReply = result.draftReply.slice(0, 4000)
              }
              const inboxStore = useEmailInboxStore.getState()

              /** Urgent: main process sets sort_category + enqueues remote Urgent folder — no “retained in inbox” UX. */
              if (result.category === 'urgent') {
                processedIds.push(messageId)
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: { ...entry },
                }))
                await sortFeedbackPaintDwell()
                inboxStore.removeBulkDraftManualCompose(messageId)
                return
              }

              const willAutoMoveFromInbox =
                (result.pending_delete && recommendedAction === 'pending_delete') ||
                (result.pending_review && recommendedAction === 'pending_review') ||
                recommendedAction === 'archive'

              if (willAutoMoveFromInbox) {
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: { ...entry },
                }))
                await sortFeedbackPaintDwell()
              }

              if (result.pending_delete && recommendedAction === 'pending_delete') {
                const moved = await inboxStore.markPendingDeleteImmediate([messageId])
                if (moved) {
                  processedIds.push(messageId)
                  movedIds.push(messageId)
                  inboxStore.removeBulkDraftManualCompose(messageId)
                  return
                }
                failedIds.push(messageId)
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: {
                    ...entry,
                    summary: 'Could not move to Pending Delete (server error). Retry Auto-Sort or use Recommended Action (Pending Delete).',
                    autosortFailure: true,
                    failureReason: 'move_failed',
                    autosortOutcome: 'failed',
                    status: 'classified',
                  },
                }))
                return
              }
              if (result.pending_review && recommendedAction === 'pending_review') {
                const moved = await inboxStore.moveToPendingReviewImmediate([messageId])
                if (moved) {
                  processedIds.push(messageId)
                  movedIds.push(messageId)
                  inboxStore.removeBulkDraftManualCompose(messageId)
                  return
                }
                failedIds.push(messageId)
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: {
                    ...entry,
                    summary: 'Could not move to Pending Review (server error). Retry or use the button below.',
                    autosortFailure: true,
                    failureReason: 'move_failed',
                    autosortOutcome: 'failed',
                    status: 'classified',
                  },
                }))
                return
              }
              if (recommendedAction === 'archive') {
                const moved = await inboxStore.archiveMessages([messageId])
                if (moved) {
                  processedIds.push(messageId)
                  movedIds.push(messageId)
                  inboxStore.removeBulkDraftManualCompose(messageId)
                  return
                }
                failedIds.push(messageId)
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: {
                    ...entry,
                    summary: 'Could not archive (server error). Retry or use Archive below.',
                    autosortFailure: true,
                    failureReason: 'move_failed',
                    autosortOutcome: 'failed',
                    status: 'classified',
                  },
                }))
                return
              }

              processedIds.push(messageId)
              let retained: BulkAiResultEntry
              if (recommendedAction === 'keep_for_manual_action') {
                retainedCounts.keep_for_manual_action += 1
                retained = withAutosortRetained(
                  entry,
                  'keep_for_manual_action',
                  'AI recommends manual handling — Auto-Sort did not change local archive/delete/review; use actions below. Remote folders update via the sync queue / ☁ Sync Remote.'
                )
              } else if (recommendedAction === 'draft_reply_ready') {
                /** Urgent + needsReply: DB already updated in main; no local tab move — same as urgent early return if duplicate. */
                processedIds.push(messageId)
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: { ...entry },
                }))
                await sortFeedbackPaintDwell()
                inboxStore.removeBulkDraftManualCompose(messageId)
                return
              } else if (recommendedAction === 'pending_delete' && !result.pending_delete) {
                retainedCounts.classified_no_auto_move += 1
                retained = withAutosortRetained(
                  entry,
                  'classified_no_auto_move',
                  'Model suggested Pending Delete but the soft-delete flag was off — left in inbox. Use Recommended Action if you agree.'
                )
              } else if (recommendedAction === 'pending_review' && !result.pending_review) {
                retainedCounts.classified_no_auto_move += 1
                retained = withAutosortRetained(
                  entry,
                  'classified_no_auto_move',
                  'Model suggested Pending Review but the flag was off — left in inbox. Use Pending Review if you agree.'
                )
              } else {
                retainedCounts.classified_no_auto_move += 1
                retained = withAutosortRetained(
                  entry,
                  'classified_no_auto_move',
                  'Classified; no automatic move applies for this recommendation.'
                )
              }
              setBulkAiOutputs((prev) => ({ ...prev, [messageId]: retained }))
              inboxStore.removeBulkDraftManualCompose(messageId)
              } catch (sortErr: unknown) {
                const msg = sortErr instanceof Error ? sortErr.message : String(sortErr ?? 'unknown error')
                console.warn('[SORT] Classification or move failed:', messageId, msg)
                failedIds.push(messageId)
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: {
                    summary: `Auto-Sort error: ${msg.slice(0, 200)}`,
                    autosortFailure: true,
                    failureReason: 'llm_error',
                    autosortOutcome: 'failed',
                    status: 'classified',
                  },
                }))
              }
            }),
          )
          for (const s of settled) {
            if (s.status === 'rejected') {
              console.warn('[SORT] Batch promise rejected:', s.reason)
            }
          }
        }
        const missedIdsPass1 = ids.filter((id) => !processedIds.includes(id) && !failedIds.includes(id))
        const toRetry = ids.filter((id) => !processedIds.includes(id))
        console.log('[SORT] First pass.', {
          targeted: ids.length,
          processed: processedIds.length,
          failed: failedIds.length,
          moved: movedIds.length,
          missed: missedIdsPass1.length,
          toRetry: toRetry.length,
          retainedBreakdown: { ...retainedCounts },
        })
        let allProcessedIds = [...processedIds]
        let allFailedIds = [...failedIds]
        let allMovedIds = [...movedIds]
        let finalRetainedCounts = { ...retainedCounts }
        if (toRetry.length === 0) {
          console.log('[SORT] All targeted messages reached a terminal outcome in one pass')
        } else if (!isRetry) {
          if (missedIdsPass1.length > 0) console.warn('[SORT] Pass-1 missed (will retry):', missedIdsPass1)
          const retryResult = await runAiCategorizeForIds(toRetry, false, true, {
            manageConcurrencyLock: false,
            suppressGlobalSortingUi,
            skipEndRefresh,
          })
          allProcessedIds = [...new Set([...processedIds, ...retryResult.processedIds])]
          allFailedIds = [...new Set([...failedIds, ...retryResult.failedIds])]
          allMovedIds = [...new Set([...movedIds, ...retryResult.movedIds])]
          finalRetainedCounts = mergeRetainedCounts(retainedCounts, retryResult.retainedCounts)
          console.log('[SORT] Retry pass.', {
            retryTargeted: toRetry.length,
            processed: retryResult.processedIds.length,
            failed: retryResult.failedIds.length,
            moved: retryResult.movedIds.length,
            retainedBreakdown: retryResult.retainedCounts,
          })
        }
        let finalMissed = ids.filter((id) => !allProcessedIds.includes(id) && !allFailedIds.includes(id))
        if (finalMissed.length > 0) {
          console.error('[SORT] Completeness gap after retry — marking processing_incomplete', {
            count: finalMissed.length,
            ids: finalMissed,
          })
          const incompleteOutputs: AiOutputs = {}
          for (const id of finalMissed) {
            incompleteOutputs[id] = {
              summary:
                'Auto-Sort did not complete this message. Use Retry Auto-Sort on this row or run Auto-Sort again.',
              autosortFailure: true,
              failureReason: 'processing_incomplete',
              autosortOutcome: 'failed',
              status: 'classified',
            }
          }
          setBulkAiOutputs((prev) => ({ ...prev, ...incompleteOutputs }))
          allFailedIds = [...new Set([...allFailedIds, ...finalMissed])]
          finalMissed = []
        }
        const retainedInInbox = allProcessedIds.filter((id) => !allMovedIds.includes(id)).length
        console.log('[SORT] Run complete.', {
          targeted: ids.length,
          moved: allMovedIds.length,
          retainedInInbox,
          failed: allFailedIds.length,
          retainedByKind: finalRetainedCounts,
          movedIds: allMovedIds,
          failedIds: allFailedIds,
        })
        /** Ensure M365/IMAP mirror for every successfully classified id (not raw batch targets). Re-upserts from DB + chained drain. */
        const classifiedIdsForRemote = [...new Set(allProcessedIds)]
        if (classifiedIdsForRemote.length > 0) {
          const syncFn = window.emailInbox?.enqueueRemoteSync ?? window.emailInbox?.enqueueRemoteLifecycleMirror
          if (syncFn) {
            try {
              const res = await syncFn(classifiedIdsForRemote)
              if (!res?.ok) {
                console.warn('[AutoSort] Remote enqueue failed:', res && 'error' in res ? res.error : res)
              } else if ('enqueued' in res && (res.enqueued ?? 0) > 0) {
                console.log('[AutoSort] Remote enqueue:', { enqueued: res.enqueued, skipped: res.skipped })
              } else if ('data' in res && res.data?.enqueued) {
                console.log('[AutoSort] Remote enqueue:', res.data)
              }
            } catch (e) {
              console.warn('[AutoSort] Remote enqueue failed:', e)
            }
            try {
              const full = await window.emailInbox?.fullRemoteSyncForMessages?.(classifiedIdsForRemote)
              if (full?.ok && (full.enqueued ?? 0) + (full.inboxRestoreNeeded ?? 0) > 0) {
                console.log('[AutoSort] Full remote reconcile:', {
                  enqueued: full.enqueued,
                  skipped: full.skipped,
                  inboxRestoreNeeded: full.inboxRestoreNeeded,
                })
              } else if (full && !full.ok) {
                console.warn('[AutoSort] fullRemoteSyncForMessages:', full.error)
              }
            } catch (e) {
              console.warn('[AutoSort] fullRemoteSyncForMessages failed:', e)
            }
          }
        }
        if (clearSelection) clearMultiSelect()
        if (!skipEndRefresh) {
          await refreshMessages()
        }
        return {
          processedIds: allProcessedIds,
          failedIds: allFailedIds,
          movedIds: allMovedIds,
          missedIds: finalMissed,
          retainedCounts: finalRetainedCounts,
        }
      } catch (e) {
        console.error('[SORT] Bulk classify batch error (all targeted ids marked failed)', e)
        const failOutputs: AiOutputs = {}
        for (const id of ids) {
          failOutputs[id] = {
            summary: 'Bulk Auto-Sort batch error — this message was not classified. Retry Auto-Sort.',
            autosortFailure: true,
            failureReason: 'llm_error',
            autosortOutcome: 'failed',
            status: 'classified',
          }
        }
        setBulkAiOutputs((prev) => ({ ...prev, ...failOutputs }))
        return {
          processedIds: [],
          failedIds: ids,
          movedIds: [],
          missedIds: [],
          retainedCounts: emptyRetainedCounts(),
        }
      } finally {
        useEmailInboxStore.getState().triggerAnalysisRestart()
        if (!isRetry && manageConcurrencyLock) {
          isSortingRef.current = false
          useEmailInboxStore.getState().setSortingActive(false)
          setAiSortProgress(null)
        }
      }
    },
    [clearMultiSelect, refreshMessages]
  )

  /**
   * Per-row manual Analyze: stream (or one-shot) advisory analysis only — same IPC as Normal Inbox.
   * Does NOT call classify / Auto-Sort (no DB sort_category writes, no archive/pending moves, no list rebucket).
   */
  const handleBulkAnalyzeOne = useCallback(async (messageId: string) => {
    const bridge = window.emailInbox
    if (!bridge) return
    const hasStream =
      typeof bridge.aiAnalyzeMessageStream === 'function' && typeof bridge.onAiAnalyzeChunk === 'function'
    const hasOneShot = typeof bridge.aiAnalyzeMessage === 'function'
    if (!hasStream && !hasOneShot) {
      console.warn('[BULK-ANALYZE] Need aiAnalyzeMessageStream or aiAnalyzeMessage')
      return
    }
    if (bulkAnalyzeInFlightRef.current.has(messageId)) return
    bulkAnalyzeInFlightRef.current.add(messageId)

    bulkAnalyzeStreamCleanupRef.current.get(messageId)?.()
    bulkAnalyzeStreamCleanupRef.current.delete(messageId)

    if (hasStream) {
      setBulkAiOutputs((prev) => ({
        ...prev,
        [messageId]: {
          ...prev[messageId],
          bulkAnalysisStreaming: true,
          autosortFailure: undefined,
          failureReason: undefined,
          summaryError: undefined,
          summaryErrorMessage: undefined,
        },
      }))
      setBulkAnalyzeUiEpoch((e) => e + 1)
    }

    let accumulatedText = ''
    let streamFailed = false
    const unsubscribeFns: Array<() => void> = []

    const cleanupListeners = () => {
      for (const u of unsubscribeFns) {
        try {
          u()
        } catch {
          /* noop */
        }
      }
      unsubscribeFns.length = 0
      bulkAnalyzeStreamCleanupRef.current.delete(messageId)
    }

    if (hasStream) {
      unsubscribeFns.push(
        bridge.onAiAnalyzeChunk!(({ messageId: mid, chunk }) => {
          if (mid !== messageId) return
          accumulatedText += chunk
          const parsed = tryParsePartialAnalysis(accumulatedText)
          if (parsed) {
            setBulkAiOutputs((prev) => ({
              ...prev,
              [messageId]: mergeNormalPartialIntoBulk(parsed.partial, prev[messageId]),
            }))
          }
        })
      )
      if (typeof bridge.onAiAnalyzeError === 'function') {
        unsubscribeFns.push(
          bridge.onAiAnalyzeError!(({ messageId: mid }) => {
            if (mid !== messageId) return
            streamFailed = true
          })
        )
      }
      bulkAnalyzeStreamCleanupRef.current.set(messageId, cleanupListeners)
    }

    let persistedEntry: BulkAiResultEntry | null = null

    try {
      let finalNormal: NormalInboxAiResult | null = null
      if (hasStream) {
        await bridge.aiAnalyzeMessageStream!(messageId)
        if (!streamFailed) {
          finalNormal = tryParseAnalysis(accumulatedText)
        }
      } else {
        const res = await bridge.aiAnalyzeMessage!(messageId)
        const data = res?.ok ? (res.data as NormalInboxAiResult & { error?: string } | undefined) : undefined
        if (data && !data.error) {
          finalNormal = data as NormalInboxAiResult
        }
      }

      if (finalNormal) {
        useEmailInboxStore.getState().setAnalysisCache(messageId, finalNormal)
      }

      setBulkAiOutputs((prev) => {
        const base = { ...(prev[messageId] ?? {}) }
        delete base.bulkAnalysisStreaming
        if (!finalNormal) {
          return {
            ...prev,
            [messageId]: {
              ...base,
              summary: streamFailed
                ? 'Analysis failed. Check that Ollama is running and try again.'
                : base.summary,
            },
          }
        }
        const mergedFields = mergeNormalPartialIntoBulk(finalNormal, base)
        const { bulkAnalysisStreaming: _bs, ...withoutFlag } = mergedFields
        const complete = advisoryNormalToBulkComplete(finalNormal, withoutFlag)
        persistedEntry = complete
        return { ...prev, [messageId]: complete }
      })

      if (persistedEntry && typeof bridge.persistManualBulkAnalysis === 'function') {
        try {
          await bridge.persistManualBulkAnalysis(messageId, bulkEntryToManualPersistJson(persistedEntry))
        } catch (e) {
          console.warn('[BULK-ANALYZE] persistManualBulkAnalysis:', e)
        }
      }
    } finally {
      cleanupListeners()
      bulkAnalyzeInFlightRef.current.delete(messageId)
      setBulkAnalyzeUiEpoch((e) => e + 1)
    }
  }, [])

  /** Toolbar Auto-Sort: “All” = full tab ID drain; paged = current selection only. */
  const handleAiAutoSort = useCallback(async () => {
    if (isSortingRef.current || useEmailInboxStore.getState().isSortingActive) {
      console.warn('[SORT] Auto-Sort click ignored: a run is already in progress', {
        isSortingRef: isSortingRef.current,
        storeIsSortingActive: useEmailInboxStore.getState().isSortingActive,
      })
      setConcurrentSortNotice(
        'Auto-Sort is already running — this extra click was ignored. Wait for the run to finish, then try again.'
      )
      window.setTimeout(() => setConcurrentSortNotice(null), 12_000)
      return
    }
    isSortingRef.current = true
    useEmailInboxStore.getState().setSortingActive(true)
    setAiSortProgress('Gathering messages…')
    setConcurrentSortNotice(null)
    setAiSortOutcomeSummary(null)
    try {
      let targetIds: string[]
      if (bulkBatchSize === 'all') {
        await useEmailInboxStore.getState().fetchAllMessages({ soft: true })
        targetIds = [...new Set(await useEmailInboxStore.getState().fetchMatchingIdsForCurrentFilter())]
      } else {
        targetIds = Array.from(new Set(multiSelectIds)).filter((id): id is string => !!id && typeof id === 'string')
      }
      if (!targetIds.length) {
        console.info('[SORT] Auto-Sort: no messages in target set (nothing to do)')
        setAiSortProgress(null)
        return
      }
      setAiSortProgress(`Analyzing ${targetIds.length} message${targetIds.length !== 1 ? 's' : ''}…`)
      console.log('[SORT] Start. Batch:', bulkBatchSize, 'Target:', targetIds.length)
      const { processedIds, failedIds, movedIds, missedIds, retainedCounts } = await runAiCategorizeForIds(
        targetIds,
        true,
        false,
        {
          manageConcurrencyLock: false,
        }
      )
      const retainedN = processedIds.filter((id) => !movedIds.includes(id)).length
      const rc = retainedCounts
      const retainParts: string[] = []
      if (rc.keep_for_manual_action) retainParts.push(`${rc.keep_for_manual_action} manual review`)
      if (rc.draft_reply_ready) retainParts.push(`${rc.draft_reply_ready} reply-ready`)
      if (rc.classified_no_auto_move) retainParts.push(`${rc.classified_no_auto_move} other no auto-move`)

      const lines: string[] = [`Auto-Sort: ${movedIds.length} moved`]
      if (retainedN > 0) {
        lines.push(
          retainParts.length > 0
            ? `${retainedN} not locally moved by Auto-Sort (${retainParts.join(', ')} — see “Auto-Sort note” on rows)`
            : `${retainedN} not locally moved by Auto-Sort (see row notes / Recommended Action)`
        )
      }
      lines.push(`${failedIds.length} failed (red error cards + Retry)`)
      if (missedIds.length > 0) {
        lines.push(`${missedIds.length} still incomplete — run Auto-Sort again`)
      }
      if (failedIds.length > 0) {
        const sample = failedIds.slice(0, 5).map(shortIdForSummary).join(', ')
        lines.push(`Failed sample: ${sample}${failedIds.length > 5 ? ` (+${failedIds.length - 5} more)` : ''}`)
      }
      console.log('[SORT] Toolbar run summary', {
        targeted: targetIds.length,
        moved: movedIds.length,
        retained: retainedN,
        failed: failedIds.length,
        missed: missedIds.length,
        retainedCounts: rc,
      })
      setAiSortOutcomeSummary(lines.join(' · '))
      window.setTimeout(() => setAiSortOutcomeSummary(null), 16_000)
    } finally {
      isSortingRef.current = false
      useEmailInboxStore.getState().setSortingActive(false)
      setAiSortProgress(null)
    }
  }, [bulkBatchSize, multiSelectIds, runAiCategorizeForIds])

  const handleUndoPendingDelete = useCallback(
    async (ids: string[]) => {
      if (!window.emailInbox?.cancelPendingDelete || ids.length === 0) return
      for (const id of ids) {
        await window.emailInbox.cancelPendingDelete(id)
      }
      clearPendingDeleteStateForIds(ids)
      await refreshMessages()
    },
    [refreshMessages, clearPendingDeleteStateForIds]
  )

  const handleUndoPendingReview = useCallback(
    async (messageId: string) => {
      if (!window.emailInbox?.cancelPendingReview) return
      const res = await window.emailInbox.cancelPendingReview(messageId)
      if (res?.ok) {
        clearBulkAiOutputsForIds([messageId])
        await refreshMessages()
      }
    },
    [refreshMessages, clearBulkAiOutputsForIds]
  )

  const handleUndoArchived = useCallback(
    async (messageId: string) => {
      if (!window.emailInbox?.unarchive) return
      const res = await window.emailInbox.unarchive(messageId)
      if (res?.ok) {
        clearBulkAiOutputsForIds([messageId])
        await refreshMessages()
      }
    },
    [refreshMessages, clearBulkAiOutputsForIds]
  )

  const loadProviderAccounts = useCallback(async () => {
    if (typeof window.emailAccounts?.listAccounts !== 'function') {
      setIsLoadingProviderAccounts(false)
      return
    }
    try {
      const res = await window.emailAccounts.listAccounts()
      if (res?.ok && res?.data) {
        const data = res.data as Array<{ id: string; displayName?: string; email: string; provider?: string; status?: string; lastError?: string }>
        setProviderAccounts(
          data.map((a) => {
            const p = a.provider
            const provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap' =
              p === 'gmail'
                ? 'gmail'
                : p === 'microsoft365'
                  ? 'microsoft365'
                  : p === 'zoho'
                    ? 'zoho'
                    : 'imap'
            const status: 'active' | 'auth_error' | 'error' | 'disabled' =
              a.status === 'active'
                ? 'active'
                : a.status === 'auth_error'
                  ? 'auth_error'
                  : a.status === 'error'
                    ? 'error'
                    : 'disabled'
            return {
              id: a.id,
              displayName: a.displayName ?? a.email,
              email: a.email,
              provider,
              status,
              lastError: a.lastError,
            }
          }),
        )
        setSelectedProviderAccountId((prev) => {
          if (prev && data.some((a: { id: string }) => a.id === prev)) return prev
          const pick = pickDefaultEmailAccountRowId(
            data.map((a) => ({ id: a.id, status: a.status })),
          )
          return pick ?? data[0]?.id ?? null
        })
      } else {
        setProviderAccounts([])
      }
    } catch {
      setProviderAccounts([])
    } finally {
      setIsLoadingProviderAccounts(false)
    }
  }, [])

  useEffect(() => {
    loadProviderAccounts()
  }, [loadProviderAccounts])

  useEffect(() => {
    const unsub = window.emailAccounts?.onAccountConnected?.(() => loadProviderAccounts())
    return () => unsub?.()
  }, [loadProviderAccounts])

  const handleAfterEmailConnected = useCallback(async () => {
    await loadProviderAccounts()
    useEmailInboxStore.getState().clearLastSyncWarnings()
    useEmailInboxStore.getState().clearRemoteSyncLog()
  }, [loadProviderAccounts])

  const { openConnectEmail, connectEmailFlowModal } = useConnectEmailFlow({
    onAfterConnected: handleAfterEmailConnected,
    theme: 'dark',
  })

  const handleConnectEmail = useCallback(
    () => openConnectEmail(ConnectEmailLaunchSource.BulkInbox),
    [openConnectEmail],
  )

  const handleUpdateImapCredentials = useCallback(
    (accountId: string) => {
      openConnectEmail(ConnectEmailLaunchSource.BulkInbox, { reconnectAccountId: accountId })
    },
    [openConnectEmail],
  )

  /** One-time IMAP connection probe after accounts load (password / app-password drift). */
  const imapProbeDoneRef = useRef(false)
  useEffect(() => {
    if (isLoadingProviderAccounts || imapProbeDoneRef.current) return
    if (!providerAccounts.some((a) => a.provider === 'imap')) return
    imapProbeDoneRef.current = true
    let cancelled = false
    ;(async () => {
      for (const acc of providerAccounts) {
        if (acc.provider !== 'imap') continue
        try {
          const r = await window.emailAccounts?.testConnection?.(acc.id)
          if (cancelled) return
          if (r?.ok && r.data && !r.data.success) {
            await loadProviderAccounts()
            break
          }
        } catch {
          /* ignore */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isLoadingProviderAccounts, providerAccounts, loadProviderAccounts])
  const handleDisconnectEmail = useCallback(
    async (id: string) => {
      try {
        if (typeof window.emailAccounts?.deleteAccount === 'function') {
          await window.emailAccounts.deleteAccount(id)
          loadProviderAccounts()
        }
      } catch {
        /* ignore */
      }
    },
    [loadProviderAccounts]
  )

  const handleSummarize = useCallback(
    async (messageId: string) => {
      if (!window.emailInbox?.aiSummarize) {
        console.warn(`[AI-SUMMARIZE][bulk] missing bridge messageId=${messageId}`)
        setBulkAiOutputs((prev) => ({
          ...prev,
          [messageId]: {
            ...prev[messageId],
            summary: '',
            summaryError: true,
            summaryErrorMessage:
              'Summarize unavailable: email AI API is not connected (reload the app or check the preload bridge).',
            loading: undefined,
          },
        }))
        return
      }
      console.log(`[AI-SUMMARIZE][bulk] start messageId=${messageId}`)
      setBulkAiOutputs((prev) => ({
        ...prev,
        [messageId]: {
          ...prev[messageId],
          loading: 'summary',
          summaryError: undefined,
          summaryErrorMessage: undefined,
        },
      }))
      try {
        const res = await window.emailInbox.aiSummarize(messageId)
        const data = res.data as { summary?: string; error?: boolean } | undefined
        const isError = !res.ok || !data?.summary || !!data.error
        const failReason = !res.ok
          ? 'http_not_ok'
          : !data?.summary
            ? 'empty_summary'
            : data.error
              ? 'api_error_flag'
              : 'ok'
        if (isError) {
          console.warn(`[AI-SUMMARIZE][bulk] fail messageId=${messageId} reason=${failReason}`)
        } else {
          console.log(`[AI-SUMMARIZE][bulk] ok messageId=${messageId}`)
        }
        setBulkAiOutputs((prev) => {
          const existing = prev[messageId] ?? {}
          return {
            ...prev,
            [messageId]: {
              ...existing,
              summary: data?.summary ?? (isError ? 'Summarize failed.' : ''),
              summaryError: isError,
              summaryErrorMessage: isError
                ? 'Couldn’t generate a summary. Check that Ollama is running, then Retry.'
                : undefined,
              status: existing.status ?? 'classified',
              loading: undefined,
            },
          }
        })
      } catch (err) {
        console.warn(`[AI-SUMMARIZE][bulk] fail messageId=${messageId} reason=exception`, err)
        setBulkAiOutputs((prev) => ({
          ...prev,
          [messageId]: {
            ...prev[messageId],
            summary: 'Summarize failed.',
            summaryError: true,
            summaryErrorMessage: 'Summarize failed (unexpected error). Check the console and Retry.',
            loading: undefined,
          },
        }))
      }
    },
    []
  )

  const handleDraftReply = useCallback(
    async (messageId: string) => {
      if (!window.emailInbox?.aiDraftReply) return
      setDraftAttachmentsByMessage((prev) => {
        const next = { ...prev }
        delete next[messageId]
        return next
      })
      setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: 'draft', draftError: undefined } }))
      try {
        const res = await window.emailInbox.aiDraftReply(messageId)
        const data = res.data as { draft?: string; error?: boolean } | undefined
        const isError = !res.ok || !data?.draft || !!data.error
        setBulkAiOutputs((prev) => {
          const existing = prev[messageId] ?? {}
          return {
            ...prev,
            [messageId]: {
              ...existing,
              draftReply: isError ? undefined : data!.draft,
              draftError: isError,
              status: existing.status ?? 'classified',
              loading: undefined,
            },
          }
        })
        if (!isError) useEmailInboxStore.getState().addBulkDraftManualCompose(messageId)
      } catch {
        setBulkAiOutputs((prev) => ({
          ...prev,
          [messageId]: {
            ...prev[messageId],
            draftError: true,
            loading: undefined,
          },
        }))
      }
    },
    []
  )

  /** Update draft reply in state — used by editable UI layers. */
  const updateDraftReply = useCallback((messageId: string, draftReply: string) => {
    setBulkAiOutputs((prev) => ({
      ...prev,
      [messageId]: { ...prev[messageId], draftReply },
    }))
  }, [])

  const handleFocusPair = useCallback(
    (msg: InboxMessage) => {
      const next = focusedMessageId === msg.id ? null : msg.id
      onSelectMessage?.(next)
      useEmailInboxStore.getState().setSubFocus({ kind: 'none' })
    },
    [focusedMessageId, onSelectMessage]
  )

  const handleExpandMessage = useCallback(
    (msg: InboxMessage) => {
      setExpandedMessageId(msg.id)
      selectMessage(msg.id)
    },
    [selectMessage]
  )

  const handleCloseExpand = useCallback(() => {
    setExpandedMessageId(null)
    selectMessage(null)
  }, [selectMessage])

  const handleLinkClick = useCallback((url: string) => {
    setPendingLinkUrl(url)
  }, [])

  const handleLinkConfirm = useCallback(() => {
    if (pendingLinkUrl) {
      window.open(pendingLinkUrl, '_blank', 'noopener,noreferrer')
      setPendingLinkUrl(null)
    }
  }, [pendingLinkUrl])

  const handleLinkCancel = useCallback(() => setPendingLinkUrl(null), [])

  const handleComposeClick = useCallback((fn: () => void) => {
    const now = Date.now()
    if (now - composeClickRef.current < 600) return
    composeClickRef.current = now
    fn()
  }, [])

  const handleOpenEmailCompose = useCallback(() => {
    if (typeof window.analysisDashboard?.openEmailCompose === 'function') {
      window.analysisDashboard.openEmailCompose()
    } else {
      setReplyToMessage(null)
      setShowEmailCompose(true)
    }
  }, [])

  const handleOpenBeapDraft = useCallback(() => {
    if (typeof window.analysisDashboard?.openBeapDraft === 'function') {
      window.analysisDashboard.openBeapDraft()
    }
  }, [])

  const handleReply = useCallback((msg: InboxMessage) => {
    const isDepackaged = msg.source_type === 'email_plain'
    if (isDepackaged) {
      const subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || '(No subject)'}`
      setReplyToMessage({ ...msg, subject })
      setReplyDraftBody('')
      setShowEmailCompose(true)
    } else {
      window.analysisDashboard?.openBeapDraft?.()
    }
  }, [])

  const [sendEmailToast, setSendEmailToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  /** Send draft directly (no modal). */
  const handleSendDraft = useCallback(
    async (msg: InboxMessage, draftBody: string, attachments?: Array<{ name: string; path: string; size: number }>) => {
      const isDepackaged = msg.source_type === 'email_plain'
      if (!isDepackaged) {
        if (draftBody?.trim()) navigator.clipboard?.writeText(draftBody).catch(() => {})
        window.analysisDashboard?.openBeapDraft?.()
        return
      }
      const to = msg.from_address?.trim()
      if (!to) {
        setSendEmailToast({ type: 'error', message: 'No sender address' })
        return
      }
      if (typeof window.emailAccounts?.listAccounts !== 'function' || typeof window.emailAccounts?.sendEmail !== 'function') {
        setSendEmailToast({ type: 'error', message: 'Email send not available' })
        return
      }
      const accountsRes = await window.emailAccounts.listAccounts()
      if (!accountsRes?.ok || !accountsRes.data?.length) {
        setSendEmailToast({ type: 'error', message: 'No email account connected' })
        return
      }
      const accountId = accountsRes.data[0].id
      const subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || '(No subject)'}`
      const fullBody = (draftBody || '').trim() + '\n\n—\nAutomate your inbox. Try wrdesk.com\nhttps://wrdesk.com'
      const emailAttachments: { filename: string; mimeType: string; contentBase64: string }[] = []
      if (window.emailInbox?.readFileForAttachment && attachments?.length) {
        for (const pa of attachments) {
          const res = await window.emailInbox.readFileForAttachment(pa.path)
          if (res?.ok && res?.data) {
            emailAttachments.push({
              filename: res.data.filename,
              mimeType: res.data.mimeType,
              contentBase64: res.data.contentBase64,
            })
          }
        }
      }
      try {
        const res = await window.emailAccounts.sendEmail(accountId, {
          to: [to],
          subject: subject.trim() || '(No subject)',
          bodyText: fullBody,
          attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
        })
        if (res.ok && res.data?.success) {
          setSendEmailToast({ type: 'success', message: `Email sent to ${to}` })
          setDraftAttachmentsByMessage((prev) => {
            const { [msg.id]: _, ...rest } = prev
            return rest
          })
          updateDraftReply(msg.id, '')
          refreshMessages()
          setTimeout(() => setSendEmailToast(null), 3000)
        } else {
          setSendEmailToast({ type: 'error', message: res.error || 'Failed to send' })
        }
      } catch (err) {
        setSendEmailToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send' })
      }
    },
    [updateDraftReply, refreshMessages]
  )

  const handleAddDraftAttachment = useCallback(async (msgId: string) => {
    if (!window.emailInbox?.showOpenDialogForAttachments) return
    const res = await window.emailInbox.showOpenDialogForAttachments()
    if (res?.ok && res?.data?.files?.length) {
      setDraftAttachmentsByMessage((prev) => ({
        ...prev,
        [msgId]: [...(prev[msgId] ?? []), ...res.data.files],
      }))
    }
  }, [])

  const handleRemoveDraftAttachment = useCallback((msgId: string, index: number) => {
    setDraftAttachmentsByMessage((prev) => {
      const list = prev[msgId] ?? []
      const next = list.filter((_, i) => i !== index)
      if (next.length === 0) {
        const { [msgId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [msgId]: next }
    })
  }, [])

  const handleArchiveOne = useCallback(
    (msg: InboxMessage) => {
      archiveMessages([msg.id])
    },
    [archiveMessages]
  )

  const handleDeleteOne = useCallback(
    (msg: InboxMessage) => {
      deleteMessages([msg.id])
    },
    [deleteMessages]
  )

  /** Move to Pending Delete (soft, 7-day grace). Use when AI recommends pending_delete. */
  const handlePendingDeleteOne = useCallback(
    (msg: InboxMessage) => {
      markPendingDeleteImmediate([msg.id])
    },
    [markPendingDeleteImmediate]
  )

  /** Move to Pending Review (14-day grace in DB). Use when AI recommends pending_review or manual. */
  const handleMoveToPendingReviewOne = useCallback(async (msg: InboxMessage) => {
    await moveToPendingReviewImmediate([msg.id])
  }, [moveToPendingReviewImmediate])

  /** Render structured Action Card when BulkAiResult exists; otherwise fallback. */
  const renderActionCard = useCallback(
    (msg: InboxMessage, output: BulkAiResultEntry | undefined, isExpanded: boolean) => {
      /** FIX-H4: Undo visibility based SOLELY on current filter. No other conditions. */
      const currentFilter = filter.filter
      const showUndo = ['pending_delete', 'pending_review', 'archived'].includes(currentFilter)
      const hasFullStructured = hasFullBulkAnalysis(output)
      const hasDraftReady = !!(output?.draftReply && !output?.draftError)
      const category = (output?.category ?? 'normal') as keyof typeof CATEGORY_BORDER
      const borderColor = CATEGORY_BORDER[category] ?? 'transparent'
      const urgency = output?.urgencyScore ?? 5

      if (output?.loading) {
        return (
          <div className="bulk-action-card bulk-action-card--loading">
            <div className="bulk-action-card-state-content">
              <span className="bulk-action-card-state-label">Analyzing</span>
              <span className="bulk-action-card-state-detail">AI is processing this message…</span>
            </div>
            <div className="bulk-action-card-actions-row">
              {showUndo && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                  onClick={() => {
                    if (currentFilter === 'pending_delete') handleUndoPendingDelete([msg.id])
                    else if (currentFilter === 'pending_review') handleUndoPendingReview(msg.id)
                    else handleUndoArchived(msg.id)
                  }}
                  title="Move back to inbox"
                >
                  Undo
                </button>
              )}
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                onClick={() => handleDeleteOne(msg)}
                title="Delete this message"
              >
                Delete
              </button>
            </div>
          </div>
        )
      }

      if (output?.autosortFailure) {
        const fr = output.failureReason
        const isTimeout = fr === 'timeout'
        const isMoveFailed = fr === 'move_failed'
        const isParseFailed = fr === 'parse_failed'
        const isIncomplete = fr === 'processing_incomplete'
        const failTitle = isTimeout
          ? 'Timed out'
          : isMoveFailed
            ? 'Could not move'
            : isParseFailed
              ? 'Could not parse AI result'
              : isIncomplete
                ? 'Sort incomplete'
                : 'Analysis failed'
        const failDetail =
          output.summary ||
          (isTimeout
            ? 'The model may be slow or unavailable.'
            : isMoveFailed
              ? 'The server could not apply the move. Retry or use the action buttons.'
              : isParseFailed
                ? 'The classifier returned an unreadable response.'
                : isIncomplete
                  ? 'This message was targeted but did not finish in the last bulk run.'
                  : 'No usable result from AI for this message.')
        return (
          <div className="bulk-action-card bulk-action-card--failure">
            <div className="bulk-action-card-state-content bulk-action-card-failure-content">
              <span className="bulk-action-card-state-label bulk-action-card-failure-label">{failTitle}</span>
              <span className="bulk-action-card-state-detail bulk-action-card-failure-detail">{failDetail}</span>
            </div>
            <div className="bulk-action-card-actions-row">
              {showUndo && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                  onClick={() => {
                    if (currentFilter === 'pending_delete') handleUndoPendingDelete([msg.id])
                    else if (currentFilter === 'pending_review') handleUndoPendingReview(msg.id)
                    else handleUndoArchived(msg.id)
                  }}
                  title="Move back to inbox"
                >
                  Undo
                </button>
              )}
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--compact"
                onClick={() => runAiCategorizeForIds([msg.id], false)}
                title="Retry AI Auto-Sort for this message"
              >
                Retry Auto-Sort
              </button>
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                onClick={() => handleSummarize(msg.id)}
              >
                Summarize
              </button>
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                onClick={() => handleDraftReply(msg.id)}
              >
                Draft
              </button>
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn-delete bulk-action-card-btn--compact"
                onClick={() => handleDeleteOne(msg)}
                title="Delete this message"
              >
                Delete
              </button>
            </div>
          </div>
        )
      }

      if (output && (hasFullStructured || hasDraftReady || output.bulkAnalysisStreaming)) {
        const analyzeRunning = bulkAnalyzeInFlightRef.current.has(msg.id)
        const showAnalyzeBtn = shouldShowBulkAnalyzeButton(output)
        return (
          <BulkActionCardStructured
            msg={msg}
            output={output}
            isExpanded={isExpanded}
            currentFilter={filter.filter}
            updateDraftReply={updateDraftReply}
            handleSendDraft={handleSendDraft}
            handleArchiveOne={handleArchiveOne}
            handleDeleteOne={handleDeleteOne}
            draftAttachments={draftAttachmentsByMessage[msg.id]}
            onAddDraftAttachment={() => handleAddDraftAttachment(msg.id)}
            onRemoveDraftAttachment={(i) => handleRemoveDraftAttachment(msg.id, i)}
            handlePendingDeleteOne={handlePendingDeleteOne}
            handleMoveToPendingReviewOne={handleMoveToPendingReviewOne}
            handleSummarize={handleSummarize}
            handleDraftReply={handleDraftReply}
            handleBulkAnalyze={handleBulkAnalyzeOne}
            analyzeRunning={analyzeRunning}
            showAnalyzeButton={showAnalyzeBtn}
            handleUndoPendingDelete={handleUndoPendingDelete}
            handleUndoPendingReview={handleUndoPendingReview}
            handleUndoArchived={handleUndoArchived}
            focusedMessageId={focusedMessageId ?? null}
            editingDraftForMessageId={editingDraftForMessageId ?? null}
  subFocus={subFocus}
  setSubFocus={setSubFocus}
  onSelectMessage={onSelectMessage}
          />
        )
      }

      // Fallback: summary / errors only (draft success uses BulkActionCardStructured above)
      if (output?.summary || output?.summaryError || output?.draftError) {
        const fbShowAnalyze = shouldShowBulkAnalyzeButton(output)
        const fbAnalyzeRunning = bulkAnalyzeInFlightRef.current.has(msg.id)
        const fallbackSummaryCls = isExpanded ? 'bulk-action-card-summary bulk-action-card-summary--expanded' : 'bulk-action-card-summary bulk-action-card-summary--collapsed'
        return (
          <div className={`bulk-action-card bulk-action-card--fallback ${isExpanded ? 'bulk-action-card--expanded' : ''}`}>
            <div className="bulk-action-card-fallback-content">
              {(output.summaryError || output.draftError) && (
                <div className="bulk-action-card-error-banner">
                  {output.summaryError && (
                    <span>
                      {output.summaryErrorMessage ?? 'Summarize failed.'}{' '}
                      <button type="button" className="bulk-action-card-inline-retry" onClick={() => handleSummarize(msg.id)}>Retry</button>
                    </span>
                  )}
                  {output.draftError && (
                    <span>Draft failed. <button type="button" className="bulk-action-card-inline-retry" onClick={() => handleDraftReply(msg.id)}>Retry</button></span>
                  )}
                </div>
              )}
              {output.summary && !output.summaryError && (
                <div className={`bulk-action-card-row ${fallbackSummaryCls}`}>
                  <span className="bulk-action-card-row-label">Summary</span>
                  <div className="bulk-action-card-row-value">{output.summary}</div>
                </div>
              )}
              {output.summaryError && output.summary && (
                <div className={`bulk-action-card-row ${fallbackSummaryCls} bulk-action-card-summary--error`}>
                  <span className="bulk-action-card-row-label">Error</span>
                  <div className="bulk-action-card-row-value">{output.summary}</div>
                </div>
              )}
            </div>
            <div className="bulk-action-card-actions-row">
              {showUndo && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                  onClick={() => {
                    if (currentFilter === 'pending_delete') handleUndoPendingDelete([msg.id])
                    else if (currentFilter === 'pending_review') handleUndoPendingReview(msg.id)
                    else handleUndoArchived(msg.id)
                  }}
                  title="Move back to inbox"
                >
                  Undo
                </button>
              )}
              {fbShowAnalyze ? (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                  onClick={() => handleBulkAnalyzeOne(msg.id)}
                  disabled={fbAnalyzeRunning || !!output?.loading}
                  title="Run full AI triage (classify) for this message"
                >
                  Analyze
                </button>
              ) : null}
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                onClick={() => handleSummarize(msg.id)}
                disabled={!!output?.loading}
              >
                Summarize
              </button>
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                onClick={() => handleDraftReply(msg.id)}
                disabled={!!output?.loading}
              >
                Draft
              </button>
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn-delete bulk-action-card-btn--compact"
                onClick={() => handleDeleteOne(msg)}
                title="Delete this message"
              >
                Delete
              </button>
            </div>
          </div>
        )
      }

      // Guidance state: not yet analyzed
      const guidanceAnalyzeRunning = bulkAnalyzeInFlightRef.current.has(msg.id)
      return (
        <div className="bulk-action-card bulk-action-card--guidance">
          <div className="bulk-action-card-state-content bulk-action-card-guidance-content">
            <span className="bulk-action-card-state-label bulk-action-card-guidance-label">Not yet analyzed</span>
            <span className="bulk-action-card-state-detail bulk-action-card-guidance-detail">
              This message has not been analyzed. Select messages above and click <strong>AI Auto-Sort</strong> in the toolbar to analyze the batch, or use per-message actions below.
            </span>
          </div>
          <div className="bulk-action-card-actions-row bulk-action-card-actions-row--secondary">
            {showUndo && (
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
                onClick={() => {
                  if (currentFilter === 'pending_delete') handleUndoPendingDelete([msg.id])
                  else if (currentFilter === 'pending_review') handleUndoPendingReview(msg.id)
                  else handleUndoArchived(msg.id)
                }}
                title="Move back to inbox"
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
              onClick={() => handleBulkAnalyzeOne(msg.id)}
              disabled={guidanceAnalyzeRunning}
              title="Run full AI triage (classify) for this message"
            >
              Analyze
            </button>
            <button
              type="button"
              className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
              onClick={() => handleSummarize(msg.id)}
            >
              Summarize
            </button>
            <button
              type="button"
              className="bulk-action-card-btn bulk-action-card-btn--secondary bulk-action-card-btn--compact"
              onClick={() => handleDraftReply(msg.id)}
            >
              Draft
            </button>
            <button
              type="button"
              className="bulk-action-card-btn bulk-action-card-btn-delete bulk-action-card-btn--compact"
              onClick={() => handleDeleteOne(msg)}
              title="Delete this message"
            >
              Delete
            </button>
          </div>
        </div>
      )
    },
    [
      filter.filter,
      bulkAnalyzeUiEpoch,
      draftAttachmentsByMessage,
      handleAddDraftAttachment,
      handleRemoveDraftAttachment,
      updateDraftReply,
      handleSendDraft,
      handleArchiveOne,
      handleDeleteOne,
      handlePendingDeleteOne,
      handleMoveToPendingReviewOne,
      handleSummarize,
      handleDraftReply,
      handleUndoPendingDelete,
      handleUndoPendingReview,
      handleUndoArchived,
      focusedMessageId,
      editingDraftForMessageId,
      subFocus,
      setSubFocus,
      onSelectMessage,
      runAiCategorizeForIds,
      handleBulkAnalyzeOne,
      draftRefineConnect,
    ]
  )

  const expandedMessage =
    expandedMessageId && selectedMessageId === expandedMessageId ? selectedMessage : null

  /** Focus next/previous row. Returns true if handled. */
  const focusAdjacentRow = useCallback(
    (direction: 'next' | 'prev') => {
      if (sortedMessages.length === 0) return
      const idx = focusedMessageId
        ? sortedMessages.findIndex((m) => m.id === focusedMessageId)
        : -1
      const nextIdx = direction === 'next' ? idx + 1 : idx - 1
      if (nextIdx >= 0 && nextIdx < sortedMessages.length) {
        onSelectMessage?.(sortedMessages[nextIdx].id)
      } else if (idx < 0 && sortedMessages.length > 0) {
        onSelectMessage?.(sortedMessages[direction === 'next' ? 0 : sortedMessages.length - 1].id)
      }
    },
    [sortedMessages, focusedMessageId, onSelectMessage]
  )

  /** Trigger primary recommended action for focused row. Safe: skip draft_reply_ready. */
  const triggerPrimaryAction = useCallback(
    (msg: InboxMessage, output: BulkAiResultEntry | undefined) => {
      if (!output?.recommendedAction) return
      const rec = output.recommendedAction
      if (rec === 'pending_delete') handlePendingDeleteOne(msg)
      else if (rec === 'pending_review') handleMoveToPendingReviewOne(msg)
      else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
      // draft_reply_ready: skip — avoid accidental send
    },
    [handlePendingDeleteOne, handleMoveToPendingReviewOne, handleArchiveOne]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const inInput =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.getAttribute?.('contenteditable') === 'true')
      if (inInput) return
      const onActionablePanel = el?.closest('.bulk-action-card-panel--actionable')

      if (expandedMessageId) {
        if (e.key === 'Escape') {
          e.preventDefault()
          handleCloseExpand()
        }
        return
      }
      if (pendingLinkUrl || showEmailCompose) return

      const focusedMsg = focusedMessageId
        ? sortedMessages.find((m) => m.id === focusedMessageId)
        : null
      const focusedOutput = focusedMsg ? bulkAiOutputs[focusedMsg.id] : undefined

      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          focusAdjacentRow('next')
        }
        return
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          focusAdjacentRow('prev')
        }
        return
      }
      if (e.key === 'Enter') {
        if (onActionablePanel) return
        if (focusedMsg) {
          e.preventDefault()
          toggleCardExpand(focusedMsg.id)
        }
        return
      }
      if (e.key === ' ' && !onActionablePanel && focusedMsg && focusedOutput?.recommendedAction) {
        const rec = focusedOutput.recommendedAction
        if (rec !== 'draft_reply_ready') {
          e.preventDefault()
          triggerPrimaryAction(focusedMsg, focusedOutput)
        }
        return
      }
      if (e.key === 'a' || e.key === 'A') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          if (selectedCount > 0) handleBulkArchive()
          else if (focusedMsg) handleArchiveOne(focusedMsg)
        }
        return
      }
      if (e.key === 'd' || e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedCount > 0) handleBulkDelete()
        else if (focusedMsg) {
          if (focusedOutput?.recommendedAction === 'pending_delete') handlePendingDeleteOne(focusedMsg)
          else handleDeleteOne(focusedMsg)
        }
        return
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [
    expandedMessageId,
    pendingLinkUrl,
    showEmailCompose,
    handleCloseExpand,
    sortedMessages,
    focusedMessageId,
    bulkAiOutputs,
    expandedCardIds,
    selectedCount,
    focusAdjacentRow,
    toggleCardExpand,
    triggerPrimaryAction,
    handleBulkArchive,
    handleArchiveOne,
    handleBulkDelete,
    handleDeleteOne,
    handlePendingDeleteOne,
  ])

  const showBulkStatusDock =
    Boolean(aiSortProgress) ||
    Boolean(sendEmailToast) ||
    Boolean(concurrentSortNotice) ||
    Boolean(aiSortOutcomeSummary)

  return (
    <div className={`bulk-view-root ${bulkCompactMode ? 'bulk-view--compact' : ''}`}>
      {/* Toolbar — row 1: filter tabs; row 2: selection + AI (left) / sync prefs + Sync + debug (right) */}
      <div className="bulk-view-toolbar bulk-view-toolbar--stacked">
        <div className="bulk-view-toolbar-row bulk-view-toolbar-row--tabs">
          <div className="bulk-view-toolbar-tabs">
            <button
              type="button"
              onClick={() => setFilter({ filter: 'all' })}
              className="bulk-view-toolbar-filter-btn"
              data-active={filter.filter === 'all'}
            >
              All ({filter.filter === 'all' ? total : (tabCounts.all ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setFilter({ filter: 'urgent' })}
              className="bulk-view-toolbar-filter-btn bulk-view-toolbar-filter-btn--urgent"
              data-active={filter.filter === 'urgent'}
            >
              Urgent ({filter.filter === 'urgent' ? total : (tabCounts.urgent ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setFilter({ filter: 'pending_delete' })}
              className="bulk-view-toolbar-filter-btn bulk-view-toolbar-filter-btn--pending"
              data-active={filter.filter === 'pending_delete'}
            >
              Pending Delete ({filter.filter === 'pending_delete' ? total : (tabCounts.pending_delete ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setFilter({ filter: 'pending_review' })}
              className="bulk-view-toolbar-filter-btn bulk-view-toolbar-filter-btn--review"
              data-active={filter.filter === 'pending_review'}
            >
              Pending Review ({filter.filter === 'pending_review' ? total : (tabCounts.pending_review ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setFilter({ filter: 'archived' })}
              className="bulk-view-toolbar-filter-btn bulk-view-toolbar-filter-btn--archived"
              data-active={filter.filter === 'archived'}
            >
              Archived ({filter.filter === 'archived' ? total : (tabCounts.archived ?? 0)})
            </button>
          </div>
        </div>

        <div className="bulk-view-toolbar-row bulk-view-toolbar-row--main">
          <div className="bulk-view-toolbar-left">
            <input
              type="checkbox"
              checked={allInBatchSelected}
              ref={batchCheckboxRef}
              onChange={handleBatchCheckboxToggle}
              title={
                bulkBatchSize === 'all'
                  ? allInBatchSelected || someInBatchSelected
                    ? 'Deselect all in this tab'
                    : 'Select all messages in this tab (full list)'
                  : allInBatchSelected || someInBatchSelected
                    ? 'Deselect all on this page'
                    : 'Select all on this page'
              }
            />
            <select
              value={bulkBatchSize}
              onChange={(e) => {
                const val = e.target.value
                if (val === 'all') {
                  setBulkBatchSize('all')
                  setShouldSelectAllWhenReady(true)
                } else {
                  setBulkBatchSize(Number(val))
                }
              }}
              className="bulk-view-selection-group-select"
            >
              <option value="all">All</option>
              {[10, 12, 24, 48].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bulk-view-ai-sort-btn ai-auto-sort-btn"
              onClick={() => void handleAiAutoSort()}
              disabled={
                isSortingActive || (bulkBatchSize === 'all' ? total === 0 : selectedCount === 0)
              }
              title={
                isSortingActive
                  ? 'Auto-Sort is running…'
                  : bulkBatchSize === 'all'
                    ? total === 0
                      ? 'No messages in this tab'
                      : `AI Auto-Sort all ${total} message(s) in this tab`
                    : selectedCount === 0
                      ? 'Select messages on this page, then run AI Auto-Sort'
                      : 'AI Auto-Sort selected messages'
              }
            >
              ⚡AI Auto-Sort
            </button>
            <span className="bulk-view-selection-group-count selected-count">{selectedCount} selected</span>
          </div>

          <div className="bulk-view-toolbar-right bulk-view-toolbar-right--compact">
            <EmailInboxSyncControls
              accountSyncWindowDays={accountSyncWindowDays}
              onSyncWindowChange={handleSyncWindowChange}
              primaryAccountId={primaryAccountId}
              autoSyncEnabled={autoSyncEnabled}
              onToggleAutoSync={toggleAutoSync}
              onUnifiedSync={() => void handleUnifiedSync()}
              syncing={syncing}
              remoteSyncBusy={remoteSyncBusy}
              pullOnly={bulkToolbarPullOnly}
            />
            <button
              type="button"
              className="bulk-view-wr-expert-btn"
              onClick={() => setShowWrExpertModal(true)}
              title="Edit AI inbox rules (WRExpert.md)"
            >
              WR Expert
            </button>
            <button
              type="button"
              className="bulk-view-debug-icon-btn"
              onClick={openRemoteDebugPanel}
              title="Developer tools — remote queue & diagnostics"
            >
              🔧
            </button>
          </div>
        </div>
      </div>

      {remoteDebugOpen ? (
        <div
          role="dialog"
          aria-label="Remote sync debug"
          style={{
            position: 'fixed',
            top: 100,
            right: 16,
            width: 440,
            maxHeight: '72vh',
            zIndex: 12000,
            background: '#fff',
            color: '#111',
            border: '1px solid #ccc',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #ddd' }}>
            <div>
              <strong>Developer tools — Remote sync</strong>
              <div style={{ fontSize: 10, fontWeight: 400, color: MUTED, marginTop: 2 }}>Queue diagnostics &amp; IMAP folder checks</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => void refreshRemoteDebugQueue()} disabled={remoteDebugLoading}>
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleRetryFailedRemoteQueue()}
                disabled={remoteDebugLoading}
                title="Set all failed remote queue rows to pending (attempts=0) and schedule background drain"
              >
                Retry failed
              </button>
              <button
                type="button"
                onClick={() => void handleTestMoveOne()}
                disabled={displayMessages.length === 0 || remoteDebugLoading}
                title="Enqueue + drain first visible message only"
              >
                Test Move 1
              </button>
              <button type="button" onClick={() => setRemoteDebugOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <div style={{ overflow: 'auto', padding: 12, flex: 1 }}>
            {remoteSyncUserSummary ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: '#0f172a',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Sync status</div>
                {remoteSyncUserSummary.line}
              </div>
            ) : null}
            {remoteDebugLoading ? <div>Loading…</div> : null}
            {remoteFolderVerifyLoading ? <div style={{ marginBottom: 8, fontSize: 11 }}>Verifying IMAP folders…</div> : null}
            {remoteFolderVerify && remoteFolderVerify.ok === false ? (
              <div style={{ marginBottom: 10, padding: 8, background: '#fef2f2', borderRadius: 6, fontSize: 11, color: '#b91c1c' }}>
                Verify remote: {String((remoteFolderVerify as { error?: string }).error ?? 'failed')}
              </div>
            ) : null}
            {remoteFolderVerify && remoteFolderVerify.ok === true && (remoteFolderVerify as { data?: unknown }).data ? (
              <section
                style={{
                  marginBottom: 12,
                  padding: 10,
                  background: '#f0fdf4',
                  borderRadius: 6,
                  border: '1px solid #bbf7d0',
                  fontSize: 11,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  IMAP server folders (read-only)
                  {remoteFolderVerifyLabel ? (
                    <span style={{ fontWeight: 400, color: '#475569' }}> — {remoteFolderVerifyLabel}</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginBottom: 8, lineHeight: 1.45 }}>
                  Canonical lifecycle uses <strong>exact</strong> name match — typo <code>Archieve</code> and <code>WRDesk-*</code>{' '}
                  do not count. Use <strong>Verify</strong> next to each IMAP account under Per account (queue).
                </div>
                {(() => {
                  const data = (remoteFolderVerify as { data?: { lifecycleOnServer?: unknown[]; folders?: unknown[] } }).data
                  const lc = (data?.lifecycleOnServer ?? []) as Array<{
                    role?: string
                    mailbox?: string
                    resolved?: string
                    exactMatch?: boolean
                  }>
                  const fds = (data?.folders ?? []) as Array<{
                    path?: string
                    name?: string
                    messages?: number
                    unseen?: number
                    legacy?: boolean
                    statusError?: string
                  }>
                  return (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Expected lifecycle (exact on server)</div>
                      <ul style={{ margin: '0 0 10px 14px', padding: 0, lineHeight: 1.5 }}>
                        {lc.map((row) => (
                          <li key={String(row.role)}>
                            <strong>{String(row.role)}</strong>: {String(row.mailbox)} →{' '}
                            <code style={{ fontSize: 10 }}>{String(row.resolved)}</code>{' '}
                            {row.exactMatch ? (
                              <span style={{ color: '#15803d' }}>✓</span>
                            ) : (
                              <span style={{ color: '#b45309' }}>missing / wrong name</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>All folders (STATUS)</div>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 14,
                          maxHeight: 220,
                          overflow: 'auto',
                          lineHeight: 1.45,
                          fontSize: 10,
                        }}
                      >
                        {fds.map((f) => (
                          <li key={String(f.path)} style={{ marginBottom: 4 }}>
                            <code>{String(f.path)}</code>
                            {f.legacy ? (
                              <span style={{ color: '#b45309', marginLeft: 6 }}>(legacy)</span>
                            ) : null}
                            {typeof f.messages === 'number' ? (
                              <span style={{ color: '#475569', marginLeft: 6 }}>
                                msgs {f.messages}
                                {typeof f.unseen === 'number' ? ` · unseen ${f.unseen}` : ''}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8', marginLeft: 6 }}>{f.statusError || 'no count'}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )
                })()}
              </section>
            ) : null}
            {(() => {
              const err = remoteDebugQueue?.error
              if (typeof err === 'string') {
                return <div style={{ color: '#b91c1c' }}>Error: {err}</div>
              }
              const total = remoteDebugQueue?.total as { c?: number } | undefined
              const byStatus = (remoteDebugQueue?.byStatus as QueueStatusRow[]) ?? []
              const byOp = (remoteDebugQueue?.byOp as QueueStatusRow[]) ?? []
              const byAccountStatus = (remoteDebugQueue?.byAccountStatus as QueueAccountStatusRow[]) ?? []
              const queueByAccountSummary = (remoteDebugQueue?.queueByAccountSummary as QueueByAccountSummaryRow[]) ?? []
              const failed = (remoteDebugQueue?.failed as QueueMsgRow[]) ?? []
              const recent = (remoteDebugQueue?.sample as QueueMsgRow[]) ?? []
              const opAgg = aggregateLifecycleOpCounts(byOp)
              const totalC = Number(total?.c) || 0
              const completedC = countStatus(byStatus, 'completed')
              const pendingC = countStatus(byStatus, 'pending')
              const processingC = countStatus(byStatus, 'processing')
              const etaLine = formatDrainEtaLine(remoteDrainHistory, pendingC, processingC)
              return (
                <>
                  <section style={{ marginBottom: 12, padding: 10, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Drain progress</div>
                    <div style={{ lineHeight: 1.45 }}>
                      Remote sync: {completedC}/{totalC} completed ({pendingC} pending, {processingC} processing)
                    </div>
                    {etaLine ? (
                      <div style={{ marginTop: 6, color: '#0369a1', fontWeight: 500 }}>{etaLine}</div>
                    ) : (
                      <div style={{ marginTop: 6, fontSize: 11, color: MUTED }}>
                        {pendingC + processingC > 0
                          ? 'ETA appears after a few samples (completed count must rise over ~30s).'
                          : 'No pending/processing rows — queue idle for remote moves.'}
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 10, color: MUTED }}>
                      Auto-refresh every 5s while this panel is open.
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        padding: 8,
                        fontSize: 10,
                        lineHeight: 1.45,
                        color: '#92400e',
                        background: '#fffbeb',
                        borderRadius: 4,
                        border: '1px solid #fcd34d',
                      }}
                    >
                      <strong>Microsoft 365 / Outlook:</strong> If pending lifecycle mail seems missing after an
                      older sync, check <strong>Deleted items</strong> (Gelöschte Elemente) and{' '}
                      <strong>Recoverable items</strong> in Outlook on the web. Move back to Inbox if needed, then use
                      ☁ Sync Remote or Retry failed. Current app moves to &quot;Pending Delete&quot; / &quot;Pending
                      Review&quot; folders only — it does not hard-delete those messages from the queue op.
                    </div>
                  </section>
                  <section
                    style={{
                      marginBottom: 12,
                      padding: 10,
                      background: '#fefce8',
                      borderRadius: 6,
                      border: '1px solid #fde047',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Account status (gateway vs inbox DB)</div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 8, lineHeight: 1.45 }}>
                      Accounts are stored in <code>email-accounts.json</code>. Inbox rows use <code>account_id</code> — after
                      reconnect the UUID may change. Orphan ids are absent from the gateway; migrate to the current
                      account, then run <strong>☁ Sync Remote</strong> (classifications are kept; only the id is fixed).
                    </div>
                    {!window.emailInbox?.debugAccountMigrationStatus ? (
                      <div style={{ color: MUTED, fontSize: 11 }}>Update app for account migration diagnostics.</div>
                    ) : accountMigrationDiag && accountMigrationDiag.ok === true ? (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 6 }}>Connected accounts</div>
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.5 }}>
                          {(
                            (accountMigrationDiag.gatewayAccounts as Array<Record<string, unknown>>) ?? []
                          ).map((g) => (
                            <li key={String(g.id)} style={{ marginBottom: 8 }}>
                              <div>
                                <strong>{String(g.email ?? '—')}</strong> · {String(g.provider ?? '—')} ·{' '}
                                {String(g.status ?? '—')}
                              </div>
                              <div
                                style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: '#475569' }}
                              >
                                id {String(g.id)}
                              </div>
                              <div>inbox_messages (non-deleted): {Number(g.inboxMessageCount) || 0}</div>
                            </li>
                          ))}
                        </ul>
                        {(
                          (accountMigrationDiag.orphans as Array<Record<string, unknown>>) ?? []
                        ).length > 0 ? (
                          <>
                            <div
                              style={{ fontWeight: 600, fontSize: 11, margin: '10px 0 6px', color: '#a16207' }}
                            >
                              Orphan account_id (not in gateway — often old id after reconnect)
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.5 }}>
                              {(
                                (accountMigrationDiag.orphans as Array<Record<string, unknown>>) ?? []
                              ).map((o) => {
                                const oid = String(o.accountId ?? '')
                                const sugg = (o.suggestedTargetAccountIds as string[] | undefined) ?? []
                                const gw =
                                  (accountMigrationDiag.gatewayAccounts as Array<Record<string, unknown>>) ?? []
                                const emailFor = (id: string) =>
                                  String(gw.find((x) => String(x.id) === id)?.email ?? `${id.slice(0, 8)}…`)
                                const target = orphanMigrateTargetId[oid] || (sugg.length > 0 ? sugg[0] : '')
                                return (
                                  <li key={oid} style={{ marginBottom: 10 }}>
                                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>{oid}</div>
                                    <div>
                                      {Number(o.inboxMessageCount) || 0} messages · {Number(o.queueRowCount) || 0}{' '}
                                      queue rows
                                    </div>
                                    {sugg.length === 0 ? (
                                      <div style={{ color: '#b45309', fontSize: 10, marginTop: 4 }}>
                                        No To/Cc match to a connected mailbox — use a manual SQL UPDATE or ensure
                                        messages include your address in To/Cc so we can suggest a target.
                                      </div>
                                    ) : (
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexWrap: 'wrap',
                                          gap: 6,
                                          alignItems: 'center',
                                          marginTop: 6,
                                        }}
                                      >
                                        {sugg.length > 1 ? (
                                          <select
                                            value={target}
                                            onChange={(e) =>
                                              setOrphanMigrateTargetId((prev) => ({
                                                ...prev,
                                                [oid]: e.target.value,
                                              }))
                                            }
                                            style={{ fontSize: 11, maxWidth: 240 }}
                                          >
                                            {sugg.map((tid) => (
                                              <option key={tid} value={tid}>
                                                {emailFor(tid)}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          <span style={{ fontSize: 11 }}>→ {emailFor(sugg[0])}</span>
                                        )}
                                        <button
                                          type="button"
                                          disabled={remoteDebugLoading || !target}
                                          style={{ fontSize: 11, padding: '4px 8px' }}
                                          onClick={() => void handleMigrateInboxAccount(oid, target)}
                                        >
                                          Migrate messages + clear queue (old id)
                                        </button>
                                      </div>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          </>
                        ) : (
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                            No orphan account ids — inbox account_id values match the gateway.
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: MUTED }}>Refresh to load account diagnostics.</div>
                    )}
                  </section>
                  <section style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Queue overview</div>
                    <div>Total queue rows: {totalC}</div>
                    <div>
                      Pending: {pendingC} | Processing: {processingC} | Completed: {completedC} | Failed:{' '}
                      {countStatus(byStatus, 'failed')}
                    </div>
                  </section>
                  <section style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>By operation</div>
                    {(['archive', 'pending_delete', 'pending_review', 'urgent'] as const).map((op) => (
                      <div key={op}>
                        {op}: {opAgg[op]?.pending ?? 0} pending, {opAgg[op]?.failed ?? 0} failed
                      </div>
                    ))}
                  </section>
                  <section style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Per account (queue)</div>
                    {queueByAccountSummary.length === 0 ? (
                      <div style={{ color: MUTED }}>No rows (or no accounts in gateway).</div>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5 }}>
                        {queueByAccountSummary.map((acc) => (
                          <li key={acc.accountId} style={{ marginBottom: 6 }}>
                            <strong>{acc.label}</strong>
                            <div style={{ fontSize: 11, color: '#334155' }}>
                              id <code style={{ fontSize: 10 }}>{acc.accountId}</code>
                            </div>
                            <div style={{ fontSize: 11 }}>
                              pending {acc.pending} · processing {acc.processing} · completed {acc.completed} · failed{' '}
                              {acc.failed} · total {acc.total}
                            </div>
                            {acc.accountId !== '(no account_id)' ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                {String(acc.provider ?? '')
                                  .toLowerCase()
                                  .includes('imap') ? (
                                  <button
                                    type="button"
                                    disabled={remoteDebugLoading || remoteFolderVerifyLoading}
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                    title="LIST + STATUS counts + lifecycle exact-match (read-only)"
                                    onClick={() => void handleVerifyImapRemoteFolders(acc.accountId, acc.label)}
                                  >
                                    Verify remote
                                  </button>
                                ) : null}
                                {acc.failed > 0 ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={remoteDebugLoading}
                                      style={{ fontSize: 11, padding: '4px 8px' }}
                                      title="Reset failed queue rows for this account only (e.g. Outlook after provider fix)"
                                      onClick={() => void handleRetryFailedRemoteQueue(acc.accountId)}
                                    >
                                      Retry failed (this account)
                                    </button>
                                    <button
                                      type="button"
                                      disabled={remoteDebugLoading}
                                      style={{ fontSize: 11, padding: '4px 8px' }}
                                      title="Delete failed queue rows for this account (e.g. Account not found after disconnect — use Sync Remote after reconnect)"
                                      onClick={() => void handleClearFailedRemoteQueue(acc.accountId)}
                                    >
                                      Clear failed (this account)
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section
                    style={{
                      marginBottom: 12,
                      padding: 10,
                      background: '#fafafa',
                      borderRadius: 6,
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      Unclassified messages (main Inbox — may still be in server Posteingang)
                    </div>
                    <div style={{ fontSize: 10, color: MUTED, marginBottom: 8, lineHeight: 1.45 }}>
                      WR Desk “all” tab: not archived, not pending delete/review. Classified messages mirror to four server
                      folders: <strong>Archive</strong> (archive / newsletter / normal / other categories),{' '}
                      <strong>Pending Review</strong> (pending_review / important), <strong>Pending Delete</strong>,{' '}
                      <strong>Urgent</strong>. Unclassified (no sort_category) stay in Inbox until Auto-Sort.
                    </div>
                    <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                        Account filter
                        <select
                          value={remoteMainInboxAccountId}
                          onChange={(e) => {
                            const v = e.target.value
                            setRemoteMainInboxAccountId(v)
                            void refreshRemoteDebugQueue({
                              silent: true,
                              mainInboxAccountOverride: v.trim() ? v : undefined,
                            })
                          }}
                          style={{ fontSize: 11, maxWidth: 240 }}
                        >
                          <option value="">All accounts</option>
                          {queueByAccountSummary
                            .filter((a) => a.accountId && a.accountId !== '(no account_id)')
                            .map((a) => (
                              <option key={a.accountId} value={a.accountId}>
                                {a.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    {remoteMainInboxDebug && remoteMainInboxDebug.ok === false ? (
                      <div style={{ color: '#b91c1c', fontSize: 11 }}>
                        {String((remoteMainInboxDebug as { error?: string }).error ?? 'failed')}
                      </div>
                    ) : remoteMainInboxDebug && remoteMainInboxDebug.ok === true ? (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
                          {String(remoteMainInboxDebug.summaryText ?? '')}
                        </div>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>
                          {String(remoteMainInboxDebug.policyNote ?? '')}
                        </div>
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 14,
                            fontSize: 11,
                            lineHeight: 1.45,
                            maxHeight: 280,
                            overflow: 'auto',
                          }}
                        >
                          {(
                            (remoteMainInboxDebug.rows as Array<Record<string, unknown>>) ?? []
                          ).map((row) => (
                            <li key={String(row.id)} style={{ marginBottom: 8 }}>
                              <div style={{ fontWeight: 600 }}>
                                {String(row.subject ?? '(no subject)').slice(0, 140)}
                              </div>
                              <div style={{ color: '#475569' }}>
                                {String(row.from_address ?? '—')} · {String(row.received_at ?? '—')}
                              </div>
                              <div>
                                <code>sort_category</code> {String(row.sort_category ?? 'null')} ·{' '}
                                <code>imap_remote_mailbox</code> {String(row.imap_remote_mailbox ?? 'null')} ·{' '}
                                <code>queue</code> {String(row.queue_op ?? '—')} / {String(row.queue_status ?? '—')}
                              </div>
                              <div style={{ color: '#0369a1' }}>{String(row.whyDetail ?? row.why ?? '')}</div>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: MUTED }}>
                        Open Refresh to load (needs app with debugMainInboxRows).
                      </div>
                    )}
                  </section>
                  <section style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Raw: account × status</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
                      {byAccountStatus.length === 0 ? (
                        <li>—</li>
                      ) : (
                        byAccountStatus.map((row, i) => (
                          <li key={i}>
                            {row.account_id ?? 'null'} · {row.status} · {row.c}
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                  <section style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Failed rows (sample up to 10)</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {failed.map((row, i) => (
                        <li key={i} style={{ marginBottom: 6 }}>
                          <code>{row.operation}</code> — {String(row.last_error ?? '').slice(0, 200)} (attempts {row.attempts ?? 0}, email_id{' '}
                          {row.email_message_id ?? '—'})
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Recent rows (last 5)</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {recent.map((row, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          <code>{row.operation}</code> · {row.status} · {row.created_at ?? ''} → {row.updated_at ?? ''}
                        </li>
                      ))}
                    </ul>
                  </section>
                  {remoteDebugTestMove ? (
                    <section style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 4 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Test Move 1</div>
                      <div>{remoteDebugTestMove.enqueue}</div>
                      <div>{remoteDebugTestMove.move}</div>
                      {(() => {
                        const fmt = (row: Record<string, unknown> | null | undefined, title: string) =>
                          row ? (
                            <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.45 }}>
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
                              <div>
                                <code>imap_remote_mailbox</code>:{' '}
                                {row.imap_remote_mailbox != null ? String(row.imap_remote_mailbox) : 'null'}
                              </div>
                              <div>
                                <code>email_message_id</code>:{' '}
                                {row.email_message_id != null ? String(row.email_message_id) : 'null'}
                              </div>
                              <div>
                                archived={String(row.archived ?? '—')} · pending_delete={String(row.pending_delete ?? '—')} ·
                                sort_category={row.sort_category != null ? String(row.sort_category) : 'null'}
                              </div>
                              <div>
                                pending_review_at={row.pending_review_at != null ? String(row.pending_review_at) : 'null'} ·
                                source_type={String(row.source_type ?? '—')}
                              </div>
                            </div>
                          ) : null
                        return (
                          <>
                            {fmt(remoteDebugTestMove.messageRowBeforeEnqueue, 'Message (before enqueue — skip logic)')}
                            {fmt(remoteDebugTestMove.messageRowAfterDrain, 'Message (after drain — current DB)')}
                          </>
                        )
                      })()}
                      {remoteDebugTestMove.skipReasons && remoteDebugTestMove.skipReasons.length > 0 ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Skip reasons</div>
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.4 }}>
                            {remoteDebugTestMove.skipReasons.map((line, i) => (
                              <li key={i} style={{ marginBottom: 4 }}>
                                {line}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {remoteDebugTestMove.queueRows && remoteDebugTestMove.queueRows.length > 0 ? (
                        <div style={{ marginTop: 8, fontSize: 11 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Queue rows (this message)</div>
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {remoteDebugTestMove.queueRows.map((qr, i) => (
                              <li key={i} style={{ marginBottom: 4 }}>
                                <code>{String(qr.operation ?? '—')}</code> · {String(qr.status ?? '—')} · attempts{' '}
                                {String(qr.attempts ?? '—')}
                                {qr.last_error ? ` · ${String(qr.last_error).slice(0, 120)}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>Activity log</span>
                      <button type="button" onClick={() => clearRemoteSyncLog()}>
                        Clear log
                      </button>
                    </div>
                    <div
                      style={{
                        maxHeight: 140,
                        overflow: 'auto',
                        background: '#f1f5f9',
                        padding: 8,
                        borderRadius: 4,
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 11,
                      }}
                    >
                      {remoteSyncLog.length === 0 ? <span style={{ color: MUTED }}>No entries yet.</span> : null}
                      {remoteSyncLog.map((line, i) => (
                        <div key={i} style={{ marginBottom: 4 }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )
            })()}
          </div>
        </div>
      ) : null}

      {lastSyncWarnings && lastSyncWarnings.length > 0 ? (
        <SyncFailureBanner
          warnings={lastSyncWarnings}
          accounts={providerAccounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
          onUpdateCredentials={handleUpdateImapCredentials}
          onRemoveAccount={handleDisconnectEmail}
        />
      ) : null}

      {/* Collapsible provider/account section */}
      <div className={`bulk-view-provider-section ${providerSectionExpanded ? 'bulk-view-provider-section--expanded' : ''}`}>
        <button
          type="button"
          className="bulk-view-provider-toggle"
          onClick={() => setProviderSectionExpanded((v) => !v)}
          aria-expanded={providerSectionExpanded}
        >
          <span style={{ fontSize: 14 }}>🔗</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Email Accounts</span>
          {providerAccounts.length > 0 && (
            <span style={{ fontSize: 11, color: MUTED }}>({providerAccounts.length})</span>
          )}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              transform: providerSectionExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          >
            ▼
          </span>
        </button>
        {providerSectionExpanded && (
          <div className="bulk-view-provider-body">
            <EmailProvidersSection
              theme="professional"
              emailAccounts={providerAccounts}
              isLoadingEmailAccounts={isLoadingProviderAccounts}
              selectedEmailAccountId={selectedProviderAccountId}
              onConnectEmail={handleConnectEmail}
              onDisconnectEmail={handleDisconnectEmail}
              onSelectEmailAccount={setSelectedProviderAccountId}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="bulk-view-content">
        {error ? (
          <div className="bulk-view-content-message bulk-view-empty-state" style={{ color: '#ef4444' }}>
            {error}
          </div>
        ) : loading && displayMessages.length === 0 && !bulkBackgroundRefresh ? (
          <div className="bulk-view-content-message bulk-view-empty-state">Loading…</div>
        ) : !loading && !bulkBackgroundRefresh && messages.length === 0 ? (
          <div className="bulk-view-content-message bulk-view-empty-state">No messages in this batch.</div>
        ) : (
          <div className="bulk-view-content-body">
            <div className="bulk-view-content-chrome">
              {(bulkBackgroundRefresh || (loading && displayMessages.length > 0)) ? (
                <div
                  className="bulk-view-refresh-strip"
                  role="progressbar"
                  aria-label="Refreshing inbox"
                  aria-busy="true"
                />
              ) : null}
              <div className="bulk-view-pagination-bar">
                <span style={{ fontSize: 11, color: MUTED }}>
                  {total} message{total !== 1 ? 's' : ''} in this tab
                  {bulkHasMore ? (
                    <span style={{ marginLeft: 8 }}>
                      ({messages.length} loaded)
                    </span>
                  ) : null}
                </span>
              </div>
              {showBulkStatusDock ? (
                <div className="bulk-view-status-dock" role="region" aria-label="Bulk inbox status">
                  {aiSortProgress ? (
                    <div className="bulk-view-sort-progress" role="status">
                      <span className="bulk-view-sort-progress-text">{aiSortProgress}</span>
                    </div>
                  ) : null}
                  {sendEmailToast ? (
                    <div
                      className="bulk-view-toast-primary"
                      style={{
                        background: sendEmailToast.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                        borderColor: sendEmailToast.type === 'success' ? '#22c55e' : '#ef4444',
                      }}
                      role="status"
                    >
                      <span>{sendEmailToast.message}</span>
                      <button type="button" onClick={() => setSendEmailToast(null)}>Dismiss</button>
                    </div>
                  ) : null}
                  {concurrentSortNotice ? (
                    <div
                      className="bulk-view-toast-primary"
                      style={{ background: 'rgba(234,179,8,0.18)', borderColor: '#ca8a04' }}
                      role="status"
                    >
                      <span>{concurrentSortNotice}</span>
                      <button type="button" onClick={() => setConcurrentSortNotice(null)}>Dismiss</button>
                    </div>
                  ) : null}
                  {aiSortOutcomeSummary ? (
                    <div
                      className="bulk-view-toast-primary"
                      style={{
                        background: 'rgba(124,58,237,0.12)',
                        borderColor: 'rgba(124,58,237,0.45)',
                      }}
                      role="status"
                    >
                      <span>{aiSortOutcomeSummary}</span>
                      <button type="button" onClick={() => setAiSortOutcomeSummary(null)}>Dismiss</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {bulkCompactMode && (bulkBatchSize === 'all' || bulkBatchSize >= 24) && messages.length > 0 ? (
                <div
                  className="bulk-view-compact-hint"
                  role="status"
                  title="Keyboard: j/k nav, a archive, d delete, g keep, Enter expand, Space primary"
                >
                  Compact mode · {messages.length} messages · j/k nav, a archive, d delete
                </div>
              ) : null}
            </div>
            <div className="bulk-view-grid-scroll" ref={bulkScrollContainerRef}>
          <div
            className={`bulk-view-grid ${isSortingActive ? 'bulk-view-grid--analyzing' : ''}`}
            title="Keyboard: j/k or ↑↓ nav, Enter expand, a archive, d delete, Space primary action"
          >
            {displayMessages.map((msg) => {
              const isRemoving = removingItems.has(msg.id)
              const isMultiSelected = multiSelectIds.has(msg.id)
              const isFocused = focusedMessageId === msg.id
              const isCardExpanded = expandedCardIds.has(msg.id)
              const output = bulkAiOutputs[msg.id] ?? parsePersistedAnalysis(msg.ai_analysis_json, msg)
              const bodyContent = (msg.body_text || '').trim() || '(No body)'
              const hasAttachments = msg.has_attachments === 1
              const isDeleted = msg.deleted === 1
              const isPendingDelete = (msg as InboxMessage & { pending_delete?: number }).pending_delete === 1
              const urgencyScore = output?.urgencyScore ?? msg.urgency_score ?? 5
              const baseCategory = (output?.category ?? msg.sort_category ?? 'normal') as keyof typeof CATEGORY_BORDER
              /** When we have structured AI output, do not let stale DB sort_category=urgent override a reconciled low score (e.g. promotional). */
              const hasStructuredUrgency = typeof output?.urgencyScore === 'number'
              const isUrgent = hasStructuredUrgency
                ? urgencyScore >= BULK_AUTO_SORT_URGENCY_THRESHOLD && baseCategory === 'urgent'
                : urgencyScore >= BULK_AUTO_SORT_URGENCY_THRESHOLD || msg.sort_category === 'urgent'
              const category = (isUrgent ? 'urgent' : baseCategory) as keyof typeof CATEGORY_BORDER
              /**
               * Tint from DB sort state, or immediately from live bulk AI output (Auto-Sort mid-flight before move/refresh).
               * Undo/clear still removes both so rows return to neutral.
               */
              const hasLiveBulkClassification =
                !!output &&
                (output.bulkAnalysisStreaming === true ||
                  Boolean(output.category && String(output.category).trim()) ||
                  output.autosortFailure === true ||
                  output.autosortOutcome != null ||
                  output.autosortRetainKind != null)
              const isUnsorted =
                !msg.sort_category &&
                msg.pending_delete !== 1 &&
                msg.archived !== 1 &&
                !hasLiveBulkClassification
              const borderColor = isUnsorted ? undefined : (CATEGORY_BORDER[category] ?? 'transparent')
              const bgTint = isUnsorted ? undefined : (CATEGORY_BG[category] ?? 'transparent')
              /** Prefer reconciled AI output over DB when present (promotional cap clears needs_reply). */
              const needsReply = output ? !!output.needsReply : msg.needs_reply === 1

              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  className={`bulk-view-row ${isRemoving ? 'bulk-view-row--removing' : ''} ${isMultiSelected ? 'bulk-view-row--multi' : ''} ${isFocused ? 'bulk-view-row--focused' : ''} ${isCardExpanded ? 'bulk-view-row--expanded' : ''} ${output?.draftReply ? 'bulk-view-row--has-draft' : ''}`}
                  onAnimationEnd={isRemoving ? () => setRemovingItems((prev) => { const next = new Map(prev); next.delete(msg.id); return next; }) : undefined}
                >
                  {/* Left: Message card — click toggles focus */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if (
                        (e.target as HTMLElement).closest('.bulk-view-expand-btn') ||
                        (e.target as HTMLElement).closest('.bulk-view-msg-delete-btn') ||
                        (e.target as HTMLElement).closest('[data-subfocus="attachment"]')
                      ) {
                        return
                      }
                      handleFocusPair(msg)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleFocusPair(msg)
                      }
                    }}
                    className={`bulk-view-message ${isMultiSelected ? 'bulk-view-message--multi' : ''} ${isFocused ? 'bulk-view-message--focused' : ''} ${editingDraftForMessageId === msg.id ? 'bulk-view-message--editing-draft' : ''}`}
                  >
                    <div className="bulk-view-message-inner">
                      <div className="bulk-view-message-header">
                        <div className="bulk-view-message-meta">
                          {isFocused ? (
                            <span
                              className="bulk-view-message-focus-cue"
                              title="Focused — chat/search scoped to this message"
                              aria-hidden
                            >
                              👉
                            </span>
                          ) : null}
                          <RemoteSyncStatusDot msg={msg} />
                          <div className="msg-sender" style={{ minWidth: 0 }}>
                            <span className="msg-sender-name" style={{ fontSize: 14, fontWeight: 600 }}>
                              {msg.from_name || msg.from_address || '—'}
                              {msg.from_address &&
                                msg.from_name &&
                                msg.from_name.trim() !== msg.from_address.trim() && (
                                  <span style={{ color: '#888', marginLeft: 6, fontSize: '0.9em' }}>
                                    {msg.from_address}
                                  </span>
                                )}
                            </span>
                          </div>
                          {editingDraftForMessageId === msg.id && (
                            <span
                              role="button"
                              tabIndex={0}
                              className="bulk-view-editing-draft-indicator"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingDraftForMessageId(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setEditingDraftForMessageId(null)
                                }
                              }}
                              title="Click to exit edit mode"
                            >
                              Editing draft
                            </span>
                          )}
                          <span
                            style={{
                              marginLeft: 'auto',
                              flexShrink: 0,
                              fontSize: 11,
                              fontWeight: 500,
                              color: MUTED,
                            }}
                            title={msg.received_at ? `Received: ${formatDate(msg.received_at)}` : 'No received date'}
                          >
                            {formatRelativeDate(msg.received_at)}
                          </span>
                          <button
                            type="button"
                            className="bulk-view-expand-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleExpandMessage(msg)
                            }}
                            title="View full message"
                          >
                            View full
                          </button>
                          <button
                            type="button"
                            className="bulk-view-msg-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteOne(msg)
                            }}
                            title="Delete this message"
                          >
                            🗑 Delete
                          </button>
                        </div>
                        <div className="bulk-view-message-subject" style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, flexShrink: 0 }}>
                          {msg.subject || '(No subject)'}
                        </div>
                        {((output?.summary || output?.reason || msg.sort_reason) ?? '').trim() ? (
                          <div className="bulk-view-message-preview-line" style={{ fontSize: 11, fontStyle: 'italic', color: MUTED, marginBottom: 6, flexShrink: 0 }}>
                            {((output?.summary || output?.reason || msg.sort_reason) ?? '').trim().slice(0, 120)}
                            {((output?.summary || output?.reason || msg.sort_reason) ?? '').trim().length > 120 ? '…' : ''}
                          </div>
                        ) : null}
                      </div>
                      <div className="bulk-view-message-scroll">
                        <div
                          className="bulk-view-message-body"
                          style={{
                            fontSize: 12,
                            color: MUTED,
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {extractLinkParts(bodyContent).map((part, i) =>
                            part.type === 'text' ? (
                              <span key={i}>{part.text}</span>
                            ) : (
                              <button
                                key={i}
                                type="button"
                                className="msg-safe-link-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleLinkClick(part.url!)
                                }}
                              >
                                {part.text}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                      {hasAttachments ? (
                        <div className="bulk-view-message-attachments-footer bulk-message-footer">
                          <BulkInboxAttachmentsStrip
                            msg={msg}
                            selectedAttachmentId={selectedAttachmentId ?? null}
                            selectAttachment={selectAttachment}
                            onSelectAttachment={onSelectAttachment}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Right: Action Card — FIX-H5: ALL badges here, never in message body */}
                  <div
                    className="bulk-view-ai"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('textarea') || (e.target as HTMLElement).closest('[data-subfocus="draft"]') || (e.target as HTMLElement).closest('[data-subfocus="attachment"]')) return
                      handleFocusPair(msg)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        if (!(e.target as HTMLElement).closest('[data-subfocus="draft"]') && !(e.target as HTMLElement).closest('[data-subfocus="attachment"]')) handleFocusPair(msg)
                      }
                    }}
                    style={{
                      borderLeft: borderColor ? `4px solid ${borderColor}` : undefined,
                      background: bgTint !== 'transparent' ? bgTint : undefined,
                    }}
                  >
                    <div className="action-card-badges">
                      {(msg.sort_category === 'spam' || category === 'spam') && (
                        <span className="action-card-badge action-card-badge--spam">SPAM</span>
                      )}
                      {isPendingDelete && (
                        <span className="action-card-badge action-card-badge--pending-delete" title="Permanently deleted 7 days after moving here">
                          PENDING DELETE — {formatPendingDeleteInfo(msg.pending_delete_at)}
                        </span>
                      )}
                      {isPendingDelete && (
                        <UndoFadeWrapper>
                          <button
                            type="button"
                            className="action-card-badge action-card-badge--undo"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleUndoPendingDelete([msg.id])
                            }}
                          >
                            Undo
                          </button>
                        </UndoFadeWrapper>
                      )}
                      {isUrgent && (
                        <span
                          className="action-card-badge action-card-badge--urgency"
                          title={msg.sort_reason || output?.urgencyReason || 'Requires attention'}
                        >
                          {getUrgencyBadgeText(output?.urgencyReason ?? msg.sort_reason, needsReply, urgencyScore)}
                        </span>
                      )}
                      {hasAttachments && (
                        <span className="action-card-badge action-card-badge--attachments">📎 {msg.attachment_count}</span>
                      )}
                      {needsReply && !isUrgent && (
                        <span className="action-card-badge action-card-badge--needs-reply" title="Needs reply">↩</span>
                      )}
                      {isDeleted && (
                        <span className="action-card-badge action-card-badge--deleted">Deleted</span>
                      )}
                      {!isUnsorted && category && category !== 'normal' && category !== 'spam' && borderColor && (
                        <span className="action-card-badge action-card-badge--category" style={{ borderColor, color: borderColor }}>
                          {category === 'pending_review' ? 'REVIEW' : category.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div
                      className="bulk-view-ai-inner"
                      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    >
                      {renderActionCard(msg, output, isCardExpanded)}
                    </div>
                  </div>
                  {/* Full-row expand toggle — CSS gives this grid-column: 1/-1 so it spans both panes */}
                  <div
                    className="bulk-card-expand-toggle"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleCardExpand(msg.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleCardExpand(msg.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={isCardExpanded ? 'Show less' : 'Show more'}
                  >
                    {isCardExpanded ? '▴ Show less' : '▾ Show more'}
                  </div>
                </div>
              )
            })}
          </div>
            {bulkHasMore ? (
              <div
                ref={bulkLoadSentinelRef}
                className="bulk-scroll-sentinel"
                aria-hidden={!bulkLoadingMore}
              >
                {bulkLoadingMore ? (
                  <span className="bulk-loading-inline" role="status">
                    Loading…
                  </span>
                ) : null}
              </div>
            ) : null}
            </div>
          </div>
        )}
      </div>

      <LinkWarningDialog
        isOpen={!!pendingLinkUrl}
        url={pendingLinkUrl || ''}
        onConfirm={handleLinkConfirm}
        onCancel={handleLinkCancel}
      />

      {connectEmailFlowModal}

      {/* WR Expert modal — edit AI inbox rules */}
      {showWrExpertModal && (
        <WrExpertModal
          content={wrExpertContent}
          onChange={setWrExpertContent}
          onSave={async () => {
            setWrExpertSaving(true)
            try {
              const res = await window.emailInbox?.saveAiRules?.(wrExpertContent)
              return !!res?.ok
            } finally {
              setWrExpertSaving(false)
            }
          }}
          onResetToDefaults={async () => {
            const defaults = await window.emailInbox?.getAiRulesDefault?.()
            setWrExpertContent(defaults ?? '')
          }}
          onClose={() => setShowWrExpertModal(false)}
          saving={wrExpertSaving}
        />
      )}

      {/* Compose buttons — floating bottom-right */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          zIndex: 100,
        }}
      >
        <button
          type="button"
          onClick={() => handleComposeClick(handleOpenEmailCompose)}
          title="New Email"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '10px 14px',
            borderRadius: 24,
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
          }}
        >
          ✉️+
        </button>
        <button
          type="button"
          onClick={() => handleComposeClick(handleOpenBeapDraft)}
          title="New BEAP™ Message"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 18px',
            borderRadius: 24,
            background: '#7c3aed',
            color: '#fff',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
          }}
        >
          + BEAP
        </button>
      </div>

      {/* Inline email compose overlay (fallback when analysisDashboard.openEmailCompose not available) */}
      {showEmailCompose && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowEmailCompose(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              maxHeight: '90vh',
              overflow: 'hidden',
              background: 'var(--color-bg, #0f172a)',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <EmailComposeOverlay
              theme="default"
              onClose={() => {
                setShowEmailCompose(false)
                setReplyToMessage(null)
                setReplyDraftBody('')
                setDraftAttachmentsForCompose([])
              }}
              onSent={() => {
                setShowEmailCompose(false)
                setReplyToMessage(null)
                setReplyDraftBody('')
                setDraftAttachmentsForCompose([])
                refreshMessages()
              }}
              replyTo={
                replyToMessage
                  ? {
                      to: replyToMessage.from_address ?? undefined,
                      subject: replyToMessage.subject ?? undefined,
                      body: replyDraftBody,
                      initialAttachments: draftAttachmentsForCompose,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {/* Full message modal — stays inside bulk mode */}
      {expandedMessageId && (
        <div
          className="bulk-view-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-view-modal-title"
          onClick={(e) => e.target === e.currentTarget && handleCloseExpand()}
          onKeyDown={(e) => e.key === 'Escape' && handleCloseExpand()}
        >
          <div className="bulk-view-modal">
            <div className="bulk-view-modal-header">
              <h2 id="bulk-view-modal-title" className="bulk-view-modal-title">
                Message
              </h2>
              <button
                type="button"
                className="bulk-view-modal-close"
                onClick={handleCloseExpand}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="bulk-view-modal-body">
              {expandedMessage ? (
                <EmailMessageDetail
                  message={expandedMessage}
                  selectedAttachmentId={selectedAttachmentId}
                  onSelectAttachment={(attachmentId) => {
                    selectAttachment(expandedMessage.id, attachmentId)
                    onSelectAttachment?.(attachmentId)
                  }}
                  onReply={handleReply}
                />
              ) : (
                <div className="bulk-view-modal-loading">Loading…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
