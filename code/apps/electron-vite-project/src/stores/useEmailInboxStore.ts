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
}

export interface InboxFilter {
  filter: 'all' | 'unread' | 'starred' | 'deleted' | 'archived' | 'pending_delete' | 'pending_review'
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
  /** messageId -> expiresAt ISO. Survives view switch. */
  pendingDeletePreviewExpiries: Record<string, string>
  /** messageId -> expiresAt ISO for archive grace. Survives view switch. */
  archivePreviewExpiries: Record<string, string>
  /** messageId -> expiresAt ISO for pending review grace. Survives view switch. */
  pendingReviewPreviewExpiries: Record<string, string>
  /** IDs user chose to keep during preview. Survives view switch. */
  keptDuringPreviewIds: Set<string>
  /** IDs user chose to keep during archive preview. Survives view switch. */
  keptDuringArchivePreviewIds: Set<string>
  /** IDs user chose to keep during pending review preview. Survives view switch. */
  keptDuringReviewPreviewIds: Set<string>
  /** Toast shown after move; Undo clears it. */
  pendingDeleteToast: { count: number; ids: string[] } | null
  /** Recent undoable batches (max 5) — supports recovery when multiple actions happen quickly. */
  recentPendingDeleteBatches: Array<{ count: number; ids: string[] }>
  /** Incremented every second when previews exist; drives live countdown. */
  countdownTick: number
  /** Session counters: reset when bulk mode exits. */
  bulkSessionArchived: number
  bulkSessionPendingDelete: number
  autoSyncEnabled: boolean
  syncing: boolean
  lastSyncAt: string | null
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
  /**
   * Bulk rows where the user manually regenerated draft — hide analysis/recommended chrome
   * so the draft editor uses the full pane until “Show analysis” or a new Auto-Sort.
   */
  bulkDraftManualComposeIds: Set<string>
  addBulkDraftManualCompose: (messageId: string) => void
  removeBulkDraftManualCompose: (messageId: string) => void
  clearBulkDraftManualComposeForIds: (ids: string[]) => void

  fetchMessages: () => Promise<void>
  /** Fetch all filter tabs in parallel — used by bulk view on mount for instant tab switching. */
  fetchAllMessages: () => Promise<void>
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
  addPendingDeletePreview: (ids: string[]) => void
  addArchivePreview: (ids: string[]) => void
  addPendingReviewPreview: (ids: string[]) => void
  keepDuringPreview: (id: string) => void
  keepDuringArchivePreview: (id: string) => void
  keepDuringReviewPreview: (id: string) => void
  setPendingDeleteToast: (toast: { count: number; ids: string[] } | null) => void
  /** Remove a batch from recent list after Undo. */
  removeRecentPendingDeleteBatch: (ids: string[]) => void
  /** Decrement session pending-delete count when Undo restores messages. */
  decrementBulkSessionPendingDelete: (count: number) => void
  /** Fully reset pending-delete state for ids after Undo. Clears preview, grace-period, and AI output flags. */
  clearPendingDeleteStateForIds: (ids: string[]) => void
  incrementCountdownTick: () => void
  processExpiredPendingDeletes: () => Promise<void>
  processExpiredArchivePreviews: () => Promise<void>
  processExpiredPendingReviewPreviews: () => Promise<void>
  markRead: (ids: string[], read: boolean) => Promise<void>
  toggleStar: (id: string) => Promise<void>
  archiveMessages: (ids: string[]) => Promise<void>
  deleteMessages: (ids: string[], gracePeriodHours?: number) => Promise<void>
  /** Move messages to Pending Delete (soft, 7-day grace). Use for AI-recommended pending_delete. */
  markPendingDeleteImmediate: (ids: string[]) => Promise<void>
  cancelDeletion: (id: string) => Promise<void>
  setCategory: (ids: string[], category: string) => Promise<void>
  syncAccount: (accountId: string) => Promise<void>
  toggleAutoSync: (accountId: string, enabled: boolean) => Promise<void>
  /** Load autoSyncEnabled from backend for the given account. Call when Inbox view mounts. */
  loadSyncState: (accountId: string) => Promise<void>
  setAnalysisCache: (messageId: string, result: NormalInboxAiResult) => void
  clearAnalysisCache: () => void
  setEditingDraftForMessageId: (id: string | null) => void
  setSubFocus: (focus: SubFocus) => void
  setSortingActive: (active: boolean) => void
  triggerAnalysisRestart: () => void
}

// =============================================================================
// Helpers
// =============================================================================

function getBridge() {
  return typeof window !== 'undefined' ? window.emailInbox : undefined
}

const DEFAULT_FILTER: InboxFilter = {
  filter: 'all',
  sourceType: 'all',
}

/** Filter messages by inbox filter. Used for single-source-of-truth display. */
function filterByInboxFilter(
  messages: InboxMessage[],
  filterKey: InboxFilter['filter']
): InboxMessage[] {
  return messages.filter((m) => {
    if (m.deleted === 1) return false
    if (filterKey === 'archived') return m.archived === 1
    if (filterKey === 'pending_delete') return m.pending_delete === 1
    if (filterKey === 'pending_review') return m.sort_category === 'pending_review'
    /* all: main inbox — exclude archived, pending_delete, pending_review */
    if (m.archived === 1) return false
    if (m.pending_delete === 1) return false
    if (m.sort_category === 'pending_review') return false
    return true
  })
}

/** Derive messages and total from allMessages + filter + pagination. */
function deriveDisplayFromAll(
  allMessages: InboxMessage[],
  filterKey: InboxFilter['filter'],
  bulkPage: number,
  bulkBatchSize: number | 'all'
): { messages: InboxMessage[]; total: number } {
  const filtered = filterByInboxFilter(allMessages, filterKey)
  const total = filtered.length
  const limit = bulkBatchSize === 'all' ? filtered.length : bulkBatchSize
  const offset = bulkBatchSize === 'all' ? 0 : bulkPage * limit
  const messages = filtered.slice(offset, offset + limit)
  return { messages, total }
}

/** Derive tab counts from allMessages for filter tab labels. */
function deriveTabCounts(allMessages: InboxMessage[]): Record<string, number> {
  const filters: Array<'all' | 'pending_delete' | 'pending_review' | 'archived'> = ['all', 'pending_delete', 'pending_review', 'archived']
  const out: Record<string, number> = {}
  for (const f of filters) {
    out[f] = filterByInboxFilter(allMessages, f).length
  }
  return out
}

/** Preview state for real-time count derivation (FIX-C5). */
export interface TabCountPreviewState {
  pendingDeletePreviewExpiries: Record<string, string>
  archivePreviewExpiries: Record<string, string>
  pendingReviewPreviewExpiries: Record<string, string>
  keptDuringPreviewIds: Set<string>
  keptDuringArchivePreviewIds: Set<string>
  keptDuringReviewPreviewIds: Set<string>
}

/**
 * Derive tab counts from allMessages + preview state. Messages in preview are counted
 * as already moved (real-time updates). Used by filter tab labels.
 */
export function deriveTabCountsWithPreview(
  allMessages: InboxMessage[],
  preview: TabCountPreviewState
): Record<string, number> {
  const counts = { all: 0, pending_delete: 0, pending_review: 0, archived: 0 }
  for (const m of allMessages) {
    if (m.deleted === 1) continue
    if (preview.pendingDeletePreviewExpiries[m.id] && !preview.keptDuringPreviewIds.has(m.id)) {
      counts.pending_delete++
    } else if (preview.archivePreviewExpiries[m.id] && !preview.keptDuringArchivePreviewIds.has(m.id)) {
      counts.archived++
    } else if (preview.pendingReviewPreviewExpiries[m.id] && !preview.keptDuringReviewPreviewIds.has(m.id)) {
      counts.pending_review++
    } else if (m.archived === 1) {
      counts.archived++
    } else if (m.pending_delete === 1) {
      counts.pending_delete++
    } else if (m.sort_category === 'pending_review') {
      counts.pending_review++
    } else {
      counts.all++
    }
  }
  return counts
}

// Auto-hide for pending-delete toast: 5 seconds
const PENDING_DELETE_TOAST_VISIBILITY_MS = 5000
const RECENT_PENDING_DELETE_MAX = 5

let pendingDeleteToastTimeoutId: ReturnType<typeof setTimeout> | null = null

// =============================================================================
// Store Implementation
// =============================================================================

export const useEmailInboxStore = create<EmailInboxState>((set, get) => ({
  allMessages: [],
  tabCounts: {},
  messages: [],
  total: 0,
  loading: false,
  error: null,
  selectedMessageId: null,
  selectedMessage: null,
  selectedAttachmentId: null,
  multiSelectIds: new Set(),
  filter: DEFAULT_FILTER,
  bulkMode: false,
  bulkPage: 0,
  bulkAiOutputs: {},
  pendingDeletePreviewExpiries: {},
  archivePreviewExpiries: {},
  pendingReviewPreviewExpiries: {},
  keptDuringPreviewIds: new Set(),
  keptDuringArchivePreviewIds: new Set(),
  keptDuringReviewPreviewIds: new Set(),
  pendingDeleteToast: null,
  recentPendingDeleteBatches: [],
  countdownTick: 0,
  bulkSessionArchived: 0,
  bulkSessionPendingDelete: 0,
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
  syncing: false,
  lastSyncAt: null,
  analysisCache: {},
  editingDraftForMessageId: null,
  subFocus: { kind: 'none' },
  isSortingActive: false,
  analysisRestartCounter: 0,
  bulkDraftManualComposeIds: new Set<string>(),

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

  setEditingDraftForMessageId: (id) =>
    set((s) => {
      const subFocus: SubFocus = id ? { kind: 'draft', messageId: id } : { kind: 'none' }
      return {
        editingDraftForMessageId: id,
        subFocus,
        ...(id ? { selectedAttachmentId: null } : {}),
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
      const { filter, bulkMode, bulkPage, bulkBatchSize, total } = get()
      const options: Parameters<typeof bridge.listMessages>[0] = {
        filter: filter.filter,
        sourceType: filter.sourceType === 'all' ? undefined : filter.sourceType,
        handshakeId: filter.handshakeId,
        category: filter.category,
        search: filter.search,
      }
      if (bulkMode) {
        const effectiveLimit = bulkBatchSize === 'all' ? Math.min(total || 500, 500) : bulkBatchSize
        options.limit = effectiveLimit
        options.offset = bulkBatchSize === 'all' ? 0 : bulkPage * bulkBatchSize
      } else {
        options.limit = 50
        options.offset = 0
      }
      const res = await bridge.listMessages(options)
      if (res.ok && res.data) {
        const newMessages = (res.data.messages ?? []) as InboxMessage[]
        const currentIds = new Set(newMessages.map((m) => m.id))
        set((state) => ({
          messages: newMessages,
          total: res.data.total ?? 0,
          loading: false,
          error: null,
          analysisCache: Object.fromEntries(
            Object.entries(state.analysisCache).filter(([id]) => currentIds.has(id))
          ),
        }))
      } else {
        set({
          loading: false,
          error: res.error ?? 'Failed to fetch messages',
        })
      }
    } catch (err: unknown) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch messages',
      })
    }
  },

  fetchAllMessages: async () => {
    const bridge = getBridge()
    if (!bridge?.listMessages) {
      set({ error: 'Email inbox bridge not available' })
      return
    }
    set({ loading: true, error: null })
    const filters: Array<'all' | 'pending_delete' | 'pending_review' | 'archived'> = ['all', 'pending_delete', 'pending_review', 'archived']
    const limit = 500
    try {
      const results = await Promise.all(
        filters.map((f) =>
          bridge!.listMessages({
            filter: f,
            limit,
            offset: 0,
          })
        )
      )
      const byId = new Map<string, InboxMessage>()
      filters.forEach((f, i) => {
        const res = results[i]
        if (res?.ok && res?.data) {
          const list = (res.data.messages ?? []) as InboxMessage[]
          for (const m of list) byId.set(m.id, m)
        }
      })
      const allMessages = Array.from(byId.values())
      const { filter, bulkPage, bulkBatchSize } = get()
      const { messages, total } = deriveDisplayFromAll(allMessages, filter.filter, bulkPage, bulkBatchSize)
      const currentIds = new Set(allMessages.map((m) => m.id))
      set((state) => ({
        allMessages,
        tabCounts: deriveTabCounts(allMessages),
        messages,
        total,
        loading: false,
        error: null,
        analysisCache: Object.fromEntries(
          Object.entries(state.analysisCache).filter(([id]) => currentIds.has(id))
        ),
      }))
    } catch (err: unknown) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch messages',
      })
    }
  },

  refreshMessages: async () => {
    const { bulkMode, messages } = get()
    console.log('[SORT] refreshMessages called. Current message count:', messages.length)
    if (bulkMode) await get().fetchAllMessages()
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
            const { messages, total } = deriveDisplayFromAll(nextAll, state.filter.filter, state.bulkPage, state.bulkBatchSize)
            return { allMessages: nextAll, tabCounts: state.tabCounts, messages, total }
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
    set((state) => {
      const newFilter = { ...state.filter, ...partial }
      if (state.bulkMode && state.allMessages.length > 0) {
        const { messages, total } = deriveDisplayFromAll(
          state.allMessages,
          newFilter.filter,
          state.bulkPage,
          state.bulkBatchSize
        )
        return { filter: newFilter, messages, total }
      }
      return { filter: newFilter }
    })
    const { bulkMode, allMessages, filter } = get()
    if (!bulkMode || allMessages.length === 0) {
      get().fetchMessages()
    }
  },

  setBulkMode: (enabled) => {
    set({
      bulkMode: enabled,
      bulkPage: 0,
      ...(enabled ? {} : { bulkSessionArchived: 0, bulkSessionPendingDelete: 0 }),
    })
    if (!enabled) get().fetchMessages()
  },

  setBulkPage: (page) => {
    const { bulkMode, allMessages, filter, bulkBatchSize } = get()
    if (bulkMode && allMessages.length > 0) {
      const { messages, total } = deriveDisplayFromAll(allMessages, filter.filter, page, bulkBatchSize)
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
    if (bulkMode && allMessages.length > 0) {
      const { messages, total } = deriveDisplayFromAll(allMessages, filter.filter, 0, size)
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

  addPendingDeletePreview: (ids) => {
    if (ids.length === 0) return
    const expiresAt = new Date(Date.now() + 5 * 1000).toISOString()
    set((state) => {
      const next = { ...state.pendingDeletePreviewExpiries }
      for (const id of ids) next[id] = expiresAt
      const kept = new Set(state.keptDuringPreviewIds)
      for (const id of ids) kept.delete(id)
      return { pendingDeletePreviewExpiries: next, keptDuringPreviewIds: kept }
    })
  },

  addArchivePreview: (ids) => {
    if (ids.length === 0) return
    const expiresAt = new Date(Date.now() + 5 * 1000).toISOString()
    set((state) => {
      const next = { ...state.archivePreviewExpiries }
      for (const id of ids) next[id] = expiresAt
      const kept = new Set(state.keptDuringArchivePreviewIds)
      for (const id of ids) kept.delete(id)
      return { archivePreviewExpiries: next, keptDuringArchivePreviewIds: kept }
    })
  },

  addPendingReviewPreview: (ids) => {
    if (ids.length === 0) return
    const expiresAt = new Date(Date.now() + 5 * 1000).toISOString()
    set((state) => {
      const next = { ...state.pendingReviewPreviewExpiries }
      for (const id of ids) next[id] = expiresAt
      const kept = new Set(state.keptDuringReviewPreviewIds)
      for (const id of ids) kept.delete(id)
      return { pendingReviewPreviewExpiries: next, keptDuringReviewPreviewIds: kept }
    })
  },

  keepDuringPreview: (id) => {
    set((state) => ({
      keptDuringPreviewIds: new Set([...state.keptDuringPreviewIds, id]),
    }))
  },

  keepDuringArchivePreview: (id) => {
    set((state) => ({
      keptDuringArchivePreviewIds: new Set([...state.keptDuringArchivePreviewIds, id]),
    }))
  },

  keepDuringReviewPreview: (id) => {
    set((state) => ({
      keptDuringReviewPreviewIds: new Set([...state.keptDuringReviewPreviewIds, id]),
    }))
  },

  setPendingDeleteToast: (toast) => {
    if (pendingDeleteToastTimeoutId) {
      clearTimeout(pendingDeleteToastTimeoutId)
      pendingDeleteToastTimeoutId = null
    }
    const state = get()
    if (state.pendingDeleteToast) {
      set((s) => ({
        recentPendingDeleteBatches: [
          ...s.recentPendingDeleteBatches,
          { count: state.pendingDeleteToast!.count, ids: state.pendingDeleteToast!.ids },
        ].slice(-RECENT_PENDING_DELETE_MAX),
      }))
    }
    set({ pendingDeleteToast: toast })
    if (toast) {
      pendingDeleteToastTimeoutId = setTimeout(() => {
        pendingDeleteToastTimeoutId = null
        const current = get().pendingDeleteToast
        if (current) {
          set((s) => ({
            pendingDeleteToast: null,
            recentPendingDeleteBatches: [
              ...s.recentPendingDeleteBatches,
              { count: current.count, ids: current.ids },
            ].slice(-RECENT_PENDING_DELETE_MAX),
          }))
        } else {
          set({ pendingDeleteToast: null })
        }
      }, PENDING_DELETE_TOAST_VISIBILITY_MS)
    }
  },

  removeRecentPendingDeleteBatch: (ids) => {
    const idSet = new Set(ids)
    set((s) => ({
      recentPendingDeleteBatches: s.recentPendingDeleteBatches.filter(
        (b) => !(b.ids.length === ids.length && b.ids.every((id) => idSet.has(id)))
      ),
    }))
  },

  decrementBulkSessionPendingDelete: (count) => {
    set((s) => ({ bulkSessionPendingDelete: Math.max(0, s.bulkSessionPendingDelete - count) }))
  },

  clearPendingDeleteStateForIds: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const nextExpiries = { ...state.pendingDeletePreviewExpiries }
      const nextArchiveExpiries = { ...state.archivePreviewExpiries }
      const nextKept = new Set(state.keptDuringPreviewIds)
      const nextArchiveKept = new Set(state.keptDuringArchivePreviewIds)
      const nextOutputs = { ...state.bulkAiOutputs }
      for (const id of idSet) {
        delete nextExpiries[id]
        delete nextArchiveExpiries[id]
        nextKept.delete(id)
        nextArchiveKept.delete(id)
        /* FIX-H3: Delete bulkAiOutputs entirely so color coding resets (no residual category) */
        delete nextOutputs[id]
      }
      const resetMsg = (m: InboxMessage) =>
        idSet.has(m.id)
          ? { ...m, pending_delete: 0, pending_delete_at: null, sort_category: null, sort_reason: null, ai_analysis_json: null }
          : m
      const nextAll = state.allMessages.map(resetMsg)
      const { messages, total } = state.bulkMode && nextAll.length > 0
        ? deriveDisplayFromAll(nextAll, state.filter.filter, state.bulkPage, state.bulkBatchSize)
        : { messages: state.messages.map(resetMsg), total: state.total }
      const nextSelected =
        state.selectedMessage && idSet.has(state.selectedMessage.id)
          ? resetMsg(state.selectedMessage)
          : state.selectedMessage
      return {
        allMessages: nextAll,
        tabCounts: state.bulkMode ? deriveTabCounts(nextAll) : state.tabCounts,
        pendingDeletePreviewExpiries: nextExpiries,
        archivePreviewExpiries: nextArchiveExpiries,
        keptDuringPreviewIds: nextKept,
        keptDuringArchivePreviewIds: nextArchiveKept,
        bulkAiOutputs: nextOutputs,
        messages,
        total,
        selectedMessage: nextSelected,
      }
    })
  },

  incrementCountdownTick: () => {
    set((s) => ({ countdownTick: s.countdownTick + 1 }))
  },

  processExpiredPendingDeletes: async () => {
    const bridge = getBridge()
    if (!bridge?.markPendingDelete) return
    const state = get()
    const now = Date.now()
    const expired: string[] = []
    for (const [id, expiresAt] of Object.entries(state.pendingDeletePreviewExpiries)) {
      if (new Date(expiresAt).getTime() <= now) expired.push(id)
    }
    if (expired.length === 0) return
    const idsToMove = expired.filter((id) => !state.keptDuringPreviewIds.has(id))
    set((s) => {
      const nextExpiries = { ...s.pendingDeletePreviewExpiries }
      const nextKept = new Set(s.keptDuringPreviewIds)
      for (const id of expired) {
        delete nextExpiries[id]
        nextKept.delete(id)
      }
      return { pendingDeletePreviewExpiries: nextExpiries, keptDuringPreviewIds: nextKept }
    })
    if (idsToMove.length === 0) return
    const res = await bridge.markPendingDelete(idsToMove)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(idsToMove)
      const now = new Date().toISOString()
      const idSet = new Set(idsToMove)
      set((s) => {
        const nextAll = s.allMessages.map((m) =>
          idSet.has(m.id) ? { ...m, pending_delete: 1, pending_delete_at: now } : m
        )
        const { messages, total } = s.bulkMode && nextAll.length > 0
          ? deriveDisplayFromAll(nextAll, s.filter.filter, s.bulkPage, s.bulkBatchSize)
          : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - idsToMove.length) }
        return {
          allMessages: nextAll,
          tabCounts: s.bulkMode ? deriveTabCounts(nextAll) : s.tabCounts,
          messages,
          total,
          multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !idsToMove.includes(x))),
          selectedMessageId: s.selectedMessageId && idsToMove.includes(s.selectedMessageId) ? null : s.selectedMessageId,
          selectedMessage: s.selectedMessage && idsToMove.includes(s.selectedMessage.id) ? null : s.selectedMessage,
          bulkSessionPendingDelete: s.bulkSessionPendingDelete + idsToMove.length,
        }
      })
      get().setPendingDeleteToast({ count: idsToMove.length, ids: idsToMove })
    }
  },

  processExpiredPendingReviewPreviews: async () => {
    const bridge = getBridge()
    if (!bridge?.moveToPendingReview) return
    const state = get()
    const now = Date.now()
    const expired: string[] = []
    for (const [id, expiresAt] of Object.entries(state.pendingReviewPreviewExpiries)) {
      if (new Date(expiresAt).getTime() <= now) expired.push(id)
    }
    if (expired.length === 0) return
    const idsToMove = expired.filter((id) => !state.keptDuringReviewPreviewIds.has(id))
    set((s) => {
      const nextExpiries = { ...s.pendingReviewPreviewExpiries }
      const nextKept = new Set(s.keptDuringReviewPreviewIds)
      for (const id of expired) {
        delete nextExpiries[id]
        nextKept.delete(id)
      }
      return { pendingReviewPreviewExpiries: nextExpiries, keptDuringReviewPreviewIds: nextKept }
    })
    if (idsToMove.length === 0) return
    const res = await bridge.moveToPendingReview(idsToMove)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(idsToMove)
      const idSet = new Set(idsToMove)
      set((s) => {
        const nextAll = s.allMessages.map((m) =>
          idSet.has(m.id) ? { ...m, sort_category: 'pending_review' } : m
        )
        const { messages, total } = s.bulkMode && nextAll.length > 0
          ? deriveDisplayFromAll(nextAll, s.filter.filter, s.bulkPage, s.bulkBatchSize)
          : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - idsToMove.length) }
        return {
          allMessages: nextAll,
          tabCounts: s.bulkMode ? deriveTabCounts(nextAll) : s.tabCounts,
          messages,
          total,
          multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !idsToMove.includes(x))),
          selectedMessageId: s.selectedMessageId && idsToMove.includes(s.selectedMessageId) ? null : s.selectedMessageId,
          selectedMessage: s.selectedMessage && idsToMove.includes(s.selectedMessage.id) ? null : s.selectedMessage,
        }
      })
    }
  },

  processExpiredArchivePreviews: async () => {
    const bridge = getBridge()
    if (!bridge?.archiveMessages) return
    const state = get()
    const now = Date.now()
    const expired: string[] = []
    for (const [id, expiresAt] of Object.entries(state.archivePreviewExpiries)) {
      if (new Date(expiresAt).getTime() <= now) expired.push(id)
    }
    if (expired.length === 0) return
    const idsToArchive = expired.filter((id) => !state.keptDuringArchivePreviewIds.has(id))
    set((s) => {
      const nextExpiries = { ...s.archivePreviewExpiries }
      const nextKept = new Set(s.keptDuringArchivePreviewIds)
      for (const id of expired) {
        delete nextExpiries[id]
        nextKept.delete(id)
      }
      return { archivePreviewExpiries: nextExpiries, keptDuringArchivePreviewIds: nextKept }
    })
    if (idsToArchive.length === 0) return
    const res = await bridge.archiveMessages(idsToArchive)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(idsToArchive)
      const idSet = new Set(idsToArchive)
      set((s) => {
        const nextAll = s.allMessages.map((m) =>
          idSet.has(m.id) ? { ...m, archived: 1 } : m
        )
        const { messages, total } = s.bulkMode && nextAll.length > 0
          ? deriveDisplayFromAll(nextAll, s.filter.filter, s.bulkPage, s.bulkBatchSize)
          : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - idsToArchive.length) }
        return {
          allMessages: nextAll,
          tabCounts: s.bulkMode ? deriveTabCounts(nextAll) : s.tabCounts,
          messages,
          total,
          multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !idsToArchive.includes(x))),
          selectedMessageId: s.selectedMessageId && idsToArchive.includes(s.selectedMessageId) ? null : s.selectedMessageId,
          selectedMessage: s.selectedMessage && idsToArchive.includes(s.selectedMessage.id) ? null : s.selectedMessage,
          bulkSessionArchived: s.bulkSessionArchived + idsToArchive.length,
        }
      })
    }
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
    if (!bridge?.archiveMessages) return
    const res = await bridge.archiveMessages(ids)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(ids)
      const idSet = new Set(ids)
      set((s) => {
        const nextAll = s.allMessages.map((m) =>
          idSet.has(m.id) ? { ...m, archived: 1 } : m
        )
        const { messages, total } = s.bulkMode && nextAll.length > 0
          ? deriveDisplayFromAll(nextAll, s.filter.filter, s.bulkPage, s.bulkBatchSize)
          : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - ids.length) }
        return {
          allMessages: nextAll,
          tabCounts: s.bulkMode ? deriveTabCounts(nextAll) : s.tabCounts,
          messages,
          total,
          multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
          selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
          selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
          bulkSessionArchived: s.bulkSessionArchived + ids.length,
        }
      })
    }
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
          ? deriveDisplayFromAll(nextAll, s.filter.filter, s.bulkPage, s.bulkBatchSize)
          : { messages: s.messages.map(updatedMsg), total: s.total }
        const selectedWasDeleted = s.selectedMessage && ids.includes(s.selectedMessage.id)
        return {
          allMessages: nextAll,
          tabCounts: s.bulkMode ? deriveTabCounts(nextAll) : s.tabCounts,
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
    if (!bridge?.markPendingDelete || ids.length === 0) return
    const res = await bridge.markPendingDelete(ids)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(ids)
      const now = new Date().toISOString()
      set((s) => {
        const idSet = new Set(ids)
        const nextExpiries = { ...s.pendingDeletePreviewExpiries }
        const nextKept = new Set(s.keptDuringPreviewIds)
        for (const id of ids) {
          delete nextExpiries[id]
          nextKept.delete(id)
        }
        const nextAll = s.allMessages.map((m) =>
          idSet.has(m.id) ? { ...m, pending_delete: 1, pending_delete_at: now } : m
        )
        const { messages, total } = s.bulkMode && nextAll.length > 0
          ? deriveDisplayFromAll(nextAll, s.filter.filter, s.bulkPage, s.bulkBatchSize)
          : { messages: s.messages.filter((m) => !idSet.has(m.id)), total: Math.max(0, s.total - ids.length) }
        return {
          allMessages: nextAll,
          tabCounts: s.bulkMode ? deriveTabCounts(nextAll) : s.tabCounts,
          messages,
          total,
          multiSelectIds: new Set([...s.multiSelectIds].filter((x) => !ids.includes(x))),
          selectedMessageId: s.selectedMessageId && ids.includes(s.selectedMessageId) ? null : s.selectedMessageId,
          selectedMessage: s.selectedMessage && ids.includes(s.selectedMessage.id) ? null : s.selectedMessage,
          pendingDeletePreviewExpiries: nextExpiries,
          keptDuringPreviewIds: nextKept,
          bulkSessionPendingDelete: s.bulkSessionPendingDelete + ids.length,
        }
      })
      get().setPendingDeleteToast({ count: ids.length, ids })
    }
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
    if (!bridge?.syncAccount) return
    set({ syncing: true })
    try {
      const res = await bridge.syncAccount(accountId)
      if (res.ok) {
        set({ lastSyncAt: new Date().toISOString(), syncing: false })
        if (get().isSortingActive) {
          console.log('[SYNC] Skipped — sort in progress')
          return
        }
        get().refreshMessages()
      } else {
        set({ syncing: false })
      }
    } catch {
      set({ syncing: false })
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
      if (res.ok && res.data) {
        const row = res.data as { auto_sync_enabled?: number }
        set({ autoSyncEnabled: row.auto_sync_enabled === 1 })
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
