/**
 * EmailInboxView — Main inbox view matching HandshakeView layout.
 * Left: toolbar + message list.
 * When no message selected: center = provider area, right = capsule drop.
 * When message selected: right = 50/50 message + AI workspace.
 */

import { useEffect, useCallback, useState, useRef } from 'react'
import EmailInboxToolbar from './EmailInboxToolbar'
import EmailMessageDetail from './EmailMessageDetail'
import EmailComposeOverlay from './EmailComposeOverlay'
import BeapMessageImportZone from './BeapMessageImportZone'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import { EmailConnectWizard } from '@ext/shared/components/EmailConnectWizard'
import { useEmailInboxStore, type InboxMessage } from '../stores/useEmailInboxStore'
import type { NormalInboxAiResult } from '../types/inboxAi'
import '../components/handshakeViewTypes'

// ── Relative date ──

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

// ── InboxDetailAiPanel (right column: multi-section AI dashboard) ──
// Uses NormalInboxAiResult — advisory AI: informative only, no silent actions

interface InboxDetailAiPanelProps {
  messageId: string
  message: InboxMessage | null
  onSendDraft?: (draft: string, message: InboxMessage) => void
  onArchive?: (messageIds: string[]) => void
  onDelete?: (messageIds: string[]) => void
}

function InboxDetailAiPanel({ messageId, message, onSendDraft, onArchive, onDelete }: InboxDetailAiPanelProps) {
  const [analysis, setAnalysis] = useState<NormalInboxAiResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState(false)
  const [editedDraft, setEditedDraft] = useState('')
  const [actionChecked, setActionChecked] = useState<Record<number, boolean>>({})
  const summaryRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLDivElement>(null)

  const runAnalysis = useCallback(async () => {
    if (!window.emailInbox?.aiAnalyzeMessage) return
    setAnalysisLoading(true)
    setAnalysis(null)
    setAnalysisError(false)
    try {
      const res = await window.emailInbox.aiAnalyzeMessage(messageId)
      if (res.ok && res.data && !(res.data as { error?: string }).error) {
        setAnalysis({
          needsReply: res.data.needsReply,
          needsReplyReason: res.data.needsReplyReason ?? '',
          summary: res.data.summary ?? '',
          urgencyScore: res.data.urgencyScore ?? 5,
          urgencyReason: res.data.urgencyReason ?? '',
          actionItems: res.data.actionItems ?? [],
          archiveRecommendation: res.data.archiveRecommendation ?? 'keep',
          archiveReason: res.data.archiveReason ?? '',
        })
      } else {
        setAnalysisError(true)
      }
    } catch {
      setAnalysisError(true)
    } finally {
      setAnalysisLoading(false)
    }
  }, [messageId])

  useEffect(() => {
    if (!messageId) return
    setAnalysis(null)
    setDraft(null)
    setEditedDraft('')
    setActionChecked({})
    runAnalysis()
  }, [messageId, runAnalysis])

  const handleSummarize = useCallback(async () => {
    if (!window.emailInbox?.aiSummarize) return
    setAnalysisLoading(true)
    setAnalysisError(false)
    try {
      const res = await window.emailInbox.aiSummarize(messageId)
      if (res.ok && res.data?.summary) {
        setAnalysis((prev) =>
          prev ? { ...prev, summary: res.data!.summary } : {
            needsReply: false,
            needsReplyReason: '',
            summary: res.data!.summary,
            urgencyScore: 5,
            urgencyReason: '',
            actionItems: [],
            archiveRecommendation: 'keep',
            archiveReason: '',
          }
        )
      }
    } catch {
      setAnalysisError(true)
    } finally {
      setAnalysisLoading(false)
    }
    summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messageId])

  const handleDraftReply = useCallback(async () => {
    if (!window.emailInbox?.aiDraftReply) return
    setDraftLoading(true)
    setDraft(null)
    setDraftError(false)
    try {
      const res = await window.emailInbox.aiDraftReply(messageId)
      if (res.ok && res.data?.draft) {
        setDraft(res.data.draft)
        setEditedDraft(res.data.draft)
        setDraftError(!!(res.data as { error?: boolean }).error)
      } else {
        setDraftError(true)
      }
    } catch {
      setDraftError(true)
    } finally {
      setDraftLoading(false)
    }
    draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messageId])

  const handleRegenerateDraft = useCallback(() => {
    handleDraftReply()
  }, [handleDraftReply])

  const handleSend = useCallback(() => {
    if (!message || !onSendDraft) return
      const draftToSend = (editedDraft || draft) ?? ''
    if (draftToSend.trim()) onSendDraft(draftToSend, message)
  }, [message, onSendDraft, editedDraft, draft])

  const handleArchive = useCallback(() => {
    if (onArchive && messageId) onArchive([messageId])
  }, [onArchive, messageId])

  const handleDelete = useCallback(() => {
    if (onDelete && messageId) onDelete([messageId])
  }, [onDelete, messageId])

  const handleRetryAnalysis = useCallback(() => {
    setAnalysisError(false)
    runAnalysis()
  }, [runAnalysis])

  const handleRetryDraft = useCallback(() => {
    setDraftError(false)
    handleDraftReply()
  }, [handleDraftReply])

  const toggleActionChecked = useCallback((idx: number) => {
    setActionChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }, [])

  const isDepackaged = message?.source_type === 'email_plain'

  const urgencyColor = analysis
    ? analysis.urgencyScore <= 3
      ? '#22c55e'
      : analysis.urgencyScore <= 6
        ? '#eab308'
        : '#ef4444'
    : 'var(--color-text-muted, #94a3b8)'

  return (
    <div className="inbox-detail-ai-inner inbox-detail-ai-premium">
      <div className="inbox-detail-ai-advisory-banner">
        AI suggestions — you decide what to do
      </div>
      <div className="inbox-detail-ai-actions">
        <button type="button" onClick={handleSummarize} disabled={analysisLoading || draftLoading}>
          {analysisLoading && !analysis ? 'Analyzing…' : 'Summarize'}
        </button>
        <button type="button" onClick={handleDraftReply} disabled={analysisLoading || draftLoading}>
          {draftLoading ? 'Generating…' : 'Draft Reply'}
        </button>
        {onDelete && messageId && (
          <button type="button" className="inbox-detail-ai-btn-delete" onClick={handleDelete}>
            Delete
          </button>
        )}
      </div>
      <div className="inbox-detail-ai-scroll">
        {analysisError && (
          <div className="inbox-detail-ai-error-banner">
            <span>AI analysis failed. Check Ollama.</span>
            <button type="button" onClick={handleRetryAnalysis}>Retry</button>
          </div>
        )}

        {/* Response Needed — always visible */}
        <div className="inbox-detail-ai-row">
          <span className="inbox-detail-ai-row-label">Response Needed</span>
          <div className="inbox-detail-ai-row-value">
            {analysisLoading && !analysis ? (
              <span className="inbox-detail-ai-skeleton-inline" />
            ) : analysis ? (
              <span className="inbox-detail-ai-response-needed">
                <span className="inbox-detail-ai-dot" style={{ background: analysis.needsReply ? '#ef4444' : '#22c55e' }} />
                {analysis.needsReply ? 'Yes' : 'No'} — {analysis.needsReplyReason || '—'}
              </span>
            ) : (
              <span className="inbox-detail-ai-muted">—</span>
            )}
          </div>
        </div>

        {/* Summary — always visible */}
        <div className="inbox-detail-ai-row" ref={summaryRef}>
          <span className="inbox-detail-ai-row-label">Summary</span>
          <div className="inbox-detail-ai-row-value">
            {analysisLoading && !analysis ? (
              <span className="inbox-detail-ai-skeleton-inline" style={{ width: '80%' }} />
            ) : analysis?.summary ? (
              <span className="inbox-detail-ai-text">{analysis.summary}</span>
            ) : (
              <span className="inbox-detail-ai-muted">—</span>
            )}
          </div>
        </div>

        {/* Urgency — always visible */}
        <div className="inbox-detail-ai-row">
          <span className="inbox-detail-ai-row-label">Urgency</span>
          <div className="inbox-detail-ai-row-value">
            {analysisLoading && !analysis ? (
              <span className="inbox-detail-ai-skeleton-inline" />
            ) : analysis ? (
              <>
                <div className="inbox-detail-ai-urgency-bar">
                  <div className="inbox-detail-ai-urgency-fill" style={{ width: `${(analysis.urgencyScore / 10) * 100}%`, background: urgencyColor }} />
                </div>
                <span className="inbox-detail-ai-urgency-label">{analysis.urgencyScore}/10 — {analysis.urgencyReason || '—'}</span>
              </>
            ) : (
              <span className="inbox-detail-ai-muted">—</span>
            )}
          </div>
        </div>

        {/* Draft Reply — always visible */}
        <div className="inbox-detail-ai-row inbox-detail-ai-row-draft" ref={draftRef}>
          <span className="inbox-detail-ai-row-label">Draft Reply</span>
          <div className="inbox-detail-ai-row-value">
            {draftLoading ? (
              <span className="inbox-detail-ai-skeleton-inline" style={{ width: '90%', height: 48 }} />
            ) : draft ? (
              <>
                {draftError && (
                  <div className="inbox-detail-ai-error-banner">
                    <span>Draft generation failed.</span>
                    <button type="button" onClick={handleRetryDraft}>Retry</button>
                  </div>
                )}
                <textarea
                  value={editedDraft || draft}
                  onChange={(e) => setEditedDraft(e.target.value)}
                  className="inbox-detail-ai-draft-textarea"
                  placeholder="Edit draft before sending…"
                />
                <div className="inbox-detail-ai-draft-actions">
                  <button type="button" className="inbox-detail-ai-btn-secondary" onClick={handleRegenerateDraft}>Regenerate</button>
                  {message && onSendDraft && (
                    <button type="button" className="inbox-detail-ai-btn-primary" onClick={handleSend}>
                      {isDepackaged ? 'Send via Email' : 'Send via BEAP'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <span className="inbox-detail-ai-muted">Click &quot;Draft Reply&quot; to generate.</span>
            )}
          </div>
        </div>

        {/* Action Items — always visible */}
        <div className="inbox-detail-ai-row">
          <span className="inbox-detail-ai-row-label">Action Items</span>
          <div className="inbox-detail-ai-row-value">
            {analysisLoading && !analysis ? (
              <span className="inbox-detail-ai-skeleton-inline" />
            ) : analysis?.actionItems?.length ? (
              <ul className="inbox-detail-ai-action-list">
                {analysis.actionItems.map((item, idx) => (
                  <li key={idx} className="inbox-detail-ai-action-item">
                    <input type="checkbox" checked={!!actionChecked[idx]} onChange={() => toggleActionChecked(idx)} />
                    <span style={{ textDecoration: actionChecked[idx] ? 'line-through' : undefined }}>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="inbox-detail-ai-muted">None.</span>
            )}
          </div>
        </div>

        {/* Archive suggestion — advisory only, user must click to act */}
        <div className="inbox-detail-ai-row">
          <span className="inbox-detail-ai-row-label">Suggested action</span>
          <div className="inbox-detail-ai-row-value">
            {analysisLoading && !analysis ? (
              <span className="inbox-detail-ai-skeleton-inline" />
            ) : analysis ? (
              <>
                <span className="inbox-detail-ai-text">
                  {analysis.archiveRecommendation === 'archive'
                    ? `Consider archiving — ${analysis.archiveReason || '—'}`
                    : `Keep for now — ${analysis.archiveReason || '—'}`}
                </span>
                {analysis.archiveRecommendation === 'archive' && onArchive && (
                  <button type="button" className="inbox-detail-ai-btn-secondary inbox-detail-ai-archive-btn" onClick={handleArchive}>Archive</button>
                )}
              </>
            ) : (
              <span className="inbox-detail-ai-muted">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── InboxMessageRow ──

interface InboxMessageRowProps {
  message: InboxMessage
  selected: boolean
  bulkMode: boolean
  multiSelected: boolean
  onSelect: () => void
  onToggleMultiSelect: () => void
}

function InboxMessageRow({
  message,
  selected,
  bulkMode,
  multiSelected,
  onSelect,
  onToggleMultiSelect,
}: InboxMessageRowProps) {
  const isBeap = message.source_type === 'email_beap' || message.source_type === 'direct_beap'
  const bodyPreview = (message.body_text || '').slice(0, 100).replace(/\s+/g, ' ').trim()
  const hasAttachments = message.has_attachments === 1

  const handleClick = () => {
    if (bulkMode) {
      onToggleMultiSelect()
    } else {
      onSelect()
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`inbox-message-row ${selected && !bulkMode ? 'inbox-message-row--selected' : ''} ${bulkMode && multiSelected ? 'inbox-message-row--multi' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      {bulkMode && (
        <div
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `2px solid ${multiSelected ? 'var(--purple-accent, #9333ea)' : 'var(--color-border, rgba(255,255,255,0.2))'}`,
            background: multiSelected ? 'var(--purple-accent, #9333ea)' : 'transparent',
          }}
        />
      )}
      {!bulkMode && selected && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 14,
            lineHeight: 1,
            color: 'var(--purple-accent, #a78bfa)',
          }}
          title="Focused message — chat/search scoped to this BEAP message"
          aria-hidden
        >
          👉
        </span>
      )}

      {/* Source badge */}
      <div
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          background: isBeap ? 'var(--purple-accent, #9333ea)' : 'rgba(107,114,128,0.5)',
          color: '#fff',
        }}
      >
        {isBeap ? 'B' : '✉'}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: message.read_status === 0 ? 700 : 500,
              color: 'var(--color-text, #e2e8f0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {message.from_name || message.from_address || '—'}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              color: 'var(--color-text-muted, #94a3b8)',
            }}
          >
            {formatRelativeDate(message.received_at)}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text, #e2e8f0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {message.subject || '(No subject)'}
        </div>
        {bodyPreview && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted, #94a3b8)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {bodyPreview}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {hasAttachments && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted, #94a3b8)' }}>📎</span>
          )}
          {message.starred === 1 && (
            <span style={{ fontSize: 10, color: 'var(--purple-accent, #9333ea)' }}>⭐</span>
          )}
          {message.sort_category && (
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--color-surface, rgba(255,255,255,0.04))',
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              {message.sort_category}
            </span>
          )}
          {message.handshake_id && (
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--purple-accent-muted, rgba(147,51,234,0.2))',
                color: 'var(--purple-accent, #9333ea)',
              }}
            >
              🤝
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ──

export interface EmailInboxViewProps {
  accounts: Array<{ id: string; email: string }>
  selectedMessageId?: string | null
  onSelectMessage?: (messageId: string | null) => void
  selectedAttachmentId?: string | null
  onSelectAttachment?: (attachmentId: string | null) => void
}

export default function EmailInboxView({
  accounts,
  selectedMessageId: selectedMessageIdProp,
  onSelectMessage,
  selectedAttachmentId: selectedAttachmentIdProp,
  onSelectAttachment,
}: EmailInboxViewProps) {
  const {
    messages,
    total,
    loading,
    error,
    selectedMessageId,
    selectedMessage,
    selectedAttachmentId,
    filter,
    bulkMode,
    multiSelectIds,
    autoSyncEnabled,
    syncing,
    fetchMessages,
    selectMessage,
    selectAttachment,
    setFilter,
    setBulkMode,
    toggleMultiSelect,
    clearMultiSelect,
    markRead,
    archiveMessages,
    deleteMessages,
    setCategory,
    syncAccount,
    toggleAutoSync,
    loadSyncState,
  } = useEmailInboxStore()

  const primaryAccountId = accounts[0]?.id

  useEffect(() => {
    if (primaryAccountId) loadSyncState(primaryAccountId)
  }, [primaryAccountId, loadSyncState])

  // Provider/account state for no-selection workspace
  const [providerAccounts, setProviderAccounts] = useState<Array<{ id: string; displayName: string; email: string; provider: 'gmail' | 'microsoft365' | 'imap'; status: 'active' | 'error' | 'disabled'; lastError?: string }>>([])
  const [isLoadingProviderAccounts, setIsLoadingProviderAccounts] = useState(true)
  const [selectedProviderAccountId, setSelectedProviderAccountId] = useState<string | null>(null)
  const [showEmailConnectModal, setShowEmailConnectModal] = useState(false)
  const [showEmailCompose, setShowEmailCompose] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState<InboxMessage | null>(null)
  const [replyDraftBody, setReplyDraftBody] = useState<string>('')
  const composeClickRef = useRef<number>(0)

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
    if (!selectedMessageId) loadProviderAccounts()
  }, [selectedMessageId, loadProviderAccounts])

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

  // Sync App-level selection to store when props change
  useEffect(() => {
    if (selectedMessageIdProp !== undefined && selectedMessageIdProp !== selectedMessageId) {
      selectMessage(selectedMessageIdProp)
    }
  }, [selectedMessageIdProp, selectedMessageId, selectMessage])

  useEffect(() => {
    if (selectedAttachmentIdProp !== undefined && selectedAttachmentIdProp !== selectedAttachmentId) {
      selectAttachment(selectedAttachmentIdProp)
    }
  }, [selectedAttachmentIdProp, selectedAttachmentId, selectAttachment])

  const handleSelectMessage = useCallback(
    (id: string) => {
      const next = selectedMessageId === id ? null : id
      selectMessage(next)
      onSelectMessage?.(next)
    },
    [selectedMessageId, selectMessage, onSelectMessage]
  )

  const handleSelectAttachment = useCallback(
    (id: string | null) => {
      selectAttachment(id)
      onSelectAttachment?.(id)
    },
    [selectAttachment, onSelectAttachment]
  )
  const selectedCount = multiSelectIds.size

  const handleSync = useCallback(() => {
    if (primaryAccountId) syncAccount(primaryAccountId)
  }, [primaryAccountId, syncAccount])

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

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    const unsub = window.emailInbox?.onNewMessages?.(() => {
      fetchMessages()
    })
    return () => unsub?.()
  }, [fetchMessages])

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
      setReplyDraftBody('')
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

  const handleSendDraft = useCallback((draft: string, msg: InboxMessage) => {
    const isDepackaged = msg.source_type === 'email_plain'
    if (isDepackaged) {
      const subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || '(No subject)'}`
      setReplyToMessage({ ...msg, subject })
      setReplyDraftBody(draft)
      setShowEmailCompose(true)
    } else {
      navigator.clipboard?.writeText(draft).catch(() => {})
      window.analysisDashboard?.openBeapDraft?.()
    }
  }, [])

  const gridCols = selectedMessageId ? '320px 1fr' : '320px 1fr 320px'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-bg, #0f172a)',
        color: 'var(--color-text, #e2e8f0)',
      }}
    >
      {/* Left panel: toolbar + message list */}
      <div
        style={{
          borderRight: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <EmailInboxToolbar
          filter={filter}
          onFilterChange={(partial) => setFilter(partial)}
          accounts={accounts}
          autoSyncEnabled={autoSyncEnabled}
          syncing={syncing}
          onSync={handleSync}
          onToggleAutoSync={toggleAutoSync}
          bulkMode={bulkMode}
          onBulkModeChange={setBulkMode}
          selectedCount={selectedCount}
          onBulkDelete={handleBulkDelete}
          onBulkArchive={handleBulkArchive}
          onBulkCategorize={
            selectedCount > 0
              ? () => {
                  const ids = Array.from(multiSelectIds)
                  if (ids.length) {
                    const cat = window.prompt('Category name (or leave empty to clear):')
                    if (cat !== null) setCategory(ids, cat)
                  }
                }
              : undefined
          }
        />

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {loading ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              Loading…
            </div>
          ) : error ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: '#ef4444',
              }}
            >
              {error}
            </div>
          ) : messages.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>✉</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                No messages.
                <br />
                Pull to sync or connect an email account.
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <InboxMessageRow
                key={msg.id}
                message={msg}
                selected={selectedMessageId === msg.id}
                bulkMode={bulkMode}
                multiSelected={multiSelectIds.has(msg.id)}
                onSelect={() => handleSelectMessage(msg.id)}
                onToggleMultiSelect={() => toggleMultiSelect(msg.id)}
              />
            ))
          )}
        </div>

        <div
          style={{
            padding: '8px 14px',
            fontSize: 11,
            color: 'var(--color-text-muted, #94a3b8)',
            borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          }}
        >
          {total} message{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Center + Right when no message selected: provider area + capsule drop */}
      {!selectedMessageId && (
        <>
          <div
            className="inbox-no-selection-center"
            style={{
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overflowX: 'hidden',
              minWidth: 0,
              minHeight: 0,
              borderRight: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            }}
          >
            <div className="inbox-provider-section">
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
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted, #94a3b8)',
                padding: 24,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>✉</div>
              <div style={{ fontSize: 13, textAlign: 'center' }}>
                {messages.length === 0
                  ? 'Connect an email account or import a .beap file to get started'
                  : 'Select a message to view details'}
              </div>
            </div>
          </div>
          <div
            className="inbox-no-selection-right"
            style={{
              borderLeft: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            <div
              style={{
                padding: '14px 12px',
                borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Import & Compose
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              <BeapMessageImportZone onSubmitted={fetchMessages} />
            </div>
          </div>
        </>
      )}

      {/* Right panel: 50/50 message + AI workspace (only when message selected) */}
      {selectedMessageId && (
        <div className="inbox-detail-workspace">
          <div className="inbox-detail-message">
            <EmailMessageDetail
              message={selectedMessage}
              onSelectAttachment={onSelectAttachment ? handleSelectAttachment : undefined}
              onReply={handleReply}
            />
          </div>
          <div className="inbox-detail-ai">
            <InboxDetailAiPanel
              messageId={selectedMessageId}
              message={selectedMessage}
              onSendDraft={handleSendDraft}
              onArchive={archiveMessages}
              onDelete={deleteMessages}
            />
          </div>
        </div>
      )}

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
                      body: replyDraftBody || undefined,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
