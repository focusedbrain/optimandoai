/**
 * EmailInboxBulkView — Bulk grid view: [Message Card | AI Output Field] per row (50/50).
 * Toolbar: Select all, bulk actions, pagination. Uses bulkPage + bulkBatchSize from store.
 * Collapsible provider section at top for account management.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  useEmailInboxStore,
  type InboxMessage,
  type InboxSourceType,
} from '../stores/useEmailInboxStore'
import { useShallow } from 'zustand/react/shallow'
import EmailMessageDetail from './EmailMessageDetail'
import EmailComposeOverlay from './EmailComposeOverlay'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import { EmailConnectWizard } from '@ext/shared/components/EmailConnectWizard'
import LinkWarningDialog from './LinkWarningDialog'
import { extractLinkParts } from '../utils/safeLinks'
import type { AiOutputs, BulkAiResult, BulkRecommendedAction, SortCategory } from '../types/inboxAi'
import '../components/handshakeViewTypes'

const MUTED = '#64748b'

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

function formatSourceBadge(sourceType: InboxSourceType): string {
  switch (sourceType) {
    case 'direct_beap':
      return 'Direct'
    case 'email_beap':
      return 'BEAP'
    case 'email_plain':
      return 'Plain'
    default:
      return 'Email'
  }
}

const GRACE_SECONDS = 5

/** Live countdown for pending-delete preview. Subscribes only to countdownTick to limit rerenders. */
function PendingDeleteCountdown({ expiresAt }: { expiresAt: string | undefined }) {
  useEmailInboxStore((s) => s.countdownTick)
  if (!expiresAt) return <span className="bulk-action-card-pending-countdown">Delete to move to Pending Delete</span>
  try {
    const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
    const text = remaining > 0 ? `Moving in ${remaining}s` : 'Moving now'
    return <span className="bulk-action-card-pending-countdown">{text}</span>
  } catch {
    return <span className="bulk-action-card-pending-countdown">Moving in {GRACE_SECONDS}s</span>
  }
}

/** Live countdown for archive preview. */
function ArchiveCountdown({ expiresAt }: { expiresAt: string | undefined }) {
  useEmailInboxStore((s) => s.countdownTick)
  if (!expiresAt) return <span className="bulk-action-card-archive-countdown">Archiving in {GRACE_SECONDS}s</span>
  try {
    const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
    const text = remaining > 0 ? `Archiving in ${remaining}s` : 'Archiving now'
    return <span className="bulk-action-card-archive-countdown">{text}</span>
  } catch {
    return <span className="bulk-action-card-archive-countdown">Archiving in {GRACE_SECONDS}s</span>
  }
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
}

const CATEGORY_BORDER: Record<string, string> = {
  urgent: '#ef4444',
  important: '#f97316',
  normal: '#a855f7',
  newsletter: '#3b82f6',
  spam: '#6b7280',
  irrelevant: '#6b7280',
}

const CATEGORY_BG: Record<string, string> = {
  urgent: 'rgba(239,68,68,0.05)',
  important: 'rgba(249,115,22,0.05)',
  normal: 'transparent',
  newsletter: 'rgba(59,130,246,0.05)',
  spam: 'rgba(107,114,128,0.08)',
  irrelevant: 'rgba(107,114,128,0.08)',
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
  accounts: Array<{ id: string; email: string }>
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
    error,
    bulkPage,
    bulkBatchSize,
    bulkCompactMode,
    bulkAiOutputs,
    multiSelectIds,
    selectedMessage,
    selectedMessageId,
    filter,
    fetchMessages,
    setBulkMode,
    setBulkPage,
    setBulkBatchSize,
    setBulkCompactMode,
    syncBulkBatchSizeFromSettings,
    setBulkAiOutputs,
    pendingDeletePreviewExpiries,
    archivePreviewExpiries,
    keptDuringPreviewIds,
    keptDuringArchivePreviewIds,
    pendingDeleteToast,
      recentPendingDeleteBatches,
      bulkSessionArchived,
      bulkSessionPendingDelete,
    addPendingDeletePreview,
    addArchivePreview,
    keepDuringPreview,
    keepDuringArchivePreview,
    setPendingDeleteToast,
      removeRecentPendingDeleteBatch,
      decrementBulkSessionPendingDelete,
      clearPendingDeleteStateForIds,
    setFilter,
    selectMessage,
    toggleMultiSelect,
    clearMultiSelect,
    markRead,
    archiveMessages,
    deleteMessages,
    markPendingDeleteImmediate,
    setCategory,
    autoSyncEnabled,
    syncing,
    syncAccount,
    toggleAutoSync,
    loadSyncState,
  } = useEmailInboxStore(
    useShallow((s) => ({
      messages: s.messages,
      total: s.total,
      loading: s.loading,
      error: s.error,
      bulkPage: s.bulkPage,
      bulkBatchSize: s.bulkBatchSize,
      bulkCompactMode: s.bulkCompactMode,
      bulkAiOutputs: s.bulkAiOutputs,
      multiSelectIds: s.multiSelectIds,
      selectedMessage: s.selectedMessage,
      selectedMessageId: s.selectedMessageId,
      filter: s.filter,
      fetchMessages: s.fetchMessages,
      setBulkMode: s.setBulkMode,
      setBulkPage: s.setBulkPage,
      setBulkBatchSize: s.setBulkBatchSize,
      setBulkCompactMode: s.setBulkCompactMode,
      syncBulkBatchSizeFromSettings: s.syncBulkBatchSizeFromSettings,
      setBulkAiOutputs: s.setBulkAiOutputs,
      pendingDeletePreviewExpiries: s.pendingDeletePreviewExpiries,
      archivePreviewExpiries: s.archivePreviewExpiries,
      keptDuringPreviewIds: s.keptDuringPreviewIds,
      keptDuringArchivePreviewIds: s.keptDuringArchivePreviewIds,
      pendingDeleteToast: s.pendingDeleteToast,
      recentPendingDeleteBatches: s.recentPendingDeleteBatches,
      bulkSessionArchived: s.bulkSessionArchived,
      bulkSessionPendingDelete: s.bulkSessionPendingDelete,
      addPendingDeletePreview: s.addPendingDeletePreview,
      addArchivePreview: s.addArchivePreview,
      keepDuringPreview: s.keepDuringPreview,
      keepDuringArchivePreview: s.keepDuringArchivePreview,
      setPendingDeleteToast: s.setPendingDeleteToast,
      removeRecentPendingDeleteBatch: s.removeRecentPendingDeleteBatch,
      decrementBulkSessionPendingDelete: s.decrementBulkSessionPendingDelete,
      clearPendingDeleteStateForIds: s.clearPendingDeleteStateForIds,
      setFilter: s.setFilter,
      selectMessage: s.selectMessage,
      toggleMultiSelect: s.toggleMultiSelect,
      clearMultiSelect: s.clearMultiSelect,
      markRead: s.markRead,
      archiveMessages: s.archiveMessages,
      deleteMessages: s.deleteMessages,
      markPendingDeleteImmediate: s.markPendingDeleteImmediate,
      setCategory: s.setCategory,
      autoSyncEnabled: s.autoSyncEnabled,
      syncing: s.syncing,
      syncAccount: s.syncAccount,
      toggleAutoSync: s.toggleAutoSync,
      loadSyncState: s.loadSyncState,
    }))
  )

  const primaryAccountId = accounts[0]?.id

  useEffect(() => {
    if (primaryAccountId) loadSyncState(primaryAccountId)
  }, [primaryAccountId, loadSyncState])

  const handleSync = useCallback(() => {
    if (primaryAccountId) syncAccount(primaryAccountId)
  }, [primaryAccountId, syncAccount])

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

  const [providerAccounts, setProviderAccounts] = useState<Array<{ id: string; displayName: string; email: string; provider: 'gmail' | 'microsoft365' | 'imap'; status: 'active' | 'error' | 'disabled'; lastError?: string }>>([])
  const [isLoadingProviderAccounts, setIsLoadingProviderAccounts] = useState(true)
  const [selectedProviderAccountId, setSelectedProviderAccountId] = useState<string | null>(null)
  const [showEmailConnectModal, setShowEmailConnectModal] = useState(false)

  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null)
  const [aiSortProgress, setAiSortProgress] = useState<string | null>(null)
  const [aiSortPhase, setAiSortPhase] = useState<'idle' | 'analyzing' | 'reordered'>('idle')
  const [showEmailCompose, setShowEmailCompose] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState<InboxMessage | null>(null)
  const [replyDraftBody, setReplyDraftBody] = useState<string>('')
  const composeClickRef = useRef<number>(0)

  /** Messages animating out (archive / pending delete). Cleared after exit animation. */
  const [removingItems, setRemovingItems] = useState<Map<string, { message: InboxMessage; index: number }>>(new Map())
  const prevMessagesRef = useRef<InboxMessage[]>([])
  const prevFilterRef = useRef<string>(filter.filter)

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
  const selectedCount = multiSelectIds.size
  const totalPages = Math.max(1, Math.ceil(total / bulkBatchSize))
  const canPrev = bulkPage > 0
  const canNext = bulkPage < totalPages - 1
  const allSelected = messages.length > 0 && selectedCount === messages.length

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

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages, bulkPage])

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      clearMultiSelect()
    } else {
      messages.forEach((m) => {
        if (!multiSelectIds.has(m.id)) toggleMultiSelect(m.id)
      })
    }
  }, [allSelected, messages, multiSelectIds, clearMultiSelect, toggleMultiSelect])

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

  /** Run AI categorize for given ids. Used by both manual AI Auto-Sort and auto-run on load. */
  const runAiCategorizeForIds = useCallback(
    async (ids: string[], clearSelection: boolean) => {
      if (!ids.length || !window.emailInbox?.aiCategorize) return
      setAiSortProgress(`Analyzing ${ids.length} message${ids.length !== 1 ? 's' : ''}…`)
      setAiSortPhase('analyzing')
      try {
        const res = await window.emailInbox.aiCategorize(ids)
        const classifications = res.ok && res.data?.classifications
          ? (res.data.classifications as Array<{
              id: string
              category: string
              summary?: string
              reason: string
              needs_reply: boolean
              needs_reply_reason?: string
              urgency_score: number
              urgency_reason?: string
              recommended_action?: string
              action_explanation?: string
              action_items?: string[]
              draft_reply?: string
              pending_delete: boolean
              classification_failed?: boolean
            }>)
          : []

        const VALID_ACTIONS: BulkRecommendedAction[] = ['pending_delete', 'archive', 'keep_for_manual_action', 'draft_reply_ready']
        const VALID_CATEGORIES: SortCategory[] = ['urgent', 'important', 'normal', 'newsletter', 'spam', 'irrelevant']

        const nextOutputs: AiOutputs = {}
        for (const c of classifications) {
          if (!ids.includes(c.id)) continue
          if (c.classification_failed) {
            nextOutputs[c.id] = {
              summary: c.reason || 'AI analysis failed for this message.',
              autosortFailure: true,
              status: 'classified',
            }
            continue
          }
          const category = (VALID_CATEGORIES.includes(c.category as SortCategory) ? c.category : 'normal') as SortCategory
          const recommendedAction = (VALID_ACTIONS.includes((c.recommended_action ?? '') as BulkRecommendedAction)
            ? c.recommended_action
            : 'keep_for_manual_action') as BulkRecommendedAction
          const summary = (c.summary ?? '').slice(0, 500)
          const actionExplanation = (c.action_explanation ?? '').slice(0, 300)
          const isIncomplete = !summary.trim() || !actionExplanation.trim()
          if (isIncomplete) {
            nextOutputs[c.id] = {
              summary: c.reason || 'Incomplete AI analysis.',
              autosortFailure: true,
              status: 'classified',
            }
            continue
          }
          const entry: BulkAiResult = {
            category,
            urgencyScore: typeof c.urgency_score === 'number' ? Math.max(1, Math.min(10, c.urgency_score)) : 5,
            urgencyReason: (c.urgency_reason ?? c.reason ?? '').slice(0, 300),
            summary,
            reason: (c.reason ?? '').slice(0, 300),
            needsReply: !!c.needs_reply,
            needsReplyReason: (c.needs_reply_reason ?? '').slice(0, 300),
            recommendedAction,
            actionExplanation,
            actionItems: Array.isArray(c.action_items) ? c.action_items.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
            status: 'classified',
          }
          if (c.draft_reply && (c.needs_reply || recommendedAction === 'draft_reply_ready')) {
            entry.draftReply = c.draft_reply.slice(0, 4000)
          }
          if (c.pending_delete && recommendedAction === 'pending_delete') {
            entry.pendingDeletePreviewUntil = new Date(Date.now() + GRACE_SECONDS * 1000).toISOString()
          }
          if (recommendedAction === 'archive') {
            entry.archivePreviewUntil = new Date(Date.now() + GRACE_SECONDS * 1000).toISOString()
          }
          nextOutputs[c.id] = entry
        }

        for (const id of ids) {
          if (!(id in nextOutputs)) {
            nextOutputs[id] = {
              summary: res.ok ? 'No result from AI.' : (res.error ?? 'Analysis failed.'),
              autosortFailure: true,
              status: 'classified',
            }
          }
        }

        setBulkAiOutputs((prev) => ({ ...prev, ...nextOutputs }))

        const pendingIds = classifications.filter((c) => !c.classification_failed && c.pending_delete).map((c) => c.id)
        const archiveIds = classifications.filter((c) => !c.classification_failed && (c.recommended_action ?? '') === 'archive').map((c) => c.id)
        if (clearSelection) clearMultiSelect()
        await fetchMessages()
        const sortedMessages = sortMessagesByCategory(useEmailInboxStore.getState().messages)
        console.log('[AUTO-SORT] Store updated, sorted messages:', sortedMessages.map((m) => ({ id: m.id, category: m.sort_category, urgency: m.urgency_score })))
        if (pendingIds.length > 0) addPendingDeletePreview(pendingIds)
        if (archiveIds.length > 0) addArchivePreview(archiveIds)
        setAiSortPhase('reordered')
        setTimeout(() => setAiSortPhase('idle'), 380)
      } catch {
        const failOutputs: AiOutputs = {}
        for (const id of ids) {
          failOutputs[id] = { summary: 'Analysis failed.', autosortFailure: true, status: 'classified' }
        }
        setBulkAiOutputs((prev) => ({ ...prev, ...failOutputs }))
        setAiSortPhase('idle')
      } finally {
        setAiSortProgress(null)
      }
    },
    [clearMultiSelect, fetchMessages, addPendingDeletePreview, addArchivePreview]
  )

  const handleAiAutoSort = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    runAiCategorizeForIds(ids, true)
  }, [multiSelectIds, runAiCategorizeForIds])

  /** Auto-run AI analysis when messages load and batch has no analysis yet. */
  useEffect(() => {
    if (loading || messages.length === 0 || !window.emailInbox?.aiCategorize) return
    if (aiSortPhase === 'analyzing') return
    const ids = messages.map((m) => m.id)
    const hasAnalysis = ids.some((id) => {
      const out = bulkAiOutputs[id]
      return !!(out?.category || out?.summary)
    })
    if (hasAnalysis) return
    runAiCategorizeForIds(ids, false)
  }, [loading, messages, bulkAiOutputs, runAiCategorizeForIds, aiSortPhase])

  const handleUndoPendingDelete = useCallback(
    async (ids: string[]) => {
      if (!window.emailInbox?.cancelPendingDelete || ids.length === 0) return
      for (const id of ids) {
        await window.emailInbox.cancelPendingDelete(id)
      }
      setPendingDeleteToast(null)
      removeRecentPendingDeleteBatch(ids)
      decrementBulkSessionPendingDelete(ids.length)
      clearPendingDeleteStateForIds(ids)
      await fetchMessages()
    },
    [fetchMessages, setPendingDeleteToast, removeRecentPendingDeleteBatch, decrementBulkSessionPendingDelete, clearPendingDeleteStateForIds]
  )

  /** Cancel the scheduled pending-delete move for one message during the 5s preview. */
  const handleKeepDuringPreview = useCallback(
    (messageId: string) => {
      keepDuringPreview(messageId)
    },
    [keepDuringPreview]
  )

  /** Cancel the scheduled archive move for one message during the 5s preview. */
  const handleKeepDuringArchivePreview = useCallback(
    (messageId: string) => {
      keepDuringArchivePreview(messageId)
    },
    [keepDuringArchivePreview]
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
        setProviderAccounts(data.map((a) => ({
          id: a.id,
          displayName: a.displayName ?? a.email,
          email: a.email,
          provider: (a.provider === 'gmail' ? 'gmail' : a.provider === 'microsoft365' ? 'microsoft365' : 'imap') as 'gmail' | 'microsoft365' | 'imap',
          status: (a.status === 'active' ? 'active' : a.status === 'error' ? 'error' : 'disabled') as 'active' | 'error' | 'disabled',
          lastError: a.lastError,
        })))
        setSelectedProviderAccountId((prev) =>
          prev && data.some((a: { id: string }) => a.id === prev) ? prev : data[0]?.id ?? null
        )
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

  const handleConnectEmail = useCallback(() => setShowEmailConnectModal(true), [])
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
      if (!window.emailInbox?.aiSummarize) return
      setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: 'summary', summaryError: undefined } }))
      try {
        const res = await window.emailInbox.aiSummarize(messageId)
        const data = res.data as { summary?: string; error?: boolean } | undefined
        const isError = !res.ok || !data?.summary || !!data.error
        setBulkAiOutputs((prev) => {
          const existing = prev[messageId] ?? {}
          return {
            ...prev,
            [messageId]: {
              ...existing,
              summary: data?.summary ?? (isError ? 'Summarize failed.' : ''),
              summaryError: isError,
              status: existing.status ?? 'classified',
              loading: undefined,
            },
          }
        })
      } catch {
        setBulkAiOutputs((prev) => ({
          ...prev,
          [messageId]: {
            ...prev[messageId],
            summary: 'Summarize failed.',
            summaryError: true,
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

  /** Open compose with draft body for reply. */
  const handleSendDraft = useCallback((msg: InboxMessage, draftBody: string) => {
    const isDepackaged = msg.source_type === 'email_plain'
    if (isDepackaged) {
      const subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || '(No subject)'}`
      setReplyToMessage({ ...msg, subject })
      setReplyDraftBody(draftBody || '')
      setShowEmailCompose(true)
    } else {
      if (draftBody?.trim()) navigator.clipboard?.writeText(draftBody).catch(() => {})
      window.analysisDashboard?.openBeapDraft?.()
    }
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

  /** Render structured Action Card when BulkAiResult exists; otherwise fallback. */
  const renderActionCard = useCallback(
    (msg: InboxMessage, output: BulkAiResultEntry | undefined, isExpanded: boolean) => {
      const hasStructured = !!(output?.category && output?.recommendedAction)
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
        return (
          <div className="bulk-action-card bulk-action-card--failure">
            <div className="bulk-action-card-state-content bulk-action-card-failure-content">
              <span className="bulk-action-card-state-label bulk-action-card-failure-label">Analysis failed</span>
              <span className="bulk-action-card-state-detail bulk-action-card-failure-detail">{output.summary || 'No result from AI for this message.'}</span>
            </div>
            <div className="bulk-action-card-actions-row">
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

      if (hasStructured) {
        const rec = output.recommendedAction
        const panelMod = `bulk-action-card-panel--${rec}`
        const needsReplyReason = output.needsReplyReason ?? output.reason ?? ''
        const urgencyReason = output.urgencyReason ?? output.reason ?? ''
        const urgencyColor = urgency <= 3 ? '#22c55e' : urgency <= 6 ? '#eab308' : '#ef4444'
        const inPendingDeleteGrace = rec === 'pending_delete' && !keptDuringPreviewIds.has(msg.id)
        const inArchiveGrace = rec === 'archive' && !keptDuringArchivePreviewIds.has(msg.id) && !!archivePreviewExpiries[msg.id]
        const preActionMod = inPendingDeleteGrace ? 'bulk-action-card--pre-action-pending' : inArchiveGrace ? 'bulk-action-card--pre-action-archive' : ''
        const effectiveBorderColor = inPendingDeleteGrace ? '#dc2626' : inArchiveGrace ? '#2563eb' : borderColor
        return (
          <div className={`bulk-action-card bulk-action-card--structured ${isExpanded ? 'bulk-action-card--expanded' : ''} ${preActionMod}`} style={{ borderLeftColor: effectiveBorderColor }}>
            <div className="bulk-action-card-header">
              <span className="bulk-action-card-badge" style={{ background: `${borderColor}33`, color: borderColor }}>
                {(output.category ?? 'normal').toUpperCase()}
              </span>
              <span className="bulk-action-card-urgency-badge" style={{ color: urgencyColor }} title="Urgency 1–10">
                {urgency}/10
              </span>
            </div>
            {/* Same section hierarchy as Normal Inbox — reasoning visible before action */}
            <div className="bulk-action-card-sections">
              {output.summaryError && (
                <div className="bulk-action-card-error-banner">
                  <span>Summarize failed.</span>
                  <button type="button" onClick={() => handleSummarize(msg.id)}>Retry</button>
                </div>
              )}
              {output.draftError && (
                <div className="bulk-action-card-error-banner">
                  <span>Draft generation failed.</span>
                  <button type="button" onClick={() => handleDraftReply(msg.id)}>Retry</button>
                </div>
              )}
              {/* Response Needed */}
              <div className="bulk-action-card-row">
                <span className="bulk-action-card-row-label">Response Needed</span>
                <div className="bulk-action-card-row-value">
                  <span className="bulk-action-card-response-needed">
                    <span className="bulk-action-card-dot" style={{ background: output.needsReply ? '#ef4444' : '#22c55e' }} />
                    {output.needsReply ? 'Yes' : 'No'} — {needsReplyReason || '—'}
                  </span>
                </div>
              </div>
              {/* Summary — always visible when structured (parity with Normal) */}
              <div className="bulk-action-card-row">
                <span className="bulk-action-card-row-label">Summary</span>
                <div className={`bulk-action-card-row-value bulk-action-card-summary ${isExpanded ? 'bulk-action-card-summary--expanded' : 'bulk-action-card-summary--collapsed'}`}>
                  {output.summary || '—'}
                </div>
              </div>
              {/* Urgency — bar + X/10 + reason (same as Normal) */}
              <div className="bulk-action-card-row">
                <span className="bulk-action-card-row-label">Urgency</span>
                <div className="bulk-action-card-row-value">
                  <div className="bulk-action-card-urgency-bar">
                    <div className="bulk-action-card-urgency-fill" style={{ width: `${(urgency / 10) * 100}%`, background: urgencyColor }} />
                  </div>
                  <span className="bulk-action-card-urgency-label">{urgency}/10 — {urgencyReason || '—'}</span>
                </div>
              </div>
              {/* Draft Reply — same as Normal Inbox */}
              {output.draftReply != null && output.draftReply !== '' && (
                <div className="bulk-action-card-row bulk-action-card-row-draft">
                  <span className="bulk-action-card-row-label">Draft Reply</span>
                  <div className="bulk-action-card-row-value">
                    <textarea
                      className="bulk-action-card-draft-textarea"
                      value={output.draftReply}
                      onChange={(e) => updateDraftReply(msg.id, e.target.value)}
                      placeholder="Edit draft…"
                      rows={isExpanded ? 4 : 2}
                    />
                  </div>
                </div>
              )}
              {/* Action Items — always visible when structured (parity with Normal) */}
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
              {/* Recommended Action — reasoning always visible, explicit */}
              <div className="bulk-action-card-row bulk-action-card-row--recommended">
                <span className="bulk-action-card-row-label">Recommended Action</span>
                <div className="bulk-action-card-row-value">
                  <div
                    role="button"
                    tabIndex={0}
                    className={`bulk-action-card-panel bulk-action-card-panel--recommended bulk-action-card-panel--actionable ${panelMod}`}
                    onClick={() => {
                      if (rec === 'pending_delete') handlePendingDeleteOne(msg)
                      else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
                      else if (rec === 'draft_reply_ready' && output.draftReply) handleSendDraft(msg, output.draftReply)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        if (rec === 'pending_delete') handlePendingDeleteOne(msg)
                        else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
                        else if (rec === 'draft_reply_ready' && output.draftReply) handleSendDraft(msg, output.draftReply)
                      }
                    }}
                    title="Click or press Enter to apply"
                  >
                    <span className="bulk-action-card-panel-action">
                      {rec === 'pending_delete' && '🗑 Pending Delete'}
                      {rec === 'archive' && '📦 Archive'}
                      {rec === 'keep_for_manual_action' && '✋ Review manually'}
                      {rec === 'draft_reply_ready' && '✉ Send draft reply'}
                    </span>
                  </div>
                  <div className="bulk-action-card-reasoning-box">
                    <span className="bulk-action-card-reasoning-label">Why:</span>
                    <span className="bulk-action-card-reasoning">{output.actionExplanation || '—'}</span>
                  </div>
                </div>
              </div>
            </div>
            {rec === 'pending_delete' && !keptDuringPreviewIds.has(msg.id) && (
              <div className="bulk-action-card-pending-preview">
                <span className="bulk-action-card-pending-badge">PENDING DELETE</span>
                <span className="bulk-action-card-next-state">
                  Will move to Pending Delete — <PendingDeleteCountdown expiresAt={pendingDeletePreviewExpiries[msg.id]} />
                </span>
                {pendingDeletePreviewExpiries[msg.id] && (
                  <button
                    type="button"
                    className="bulk-action-card-keep-btn"
                    onClick={() => handleKeepDuringPreview(msg.id)}
                    title="Cancel auto-action"
                  >
                    Keep
                  </button>
                )}
              </div>
            )}
            {rec === 'archive' && !keptDuringArchivePreviewIds.has(msg.id) && archivePreviewExpiries[msg.id] && (
              <div className="bulk-action-card-archive-preview">
                <span className="bulk-action-card-archive-badge">ARCHIVING</span>
                <span className="bulk-action-card-next-state">
                  Will archive — <ArchiveCountdown expiresAt={archivePreviewExpiries[msg.id]} />
                </span>
                <button
                  type="button"
                  className="bulk-action-card-keep-btn"
                  onClick={() => handleKeepDuringArchivePreview(msg.id)}
                  title="Cancel auto-action"
                >
                  Keep
                </button>
              </div>
            )}
            <div className="bulk-action-card-buttons">
              {rec === 'draft_reply_ready' && output.draftReply && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis"
                  onClick={() => handleSendDraft(msg, output.draftReply!)}
                >
                  ✉ Send via Email
                </button>
              )}
              {(rec === 'archive' || rec === 'keep_for_manual_action') && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis"
                  onClick={() => handleArchiveOne(msg)}
                >
                  📦 Archive
                </button>
              )}
              {rec === 'pending_delete' && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--danger bulk-action-card-btn--primary-emphasis"
                  onClick={() => handlePendingDeleteOne(msg)}
                >
                  🗑 Pending Delete
                </button>
              )}
              {rec === 'draft_reply_ready' && output.draftReply && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--secondary"
                  onClick={() => handleArchiveOne(msg)}
                >
                  Archive
                </button>
              )}
              <div className="bulk-action-card-buttons-secondary">
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--secondary"
                  onClick={() => handleSummarize(msg.id)}
                  disabled={!!output?.loading}
                  title="Regenerate summary"
                >
                  ✨ Summarize
                </button>
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--secondary"
                  onClick={() => handleDraftReply(msg.id)}
                  disabled={!!output?.loading}
                  title="Regenerate draft"
                >
                  ✍ Draft
                </button>
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn-delete"
                  onClick={() => handleDeleteOne(msg)}
                  title="Delete this message"
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          </div>
        )
      }

      // Fallback: summary or draft without full structured result (from manual Summarize/Draft)
      if (output?.summary || output?.draftReply || output?.summaryError || output?.draftError) {
        const fallbackSummaryCls = isExpanded ? 'bulk-action-card-summary bulk-action-card-summary--expanded' : 'bulk-action-card-summary bulk-action-card-summary--collapsed'
        return (
          <div className={`bulk-action-card bulk-action-card--fallback ${isExpanded ? 'bulk-action-card--expanded' : ''}`}>
            <div className="bulk-action-card-fallback-content">
              {(output.summaryError || output.draftError) && (
                <div className="bulk-action-card-error-banner">
                  {output.summaryError && (
                    <span>Summarize failed. <button type="button" className="bulk-action-card-inline-retry" onClick={() => handleSummarize(msg.id)}>Retry</button></span>
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
              {output.draftReply && !output.draftError && (
                <div className={`bulk-action-card-row bulk-action-card-row-draft ${isExpanded ? 'bulk-action-card-draft--expanded' : ''}`}>
                  <span className="bulk-action-card-row-label">Draft — edit before sending</span>
                  <textarea
                    className="bulk-action-card-draft-textarea"
                    value={output.draftReply}
                    onChange={(e) => updateDraftReply(msg.id, e.target.value)}
                    placeholder="Edit draft…"
                    rows={isExpanded ? 4 : 2}
                  />
                </div>
              )}
            </div>
            <div className="bulk-action-card-actions-row">
              {output.draftReply && !output.draftError && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--compact"
                  onClick={() => handleSendDraft(msg, output.draftReply!)}
                >
                  Send via Email
                </button>
              )}
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
      return (
        <div className="bulk-action-card bulk-action-card--guidance">
          <div className="bulk-action-card-state-content bulk-action-card-guidance-content">
            <span className="bulk-action-card-state-label bulk-action-card-guidance-label">Not yet analyzed</span>
            <span className="bulk-action-card-state-detail bulk-action-card-guidance-detail">
              This message has not been analyzed. Select messages above and click <strong>AI Auto-Sort</strong> in the toolbar to analyze the batch, or use per-message actions below.
            </span>
          </div>
          <div className="bulk-action-card-actions-row bulk-action-card-actions-row--secondary">
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
      updateDraftReply,
      handleSendDraft,
      handleArchiveOne,
      handleDeleteOne,
      handlePendingDeleteOne,
      handleSummarize,
      handleDraftReply,
      handleKeepDuringPreview,
      handleKeepDuringArchivePreview,
      runAiCategorizeForIds,
      keptDuringPreviewIds,
      keptDuringArchivePreviewIds,
      pendingDeletePreviewExpiries,
      archivePreviewExpiries,
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
      else if (rec === 'archive' || rec === 'keep_for_manual_action') handleArchiveOne(msg)
      // draft_reply_ready: skip — avoid accidental send
    },
    [handlePendingDeleteOne, handleArchiveOne]
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
      const inPendingDeleteGrace =
        focusedMsg &&
        pendingDeletePreviewExpiries[focusedMsg.id] &&
        !keptDuringPreviewIds.has(focusedMsg.id)
      const inArchiveGrace =
        focusedMsg &&
        archivePreviewExpiries[focusedMsg.id] &&
        !keptDuringArchivePreviewIds.has(focusedMsg.id)
      const inGracePeriod = inPendingDeleteGrace || inArchiveGrace

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
      if (e.key === 'g' && inGracePeriod && focusedMsg) {
        e.preventDefault()
        if (inPendingDeleteGrace) handleKeepDuringPreview(focusedMsg.id)
        else if (inArchiveGrace) handleKeepDuringArchivePreview(focusedMsg.id)
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
    pendingDeletePreviewExpiries,
    archivePreviewExpiries,
    keptDuringPreviewIds,
    keptDuringArchivePreviewIds,
    expandedCardIds,
    selectedCount,
    focusAdjacentRow,
    toggleCardExpand,
    handleKeepDuringPreview,
    handleKeepDuringArchivePreview,
    triggerPrimaryAction,
    handleBulkArchive,
    handleArchiveOne,
    handleBulkDelete,
    handleDeleteOne,
    handlePendingDeleteOne,
  ])

  return (
    <div className={`bulk-view-root ${bulkCompactMode ? 'bulk-view--compact' : ''}`}>
      {/* Toolbar — compact, no duplication */}
      <div className="bulk-view-toolbar">
        <div className="bulk-view-selection-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={handleSelectAll}
              disabled={messages.length === 0}
            />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Select all</span>
          </label>
          <span className="bulk-view-selection-group-label">Batch</span>
          <select
            value={bulkBatchSize}
            onChange={(e) => setBulkBatchSize(Number(e.target.value))}
            className="bulk-view-selection-group-select"
          >
            {[10, 12, 24, 48].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <span className="bulk-view-selection-group-count">
              {selectedCount} selected
            </span>
          )}
        </div>
        <div className="bulk-view-filter-group">
          <button
            type="button"
            onClick={() => setFilter({ filter: 'all' })}
            className="bulk-view-toolbar-filter-btn"
            data-active={filter.filter === 'all'}
          >
            All{filter.filter === 'all' ? ` (${total})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setFilter({ filter: 'pending_delete' })}
            className="bulk-view-toolbar-filter-btn bulk-view-toolbar-filter-btn--pending"
            data-active={filter.filter === 'pending_delete'}
          >
            Pending Delete{filter.filter === 'pending_delete' ? ` (${total})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setFilter({ filter: 'archived' })}
            className="bulk-view-toolbar-filter-btn bulk-view-toolbar-filter-btn--archived"
            data-active={filter.filter === 'archived'}
          >
            Archived{filter.filter === 'archived' ? ` (${total})` : ''}
          </button>
        </div>
        {(bulkSessionArchived > 0 || bulkSessionPendingDelete > 0) && (
          <div className="bulk-view-session-progress" role="status" aria-live="polite">
            {bulkSessionArchived > 0 && (
              <span className="bulk-view-session-count bulk-view-session-archived">
                Archived {bulkSessionArchived}
              </span>
            )}
            {bulkSessionArchived > 0 && bulkSessionPendingDelete > 0 && (
              <span className="bulk-view-session-sep">·</span>
            )}
            {bulkSessionPendingDelete > 0 && (
              <span className="bulk-view-session-count bulk-view-session-pending">
                Pending {bulkSessionPendingDelete}
              </span>
            )}
            {filter.filter === 'all' && (
              <span className="bulk-view-session-remaining">
                · {messages.length} remaining
              </span>
            )}
          </div>
        )}
        <div className="bulk-view-sync-group">
          <label className="bulk-view-sync-label">
            <input
              type="checkbox"
              checked={autoSyncEnabled}
              onChange={() => primaryAccountId && toggleAutoSync(primaryAccountId, !autoSyncEnabled)}
            />
            Auto-sync
          </label>
          <button
            type="button"
            className="bulk-view-pull-btn"
            onClick={handleSync}
            disabled={syncing || !primaryAccountId}
            title="Pull messages"
          >
            {syncing ? '↻ Syncing…' : '↻ Pull'}
          </button>
        </div>
        <div className="bulk-view-action-group">
          <button
            type="button"
            className="bulk-view-delete-btn"
            onClick={handleBulkDelete}
            disabled={selectedCount === 0}
            title={selectedCount ? 'Delete selected (d)' : undefined}
          >
            🗑
          </button>
          <button
            type="button"
            className="bulk-view-archive-btn"
            onClick={handleBulkArchive}
            disabled={selectedCount === 0}
            title={selectedCount ? 'Archive selected (a)' : undefined}
          >
            Archive
          </button>
          <button
            type="button"
            className="bulk-view-ai-sort-btn"
            onClick={handleAiAutoSort}
            disabled={selectedCount === 0}
          >
            ✨ AI Auto-Sort
          </button>
        </div>
        <div className="bulk-view-toolbar-spacer" />
        <button
          type="button"
          className="bulk-view-compact-btn"
          onClick={() => setBulkCompactMode(!bulkCompactMode)}
          title={bulkCompactMode ? 'Standard view' : 'Compact view (denser)'}
        >
          {bulkCompactMode ? '⊟' : '⊞'}
        </button>
      </div>

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
        {loading ? (
          <div className="bulk-view-empty-state">Loading…</div>
        ) : error ? (
          <div className="bulk-view-empty-state" style={{ color: '#ef4444' }}>
            {error}
          </div>
        ) : messages.length === 0 ? (
          <div className="bulk-view-empty-state">No messages in this batch.</div>
        ) : (
          <>
            {totalPages > 1 && (
              <div className="bulk-view-pagination-bar">
                <span style={{ fontSize: 11, color: MUTED }}>
                  {total} message{total !== 1 ? 's' : ''}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setBulkPage(Math.max(0, bulkPage - 1))}
                    disabled={!canPrev}
                    title="Previous page"
                    style={{
                      padding: '4px 8px',
                      fontSize: 10,
                      fontWeight: 600,
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      color: canPrev ? '#334155' : MUTED,
                      cursor: canPrev ? 'pointer' : 'not-allowed',
                    }}
                  >
                    ‹ Prev
                  </button>
                  <span style={{ fontSize: 11, color: MUTED }}>
                    Page {bulkPage + 1} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBulkPage(Math.min(totalPages - 1, bulkPage + 1))}
                    disabled={!canNext}
                    title="Next page"
                    style={{
                      padding: '4px 8px',
                      fontSize: 10,
                      fontWeight: 600,
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      color: canNext ? '#334155' : MUTED,
                      cursor: canNext ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
            {aiSortProgress && (
              <div style={{ padding: 8, textAlign: 'center', fontSize: 12, color: MUTED }}>
                {aiSortProgress}
              </div>
            )}
            {bulkCompactMode && bulkBatchSize >= 24 && messages.length > 0 && (
              <div className="bulk-view-compact-hint" role="status" title="Keyboard: j/k nav, a archive, d delete, g keep, Enter expand, Space primary">
                Compact mode · {messages.length} messages · j/k nav, a archive, d delete
              </div>
            )}
            {(pendingDeleteToast || recentPendingDeleteBatches.length > 0) && (
              <div className="bulk-view-recent-actions" style={{ margin: '0 12px 12px' }}>
                {pendingDeleteToast && (
                  <div className="bulk-view-toast-primary">
                    <span>
                      {pendingDeleteToast.count} message{pendingDeleteToast.count !== 1 ? 's' : ''} moved to Pending Delete.
                    </span>
                    <button type="button" onClick={() => handleUndoPendingDelete(pendingDeleteToast.ids)}>
                      Undo
                    </button>
                  </div>
                )}
                {recentPendingDeleteBatches.length > 0 && (
                  <div className="bulk-view-recent-stack">
                    {recentPendingDeleteBatches.map((batch, i) => (
                      <div key={i} className="bulk-view-recent-item">
                        <span>
                          {batch.count} msg{batch.count !== 1 ? 's' : ''}
                        </span>
                        <button type="button" onClick={() => handleUndoPendingDelete(batch.ids)}>
                          Undo
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          <div
            className={`bulk-view-grid ${aiSortPhase === 'analyzing' ? 'bulk-view-grid--analyzing' : ''} ${aiSortPhase === 'reordered' ? 'bulk-view-grid--reordered' : ''}`}
            title="Keyboard: j/k or ↑↓ nav, Enter expand, a archive, d delete, g keep (grace), Space primary action"
          >
            {displayMessages.map((msg, rowIndex) => {
              const isRemoving = removingItems.has(msg.id)
              const isMultiSelected = multiSelectIds.has(msg.id)
              const isFocused = focusedMessageId === msg.id
              const isCardExpanded = expandedCardIds.has(msg.id)
              const output = bulkAiOutputs[msg.id]
              const bodyContent = (msg.body_text || '').trim() || '(No body)'
              const hasAttachments = msg.has_attachments === 1
              const isDeleted = msg.deleted === 1
              const isPendingDelete = (msg as InboxMessage & { pending_delete?: number }).pending_delete === 1
              const category = (msg.sort_category ?? 'normal') as keyof typeof CATEGORY_BORDER
              const borderColor = CATEGORY_BORDER[category] ?? 'transparent'
              const bgTint = CATEGORY_BG[category] ?? 'transparent'
              const needsReply = msg.needs_reply === 1

              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  data-row-index={aiSortPhase === 'reordered' ? rowIndex : undefined}
                  className={`bulk-view-row ${isRemoving ? 'bulk-view-row--removing' : ''} ${isMultiSelected ? 'bulk-view-row--multi' : ''} ${isFocused ? 'bulk-view-row--focused' : ''} ${isCardExpanded ? 'bulk-view-row--expanded' : ''} ${aiSortPhase === 'reordered' && !isRemoving ? 'bulk-view-row--reorder-enter' : ''}`}
                  onAnimationEnd={isRemoving ? () => setRemovingItems((prev) => { const next = new Map(prev); next.delete(msg.id); return next; }) : undefined}
                  style={{
                    borderLeft: borderColor ? `4px solid ${borderColor}` : undefined,
                    background: bgTint !== 'transparent' ? bgTint : undefined,
                    ...(aiSortPhase === 'reordered' && !isRemoving ? { animationDelay: `${rowIndex * 18}ms` } : {}),
                  }}
                >
                  {/* Left: Message card — click toggles focus */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('input[type="checkbox"]') || (e.target as HTMLElement).closest('.bulk-view-expand-btn') || (e.target as HTMLElement).closest('.bulk-view-msg-delete-btn')) return
                      handleFocusPair(msg)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleFocusPair(msg)
                      }
                    }}
                    className={`bulk-view-message ${isMultiSelected ? 'bulk-view-message--multi' : ''} ${isFocused ? 'bulk-view-message--focused' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      <input
                        type="checkbox"
                        checked={isMultiSelected}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleMultiSelect(msg.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ alignSelf: 'flex-start' }}
                      />
                      {isFocused && (
                        <span
                          style={{ flexShrink: 0, alignSelf: 'flex-start', fontSize: 14, color: 'var(--purple-accent, #7c3aed)', lineHeight: 1 }}
                          title="Focused — chat/search scoped to this message"
                          aria-hidden
                        >
                          👉
                        </span>
                      )}
                      <div className="bulk-view-message-inner" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexShrink: 0 }}>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                            }}
                          >
                            {msg.from_name || msg.from_address || '—'}
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
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: category === 'urgent' ? 700 : 500,
                            marginBottom: 4,
                            flexShrink: 0,
                          }}
                        >
                          {msg.subject || '(No subject)'}
                        </div>
                        {msg.sort_reason && (
                          <div style={{ fontSize: 12, color: MUTED, marginBottom: 6, flexShrink: 0 }}>
                            {msg.sort_reason}
                          </div>
                        )}
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center', flexShrink: 0 }}>
                          {hasAttachments && (
                            <span style={{ fontSize: 11, color: MUTED }}>📎 {msg.attachment_count}</span>
                          )}
                          {msg.sort_category && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '3px 8px',
                                borderRadius: 4,
                                background: borderColor ? `${borderColor}33` : 'rgba(255,255,255,0.06)',
                                color: borderColor || MUTED,
                              }}
                            >
                              {msg.sort_category.toUpperCase()}
                            </span>
                          )}
                          {needsReply && (
                            <span style={{ fontSize: 12, color: '#7c3aed' }} title="Needs reply">↩</span>
                          )}
                          {isPendingDelete && (
                            <>
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: 'rgba(239,68,68,0.1)',
                                  color: '#dc2626',
                                  fontWeight: 600,
                                }}
                                title="Permanently deleted 7 days after moving here"
                              >
                                {formatPendingDeleteInfo(msg.pending_delete_at)}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleUndoPendingDelete([msg.id])
                                }}
                                style={{
                                  fontSize: 10,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: 'rgba(34,197,94,0.2)',
                                  border: '1px solid rgba(34,197,94,0.4)',
                                  color: '#86efac',
                                  cursor: 'pointer',
                                }}
                              >
                                Undo
                              </button>
                            </>
                          )}
                          {isDeleted && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '3px 8px',
                                borderRadius: 4,
                                background: 'rgba(239,68,68,0.15)',
                                color: '#fca5a5',
                              }}
                            >
                              Deleted
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: 10,
                              padding: '3px 8px',
                              borderRadius: 4,
                              background: msg.source_type === 'email_plain' ? '#f1f5f9' : 'rgba(147,51,234,0.1)',
                              color: msg.source_type === 'email_plain' ? '#64748b' : 'var(--purple-accent, #7c3aed)',
                            }}
                          >
                            {formatSourceBadge(msg.source_type)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: Action Card — structured AI output or fallback */}
                  <div
                    className="bulk-view-ai"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('textarea')) return
                      handleFocusPair(msg)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleFocusPair(msg)
                      }
                    }}
                  >
                    {renderActionCard(msg, output, isCardExpanded)}
                  </div>
                  <div
                    className="bulk-card-expand-toggle"
                    onClick={() => toggleCardExpand(msg.id)}
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
          </>
        )}
      </div>

      <LinkWarningDialog
        isOpen={!!pendingLinkUrl}
        url={pendingLinkUrl || ''}
        onConfirm={handleLinkConfirm}
        onCancel={handleLinkCancel}
      />

      <EmailConnectWizard
        isOpen={showEmailConnectModal}
        onClose={() => setShowEmailConnectModal(false)}
        onConnected={() => {
          loadProviderAccounts()
          setShowEmailConnectModal(false)
        }}
        theme="dark"
      />

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
              }}
              onSent={() => {
                setShowEmailCompose(false)
                setReplyToMessage(null)
                setReplyDraftBody('')
                fetchMessages()
              }}
              replyTo={
                replyToMessage
                  ? {
                      to: replyToMessage.from_address ?? undefined,
                      subject: replyToMessage.subject ?? undefined,
                      body: replyDraftBody,
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
                  onSelectAttachment={onSelectAttachment}
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
