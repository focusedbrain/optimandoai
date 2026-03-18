/**
 * EmailInboxBulkView — Bulk grid view: [Message Card | AI Output Field] per row (50/50).
 * Toolbar: Select all, bulk actions, pagination. Uses bulkPage + bulkBatchSize from store.
 * Collapsible provider section at top for account management.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  useEmailInboxStore,
  type InboxMessage,
  type InboxSourceType,
} from '../stores/useEmailInboxStore'
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

const CATEGORY_ORDER: Record<string, number> = {
  urgent: 0,
  important: 1,
  normal: 2,
  newsletter: 3,
  spam: 4,
  irrelevant: 5,
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
    const orderA = CATEGORY_ORDER[a.sort_category ?? 'normal'] ?? 2
    const orderB = CATEGORY_ORDER[b.sort_category ?? 'normal'] ?? 2
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
    setFilter,
    selectMessage,
    toggleMultiSelect,
    clearMultiSelect,
    markRead,
    archiveMessages,
    deleteMessages,
    setCategory,
  } = useEmailInboxStore()

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
  const [pendingDeleteToast, setPendingDeleteToast] = useState<{ count: number; ids: string[] } | null>(null)
  const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIdsRef = useRef<string[]>([])
  const keptDuringPreviewIdsRef = useRef<Set<string>>(new Set())
  const [keptDuringPreviewIds, setKeptDuringPreviewIds] = useState<Set<string>>(new Set())
  const [showEmailCompose, setShowEmailCompose] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState<InboxMessage | null>(null)
  const [replyDraftBody, setReplyDraftBody] = useState<string>('')
  const composeClickRef = useRef<number>(0)

  const selectedCount = multiSelectIds.size
  const totalPages = Math.max(1, Math.ceil(total / bulkBatchSize))
  const canPrev = bulkPage > 0
  const canNext = bulkPage < totalPages - 1
  const allSelected = messages.length > 0 && selectedCount === messages.length

  useEffect(() => {
    setBulkMode(true)
    return () => {
      setBulkMode(false)
      if (pendingDeleteTimerRef.current) {
        clearTimeout(pendingDeleteTimerRef.current)
        pendingDeleteTimerRef.current = null
      }
    }
  }, [setBulkMode])

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

  const handleBulkMarkRead = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) markRead(ids, true)
    clearMultiSelect()
  }, [multiSelectIds, markRead, clearMultiSelect])

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

  const handleAiAutoSort = useCallback(async () => {
    const ids = Array.from(multiSelectIds)
    if (!ids.length || !window.emailInbox?.aiCategorize) return
    setAiSortProgress(`Analyzing ${ids.length} message${ids.length !== 1 ? 's' : ''}…`)
    try {
      const res = await window.emailInbox.aiCategorize(ids)
      if (res.ok && res.data?.classifications) {
        const classifications = res.data.classifications as Array<{
          id: string
          category: string
          summary?: string
          reason: string
          needs_reply: boolean
          urgency_score: number
          recommended_action?: string
          action_explanation?: string
          draft_reply?: string
          pending_delete: boolean
        }>
        console.log('[AUTO-SORT] Results:', classifications)

        const VALID_ACTIONS: BulkRecommendedAction[] = ['pending_delete', 'archive', 'keep_for_manual_action', 'draft_reply_ready']
        const VALID_CATEGORIES: SortCategory[] = ['urgent', 'important', 'normal', 'newsletter', 'spam', 'irrelevant']

        const nextOutputs: AiOutputs = {}
        for (const c of classifications) {
          const category = (VALID_CATEGORIES.includes(c.category as SortCategory) ? c.category : 'normal') as SortCategory
          const recommendedAction = (VALID_ACTIONS.includes((c.recommended_action ?? '') as BulkRecommendedAction)
            ? c.recommended_action
            : 'keep_for_manual_action') as BulkRecommendedAction

          const entry: BulkAiResult = {
            category,
            urgencyScore: typeof c.urgency_score === 'number' ? Math.max(1, Math.min(10, c.urgency_score)) : 5,
            summary: (c.summary ?? '').slice(0, 500),
            reason: (c.reason ?? '').slice(0, 300),
            needsReply: !!c.needs_reply,
            recommendedAction,
            actionExplanation: (c.action_explanation ?? '').slice(0, 300),
            status: 'classified',
          }
          if (c.draft_reply && (c.needs_reply || recommendedAction === 'draft_reply_ready')) {
            entry.draftReply = c.draft_reply.slice(0, 4000)
          }
          if (c.pending_delete && recommendedAction === 'pending_delete') {
            entry.pendingDeletePreviewUntil = new Date(Date.now() + 15 * 1000).toISOString()
          }
          nextOutputs[c.id] = entry
        }

        setBulkAiOutputs((prev) => ({ ...prev, ...nextOutputs }))

        const pendingIds = classifications.filter((c) => c.pending_delete).map((c) => c.id)
        keptDuringPreviewIdsRef.current = new Set()
        setKeptDuringPreviewIds(new Set())
        clearMultiSelect()
        await fetchMessages()
        const sortedMessages = sortMessagesByCategory(useEmailInboxStore.getState().messages)
        console.log('[AUTO-SORT] Store updated, sorted messages:', sortedMessages.map((m) => ({ id: m.id, category: m.sort_category, urgency: m.urgency_score })))
        if (pendingIds.length > 0 && window.emailInbox?.markPendingDelete) {
          pendingIdsRef.current = pendingIds
          if (pendingDeleteTimerRef.current) clearTimeout(pendingDeleteTimerRef.current)
          pendingDeleteTimerRef.current = setTimeout(async () => {
            pendingDeleteTimerRef.current = null
            const idsToMove = pendingIdsRef.current.filter((id) => !keptDuringPreviewIdsRef.current.has(id))
            if (idsToMove.length === 0) return
            const markRes = await window.emailInbox!.markPendingDelete!(idsToMove)
            if (markRes.ok) {
              setPendingDeleteToast({ count: idsToMove.length, ids: idsToMove })
              setBulkAiOutputs((prev) => {
                const next = { ...prev }
                for (const id of idsToMove) {
                  if (next[id]) next[id] = { ...next[id], status: 'action_taken' as const }
                }
                return next
              })
              fetchMessages()
            }
          }, 15 * 1000)
        }
      }
    } finally {
      setAiSortProgress(null)
    }
  }, [multiSelectIds, clearMultiSelect, fetchMessages])

  const handleUndoPendingDelete = useCallback(
    async (ids: string[]) => {
      if (!window.emailInbox?.cancelPendingDelete) return
      for (const id of ids) {
        await window.emailInbox.cancelPendingDelete(id)
      }
      setPendingDeleteToast(null)
      fetchMessages()
    },
    [fetchMessages]
  )

  /** Cancel the scheduled pending-delete move for one message during the 15s preview. */
  const handleKeepDuringPreview = useCallback((messageId: string) => {
    keptDuringPreviewIdsRef.current.add(messageId)
    setKeptDuringPreviewIds((prev) => new Set([...prev, messageId]))
  }, [])

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
      setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: 'summary' } }))
      try {
        const res = await window.emailInbox.aiSummarize(messageId)
        if (res.ok && res.data?.summary) {
          setBulkAiOutputs((prev) => {
            const existing = prev[messageId] ?? {}
            return {
              ...prev,
              [messageId]: {
                ...existing,
                summary: res.data!.summary,
                status: existing.status ?? 'classified',
                loading: undefined,
              },
            }
          })
        } else {
          setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
        }
      } catch {
        setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
      }
    },
    []
  )

  const handleDraftReply = useCallback(
    async (messageId: string) => {
      if (!window.emailInbox?.aiDraftReply) return
      setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: 'draft' } }))
      try {
        const res = await window.emailInbox.aiDraftReply(messageId)
        if (res.ok && res.data?.draft) {
          setBulkAiOutputs((prev) => {
            const existing = prev[messageId] ?? {}
            return {
              ...prev,
              [messageId]: {
                ...existing,
                draftReply: res.data!.draft,
                status: existing.status ?? 'classified',
                loading: undefined,
              },
            }
          })
        } else {
          setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
        }
      } catch {
        setBulkAiOutputs((prev) => ({ ...prev, [messageId]: { ...prev[messageId], loading: undefined } }))
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
            <span style={{ color: MUTED }}>Loading…</span>
          </div>
        )
      }

      if (hasStructured) {
        const rec = output.recommendedAction
        const panelMod = `bulk-action-card-panel--${rec}`
        const summaryCls = isExpanded ? 'bulk-action-card-summary bulk-action-card-summary--expanded' : 'bulk-action-card-summary bulk-action-card-summary--collapsed'
        return (
          <div className={`bulk-action-card ${isExpanded ? 'bulk-action-card--expanded' : ''}`} style={{ borderLeftColor: borderColor }}>
            <div className="bulk-action-card-header">
              <span className="bulk-action-card-badge" style={{ background: `${borderColor}33`, color: borderColor }}>
                {(output.category ?? 'normal').toUpperCase()}
              </span>
              <span className="bulk-action-card-urgency" title="Urgency 1–10">
                U{urgency}
              </span>
            </div>
            <div className={`bulk-action-card-panel bulk-action-card-panel--recommended ${panelMod}`}>
              <span className="bulk-action-card-panel-label">Next</span>
              <span className="bulk-action-card-panel-action">
                {rec === 'pending_delete' && '🗑 Pending Delete'}
                {rec === 'archive' && '📦 Archive'}
                {rec === 'keep_for_manual_action' && '✋ Review manually'}
                {rec === 'draft_reply_ready' && '✉ Send draft reply'}
              </span>
            </div>
            {output.summary && (
              <div className={summaryCls}>{output.summary}</div>
            )}
            {(isExpanded && output.reason) && (
              <div className="bulk-action-card-reason">{output.reason}</div>
            )}
            {rec === 'pending_delete' && !keptDuringPreviewIds.has(msg.id) && (
              <div className="bulk-action-card-pending-preview">
                <span className="bulk-action-card-pending-badge">PENDING DELETE</span>
                <span className="bulk-action-card-pending-countdown">
                  {output.pendingDeletePreviewUntil ? 'Moving in 15s' : 'Delete to move to Pending Delete'}
                </span>
                {output.pendingDeletePreviewUntil && (
                  <button
                    type="button"
                    className="bulk-action-card-keep-btn"
                    onClick={() => handleKeepDuringPreview(msg.id)}
                  >
                    Keep
                  </button>
                )}
              </div>
            )}
            {(isExpanded && output.actionExplanation) && (
              <div className="bulk-action-card-explanation">{output.actionExplanation}</div>
            )}
            {output.draftReply != null && output.draftReply !== '' && (
              <div className={`bulk-action-card-draft ${isExpanded ? 'bulk-action-card-draft--expanded' : ''}`}>
                <label className="bulk-action-card-draft-label">Draft reply — edit before sending</label>
                <textarea
                  className="bulk-action-card-draft-textarea"
                  value={output.draftReply}
                  onChange={(e) => updateDraftReply(msg.id, e.target.value)}
                  placeholder="Edit draft…"
                  rows={isExpanded ? 4 : 2}
                />
              </div>
            )}
            <div className="bulk-action-card-buttons">
              {rec === 'draft_reply_ready' && output.draftReply && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--primary"
                  onClick={() => handleSendDraft(msg, output.draftReply!)}
                >
                  ✉ Send via Email
                </button>
              )}
              {(rec === 'archive' || rec === 'keep_for_manual_action') && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--primary"
                  onClick={() => handleArchiveOne(msg)}
                >
                  📦 Archive
                </button>
              )}
              {rec === 'pending_delete' && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--danger bulk-action-card-btn--primary-emphasis"
                  onClick={() => handleDeleteOne(msg)}
                >
                  🗑 Delete
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
                  className="bulk-action-card-btn-tertiary"
                  onClick={() => handleSummarize(msg.id)}
                  disabled={!!output?.loading}
                  title="Regenerate summary"
                >
                  ✨ Summarize
                </button>
                <button
                  type="button"
                  className="bulk-action-card-btn-tertiary"
                  onClick={() => handleDraftReply(msg.id)}
                  disabled={!!output?.loading}
                  title="Regenerate draft"
                >
                  ✍ Draft
                </button>
              </div>
            </div>
          </div>
        )
      }

      // Fallback: summary or draft without full structured result
      if (output?.summary || output?.draftReply) {
        const fallbackSummaryCls = isExpanded ? 'bulk-action-card-summary bulk-action-card-summary--expanded' : 'bulk-action-card-summary bulk-action-card-summary--collapsed'
        return (
          <div className={`bulk-action-card bulk-action-card--fallback ${isExpanded ? 'bulk-action-card--expanded' : ''}`}>
            {output.summary && (
              <div className={fallbackSummaryCls}>{output.summary}</div>
            )}
            {output.draftReply && (
              <div className={`bulk-action-card-draft ${isExpanded ? 'bulk-action-card-draft--expanded' : ''}`}>
                <label className="bulk-action-card-draft-label">Draft — edit before sending</label>
                <textarea
                  className="bulk-action-card-draft-textarea"
                  value={output.draftReply}
                  onChange={(e) => updateDraftReply(msg.id, e.target.value)}
                  placeholder="Edit draft…"
                  rows={isExpanded ? 4 : 2}
                />
              </div>
            )}
            <div className="bulk-action-card-buttons">
              {output.draftReply && (
                <button
                  type="button"
                  className="bulk-action-card-btn bulk-action-card-btn--primary"
                  onClick={() => handleSendDraft(msg, output.draftReply!)}
                >
                  ✉ Send via Email
                </button>
              )}
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--muted"
                onClick={() => handleSummarize(msg.id)}
                disabled={!!output?.loading}
              >
                ✨ Summarize
              </button>
              <button
                type="button"
                className="bulk-action-card-btn bulk-action-card-btn--muted"
                onClick={() => handleDraftReply(msg.id)}
                disabled={!!output?.loading}
              >
                ✍ Draft
              </button>
            </div>
          </div>
        )
      }

      // Empty state
      return (
        <div className="bulk-action-card bulk-action-card--empty">
          <div className="bulk-view-ai-empty">
            <span className="bulk-view-ai-empty-icon">✨</span>
            Summarize or draft a reply to see output here.
          </div>
          <div className="bulk-action-card-buttons">
            <button
              type="button"
              className="bulk-action-card-btn bulk-action-card-btn--muted"
              onClick={() => handleSummarize(msg.id)}
            >
              ✨ Summarize
            </button>
            <button
              type="button"
              className="bulk-action-card-btn bulk-action-card-btn--muted"
              onClick={() => handleDraftReply(msg.id)}
            >
              ✍ Draft Reply
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
      handleSummarize,
      handleDraftReply,
      handleKeepDuringPreview,
      keptDuringPreviewIds,
    ]
  )

  const expandedMessage =
    expandedMessageId && selectedMessageId === expandedMessageId ? selectedMessage : null

  useEffect(() => {
    if (!expandedMessageId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseExpand()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [expandedMessageId, handleCloseExpand])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const inInput = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.getAttribute?.('contenteditable') === 'true')
      if (inInput) return
      if (selectedCount === 0) return
      if (e.key === 'a' || e.key === 'A') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          handleBulkArchive()
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleBulkDelete()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedCount, handleBulkArchive, handleBulkDelete])

  return (
    <div className={`bulk-view-root ${bulkCompactMode ? 'bulk-view--compact' : ''}`}>
      {/* Toolbar */}
      <div className="bulk-view-toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleSelectAll}
            disabled={messages.length === 0}
          />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Select all</span>
        </label>
        <span style={{ fontSize: 12, color: MUTED }}>
          {selectedCount} selected
        </span>
        <span style={{ color: '#cbd5e1', margin: '0 4px' }}>|</span>
        <button
          type="button"
          onClick={() => setFilter({ filter: 'all' })}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: filter.filter === 'all' ? 'rgba(147,51,234,0.1)' : '#f1f5f9',
            border: `1px solid ${filter.filter === 'all' ? 'rgba(147,51,234,0.35)' : '#e2e8f0'}`,
            borderRadius: 6,
            color: filter.filter === 'all' ? '#7c3aed' : '#334155',
            cursor: 'pointer',
          }}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setFilter({ filter: 'pending_delete' })}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: filter.filter === 'pending_delete' ? 'rgba(239,68,68,0.1)' : '#f1f5f9',
            border: `1px solid ${filter.filter === 'pending_delete' ? 'rgba(239,68,68,0.35)' : '#e2e8f0'}`,
            borderRadius: 6,
            color: filter.filter === 'pending_delete' ? '#dc2626' : '#334155',
            cursor: 'pointer',
          }}
        >
          Pending Delete
        </button>
        <span style={{ color: '#cbd5e1', margin: '0 4px' }}>|</span>
        <button
          type="button"
          onClick={handleBulkDelete}
          disabled={selectedCount === 0}
          title={selectedCount ? 'Delete selected (Del)' : undefined}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            color: '#dc2626',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Delete
        </button>
        <button
          type="button"
          onClick={handleBulkArchive}
          disabled={selectedCount === 0}
          title={selectedCount ? 'Archive selected (A)' : undefined}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            color: '#334155',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Archive
        </button>
        <button
          type="button"
          onClick={handleBulkMarkRead}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            color: '#334155',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Mark Read
        </button>
        <button
          type="button"
          onClick={handleBulkCategorize}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            color: '#334155',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          Categorize
        </button>
        <button
          type="button"
          onClick={handleAiAutoSort}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'var(--purple-accent, #9333ea)',
            border: '1px solid rgba(147,51,234,0.5)',
            borderRadius: 6,
            color: '#ffffff',
            cursor: selectedCount ? 'pointer' : 'not-allowed',
            opacity: selectedCount ? 1 : 0.5,
          }}
        >
          ✨ AI Auto-Sort
        </button>
        <div style={{ flex: 1, minWidth: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setBulkCompactMode(!bulkCompactMode)}
            title={bulkCompactMode ? 'Standard view' : 'Compact view (denser)'}
            style={{
              padding: '4px 8px',
              fontSize: 10,
              fontWeight: 600,
              background: bulkCompactMode ? 'rgba(147,51,234,0.12)' : '#f1f5f9',
              border: `1px solid ${bulkCompactMode ? 'rgba(147,51,234,0.35)' : '#e2e8f0'}`,
              borderRadius: 6,
              color: bulkCompactMode ? '#7c3aed' : '#334155',
              cursor: 'pointer',
            }}
          >
            {bulkCompactMode ? '⊟ Compact' : '⊞ Compact'}
          </button>
          <span style={{ color: '#cbd5e1', margin: '0 2px' }}>|</span>
          <span style={{ fontSize: 11, color: MUTED }}>Batch:</span>
          <select
            value={bulkBatchSize}
            onChange={(e) => setBulkBatchSize(Number(e.target.value))}
            style={{
              padding: '4px 8px',
              fontSize: 11,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: 'var(--color-text, #e2e8f0)',
              cursor: 'pointer',
            }}
          >
            {[10, 12, 24, 48].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span style={{ color: 'var(--color-border, rgba(255,255,255,0.2))', margin: '0 4px' }}>|</span>
          <button
            type="button"
            onClick={() => setBulkPage(Math.max(0, bulkPage - 1))}
            disabled={!canPrev}
            style={{
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: canPrev ? 'var(--color-text, #e2e8f0)' : MUTED,
              cursor: canPrev ? 'pointer' : 'not-allowed',
            }}
          >
            Prev
          </button>
          <span style={{ fontSize: 12, color: MUTED }}>
            Page {bulkPage + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setBulkPage(Math.min(totalPages - 1, bulkPage + 1))}
            disabled={!canNext}
            style={{
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              color: canNext ? 'var(--color-text, #e2e8f0)' : MUTED,
              cursor: canNext ? 'pointer' : 'not-allowed',
            }}
          >
            Next
          </button>
        </div>
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
            {aiSortProgress && (
              <div style={{ padding: 8, textAlign: 'center', fontSize: 12, color: MUTED }}>
                {aiSortProgress}
              </div>
            )}
            {pendingDeleteToast && (
              <div
                style={{
                  padding: '10px 14px',
                  margin: '0 12px 12px',
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 12, color: '#fca5a5' }}>
                  {pendingDeleteToast.count} message{pendingDeleteToast.count !== 1 ? 's' : ''} moved to Pending Delete.
                </span>
                <button
                  type="button"
                  onClick={() => handleUndoPendingDelete(pendingDeleteToast.ids)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(34,197,94,0.2)',
                    border: '1px solid rgba(34,197,94,0.4)',
                    borderRadius: 6,
                    color: '#86efac',
                    cursor: 'pointer',
                  }}
                >
                  Undo
                </button>
              </div>
            )}
          <div className="bulk-view-grid">
            {sortMessagesByCategory(messages).map((msg) => {
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
                  className={`bulk-view-row ${isMultiSelected ? 'bulk-view-row--multi' : ''} ${isFocused ? 'bulk-view-row--focused' : ''} ${isCardExpanded ? 'bulk-view-row--expanded' : ''}`}
                  style={{
                    borderLeft: borderColor ? `4px solid ${borderColor}` : undefined,
                    background: bgTint !== 'transparent' ? bgTint : undefined,
                  }}
                >
                  {/* Left: Message card — click toggles focus */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('input[type="checkbox"]') || (e.target as HTMLElement).closest('.bulk-view-expand-btn')) return
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
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
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
