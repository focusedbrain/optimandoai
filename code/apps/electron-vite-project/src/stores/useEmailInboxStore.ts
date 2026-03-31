/**
 * useEmailInboxStore
 *
 * Zustand store for the email inbox UI state (inbox_messages from Electron).
 * Calls window.emailInbox IPC bridge. Matches useBeapInboxStore pattern.
 *
 * @version 1.0.0
 */

import { create } from 'zustand'
import type { AiOutputs, NormalInboxAiResult } from '../types/inboxAi'
import '../components/handshakeViewTypes'
import {
  coerceInboxMessageKindFilter,
  messageMatchesKindFilter,
  type InboxMessageKindFilter,
} from '../lib/inboxMessageKind'
import { DEBUG_AUTOSORT_DIAGNOSTICS, autosortDiagLog, getAutosortDiagRunId } from '../lib/autosortDiagnostics'

export type { InboxMessageKindFilter }
export { coerceInboxMessageKindFilter, deriveInboxMessageKind, messageMatchesKindFilter } from '../lib/inboxMessageKind'

// =============================================================================
// Types
// =============================================================================

export type InboxSourceType = 'direct_beap' | 'email_beap' | 'email_plain'

export interface InboxAttachment {
  id: string
  message_id: string
  filename: string
  content_type: string | null
  size_bytes: number | null
  content_id: string | null
  storage_path: string | null
  extracted_text: string | null
  text_extraction_status: string | null
  /** When extraction failed, main-process error detail (for UI). */
  text_extraction_error?: string | null
  raster_path: string | null
}

export interface InboxMessage {
  id: string
  source_type: InboxSourceType
  handshake_id: string | null
  account_id: string | null
  email_message_id: string | null
  from_address: string | null
  from_name: string | null
  to_addresses: string | null
  cc_addresses: string | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  beap_package_json: string | null
  depackaged_json: string | null
  has_attachments: number
  attachment_count: number
  received_at: string
  ingested_at: string
  read_status: number
  starred: number
  archived: number
  deleted: number
  deleted_at: string | null
  purge_after: string | null
  remote_deleted: number | null
  sort_category: string | null
  sort_reason: string | null
  urgency_score: number | null
  needs_reply: number | null
  pending_delete: number
  pending_delete_at: string | null
  /** Set when message is in pending review workflow (matches DB). */
  pending_review_at?: string | null
  ai_summary: string | null
  ai_draft_response: string | null
  /** Persisted AI analysis JSON from Auto-Sort — survives clearBulkAiOutputsForIds. */
  ai_analysis_json?: string | null
  attachments?: InboxAttachment[]
  /** Latest remote orchestrator queue row for this message (from listMessages subquery). */
  remote_queue_status?: string | null
  remote_queue_last_error?: string | null
  remote_queue_operation?: string | null
}

export interface InboxFilter {
  filter: 'all' | 'unread' | 'starred' | 'deleted' | 'archived' | 'pending_delete' | 'pending_review' | 'urgent'
  sourceType: InboxSourceType | 'all'
  /** Product-facing BEAP kind filter — independent of raw `sourceType` labels. */
  messageKind: InboxMessageKindFilter
  handshakeId?: string
  category?: string
  search?: string
}

/** Workflow buckets shown in normal + bulk inbox (not classic mailbox folders). */
export const INBOX_WORKFLOW_FILTER_KEYS = [
  'all',
  'urgent',
  'pending_delete',
  'pending_review',
  'archived',
] as const

/** Per-tab totals for workflow toolbar (Normal + Bulk). */
export type InboxTabCounts = {
  all: number
  urgent: number
  pending_delete: number
  pending_review: number
  archived: number
}

/** Default tab counts; use for store init and safe fallbacks. */
export const EMPTY_INBOX_TAB_COUNTS: InboxTabCounts = {
  all: 0,
  urgent: 0,
  pending_delete: 0,
  pending_review: 0,
  archived: 0,
}

/** Coerce any partial/loose server or derived map to a full InboxTabCounts. */
export function normalizeInboxTabCounts(raw: Record<string, number> | Partial<InboxTabCounts> | null | undefined): InboxTabCounts {
  const r = raw ?? {}
  return {
    all: typeof r.all === 'number' ? r.all : 0,
    urgent: typeof r.urgent === 'number' ? r.urgent : 0,
    pending_delete: typeof r.pending_delete === 'number' ? r.pending_delete : 0,
    pending_review: typeof r.pending_review === 'number' ? r.pending_review : 0,
    archived: typeof r.archived === 'number' ? r.archived : 0,
  }
}

/** Map legacy tabs (Unread / Starred / Deleted) to All so normal inbox stays workflow-only. */
export function coerceInboxWorkflowFilter(f: unknown): InboxFilter['filter'] {
  const s = String(f ?? '')
  if (
    s === 'all' ||
    s === 'urgent' ||
    s === 'pending_delete' ||
    s === 'pending_review' ||
    s === 'archived'
  ) {
    return s
  }
  return 'all'
}

/** Inner sub-focus within a focused message. Separate from bulk selection and outer message focus. */
export type SubFocus =
  | { kind: 'none' }
  | { kind: 'attachment'; messageId: string; attachmentId: string }
  | { kind: 'draft'; messageId: string }

// =============================================================================
// Store Interface
// =============================================================================

interface EmailInboxState {
  /**
   * Legacy union cache (multi-tab drain). In bulk mode we now paginate from the server and keep this empty.
   * Kept for mutation helpers that still reference the field name.
   */
  allMessages: InboxMessage[]
  /** Per-tab totals from fast COUNT via `inbox:listMessages` (limit 1) — not derived from loaded rows. */
  tabCounts: InboxTabCounts
  messages: InboxMessage[]
  total: number
  loading: boolean
  /** Bulk inbox: more rows available for the active tab (offset pagination). */
  bulkHasMore: boolean
  /** Bulk inbox: fetching the next page for Load More. */
  bulkLoadingMore: boolean
  /** Bulk-only: true during fetchAllMessages({ soft }) — keep grid mounted, show thin refresh strip. */
  bulkBackgroundRefresh: boolean
  error: string | null
  selectedMessageId: string | null
  selectedMessage: InboxMessage | null
  selectedAttachmentId: string | null
  multiSelectIds: Set<string>
  filter: InboxFilter
  bulkMode: boolean
  bulkPage: number
  bulkBatchSize: number | 'all'
  bulkCompactMode: boolean
  bulkAiOutputs: AiOutputs
  autoSyncEnabled: boolean
  /** Account sync window (days); 0 = all mail. Loaded from the primary account row. */
  accountSyncWindowDays: number
  syncing: boolean
  /**
   * Main sent `inbox:newMessages` while a manual Pull was in progress (`syncing`).
   * Flush one `fetchMessages` / `refreshMessages` when `syncing` becomes false (idempotent).
   */
  pendingInboxRefreshAfterSyncEvent: boolean
  markPendingInboxRefreshAfterSyncEvent: () => void
  lastSyncAt: string | null
  /** Non-fatal sync issues from last Pull (partial failures). Cleared on next Pull start. */
  lastSyncWarnings: string[] | null
  /** Clear Pull sync warnings (e.g. after successful IMAP credential reconnect). */
  clearLastSyncWarnings: () => void
  /** Cache of AI analysis results keyed by messageId. Cleared for messages no longer in list after fetch. */
  analysisCache: Record<string, NormalInboxAiResult>
  /** FIX-H6: Message ID whose draft is currently being edited. Only one at a time. */
  editingDraftForMessageId: string | null
  /** Inner sub-focus within the focused message. Separate from bulk selection and outer message focus. */
  subFocus: SubFocus
  /** True while AI Auto-Sort is running — prevents sync from refreshing and racing. */
  isSortingActive: boolean
  /** Incremented when sort completes — kicks preload queue to re-fire. */
  analysisRestartCounter: number
  /** In-app remote sync / queue diagnostics (newest first, max 50). */
  remoteSyncLog: string[]
  addRemoteSyncLog: (entry: string) => void
  clearRemoteSyncLog: () => void
  /**
   * Bulk rows where the user manually regenerated draft — hide analysis/recommended chrome
   * so the draft editor uses the full pane until “Show analysis” or a new Auto-Sort.
   */
  bulkDraftManualComposeIds: Set<string>
  addBulkDraftManualCompose: (messageId: string) => void
  removeBulkDraftManualCompose: (messageId: string) => void
  clearBulkDraftManualComposeForIds: (ids: string[]) => void

  fetchMessages: () => Promise<void>
  /** Bulk: first page (50) + tab counts. Soft refresh keeps grid mounted. */
  fetchAllMessages: (options?: { soft?: boolean }) => Promise<void>
  /** Bulk: append next page (50) for the active tab. */
  loadMoreBulkMessages: () => Promise<void>
  /** All IDs matching the active filter (paginated drain). Same semantics as inbox tabs; ignores batch/page UI. */
  fetchMatchingIdsForCurrentFilter: () => Promise<string[]>
  /** Set multiSelectIds to every ID matching the current filter (for toolbar “select all” in batch mode “All”). */
  selectAllMatchingCurrentFilter: () => Promise<void>
  /** Refresh: fetchAllMessages in bulk mode, else fetchMessages. Use after mutations. */
  refreshMessages: () => Promise<void>
  selectMessage: (id: string | null) => Promise<void>
  selectAttachment: (messageId: string, attachmentId: string | null) => void
  /** Merge attachment rows into a list message (e.g. after lazy `getMessage` when list omitted `attachments`). */
  mergeMessageAttachments: (messageId: string, attachments: InboxAttachment[]) => void
  toggleMultiSelect: (id: string) => void
  clearMultiSelect: () => void
  setFilter: (partial: Partial<InboxFilter>) => void
  setBulkMode: (enabled: boolean) => void
  setBulkPage: (page: number) => void
  setBulkBatchSize: (size: number | 'all') => void
  setBulkCompactMode: (enabled: boolean) => void
  syncBulkBatchSizeFromSettings: () => Promise<void>
  setBulkAiOutputs: (updater: (prev: AiOutputs) => AiOutputs) => void
  clearBulkAiOutputsForIds: (ids: string[]) => void
  /** Fully reset pending-delete state for ids after Undo. Clears AI output flags and local row state. */
  clearPendingDeleteStateForIds: (ids: string[]) => void
  markRead: (ids: string[], read: boolean) => Promise<void>
  toggleStar: (id: string) => Promise<void>
  archiveMessages: (ids: string[]) => Promise<boolean>
  deleteMessages: (ids: string[], gracePeriodHours?: number) => Promise<void>
  /** Move messages to Pending Delete (soft, 7-day grace). Use for AI-recommended pending_delete. */
  markPendingDeleteImmediate: (ids: string[]) => Promise<boolean>
  /** Move messages to Pending Review (14-day grace in DB). Immediate IPC + local state. */
  moveToPendingReviewImmediate: (ids: string[]) => Promise<boolean>
  /**
   * Bulk Auto-Sort only: main already persisted in `classifySingleMessage` — sync local rows + tab counts
   * without a second DB-writing IPC.
   */
  applyBulkAutosortLocalPendingDelete: (
    ids: string[],
    pendingDeleteAt?: string | null,
    /** Same `sort_category` main wrote (e.g. spam). */
    sortCategory?: string | null,
  ) => void
  applyBulkAutosortLocalPendingReview: (
    ids: string[],
    sortCategory: string,
    pendingReviewAt?: string | null,
  ) => void
  applyBulkAutosortLocalArchive: (ids: string[]) => void
  cancelDeletion: (id: string) => Promise<void>
  setCategory: (ids: string[], category: string) => Promise<void>
  syncAccount: (accountId: string) => Promise<void>
  /** Pull the next batch of older messages (Smart Sync). */
  pullMoreAccount: (accountId: string) => Promise<void>
  patchAccountSyncPreferences: (
    accountId: string,
    partial: { syncWindowDays?: number; maxMessagesPerPull?: number },
  ) => Promise<boolean>
  /** Pull for each account (sequential IPC); one UI refresh at the end. */
  syncAllAccounts: (accountIds: string[]) => Promise<void>
  /** Enable/disable background pull for every eligible account (not just the default row). */
  toggleAutoSyncForActiveAccounts: (
    enabled: boolean,
    accountIds: string[],
    primaryAccountId: string | null,
  ) => Promise<void>
  /** Single-account IPC (legacy); prefer `toggleAutoSyncForActiveAccounts` from Inbox UI. */
  toggleAutoSync: (accountId: string, enabled: boolean) => Promise<void>
  /** Load sync window from `primaryAccountId` only. */
  loadSyncState: (accountId: string) => Promise<void>
  /** Auto checkbox = all `syncTargetIds` have auto_sync on; window prefs from primary. */
  refreshInboxSyncBackendState: (opts: {
    syncTargetIds: string[]
    primaryAccountId: string | null
  }) => Promise<void>
  setAnalysisCache: (messageId: string, result: NormalInboxAiResult) => void
  clearAnalysisCache: () => void
  /** Pass `{ toggle: true }` so a second call with the same id clears selection (bulk draft chrome). Omit or false = always select that id. */
  setEditingDraftForMessageId: (id: string | null, options?: { toggle?: boolean }) => void
  setSubFocus: (focus: SubFocus) => void
  setSortingActive: (active: boolean) => void
  triggerAnalysisRestart: () => void
}

function pullStatsLine(
  ps: { listed: number; new: number; skippedDupes: number; errors: number },
  suffix?: string,
): string {
  return `Pull: ${ps.listed} fetched, ${ps.new} new, ${ps.skippedDupes} skipped, ${ps.errors} errors${suffix ?? ''}`
}

// =============================================================================
// Helpers
// =============================================================================

function getBridge() {
  return typeof window !== 'undefined' ? window.emailInbox : undefined
}

/** All connected row ids to include on Pull (active first; excludes disabled/error when possible). */
export function activeEmailAccountIdsForSync(
  accounts: Array<{ id: string; status?: string; processingPaused?: boolean }>,
): string[] {
  if (!accounts.length) return []
  const eligible = accounts.filter((a) => a.processingPaused !== true)
  if (!eligible.length) return []
  const active = eligible.filter((a) => a.status === 'active')
  if (active.length) return [...new Set(active.map((a) => a.id))]
  const rest = eligible.filter((a) => a.status !== 'error' && a.status !== 'disabled')
  if (rest.length) return [...new Set(rest.map((a) => a.id))]
  /** Do not Pull accounts that are all in error/disabled — avoids hammering bad IMAP creds. */
  return []
}

/**
 * Chunk size for paginated inbox list / listMessageIds drains.
 * Loops until a short page is returned — total row count is not capped at this value.
 */
const INBOX_LIST_PAGE_SIZE = 500

/** Bulk inbox UI: rows per page (server LIMIT). */
const BULK_UI_PAGE_SIZE = 50

/** `inbox:listMessages` / `listMessageIds` — matches `EmailInboxBridge` (preload passes through to main). */
type ListMessagesBridgeOptions = {
  filter: string
  sourceType?: string
  messageKind?: 'handshake' | 'depackaged'
  handshakeId?: string
  category?: string
  search?: string
}

function listBridgeOptionsFromFilter(filter: InboxFilter): ListMessagesBridgeOptions {
  return {
    filter: filter.filter,
    sourceType: filter.sourceType === 'all' ? undefined : filter.sourceType,
    messageKind: filter.messageKind === 'all' ? undefined : filter.messageKind,
    handshakeId: filter.handshakeId,
    category: filter.category,
    search: filter.search,
  }
}

const DEFAULT_FILTER: InboxFilter = {
  filter: 'all',
  sourceType: 'all',
  messageKind: 'all',
}

/**
 * Client-side filter — must stay aligned with `buildInboxMessagesWhereClause` in electron `ipc.ts`
 * (same tab + sourceType / messageKind / handshakeId / category / search semantics).
 */
function filterByInboxFilter(messages: InboxMessage[], inboxFilter: InboxFilter): InboxMessage[] {
  const fk = inboxFilter.filter
  const q = inboxFilter.search?.trim()
  const qLower = q ? q.toLowerCase() : null

  return messages.filter((m) => {
    if (inboxFilter.sourceType !== 'all' && m.source_type !== inboxFilter.sourceType) return false
    if (!messageMatchesKindFilter(m, inboxFilter.messageKind)) return false
    if (inboxFilter.handshakeId && m.handshake_id !== inboxFilter.handshakeId) return false
    if (inboxFilter.category && m.sort_category !== inboxFilter.category) return false

    if (fk === 'deleted') {
      if (m.deleted !== 1) return false
    } else if (fk === 'pending_delete') {
      if (m.deleted === 1 || m.pending_delete !== 1) return false
    } else if (fk === 'pending_review') {
      if (m.deleted === 1 || m.archived === 1 || m.pending_delete === 1) return false
      const prAt = m.pending_review_at != null && String(m.pending_review_at).trim() !== ''
      const sc = m.sort_category
      if (sc !== 'pending_review' && sc !== 'important' && !prAt) return false
    } else if (fk === 'urgent') {
      if (m.deleted === 1 || m.archived === 1 || m.pending_delete === 1 || m.sort_category !== 'urgent')
        return false
    } else if (fk === 'unread') {
      if (m.deleted === 1 || m.archived === 1 || m.read_status !== 0) return false
      if (m.pending_delete === 1) return false
      if (
        m.sort_category === 'pending_review' ||
        m.sort_category === 'urgent' ||
        m.sort_category === 'important' ||
        (m.pending_review_at != null && String(m.pending_review_at).trim() !== '')
      ) {
        return false
      }
    } else if (fk === 'starred') {
      if (m.deleted === 1 || m.archived === 1 || m.starred !== 1) return false
      if (m.pending_delete === 1) return false
      if (
        m.sort_category === 'pending_review' ||
        m.sort_category === 'urgent' ||
        m.sort_category === 'important' ||
        (m.pending_review_at != null && String(m.pending_review_at).trim() !== '')
      ) {
        return false
      }
    } else if (fk === 'archived') {
      if (m.archived !== 1 || m.deleted === 1) return false
    } else {
      /* all — main inbox (aligned with buildInboxMessagesWhereClause filter=all) */
      if (m.deleted === 1) return false
      if (m.archived === 1) return false
      if (m.pending_delete === 1) return false
      if (
        m.sort_category === 'pending_review' ||
        m.sort_category === 'urgent' ||
        m.sort_category === 'important' ||
        (m.pending_review_at != null && String(m.pending_review_at).trim() !== '')
      ) {
        return false
      }
    }

    if (qLower) {
      const hay = `${m.subject ?? ''}\n${m.body_text ?? ''}\n${m.from_address ?? ''}\n${m.from_name ?? ''}`.toLowerCase()
      if (!hay.includes(qLower)) return false
    }
    return true
  })
}

type EmailInboxSet = (
  partial:
    | EmailInboxState
    | Partial<EmailInboxState>
    | ((state: EmailInboxState) => EmailInboxState | Partial<EmailInboxState>),
  replace?: boolean | undefined,
) => void

/**
 * Local Zustand update only — DB must already match (bulk classify or post successful IPC).
 * When `sortCategory` is set (bulk classify), row is aligned with `classifySingleMessage` columns.
 */
function commitPendingDeleteToLocalState(
  set: EmailInboxSet,
  ids: string[],
  pendingDeleteAt?: string | null,
  sortCategory?: string | null,
): void {
  if (!ids.length) return
  const now = pendingDeleteAt ?? new Date().toISOString()
  const idSet = new Set(ids)
  set((s) => {
    if (s.bulkMode) {
      void fetchBulkTabCountsServer(s.filter).then((tc) => {
        const fk = s.filter.filter as keyof typeof tc
        set({ tabCounts: tc, total: tc[fk] ?? 0 })
      })
      const messages = s.messages
        .map((m) => {
          if (!idSet.has(m.id)) return m
          if (sortCategory != null && sortCategory !== '') {
            return {
              ...m,
              pending_delete: 1,
              pending_delete_at: now,
              pending_review_at: null,
              archived: 0,
              sort_category: sortCategory,
            }
          }
          return { ...m, pending_delete: 1, pending_delete_at: now }
        })
        .filter((m) => filterByInboxFilter([m], s.filter).length > 0)
      const removedInView = s.messages.length - messages.length
      return {
        allMessages: [],
        messages,
        total: Math.max(0, s.total - removedInView),
        multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
        selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
        selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
      }
    }
    return {
      messages: s.messages.filter((m) => !idSet.has(m.id)),
      total: Math.max(0, s.total - ids.length),
      multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
      selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
      selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
    }
  })
}

function commitPendingReviewToLocalState(
  set: EmailInboxSet,
  ids: string[],
  sortCategory: string,
  pendingReviewAt?: string | null,
  /** When true, match classifySingleMessage pending-review row (clears pending_delete, archived). */
  alignWithClassify?: boolean,
): void {
  if (!ids.length) return
  const idSet = new Set(ids)
  set((s) => {
    if (s.bulkMode) {
      void fetchBulkTabCountsServer(s.filter).then((tc) => {
        const fk = s.filter.filter as keyof typeof tc
        set({ tabCounts: tc, total: tc[fk] ?? 0 })
      })
      const messages = s.messages
        .map((m) => {
          if (!idSet.has(m.id)) return m
          if (alignWithClassify) {
            return {
              ...m,
              sort_category: sortCategory,
              pending_review_at: pendingReviewAt ?? null,
              pending_delete: 0,
              pending_delete_at: null,
              archived: 0,
            }
          }
          return { ...m, sort_category: sortCategory }
        })
        .filter((m) => filterByInboxFilter([m], s.filter).length > 0)
      const removedInView = s.messages.length - messages.length
      return {
        allMessages: [],
        messages,
        total: Math.max(0, s.total - removedInView),
        multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
        selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
        selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
      }
    }
    return {
      messages: s.messages.filter((m) => !idSet.has(m.id)),
      total: Math.max(0, s.total - ids.length),
      multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
      selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
      selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
    }
  })
}

function commitArchiveToLocalState(set: EmailInboxSet, ids: string[]): void {
  if (!ids.length) return
  const idSet = new Set(ids)
  set((s) => {
    const removedInView = s.messages.filter((m) => idSet.has(m.id)).length
    if (s.bulkMode) {
      void fetchBulkTabCountsServer(s.filter).then((tc) => {
        const fk = s.filter.filter as keyof typeof tc
        set({ tabCounts: tc, total: tc[fk] ?? 0 })
      })
    }
    return {
      allMessages: [],
      messages: s.messages.filter((m) => !idSet.has(m.id)),
      total: s.bulkMode ? Math.max(0, s.total - removedInView) : Math.max(0, s.total - ids.length),
      multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
      selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
      selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
    }
  })
}

/** Derive tab counts for bulk toolbar labels (same list scope as `inboxFilter`). */
export function deriveTabCounts(allMessages: InboxMessage[], baseFilter: InboxFilter): InboxTabCounts {
  const filters: Array<keyof InboxTabCounts> = ['all', 'urgent', 'pending_delete', 'pending_review', 'archived']
  const out: InboxTabCounts = { ...EMPTY_INBOX_TAB_COUNTS }
  for (const f of filters) {
    out[f] = filterByInboxFilter(allMessages, { ...baseFilter, filter: f }).length
  }
  return out
}

/**
 * Fast per-tab totals: one `listMessages` call per workflow tab with `limit: 1` (server `total` = SQL COUNT).
 * Shared by Bulk (`loadBulkInboxSnapshotPaginated` / `fetchAllMessages`) and Normal (`loadPagedListSnapshot` / `fetchMessages`).
 */
async function fetchBulkTabCountsServer(baseFilter: InboxFilter): Promise<InboxTabCounts> {
  const bridge = getBridge()
  if (!bridge?.listMessages) return { ...EMPTY_INBOX_TAB_COUNTS }
  const filters: Array<keyof InboxTabCounts> = ['all', 'urgent', 'pending_delete', 'pending_review', 'archived']
  const out: Record<string, number> = {}
  try {
    for (const f of filters) {
      const res = await bridge.listMessages({
        ...listBridgeOptionsFromFilter({ ...baseFilter, filter: f }),
        limit: 1,
        offset: 0,
      })
      if (!res?.ok || !res?.data) {
        out[f] = 0
        continue
      }
      out[f] = typeof res.data.total === 'number' ? res.data.total : 0
    }
  } catch {
    return normalizeInboxTabCounts(out)
  }
  return normalizeInboxTabCounts(out)
}

/** Bulk inbox: first page only + tab counts (no full-tab drain). */
async function loadBulkInboxSnapshotPaginated(get: () => EmailInboxState): Promise<{
  allMessages: InboxMessage[]
  tabCounts: InboxTabCounts
  messages: InboxMessage[]
  total: number
  bulkAiOutputs: AiOutputs
  analysisCache: Record<string, NormalInboxAiResult>
  bulkHasMore: boolean
} | null> {
  const bridge = getBridge()
  if (!bridge?.listMessages) return null
  try {
    const filter = get().filter
    const tabCounts = await fetchBulkTabCountsServer(filter)
    const res = await bridge.listMessages({
      ...listBridgeOptionsFromFilter(filter),
      limit: BULK_UI_PAGE_SIZE,
      offset: 0,
    })
    if (!res?.ok || !res?.data) return null
    const list = (res.data.messages ?? []) as InboxMessage[]
    const total = typeof res.data.total === 'number' ? res.data.total : list.length
    const bulkHasMore = list.length < total
    const currentIds = new Set(list.map((m) => m.id))
    const state = get()
    const nextBulk: AiOutputs = {}
    for (const [id, entry] of Object.entries(state.bulkAiOutputs)) {
      if (currentIds.has(id)) nextBulk[id] = entry
    }
    const analysisCache = Object.fromEntries(
      Object.entries(state.analysisCache).filter(([id]) => currentIds.has(id)),
    )
    return {
      allMessages: [],
      tabCounts,
      messages: list,
      total,
      bulkAiOutputs: nextBulk,
      analysisCache,
      bulkHasMore,
    }
  } catch {
    return null
  }
}

/**
 * Normal Inbox: first page (50 rows) + `tabCounts` in one round-trip pair with the Bulk path
 * (`fetchBulkTabCountsServer` + `listMessages`). `fetchMessages` applies this snapshot — no separate mount-only count fetch.
 */
async function loadPagedListSnapshot(get: () => EmailInboxState): Promise<{
  messages: InboxMessage[]
  total: number
  analysisCache: Record<string, NormalInboxAiResult>
  tabCounts: InboxTabCounts
} | null> {
  const bridge = getBridge()
  if (!bridge?.listMessages) return null
  try {
    if (get().bulkMode) return null
    const { filter } = get()
    const [tabCounts, res] = await Promise.all([
      fetchBulkTabCountsServer(filter),
      bridge.listMessages({
        ...listBridgeOptionsFromFilter(filter),
        limit: BULK_UI_PAGE_SIZE,
        offset: 0,
      }),
    ])
    if (!res.ok || !res.data) return null
    const newMessages = (res.data.messages ?? []) as InboxMessage[]
    const currentIds = new Set(newMessages.map((m) => m.id))
    const state = get()
    const analysisCache = Object.fromEntries(
      Object.entries(state.analysisCache).filter(([id]) => currentIds.has(id)),
    )
    return {
      messages: newMessages,
      total: res.data.total ?? 0,
      analysisCache,
      tabCounts,
    }
  } catch {
    return null
  }
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useEmailInboxStore = create<EmailInboxState>((set, get) => ({
  allMessages: [],
  tabCounts: { ...EMPTY_INBOX_TAB_COUNTS },
  messages: [],
  total: 0,
  loading: false,
  bulkHasMore: false,
  bulkLoadingMore: false,
  bulkBackgroundRefresh: false,
  error: null,
  selectedMessageId: null,
  selectedMessage: null,
  selectedAttachmentId: null,
  multiSelectIds: new Set(),
  filter: DEFAULT_FILTER,
  bulkMode: false,
  bulkPage: 0,
  bulkAiOutputs: {},
  bulkCompactMode: (() => {
    try {
      return localStorage?.getItem('wrdesk_bulkCompactMode') === '1'
    } catch {
      return false
    }
  })(),
  bulkBatchSize: (() => {
    try {
      const s = localStorage?.getItem('wrdesk_bulkBatchSize')
      if (s === 'all') return 'all' as const
      const n = s ? parseInt(s, 10) : 10
      return [10, 12, 24, 48].includes(n) ? n : 10
    } catch {
      return 10
    }
  })(),
  autoSyncEnabled: false,
  accountSyncWindowDays: 30,
  syncing: false,
  pendingInboxRefreshAfterSyncEvent: false,
  lastSyncAt: null,
  lastSyncWarnings: null,
  analysisCache: {},
  editingDraftForMessageId: null,
  subFocus: { kind: 'none' },
  isSortingActive: false,
  analysisRestartCounter: 0,
  remoteSyncLog: [],
  bulkDraftManualComposeIds: new Set<string>(),

  addRemoteSyncLog: (entry) => {
    const ts = new Date().toLocaleTimeString()
    set((s) => ({
      remoteSyncLog: [`[${ts}] ${entry}`, ...s.remoteSyncLog].slice(0, 50),
    }))
  },
  clearRemoteSyncLog: () => set({ remoteSyncLog: [] }),
  clearLastSyncWarnings: () => set({ lastSyncWarnings: null }),

  markPendingInboxRefreshAfterSyncEvent: () => set({ pendingInboxRefreshAfterSyncEvent: true }),

  addBulkDraftManualCompose: (messageId) =>
    set((s) => {
      const next = new Set(s.bulkDraftManualComposeIds)
      next.add(messageId)
      return { bulkDraftManualComposeIds: next }
    }),

  removeBulkDraftManualCompose: (messageId) =>
    set((s) => {
      const next = new Set(s.bulkDraftManualComposeIds)
      next.delete(messageId)
      return { bulkDraftManualComposeIds: next }
    }),

  clearBulkDraftManualComposeForIds: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((s) => {
      const next = new Set(s.bulkDraftManualComposeIds)
      for (const id of idSet) next.delete(id)
      return { bulkDraftManualComposeIds: next }
    })
  },

  setEditingDraftForMessageId: (id, options) =>
    set((s) => {
      if (id === null) {
        return {
          editingDraftForMessageId: null,
          subFocus: { kind: 'none' },
        }
      }
      const useToggle = options?.toggle === true
      const nextId = useToggle && s.editingDraftForMessageId === id ? null : id
      const subFocus: SubFocus = nextId ? { kind: 'draft', messageId: nextId } : { kind: 'none' }
      return {
        editingDraftForMessageId: nextId,
        subFocus,
        ...(nextId ? { selectedAttachmentId: null } : {}),
      }
    }),
  setSubFocus: (focus) =>
    set((s) => ({
      subFocus: focus,
      selectedAttachmentId: focus.kind === 'attachment' ? focus.attachmentId : null,
      editingDraftForMessageId: focus.kind === 'draft' ? focus.messageId : null,
    })),
  setSortingActive: (active) => set({ isSortingActive: active }),
  triggerAnalysisRestart: () => set((s) => ({ analysisRestartCounter: s.analysisRestartCounter + 1 })),

  fetchMessages: async () => {
    const bridge = getBridge()
    if (!bridge?.listMessages) {
      set({ error: 'Email inbox bridge not available' })
      return
    }
    if (get().bulkMode) {
      await get().fetchAllMessages()
      return
    }
    set({ loading: true, error: null })
    try {
      const snapshot = await loadPagedListSnapshot(get)
      if (snapshot) {
        set({
          messages: snapshot.messages,
          total: snapshot.total,
          tabCounts: snapshot.tabCounts, // workflow tabs: loadPagedListSnapshot → fetchBulkTabCountsServer (same as Bulk)
          loading: false,
          error: null,
          analysisCache: snapshot.analysisCache,
        })
      } else {
        set({
          loading: false,
          error: 'Failed to fetch messages',
        })
      }
    } catch (err: unknown) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch messages',
      })
    }
  },

  fetchAllMessages: async (options?: { soft?: boolean }) => {
    if (!get().bulkMode) return
    const soft = options?.soft === true
    const bridge = getBridge()
    if (!bridge?.listMessages) {
      set({ error: 'Email inbox bridge not available' })
      return
    }
    if (soft) {
      set({ bulkBackgroundRefresh: true, error: null })
    } else {
      set({ loading: true, error: null, bulkLoadingMore: false })
    }
    try {
      const snapshot = await loadBulkInboxSnapshotPaginated(get)
      if (snapshot) {
        set({
          ...snapshot,
          bulkPage: 0,
          loading: false,
          bulkBackgroundRefresh: false,
          bulkLoadingMore: false,
          error: null,
        })
      } else {
        set({
          loading: false,
          bulkBackgroundRefresh: false,
          bulkLoadingMore: false,
          error: 'Failed to fetch messages',
        })
      }
    } catch (err: unknown) {
      set({
        loading: false,
        bulkBackgroundRefresh: false,
        bulkLoadingMore: false,
        error: err instanceof Error ? err.message : 'Failed to fetch messages',
      })
    }
  },

  loadMoreBulkMessages: async () => {
    const bridge = getBridge()
    if (!bridge?.listMessages) return
    const { bulkMode, filter, messages, bulkLoadingMore, total } = get()
    if (!bulkMode || bulkLoadingMore) return
    if (messages.length >= total) return
    set({ bulkLoadingMore: true, error: null })
    try {
      const offset = messages.length
      const res = await bridge.listMessages({
        ...listBridgeOptionsFromFilter(filter),
        limit: BULK_UI_PAGE_SIZE,
        offset,
      })
      if (!res?.ok || !res?.data) {
        set({ bulkLoadingMore: false })
        return
      }
      const chunk = (res.data.messages ?? []) as InboxMessage[]
      const serverTotal = typeof res.data.total === 'number' ? res.data.total : total
      const seen = new Set(messages.map((m) => m.id))
      const appended = chunk.filter((m) => !seen.has(m.id))
      const nextMessages = [...messages, ...appended]
      const nextIds = new Set(nextMessages.map((m) => m.id))
      set((s) => {
        const nextBulk: AiOutputs = { ...s.bulkAiOutputs }
        for (const id of Object.keys(nextBulk)) {
          if (!nextIds.has(id)) delete nextBulk[id]
        }
        const analysisCache = Object.fromEntries(
          Object.entries(s.analysisCache).filter(([id]) => nextIds.has(id)),
        )
        return {
          messages: nextMessages,
          total: serverTotal,
          bulkHasMore: nextMessages.length < serverTotal && chunk.length === BULK_UI_PAGE_SIZE,
          bulkLoadingMore: false,
          bulkAiOutputs: nextBulk,
          analysisCache,
        }
      })
    } catch {
      set({ bulkLoadingMore: false })
    }
  },

  fetchMatchingIdsForCurrentFilter: async () => {
    const bridge = getBridge()
    if (!bridge?.listMessageIds) return []
    const { filter } = get()
    const baseOpts = listBridgeOptionsFromFilter(filter)
    const ids: string[] = []
    let offset = 0
    for (;;) {
      const res = await bridge.listMessageIds({
        ...baseOpts,
        limit: INBOX_LIST_PAGE_SIZE,
        offset,
      })
      if (!res.ok || !res.data) break
      const chunk = res.data.ids ?? []
      ids.push(...chunk)
      if (chunk.length < INBOX_LIST_PAGE_SIZE) break
      offset += INBOX_LIST_PAGE_SIZE
    }
    return ids
  },

  selectAllMatchingCurrentFilter: async () => {
    const { bulkMode, bulkBatchSize } = get()
    /** “All” batch: refresh union cache first so tab totals / selection match a full paginated drain. */
    if (bulkMode && bulkBatchSize === 'all') {
      await get().fetchAllMessages({ soft: true })
    }
    const ids = await get().fetchMatchingIdsForCurrentFilter()
    set({ multiSelectIds: new Set([...new Set(ids)]) })
  },

  refreshMessages: async () => {
    const { bulkMode } = get()
    if (bulkMode) await get().fetchAllMessages({ soft: true })
    else await get().fetchMessages()
  },

  selectMessage: async (id) => {
    if (!id) {
      set({ selectedMessageId: null, selectedMessage: null, selectedAttachmentId: null, subFocus: { kind: 'none' } })
      return
    }
    const bridge = getBridge()
    if (!bridge?.getMessage) {
      set({ selectedMessageId: id, selectedMessage: null, subFocus: { kind: 'none' } })
      return
    }
    set({ selectedAttachmentId: null, subFocus: { kind: 'none' } })
    try {
      const res = await bridge.getMessage(id)
      if (res.ok && res.data) {
        const msg = res.data as InboxMessage
        set({ selectedMessageId: id, selectedMessage: msg })
        set((state) => {
          const idx = state.messages.findIndex((m) => m.id === id)
          if (idx < 0 || state.messages[idx].read_status === 1) return {}
          const next = [...state.messages]
          next[idx] = { ...next[idx], read_status: 1 }
          return { messages: next }
        })
      } else {
        set({ selectedMessageId: id, selectedMessage: null })
      }
    } catch {
      set({ selectedMessageId: id, selectedMessage: null })
    }
  },

  selectAttachment: (messageId, attachmentId) => {
    if (!attachmentId) {
      set({ selectedAttachmentId: null, subFocus: { kind: 'none' } })
      return
    }
    set({ selectedAttachmentId: attachmentId, subFocus: { kind: 'attachment', messageId, attachmentId } })
  },

  mergeMessageAttachments: (messageId, attachments) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, attachments } : m)),
      selectedMessage:
        s.selectedMessage?.id === messageId ? { ...s.selectedMessage, attachments } : s.selectedMessage,
    }))
  },

  toggleMultiSelect: (id) => {
    set((state) => {
      const next = new Set(state.multiSelectIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { multiSelectIds: next }
    })
  },

  clearMultiSelect: () => {
    set({ multiSelectIds: new Set() })
  },

  setFilter: (partial) => {
    const prev = get().filter
    const newFilter = { ...prev, ...partial }
    newFilter.filter = coerceInboxWorkflowFilter(newFilter.filter)
    newFilter.messageKind = coerceInboxMessageKindFilter(newFilter.messageKind)
    const listScopeChanged =
      (partial.search !== undefined && partial.search !== prev.search) ||
      (partial.sourceType !== undefined && partial.sourceType !== prev.sourceType) ||
      (partial.messageKind !== undefined && partial.messageKind !== prev.messageKind) ||
      (partial.handshakeId !== undefined && partial.handshakeId !== prev.handshakeId) ||
      (partial.category !== undefined && partial.category !== prev.category)

    set({
      filter: newFilter,
      bulkPage: 0,
      multiSelectIds: new Set(),
    })
    if (!get().bulkMode) {
      void get().fetchMessages()
      return
    }
    /** Tab / scope change: reset to first page (server-paginated). */
    void get().fetchAllMessages({ soft: listScopeChanged || partial.filter !== undefined })
  },

  setBulkMode: (enabled) => {
    set({
      bulkMode: enabled,
      bulkPage: 0,
    })
    if (!enabled) get().fetchMessages()
  },

  setBulkPage: (page) => {
    const { bulkMode } = get()
    if (bulkMode) {
      set({ bulkPage: page })
      return
    }
    set({ bulkPage: page })
    if (page === 0) void get().refreshMessages()
    else void get().fetchMessages()
  },

  setBulkBatchSize: (size) => {
    if (size !== 'all' && ![10, 12, 24, 48].includes(size)) return
    try {
      localStorage?.setItem('wrdesk_bulkBatchSize', String(size))
      if (size !== 'all') {
        const bridge = getBridge()
        if (bridge?.setInboxSettings) bridge.setInboxSettings({ batchSize: size })
      }
    } catch {
      /* ignore */
    }
    const { bulkMode } = get()
    if (bulkMode && size === 'all') {
      set({ bulkBatchSize: 'all', bulkPage: 0 })
      void get().fetchAllMessages()
      return
    }
    if (bulkMode) {
      set({ bulkBatchSize: size, bulkPage: 0 })
      void get().fetchAllMessages()
      return
    }
    set({ bulkBatchSize: size, bulkPage: 0 })
    get().refreshMessages()
  },

  setBulkCompactMode: (enabled) => {
    set({ bulkCompactMode: enabled })
    try {
      localStorage?.setItem('wrdesk_bulkCompactMode', enabled ? '1' : '0')
    } catch {
      /* ignore */
    }
  },

  setBulkAiOutputs: (updater) => {
    set((state) => ({ bulkAiOutputs: updater(state.bulkAiOutputs) }))
  },

  clearBulkAiOutputsForIds: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const next = { ...state.bulkAiOutputs }
      const nextCompose = new Set(state.bulkDraftManualComposeIds)
      for (const id of idSet) {
        delete next[id]
        nextCompose.delete(id)
      }
      return { bulkAiOutputs: next, bulkDraftManualComposeIds: nextCompose }
    })
  },

  clearPendingDeleteStateForIds: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const nextOutputs = { ...state.bulkAiOutputs }
      for (const id of idSet) {
        /* FIX-H3: Delete bulkAiOutputs entirely so color coding resets (no residual category) */
        delete nextOutputs[id]
      }
      const resetMsg = (m: InboxMessage) =>
        idSet.has(m.id)
          ? { ...m, pending_delete: 0, pending_delete_at: null, sort_category: null, sort_reason: null, ai_analysis_json: null }
          : m
      const messages = state.messages.map(resetMsg)
      if (state.bulkMode) {
        void fetchBulkTabCountsServer(state.filter).then((tc) => {
          const fk = state.filter.filter as keyof typeof tc
          set({ tabCounts: tc, total: tc[fk] ?? 0 })
        })
      }
      const nextSelected =
        state.selectedMessage && idSet.has(state.selectedMessage.id)
          ? resetMsg(state.selectedMessage)
          : state.selectedMessage
      return {
        allMessages: [],
        bulkAiOutputs: nextOutputs,
        messages,
        total: state.total,
        selectedMessage: nextSelected,
      }
    })
  },

  syncBulkBatchSizeFromSettings: async () => {
    const { bulkBatchSize } = get()
    if (bulkBatchSize === 'all') return // preserve user's "All" choice
    const bridge = getBridge()
    if (!bridge?.getInboxSettings) return
    try {
      const res = await bridge.getInboxSettings()
      if (res?.ok && res?.data?.batchSize != null) {
        const n = res.data.batchSize
        if ([10, 12, 24, 48].includes(n)) {
          set({ bulkBatchSize: n })
          try {
            localStorage?.setItem('wrdesk_bulkBatchSize', String(n))
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  },

  markRead: async (ids, read) => {
    const bridge = getBridge()
    if (!bridge?.markRead) return
    const res = await bridge.markRead(ids, read)
    if (res.ok) {
      set((state) => ({
        messages: state.messages.map((m) =>
          ids.includes(m.id) ? { ...m, read_status: read ? 1 : 0 } : m
        ),
        selectedMessage:
          state.selectedMessage && ids.includes(state.selectedMessage.id)
            ? { ...state.selectedMessage, read_status: read ? 1 : 0 }
            : state.selectedMessage,
      }))
    }
  },

  toggleStar: async (id) => {
    const bridge = getBridge()
    if (!bridge?.toggleStar) return
    const res = await bridge.toggleStar(id)
    if (res.ok && res.data?.starred !== undefined) {
      const starred = res.data.starred ? 1 : 0
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, starred } : m
        ),
        selectedMessage:
          state.selectedMessage?.id === id
            ? { ...state.selectedMessage, starred }
            : state.selectedMessage,
      }))
    }
  },

  archiveMessages: async (ids) => {
    const bridge = getBridge()
    if (!bridge?.archiveMessages || ids.length === 0) return false
    const res = await bridge.archiveMessages(ids)
    if (!res.ok) {
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        autosortDiagLog('archiveMessages:fail', {
          messageIds: ids,
          runId: getAutosortDiagRunId(),
          ipcResult: res,
          dbUnavailable: res.error === 'Database unavailable',
        })
      }
      return false
    }
    commitArchiveToLocalState(set, ids)
    return true
  },

  deleteMessages: async (ids, gracePeriodHours) => {
    const bridge = getBridge()
    if (!bridge?.deleteMessages) return
    const res = await bridge.deleteMessages(ids, gracePeriodHours)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(ids)
      const now = new Date().toISOString()
      const idSet = new Set(ids)
      set((s) => {
        const updatedMsg = (m: InboxMessage) =>
          idSet.has(m.id) ? { ...m, deleted: 1, deleted_at: now, purge_after: null } : m
        const selectedWasDeleted = s.selectedMessage && ids.includes(s.selectedMessage.id)
        if (s.bulkMode) {
          const removedInView = s.messages.filter((m) => idSet.has(m.id)).length
          void fetchBulkTabCountsServer(s.filter).then((tc) => {
            const fk = s.filter.filter as keyof typeof tc
            set({ tabCounts: tc, total: tc[fk] ?? 0 })
          })
          return {
            allMessages: [],
            messages: s.messages.filter((m) => !idSet.has(m.id)),
            total: Math.max(0, s.total - removedInView),
            multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
            selectedMessageId: s.selectedMessageId,
            selectedMessage: selectedWasDeleted ? updatedMsg(s.selectedMessage!) : s.selectedMessage,
          }
        }
        return {
          messages: s.messages.map(updatedMsg),
          total: s.total,
          multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
          selectedMessageId: s.selectedMessageId,
          selectedMessage: selectedWasDeleted ? updatedMsg(s.selectedMessage!) : s.selectedMessage,
        }
      })
    }
  },

  markPendingDeleteImmediate: async (ids) => {
    const bridge = getBridge()
    if (!bridge?.markPendingDelete || ids.length === 0) return false
    const res = await bridge.markPendingDelete(ids)
    if (!res.ok) {
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        autosortDiagLog('markPendingDeleteImmediate:fail', {
          messageIds: ids,
          runId: getAutosortDiagRunId(),
          ipcResult: res,
          dbUnavailable: res.error === 'Database unavailable',
        })
      }
      return false
    }
    commitPendingDeleteToLocalState(set, ids)
    return true
  },

  moveToPendingReviewImmediate: async (ids) => {
    const bridge = getBridge()
    if (!bridge?.moveToPendingReview || ids.length === 0) return false
    const res = await bridge.moveToPendingReview(ids)
    if (!res.ok) {
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        autosortDiagLog('moveToPendingReviewImmediate:fail', {
          messageIds: ids,
          runId: getAutosortDiagRunId(),
          ipcResult: res,
          dbUnavailable: res.error === 'Database unavailable',
        })
      }
      return false
    }
    commitPendingReviewToLocalState(set, ids, 'pending_review', undefined, false)
    return true
  },

  applyBulkAutosortLocalPendingDelete: (ids, pendingDeleteAt, sortCategory) =>
    commitPendingDeleteToLocalState(set, ids, pendingDeleteAt, sortCategory),

  applyBulkAutosortLocalPendingReview: (ids, sortCategory, pendingReviewAt) =>
    commitPendingReviewToLocalState(set, ids, sortCategory, pendingReviewAt, true),

  applyBulkAutosortLocalArchive: (ids) => commitArchiveToLocalState(set, ids),

  cancelDeletion: async (id) => {
    const bridge = getBridge()
    if (!bridge?.cancelDeletion) return
    const res = await bridge.cancelDeletion(id)
    if (res.ok && res.data?.cancelled) {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, deleted: 0, deleted_at: null, purge_after: null } : m
        ),
        selectedMessage:
          state.selectedMessage?.id === id
            ? { ...state.selectedMessage, deleted: 0, deleted_at: null, purge_after: null }
            : state.selectedMessage,
      }))
      get().refreshMessages()
    }
  },

  setCategory: async (ids, category) => {
    const bridge = getBridge()
    if (!bridge?.setCategory) return
    const res = await bridge.setCategory(ids, category)
    if (res.ok) {
      set((state) => ({
        messages: state.messages.map((m) =>
          ids.includes(m.id) ? { ...m, sort_category: category || null } : m
        ),
        selectedMessage:
          state.selectedMessage && ids.includes(state.selectedMessage.id)
            ? { ...state.selectedMessage, sort_category: category || null }
            : state.selectedMessage,
      }))
    }
  },

  syncAccount: async (accountId) => {
    const bridge = getBridge()
    if (!bridge?.syncAccount) {
      console.log('[PULL] store.syncAccount skipped reason=no_bridge')
      return
    }
    if (get().syncing) {
      console.log('[PULL] store.syncAccount skipped reason=already_syncing account=', accountId)
      set({ lastSyncWarnings: ['Sync already in progress'] })
      return
    }
    console.log('[PULL] store.syncAccount invoking inbox:syncAccount for account=', accountId)
    const lastSyncAt = new Date().toISOString()
    set({ syncing: true, error: null, lastSyncWarnings: null })
    try {
      const res = await bridge.syncAccount(accountId)
      const syncWarnings = res.syncWarnings
      const warnList = syncWarnings?.length ? syncWarnings : null
      const pull = res as {
        pullStats?: { listed: number; new: number; skippedDupes: number; errors: number }
        ok: boolean
        error?: string
      }
      if (pull.pullStats) {
        get().addRemoteSyncLog(
          pullStatsLine(pull.pullStats, pull.ok ? '' : ` — ${pull.error ?? 'failed'}`),
        )
      }
      const pullHint = (pull as { pullHint?: string }).pullHint
      if (typeof pullHint === 'string' && pullHint.trim()) {
        get().addRemoteSyncLog(pullHint.trim())
      }

      if (!res.ok) {
        const failWarnings = res.syncWarnings?.length
          ? res.syncWarnings.map((w: string) => `[${accountId}] ${w}`)
          : [`[${accountId}] ${res.error ?? 'Sync failed'}`]
        set({
          syncing: false,
          bulkBackgroundRefresh: false,
          loading: false,
          error: null,
          lastSyncWarnings: failWarnings,
        })
        return
      }

      const bulkMode = get().bulkMode
      if (bulkMode) {
        const snapshot = await loadBulkInboxSnapshotPaginated(get)
        if (snapshot) {
          set({
            ...snapshot,
            bulkPage: 0,
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            bulkLoadingMore: false,
            error: null,
            lastSyncWarnings: warnList,
          })
        } else {
          set({
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            bulkLoadingMore: false,
            error: 'Failed to refresh inbox after sync',
            lastSyncWarnings: warnList,
          })
        }
      } else {
        const snapshot = await loadPagedListSnapshot(get)
        if (snapshot) {
          set({
            messages: snapshot.messages,
            total: snapshot.total,
            analysisCache: snapshot.analysisCache,
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            error: null,
            lastSyncWarnings: warnList,
          })
        } else {
          set({
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            error: 'Failed to refresh inbox after sync',
            lastSyncWarnings: warnList,
          })
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      set({
        syncing: false,
        bulkBackgroundRefresh: false,
        loading: false,
        bulkLoadingMore: false,
        error: null,
        lastSyncWarnings: [`[${accountId}] ${msg}`],
      })
    }
  },

  pullMoreAccount: async (accountId) => {
    const bridge = getBridge()
    if (!bridge?.pullMoreAccount) {
      console.log('[PULL] store.pullMoreAccount skipped reason=no_bridge')
      return
    }
    if (get().syncing) {
      set({ lastSyncWarnings: ['Sync already in progress'] })
      return
    }
    const lastSyncAt = new Date().toISOString()
    set({ syncing: true, error: null, lastSyncWarnings: null })
    try {
      const res = await bridge.pullMoreAccount(accountId)
      const syncWarnings = res.syncWarnings
      const warnList = syncWarnings?.length ? syncWarnings : null
      const pull = res as {
        pullStats?: { listed: number; new: number; skippedDupes: number; errors: number }
        ok: boolean
        error?: string
      }
      if (pull.pullStats) {
        get().addRemoteSyncLog(
          `Pull More: ${pullStatsLine(pull.pullStats, pull.ok ? '' : ` — ${pull.error ?? 'failed'}`)}`,
        )
      }
      const pullHint = (pull as { pullHint?: string }).pullHint
      if (typeof pullHint === 'string' && pullHint.trim()) {
        get().addRemoteSyncLog(pullHint.trim())
      }

      if (!res.ok) {
        const failWarnings = res.syncWarnings?.length
          ? res.syncWarnings.map((w: string) => `[${accountId}] ${w}`)
          : [`[${accountId}] ${res.error ?? 'Pull More failed'}`]
        set({
          syncing: false,
          bulkBackgroundRefresh: false,
          loading: false,
          error: null,
          lastSyncWarnings: failWarnings,
        })
        return
      }

      const bulkMode = get().bulkMode
      if (bulkMode) {
        const snapshot = await loadBulkInboxSnapshotPaginated(get)
        if (snapshot) {
          set({
            ...snapshot,
            bulkPage: 0,
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            bulkLoadingMore: false,
            error: null,
            lastSyncWarnings: warnList,
          })
        } else {
          set({
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            bulkLoadingMore: false,
            error: 'Failed to refresh inbox after Pull More',
            lastSyncWarnings: warnList,
          })
        }
      } else {
        const snapshot = await loadPagedListSnapshot(get)
        if (snapshot) {
          set({
            messages: snapshot.messages,
            total: snapshot.total,
            analysisCache: snapshot.analysisCache,
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            error: null,
            lastSyncWarnings: warnList,
          })
        } else {
          set({
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            error: 'Failed to refresh inbox after Pull More',
            lastSyncWarnings: warnList,
          })
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Pull More failed'
      set({
        syncing: false,
        bulkBackgroundRefresh: false,
        loading: false,
        bulkLoadingMore: false,
        error: null,
        lastSyncWarnings: [`[${accountId}] ${msg}`],
      })
    }
  },

  patchAccountSyncPreferences: async (accountId, partial) => {
    const bridge = getBridge()
    if (!bridge?.patchAccountSyncPreferences) return false
    try {
      const res = await bridge.patchAccountSyncPreferences(accountId, partial)
      if (res.ok && typeof partial.syncWindowDays === 'number') {
        set({ accountSyncWindowDays: partial.syncWindowDays })
      }
      await get().loadSyncState(accountId)
      return !!res.ok
    } catch {
      return false
    }
  },

  syncAllAccounts: async (accountIds) => {
    const bridge = getBridge()
    if (!bridge?.syncAccount || accountIds.length === 0) {
      console.log(
        '[PULL] store.syncAllAccounts skipped reason=',
        !bridge?.syncAccount ? 'no_bridge' : 'empty_accounts',
      )
      return
    }
    if (get().syncing) {
      console.log('[PULL] store.syncAllAccounts skipped reason=already_syncing')
      set({ lastSyncWarnings: ['Sync already in progress'] })
      return
    }
    console.log(
      '[PULL] store.syncAllAccounts invoking inbox:syncAccount count=',
      accountIds.length,
      'ids=',
      accountIds.join(','),
    )
    const lastSyncAt = new Date().toISOString()
    set({ syncing: true, error: null, lastSyncWarnings: null })
    const warnings: string[] = []
    let okCount = 0
    try {
      for (const accountId of accountIds) {
        try {
          const res = (await bridge.syncAccount(accountId)) as {
            ok: boolean
            error?: string
            syncWarnings?: string[]
            pullStats?: { listed: number; new: number; skippedDupes: number; errors: number }
            pullHint?: string
          }
          if (res.pullStats) {
            const label = accountId.length > 10 ? `${accountId.slice(0, 8)}…` : accountId
            get().addRemoteSyncLog(
              `[${label}] ${pullStatsLine(res.pullStats, res.ok ? '' : ` — ${res.error ?? 'fail'}`)}`,
            )
          }
          if (typeof res.pullHint === 'string' && res.pullHint.trim()) {
            get().addRemoteSyncLog(res.pullHint.trim())
          }
          if (res.ok) okCount++
          if (res.syncWarnings?.length) {
            warnings.push(...res.syncWarnings.map((w: string) => `[${accountId}] ${w}`))
          }
          if (!res.ok) {
            warnings.push(`[${accountId}] ${res.error ?? 'Sync failed'}`)
          }
        } catch (accountErr: unknown) {
          const msg =
            accountErr instanceof Error ? accountErr.message : String(accountErr ?? 'Sync crashed')
          warnings.push(`[${accountId}] ${msg}`)
        }
      }

      const errorOut =
        okCount === 0 ? (warnings.join(' · ') || 'All accounts failed to sync') : null
      const warnList = okCount > 0 && warnings.length > 0 ? warnings : null

      const bulkMode = get().bulkMode
      if (errorOut) {
        set({
          syncing: false,
          bulkBackgroundRefresh: false,
          loading: false,
          error: null,
          lastSyncWarnings: warnings.length ? warnings : [`[__unscoped__] ${errorOut}`],
        })
        return
      }

      if (bulkMode) {
        const snapshot = await loadBulkInboxSnapshotPaginated(get)
        if (snapshot) {
          set({
            ...snapshot,
            bulkPage: 0,
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            bulkLoadingMore: false,
            error: null,
            lastSyncWarnings: warnList,
          })
        } else {
          set({
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            bulkLoadingMore: false,
            error: 'Failed to refresh inbox after sync',
            lastSyncWarnings: warnList,
          })
        }
      } else {
        const snapshot = await loadPagedListSnapshot(get)
        if (snapshot) {
          set({
            messages: snapshot.messages,
            total: snapshot.total,
            analysisCache: snapshot.analysisCache,
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            error: null,
            lastSyncWarnings: warnList,
          })
        } else {
          set({
            syncing: false,
            lastSyncAt,
            bulkBackgroundRefresh: false,
            loading: false,
            error: 'Failed to refresh inbox after sync',
            lastSyncWarnings: warnList,
          })
        }
      }
    } catch (err: unknown) {
      set({
        syncing: false,
        bulkBackgroundRefresh: false,
        loading: false,
        bulkLoadingMore: false,
        error: err instanceof Error ? err.message : 'Sync failed',
        lastSyncWarnings: null,
      })
    }
  },

  toggleAutoSyncForActiveAccounts: async (enabled, accountIds, primaryAccountId) => {
    const bridge = getBridge()
    if (!bridge?.toggleAutoSync || accountIds.length === 0) return
    for (const id of accountIds) {
      await bridge.toggleAutoSync(id, enabled)
    }
    await get().refreshInboxSyncBackendState({ syncTargetIds: accountIds, primaryAccountId })
  },

  toggleAutoSync: async (accountId, enabled) => {
    const bridge = getBridge()
    if (!bridge?.toggleAutoSync) return
    const res = await bridge.toggleAutoSync(accountId, enabled)
    if (res.ok) {
      set({ autoSyncEnabled: enabled })
    }
  },

  refreshInboxSyncBackendState: async ({ syncTargetIds, primaryAccountId }) => {
    const bridge = getBridge()
    if (!bridge?.getSyncState) return
    try {
      let allOn = syncTargetIds.length > 0
      for (const id of syncTargetIds) {
        const res = await bridge.getSyncState(id)
        const row =
          res.ok && res.data
            ? (res.data as { auto_sync_enabled?: number; syncPreferences?: { syncWindowDays?: number } })
            : null
        if (!row || row.auto_sync_enabled !== 1) allOn = false
      }
      let days: number | undefined
      if (primaryAccountId) {
        const res = await bridge.getSyncState(primaryAccountId)
        if (res.ok && res.data) {
          const sp = (res.data as { syncPreferences?: { syncWindowDays?: number } }).syncPreferences
          if (typeof sp?.syncWindowDays === 'number') days = sp.syncWindowDays
        }
      }
      set({
        autoSyncEnabled: syncTargetIds.length > 0 && allOn,
        ...(typeof days === 'number' ? { accountSyncWindowDays: days } : {}),
      })
    } catch {
      /* ignore */
    }
  },

  loadSyncState: async (accountId) => {
    const bridge = getBridge()
    if (!bridge?.getSyncState) return
    try {
      const res = await bridge.getSyncState(accountId)
      if (!res.ok || !res.data) return
      const row = res.data as { syncPreferences?: { syncWindowDays?: number } }
      const days = row.syncPreferences?.syncWindowDays
      if (typeof days === 'number') set({ accountSyncWindowDays: days })
    } catch {
      /* ignore */
    }
  },

  setAnalysisCache: (messageId, result) =>
    set((state) => ({
      analysisCache: { ...state.analysisCache, [messageId]: result },
    })),

  clearAnalysisCache: () => set({ analysisCache: {} }),
}))
