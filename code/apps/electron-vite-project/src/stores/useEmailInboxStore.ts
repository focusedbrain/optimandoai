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
  handshakeId?: string
  category?: string
  search?: string
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
  /** Single source of truth: all messages from all filters. Bulk view derives display from this. */
  allMessages: InboxMessage[]
  /** Tab counts for filter labels. Derived from allMessages. */
  tabCounts: Record<string, number>
  messages: InboxMessage[]
  total: number
  loading: boolean
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
  /** Account sync window (days); 0 = all mail. Loaded with `loadSyncState`. */
  accountSyncWindowDays: number
  syncing: boolean
  lastSyncAt: string | null
  /** Non-fatal sync issues from last Pull (partial failures). Cleared on next Pull start. */
  lastSyncWarnings: string[] | null
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
  /** Load inbox rows for all WR Desk bulk tabs (all / urgent / pending_delete / pending_review / archived) with paginated drain — no row cap. */
  fetchAllMessages: (options?: { soft?: boolean }) => Promise<void>
  /** All IDs matching the active filter (paginated drain). Same semantics as inbox tabs; ignores batch/page UI. */
  fetchMatchingIdsForCurrentFilter: () => Promise<string[]>
  /** Set multiSelectIds to every ID matching the current filter (for toolbar “select all” in batch mode “All”). */
  selectAllMatchingCurrentFilter: () => Promise<void>
  /** Refresh: fetchAllMessages in bulk mode, else fetchMessages. Use after mutations. */
  refreshMessages: () => Promise<void>
  selectMessage: (id: string | null) => Promise<void>
  selectAttachment: (messageId: string, attachmentId: string | null) => void
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
  toggleAutoSync: (accountId: string, enabled: boolean) => Promise<void>
  /** Load autoSyncEnabled from backend for the given account. Call when Inbox view mounts. */
  loadSyncState: (accountId: string) => Promise<void>
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
  accounts: Array<{ id: string; status?: string }>,
): string[] {
  if (!accounts.length) return []
  const active = accounts.filter((a) => a.status === 'active')
  if (active.length) return [...new Set(active.map((a) => a.id))]
  const rest = accounts.filter((a) => a.status !== 'error' && a.status !== 'disabled')
  if (rest.length) return [...new Set(rest.map((a) => a.id))]
  /** Do not Pull accounts that are all in error/disabled — avoids hammering bad IMAP creds. */
  return []
}

/**
 * Chunk size for paginated inbox list / listMessageIds drains.
 * Loops until a short page is returned — total row count is not capped at this value.
 */
const INBOX_LIST_PAGE_SIZE = 500

function listBridgeOptionsFromFilter(filter: InboxFilter): {
  filter: string
  sourceType?: string
  handshakeId?: string
  category?: string
  search?: string
} {
  return {
    filter: filter.filter,
    sourceType: filter.sourceType === 'all' ? undefined : filter.sourceType,
    handshakeId: filter.handshakeId,
    category: filter.category,
    search: filter.search,
  }
}

const DEFAULT_FILTER: InboxFilter = {
  filter: 'all',
  sourceType: 'all',
}

/**
 * Client-side filter — must stay aligned with `buildInboxMessagesWhereClause` in electron `ipc.ts`
 * (same tab + sourceType / handshakeId / category / search semantics).
 */
function filterByInboxFilter(messages: InboxMessage[], inboxFilter: InboxFilter): InboxMessage[] {
  const fk = inboxFilter.filter
  const q = inboxFilter.search?.trim()
  const qLower = q ? q.toLowerCase() : null

  return messages.filter((m) => {
    if (inboxFilter.sourceType !== 'all' && m.source_type !== inboxFilter.sourceType) return false
    if (inboxFilter.handshakeId && m.handshake_id !== inboxFilter.handshakeId) return false
    if (inboxFilter.category && m.sort_category !== inboxFilter.category) return false

    if (fk === 'deleted') {
      if (m.deleted !== 1) return false
    } else if (fk === 'pending_delete') {
      if (m.deleted === 1 || m.pending_delete !== 1) return false
    } else if (fk === 'pending_review') {
      if (m.deleted === 1 || m.archived === 1 || m.sort_category !== 'pending_review') return false
    } else if (fk === 'urgent') {
      if (m.deleted === 1 || m.archived === 1 || m.pending_delete === 1 || m.sort_category !== 'urgent') return false
    } else if (fk === 'unread') {
      if (m.deleted === 1 || m.archived === 1 || m.read_status !== 0) return false
      if (m.pending_delete === 1) return false
      if (m.sort_category === 'pending_review' || m.sort_category === 'urgent') return false
    } else if (fk === 'starred') {
      if (m.deleted === 1 || m.archived === 1 || m.starred !== 1) return false
      if (m.pending_delete === 1) return false
      if (m.sort_category === 'pending_review' || m.sort_category === 'urgent') return false
    } else if (fk === 'archived') {
      if (m.archived !== 1 || m.deleted === 1) return false
    } else {
      /* all — main inbox */
      if (m.deleted === 1) return false
      if (m.archived === 1) return false
      if (m.pending_delete === 1) return false
      if (m.sort_category === 'pending_review' || m.sort_category === 'urgent') return false
    }

    if (qLower) {
      const hay = `${m.subject ?? ''}\n${m.body_text ?? ''}\n${m.from_address ?? ''}\n${m.from_name ?? ''}`.toLowerCase()
      if (!hay.includes(qLower)) return false
    }
    return true
  })
}

/** Derive messages and total from allMessages + filter + pagination. */
function deriveDisplayFromAll(
  allMessages: InboxMessage[],
  inboxFilter: InboxFilter,
  bulkPage: number,
  bulkBatchSize: number | 'all'
): { messages: InboxMessage[]; total: number } {
  const filtered = filterByInboxFilter(allMessages, inboxFilter)
  const total = filtered.length
  const limit = bulkBatchSize === 'all' ? filtered.length : bulkBatchSize
  const offset = bulkBatchSize === 'all' ? 0 : bulkPage * limit
  const messages = filtered.slice(offset, offset + limit)
  return { messages, total }
}

/** Derive tab counts for bulk toolbar labels (same list scope as `inboxFilter`). */
export function deriveTabCounts(allMessages: InboxMessage[], baseFilter: InboxFilter): Record<string, number> {
  const filters: Array<'all' | 'urgent' | 'pending_delete' | 'pending_review' | 'archived'> = [
    'all',
    'urgent',
    'pending_delete',
    'pending_review',
    'archived',
  ]
  const out: Record<string, number> = {}
  for (const f of filters) {
    out[f] = filterByInboxFilter(allMessages, { ...baseFilter, filter: f }).length
  }
  return out
}

/** Bulk inbox: union of all tab scopes (paginated drain per tab). No React state updates. */
async function loadBulkInboxSnapshot(get: () => EmailInboxState): Promise<{
  allMessages: InboxMessage[]
  tabCounts: Record<string, number>
  messages: InboxMessage[]
  total: number
  bulkAiOutputs: AiOutputs
  analysisCache: Record<string, NormalInboxAiResult>
} | null> {
  const bridge = getBridge()
  if (!bridge?.listMessages) return null
  const filters: Array<'all' | 'urgent' | 'pending_delete' | 'pending_review' | 'archived'> = [
    'all',
    'urgent',
    'pending_delete',
    'pending_review',
    'archived',
  ]
  try {
    const snapshot = get().filter
    const byId = new Map<string, InboxMessage>()
    for (const f of filters) {
      const listOpts = listBridgeOptionsFromFilter({ ...snapshot, filter: f })
      let offset = 0
      for (;;) {
        const res = await bridge.listMessages({
          ...listOpts,
          limit: INBOX_LIST_PAGE_SIZE,
          offset,
        })
        if (!res?.ok || !res?.data) break
        const list = (res.data.messages ?? []) as InboxMessage[]
        for (const m of list) byId.set(m.id, m)
        if (list.length < INBOX_LIST_PAGE_SIZE) break
        offset += INBOX_LIST_PAGE_SIZE
      }
    }
    const allMessages = Array.from(byId.values())
    const { filter, bulkPage, bulkBatchSize } = get()
    const { messages, total } = deriveDisplayFromAll(allMessages, filter, bulkPage, bulkBatchSize)
    const currentIds = new Set(allMessages.map((m) => m.id))
    const state = get()
    const nextBulk: AiOutputs = {}
    for (const [id, entry] of Object.entries(state.bulkAiOutputs)) {
      if (currentIds.has(id)) nextBulk[id] = entry
    }
    const analysisCache = Object.fromEntries(
      Object.entries(state.analysisCache).filter(([id]) => currentIds.has(id)),
    )
    return {
      allMessages,
      tabCounts: deriveTabCounts(allMessages, filter),
      messages,
      total,
      bulkAiOutputs: nextBulk,
      analysisCache,
    }
  } catch {
    return null
  }
}

/** Standard / bulk paged list: single listMessages call. No React state updates. */
async function loadPagedListSnapshot(get: () => EmailInboxState): Promise<{
  messages: InboxMessage[]
  total: number
  analysisCache: Record<string, NormalInboxAiResult>
} | null> {
  const bridge = getBridge()
  if (!bridge?.listMessages) return null
  try {
    const { filter, bulkMode, bulkPage, bulkBatchSize } = get()
    if (bulkMode && bulkBatchSize === 'all') return null
    const options: Parameters<typeof bridge.listMessages>[0] = {
      ...listBridgeOptionsFromFilter(filter),
    }
    if (bulkMode) {
      options.limit = bulkBatchSize as number
      options.offset = bulkPage * (bulkBatchSize as number)
    } else {
      options.limit = 50
      options.offset = 0
    }
    const res = await bridge.listMessages(options)
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
  tabCounts: {},
  messages: [],
  total: 0,
  loading: false,
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
    set({ loading: true, error: null })
    try {
      const { bulkMode, bulkBatchSize } = get()
      if (bulkMode && bulkBatchSize === 'all') {
        await get().fetchAllMessages({ soft: true })
        return
      }
      const snapshot = await loadPagedListSnapshot(get)
      if (snapshot) {
        set({
          messages: snapshot.messages,
          total: snapshot.total,
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
    const soft = options?.soft === true
    const bridge = getBridge()
    if (!bridge?.listMessages) {
      set({ error: 'Email inbox bridge not available' })
      return
    }
    if (soft) {
      set({ bulkBackgroundRefresh: true, error: null })
    } else {
      set({ loading: true, error: null })
    }
    try {
      const snapshot = await loadBulkInboxSnapshot(get)
      if (snapshot) {
        set({
          ...snapshot,
          loading: false,
          bulkBackgroundRefresh: false,
          error: null,
        })
      } else {
        set({
          loading: false,
          bulkBackgroundRefresh: false,
          error: 'Failed to fetch messages',
        })
      }
    } catch (err: unknown) {
      set({
        loading: false,
        bulkBackgroundRefresh: false,
        error: err instanceof Error ? err.message : 'Failed to fetch messages',
      })
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
          if (state.bulkMode && state.allMessages.length > 0) {
            const nextAll = state.allMessages.map((m) =>
              m.id === id ? { ...m, read_status: 1 } : m
            )
            const { messages, total } = deriveDisplayFromAll(nextAll, state.filter, state.bulkPage, state.bulkBatchSize)
            return {
              allMessages: nextAll,
              tabCounts: deriveTabCounts(nextAll, state.filter),
              messages,
              total,
            }
          }
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
    const listScopeChanged =
      (partial.search !== undefined && partial.search !== prev.search) ||
      (partial.sourceType !== undefined && partial.sourceType !== prev.sourceType) ||
      (partial.handshakeId !== undefined && partial.handshakeId !== prev.handshakeId) ||
      (partial.category !== undefined && partial.category !== prev.category)

    set((state) => {
      if (state.bulkMode && state.allMessages.length > 0 && !listScopeChanged) {
        const { messages, total } = deriveDisplayFromAll(
          state.allMessages,
          newFilter,
          state.bulkPage,
          state.bulkBatchSize
        )
        return {
          filter: newFilter,
          messages,
          total,
          tabCounts: deriveTabCounts(state.allMessages, newFilter),
        }
      }
      return { filter: newFilter }
    })

    const s = get()
    if (!s.bulkMode) {
      get().fetchMessages()
      return
    }
    if (s.allMessages.length === 0 || listScopeChanged) {
      void get().fetchAllMessages({ soft: true })
    }
  },

  setBulkMode: (enabled) => {
    set({
      bulkMode: enabled,
      bulkPage: 0,
    })
    if (!enabled) get().fetchMessages()
  },

  setBulkPage: (page) => {
    const { bulkMode, allMessages, filter, bulkBatchSize } = get()
    if (bulkMode && allMessages.length > 0) {
      const { messages, total } = deriveDisplayFromAll(allMessages, filter, page, bulkBatchSize)
      set({ bulkPage: page, messages, total })
    } else {
      set({ bulkPage: page })
      if (page === 0) get().refreshMessages()
      else get().fetchMessages()
    }
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
    const { bulkMode, allMessages, filter } = get()
    if (bulkMode && size === 'all') {
      set({ bulkBatchSize: 'all', bulkPage: 0 })
      void get().fetchAllMessages()
      return
    }
    if (bulkMode && allMessages.length > 0) {
      const { messages, total } = deriveDisplayFromAll(allMessages, filter, 0, size)
      set({ bulkBatchSize: size, bulkPage: 0, messages, total })
    } else {
      set({ bulkBatchSize: size, bulkPage: 0 })
      get().refreshMessages()
    }
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
      const nextAll = state.allMessages.map(resetMsg)
      const { messages, total } = state.bulkMode && nextAll.length > 0
        ? deriveDisplayFromAll(nextAll, state.filter, state.bulkPage, state.bulkBatchSize)
        : { messages: state.messages.map(resetMsg), total: state.total }
      const nextSelected =
        state.selectedMessage && idSet.has(state.selectedMessage.id)
          ? resetMsg(state.selectedMessage)
          : state.selectedMessage
      return {
        allMessages: nextAll,
        tabCounts: state.bulkMode ? deriveTabCounts(nextAll, state.filter) : state.tabCounts,
        bulkAiOutputs: nextOutputs,
        messages,
        total,
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
    if (!res.ok) return false
    /** Keep bulkAiOutputs through this tick so Auto-Sort can show classification before row leaves; refresh reconciles. */
    const idSet = new Set(ids)
    set((s) => {
      const nextAll = s.allMessages.map((m) =>
        idSet.has(m.id) ? { ...m, archived: 1 } : m
      )
      const { messages, total } = s.bulkMode && nextAll.length > 0
        ? deriveDisplayFromAll(nextAll, s.filter, s.bulkPage, s.bulkBatchSize)
        : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - ids.length) }
      return {
        allMessages: nextAll,
        tabCounts: s.bulkMode ? deriveTabCounts(nextAll, s.filter) : s.tabCounts,
        messages,
        total,
        multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
        selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
        selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
      }
    })
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
        const nextAll = s.allMessages.map(updatedMsg)
        const { messages, total } = s.bulkMode && nextAll.length > 0
          ? deriveDisplayFromAll(nextAll, s.filter, s.bulkPage, s.bulkBatchSize)
          : { messages: s.messages.map(updatedMsg), total: s.total }
        const selectedWasDeleted = s.selectedMessage && ids.includes(s.selectedMessage.id)
        return {
          allMessages: nextAll,
          tabCounts: s.bulkMode ? deriveTabCounts(nextAll, s.filter) : s.tabCounts,
          messages,
          total,
          multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
          selectedMessageId: s.selectedMessageId,
          selectedMessage: selectedWasDeleted ? updatedMsg(s.selectedMessage) : s.selectedMessage,
        }
      })
    }
  },

  markPendingDeleteImmediate: async (ids) => {
    const bridge = getBridge()
    if (!bridge?.markPendingDelete || ids.length === 0) return false
    const res = await bridge.markPendingDelete(ids)
    if (!res.ok) return false
    /** Do not clear bulk AI here — Bulk Auto-Sort paints classification first; fetch will align persisted rows. */
    const now = new Date().toISOString()
    const idSet = new Set(ids)
    set((s) => {
      const nextAll = s.allMessages.map((m) =>
        idSet.has(m.id) ? { ...m, pending_delete: 1, pending_delete_at: now } : m
      )
      const { messages, total } = s.bulkMode && nextAll.length > 0
        ? deriveDisplayFromAll(nextAll, s.filter, s.bulkPage, s.bulkBatchSize)
        : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - ids.length) }
      return {
        allMessages: nextAll,
        tabCounts: s.bulkMode ? deriveTabCounts(nextAll, s.filter) : s.tabCounts,
        messages,
        total,
        multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
        selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
        selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
      }
    })
    return true
  },

  moveToPendingReviewImmediate: async (ids) => {
    const bridge = getBridge()
    if (!bridge?.moveToPendingReview || ids.length === 0) return false
    const res = await bridge.moveToPendingReview(ids)
    if (!res.ok) return false
    /** Keep per-row bulk output for live Auto-Sort feedback until refresh. */
    const idSet = new Set(ids)
    set((s) => {
      const nextAll = s.allMessages.map((m) =>
        idSet.has(m.id) ? { ...m, sort_category: 'pending_review' } : m
      )
      const { messages, total } = s.bulkMode && nextAll.length > 0
        ? deriveDisplayFromAll(nextAll, s.filter, s.bulkPage, s.bulkBatchSize)
        : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - ids.length) }
      return {
        allMessages: nextAll,
        tabCounts: s.bulkMode ? deriveTabCounts(nextAll, s.filter) : s.tabCounts,
        messages,
        total,
        multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
        selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
        selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
      }
    })
    return true
  },

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
        set({
          syncing: false,
          bulkBackgroundRefresh: false,
          loading: false,
          error: res.error ?? 'Sync failed',
          lastSyncWarnings: null,
        })
        return
      }

      const bulkMode = get().bulkMode
      if (bulkMode) {
        const snapshot = await loadBulkInboxSnapshot(get)
        if (snapshot) {
          set({
            ...snapshot,
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
        error: err instanceof Error ? err.message : 'Sync failed',
        lastSyncWarnings: null,
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
        set({
          syncing: false,
          bulkBackgroundRefresh: false,
          loading: false,
          error: res.error ?? 'Pull More failed',
          lastSyncWarnings: null,
        })
        return
      }

      const bulkMode = get().bulkMode
      if (bulkMode) {
        const snapshot = await loadBulkInboxSnapshot(get)
        if (snapshot) {
          set({
            ...snapshot,
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
      set({
        syncing: false,
        bulkBackgroundRefresh: false,
        loading: false,
        error: err instanceof Error ? err.message : 'Pull More failed',
        lastSyncWarnings: null,
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
          error: errorOut,
          lastSyncWarnings: null,
        })
        return
      }

      if (bulkMode) {
        const snapshot = await loadBulkInboxSnapshot(get)
        if (snapshot) {
          set({
            ...snapshot,
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
        error: err instanceof Error ? err.message : 'Sync failed',
        lastSyncWarnings: null,
      })
    }
  },

  toggleAutoSync: async (accountId, enabled) => {
    const bridge = getBridge()
    if (!bridge?.toggleAutoSync) return
    const res = await bridge.toggleAutoSync(accountId, enabled)
    if (res.ok) {
      set({ autoSyncEnabled: enabled })
    }
  },

  loadSyncState: async (accountId) => {
    const bridge = getBridge()
    if (!bridge?.getSyncState) return
    try {
      const res = await bridge.getSyncState(accountId)
      if (!res.ok) return
      if (res.data) {
        const row = res.data as {
          auto_sync_enabled?: number
          syncPreferences?: { syncWindowDays?: number }
        }
        const days =
          typeof row.syncPreferences?.syncWindowDays === 'number'
            ? row.syncPreferences.syncWindowDays
            : undefined
        set({
          autoSyncEnabled: row.auto_sync_enabled === 1,
          ...(days !== undefined ? { accountSyncWindowDays: days } : {}),
        })
      } else {
        set({ autoSyncEnabled: false })
      }
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
