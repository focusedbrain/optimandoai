/**
 * EmailInboxBulkView — Bulk grid view: [Message Card | AI Output Field] per row (50/50).
 * Toolbar: Select all, bulk actions, pagination. Uses bulkPage + bulkBatchSize from store.
 * Collapsible provider section at top for account management.
 */

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import {
  useEmailInboxStore,
  deriveTabCountsWithPreview,
  type InboxMessage,
  type InboxSourceType,
  type SubFocus,
} from '../stores/useEmailInboxStore'
import { useShallow } from 'zustand/react/shallow'
import EmailMessageDetail from './EmailMessageDetail'
import EmailComposeOverlay from './EmailComposeOverlay'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import { EmailConnectWizard } from '@ext/shared/components/EmailConnectWizard'
import LinkWarningDialog from './LinkWarningDialog'
import { extractLinkParts } from '../utils/safeLinks'
import type { AiOutputs, BulkAiResult, BulkAiResultEntry, BulkRecommendedAction, SortCategory } from '../types/inboxAi'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
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

/** Parse persisted ai_analysis_json into BulkAiResultEntry — used when bulkAiOutputs was cleared. */
function parsePersistedAnalysis(json: string | null | undefined): BulkAiResultEntry | undefined {
  if (!json || typeof json !== 'string') return undefined
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const hasCategory = !!parsed?.category
    const hasSummary = typeof parsed?.summary === 'string' && parsed.summary.length > 0
    const hasDraftReply = typeof parsed?.draftReply === 'string' && parsed.draftReply.length > 0
    if (!hasCategory && !hasSummary && !hasDraftReply) return undefined

    return {
      category: (hasCategory ? parsed.category : 'normal') as SortCategory,
      urgencyScore: typeof parsed.urgencyScore === 'number' ? parsed.urgencyScore : 5,
      urgencyReason: String(parsed.urgencyReason ?? ''),
      summary: String(parsed.summary ?? ''),
      reason: String(parsed.reason ?? ''),
      needsReply: !!parsed.needsReply,
      needsReplyReason: String(parsed.needsReplyReason ?? ''),
      recommendedAction: (hasCategory ? (parsed.recommendedAction ?? 'keep_for_manual_action') : 'keep_for_manual_action') as BulkRecommendedAction,
      actionExplanation: String(parsed.actionExplanation ?? ''),
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      draftReply: parsed.draftReply ?? undefined,
      status: (parsed.status ?? 'classified') as 'classified',
    }
  } catch {
    return undefined
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

/** Live countdown for pending review preview. */
function PendingReviewCountdown({ expiresAt }: { expiresAt: string | undefined }) {
  useEmailInboxStore((s) => s.countdownTick)
  if (!expiresAt) return <span className="bulk-action-card-review-countdown">Moving in {GRACE_SECONDS}s</span>
  try {
    const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
    const text = remaining > 0 ? `Moving in ${remaining}s` : 'Moving now'
    return <span className="bulk-action-card-review-countdown">{text}</span>
  } catch {
    return <span className="bulk-action-card-review-countdown">Moving in {GRACE_SECONDS}s</span>
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

/** Wraps Undo content with 10s fade-out: starts fading at 8s, gone at 10s. */
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
  handleKeepDuringPreview,
  handleKeepDuringArchivePreview,
  handleKeepDuringReviewPreview,
  handleUndoPendingDelete,
  handleUndoPendingReview,
  handleUndoArchived,
  focusedMessageId,
  editingDraftForMessageId,
  subFocus,
  setSubFocus,
  onSelectMessage,
  keptDuringPreviewIds,
  keptDuringArchivePreviewIds,
  keptDuringReviewPreviewIds,
  pendingDeletePreviewExpiries,
  archivePreviewExpiries,
  pendingReviewPreviewExpiries,
  draftAttachments = [],
  onAddDraftAttachment,
  onRemoveDraftAttachment,
}: {
  msg: InboxMessage
  output: BulkAiResultEntry
  isExpanded: boolean
  currentFilter: 'all' | 'unread' | 'starred' | 'deleted' | 'archived' | 'pending_delete' | 'pending_review'
  updateDraftReply: (messageId: string, draftReply: string) => void
  handleSendDraft: (msg: InboxMessage, draftBody: string, attachments?: Array<{ name: string; path: string; size: number }>) => void
  handleArchiveOne: (msg: InboxMessage) => void
  handleDeleteOne: (msg: InboxMessage) => void
  handlePendingDeleteOne: (msg: InboxMessage) => void
  handleMoveToPendingReviewOne: (msg: InboxMessage) => void
  handleSummarize: (messageId: string) => void
  handleDraftReply: (messageId: string) => void
  handleKeepDuringPreview: (messageId: string) => void
  handleKeepDuringArchivePreview: (messageId: string) => void
  handleKeepDuringReviewPreview: (messageId: string) => void
  handleUndoPendingDelete: (ids: string[]) => void
  handleUndoPendingReview: (messageId: string) => void
  handleUndoArchived: (messageId: string) => void
  focusedMessageId: string | null
  editingDraftForMessageId: string | null
  subFocus: SubFocus
  setSubFocus: (focus: SubFocus) => void
  onSelectMessage?: (messageId: string | null) => void
  keptDuringPreviewIds: Set<string>
  keptDuringArchivePreviewIds: Set<string>
  keptDuringReviewPreviewIds: Set<string>
  pendingDeletePreviewExpiries: Record<string, string | undefined>
  archivePreviewExpiries: Record<string, string | undefined>
  pendingReviewPreviewExpiries: Record<string, string | undefined>
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

  const hasFullStructured = !!(output.category && output.recommendedAction)
  const rec = (output.recommendedAction ?? 'draft_reply_ready') as BulkRecommendedAction
  /** Draft-only or user hit “Draft” after Auto-Sort — full-height composer, no analysis header/recommended row. */
  const hideAnalysisChrome = draftExpanded && ((!hasFullStructured) || manualDraftCompose)
  /** FIX-H4: Undo visibility based SOLELY on current filter. No other conditions. */
  const showUndo = ['pending_delete', 'pending_review', 'archived'].includes(currentFilter)
  const category = (output.category ?? 'normal') as keyof typeof CATEGORY_BORDER
  const borderColor = CATEGORY_BORDER[category] ?? 'transparent'
  const urgency = output.urgencyScore ?? 5
  const needsReplyReason = output.needsReplyReason ?? output.reason ?? ''
  const urgencyReason = output.urgencyReason ?? output.reason ?? ''
  const urgencyColor = urgency <= 3 ? '#22c55e' : urgency <= 6 ? '#eab308' : '#ef4444'
  const panelMod = `bulk-action-card-panel--${rec}`
  const inPendingDeleteGrace = rec === 'pending_delete' && !keptDuringPreviewIds.has(msg.id)
  const inArchiveGrace = rec === 'archive' && !keptDuringArchivePreviewIds.has(msg.id) && !!archivePreviewExpiries[msg.id]
  const inReviewGrace = rec === 'pending_review' && !keptDuringReviewPreviewIds.has(msg.id) && !!pendingReviewPreviewExpiries[msg.id]
  const preActionMod = inPendingDeleteGrace ? 'bulk-action-card--pre-action-pending' : inArchiveGrace ? 'bulk-action-card--pre-action-archive' : inReviewGrace ? 'bulk-action-card--pre-action-review' : ''
  const effectiveBorderColor = inPendingDeleteGrace ? '#dc2626' : inArchiveGrace ? '#2563eb' : inReviewGrace ? '#f59e0b' : borderColor
  const isConnected = draftRefineConnected && draftRefineMessageId === msg.id

  return (
    <div
      className={`bulk-action-card bulk-action-card--structured ${isExpanded ? 'bulk-action-card--expanded' : ''} ${preActionMod}${hideAnalysisChrome ? ' bulk-action-card--draft-compose-focus' : ''}`.trim()}
      style={{ borderLeftColor: effectiveBorderColor }}
    >
      {!hideAnalysisChrome ? (
      <div className="bulk-action-card-header">
        <span className="bulk-action-card-badge" style={{ background: `${borderColor}33`, color: borderColor }}>
          {(output.category ?? 'normal') === 'pending_review' ? 'REVIEW' : (output.category ?? 'normal').toUpperCase()}
        </span>
        <span className="bulk-action-card-urgency-badge" style={{ color: urgencyColor }} title="Urgency 1–10">
          {urgency}/10
        </span>
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
                <div className="bulk-action-card-row">
                  <span className="bulk-action-card-row-label">Response Needed</span>
                  <div className="bulk-action-card-row-value">
                    <span className="bulk-action-card-response-needed">
                      <span className="bulk-action-card-dot" style={{ background: output.needsReply ? '#ef4444' : '#22c55e' }} />
                      {output.needsReply ? 'Yes' : 'No'} — {needsReplyReason || '—'}
                    </span>
                  </div>
                </div>
                <div className="bulk-action-card-row">
                  <span className="bulk-action-card-row-label">Summary</span>
                  <div className={`bulk-action-card-row-value bulk-action-card-summary bulk-action-card-summary--expanded`}>
                    {output.summary || '—'}
                  </div>
                </div>
                <div className="bulk-action-card-row">
                  <span className="bulk-action-card-row-label">Urgency</span>
                  <div className="bulk-action-card-row-value">
                    <div className="bulk-action-card-urgency-bar">
                      <div className="bulk-action-card-urgency-fill" style={{ width: `${(urgency / 10) * 100}%`, background: urgencyColor }} />
                    </div>
                    <span className="bulk-action-card-urgency-label">{urgency}/10 — {urgencyReason || '—'}</span>
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
                    <div className="bulk-action-card-reasoning-box">
                      <span className="bulk-action-card-reasoning-label">Why:</span>
                      <span className="bulk-action-card-reasoning">{output.actionExplanation || '—'}</span>
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
        {/* Recommended Action — hidden in draft-compose focus so the editor uses the pane */}
        {!hideAnalysisChrome ? (
        <div className="bulk-action-card-row bulk-action-card-row--recommended">
          <span className="bulk-action-card-row-label">Recommended Action</span>
          <div className="bulk-action-card-row-value">
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
            <div className="bulk-action-card-reasoning-box">
              <span className="bulk-action-card-reasoning-label">Why:</span>
              <span className="bulk-action-card-reasoning">{output.actionExplanation || '—'}</span>
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
                  if (focusedMessageId !== msg.id) onSelectMessage?.(msg.id)
                  useEmailInboxStore.getState().setEditingDraftForMessageId(msg.id)
                  handleDraftRefineConnect()
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
                  borderTop: '1px solid #e2e8f0',
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
                {rec === 'draft_reply_ready' && output.draftReply ? (
                  <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleArchiveOne(msg)}>
                    Archive
                  </button>
                ) : null}
                {(rec === 'archive' || rec === 'keep_for_manual_action') ? (
                  <button type="button" className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis" onClick={() => handleArchiveOne(msg)}>
                    📦 Archive
                  </button>
                ) : null}
                {rec === 'pending_delete' ? (
                  <button type="button" className="bulk-action-card-btn bulk-action-card-btn--danger bulk-action-card-btn--primary-emphasis" onClick={() => handlePendingDeleteOne(msg)}>
                    🗑 Pending Delete
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
      {rec === 'pending_delete' && !keptDuringPreviewIds.has(msg.id) && (
        <div className="bulk-action-card-pending-preview">
          <span className="bulk-action-card-pending-badge">PENDING DELETE</span>
          <span className="bulk-action-card-next-state">
            Will move to Pending Delete — <PendingDeleteCountdown expiresAt={pendingDeletePreviewExpiries[msg.id]} />
          </span>
          {pendingDeletePreviewExpiries[msg.id] && (
            <button type="button" className="bulk-action-card-keep-btn" onClick={() => handleKeepDuringPreview(msg.id)} title="Cancel auto-action">
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
          <button type="button" className="bulk-action-card-keep-btn" onClick={() => handleKeepDuringArchivePreview(msg.id)} title="Cancel auto-action">
            Keep
          </button>
        </div>
      )}
      {rec === 'pending_review' && !keptDuringReviewPreviewIds.has(msg.id) && pendingReviewPreviewExpiries[msg.id] && (
        <div className="bulk-action-card-review-preview">
          <span className="bulk-action-card-review-badge">REVIEW</span>
          <span className="bulk-action-card-next-state">
            Will move to Pending Review — <PendingReviewCountdown expiresAt={pendingReviewPreviewExpiries[msg.id]} />
          </span>
          <button type="button" className="bulk-action-card-keep-btn" onClick={() => handleKeepDuringReviewPreview(msg.id)} title="Cancel auto-action">
            Keep
          </button>
        </div>
      )}
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
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis" onClick={() => handleArchiveOne(msg)}>
            📦 Archive
          </button>
        )}
        {rec === 'pending_delete' && (
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--danger bulk-action-card-btn--primary-emphasis" onClick={() => handlePendingDeleteOne(msg)}>
            🗑 Pending Delete
          </button>
        )}
        {rec === 'draft_reply_ready' && output.draftReply && (
          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={() => handleArchiveOne(msg)}>
            Archive
          </button>
        )}
        <div className="bulk-action-card-buttons-secondary">
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

/** Derive urgency badge text from reason/needsReply. */
function getUrgencyBadgeText(reason: string | null | undefined, needsReply: boolean): string {
  const r = (reason ?? '').toLowerCase()
  if (/\b(payment|invoice|due|bill|amount)\b/.test(r)) return 'Payment Due'
  if (needsReply || /\b(reply|response|answer)\b/.test(r)) return 'Response Expected'
  return 'Action Required'
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
    allMessages,
    fetchMessages,
    fetchAllMessages,
    refreshMessages,
    setBulkMode,
    setBulkPage,
    setBulkBatchSize,
    setBulkCompactMode,
    syncBulkBatchSizeFromSettings,
    setBulkAiOutputs,
    clearBulkAiOutputsForIds,
    pendingDeletePreviewExpiries,
    archivePreviewExpiries,
    pendingReviewPreviewExpiries,
    keptDuringPreviewIds,
    keptDuringArchivePreviewIds,
    keptDuringReviewPreviewIds,
    pendingDeleteToast,
    bulkSessionArchived,
      bulkSessionPendingDelete,
    addPendingDeletePreview,
    addArchivePreview,
    addPendingReviewPreview,
    keepDuringPreview,
    keepDuringArchivePreview,
    keepDuringReviewPreview,
    setPendingDeleteToast,
      removeRecentPendingDeleteBatch,
      decrementBulkSessionPendingDelete,
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
    setCategory,
    autoSyncEnabled,
    syncing,
    syncAccount,
    toggleAutoSync,
    loadSyncState,
    editingDraftForMessageId,
    setEditingDraftForMessageId,
    subFocus,
    setSubFocus,
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
      allMessages: s.allMessages,
      fetchMessages: s.fetchMessages,
      fetchAllMessages: s.fetchAllMessages,
      refreshMessages: s.refreshMessages,
      setBulkMode: s.setBulkMode,
      setBulkPage: s.setBulkPage,
      setBulkBatchSize: s.setBulkBatchSize,
      setBulkCompactMode: s.setBulkCompactMode,
      syncBulkBatchSizeFromSettings: s.syncBulkBatchSizeFromSettings,
      setBulkAiOutputs: s.setBulkAiOutputs,
      clearBulkAiOutputsForIds: s.clearBulkAiOutputsForIds,
      pendingDeletePreviewExpiries: s.pendingDeletePreviewExpiries,
      archivePreviewExpiries: s.archivePreviewExpiries,
      pendingReviewPreviewExpiries: s.pendingReviewPreviewExpiries,
      keptDuringPreviewIds: s.keptDuringPreviewIds,
      keptDuringArchivePreviewIds: s.keptDuringArchivePreviewIds,
      keptDuringReviewPreviewIds: s.keptDuringReviewPreviewIds,
      pendingDeleteToast: s.pendingDeleteToast,
      bulkSessionArchived: s.bulkSessionArchived,
      bulkSessionPendingDelete: s.bulkSessionPendingDelete,
      addPendingDeletePreview: s.addPendingDeletePreview,
      addArchivePreview: s.addArchivePreview,
      addPendingReviewPreview: s.addPendingReviewPreview,
      keepDuringPreview: s.keepDuringPreview,
      keepDuringArchivePreview: s.keepDuringArchivePreview,
      keepDuringReviewPreview: s.keepDuringReviewPreview,
      setPendingDeleteToast: s.setPendingDeleteToast,
      removeRecentPendingDeleteBatch: s.removeRecentPendingDeleteBatch,
      decrementBulkSessionPendingDelete: s.decrementBulkSessionPendingDelete,
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
      setCategory: s.setCategory,
      autoSyncEnabled: s.autoSyncEnabled,
      syncing: s.syncing,
      syncAccount: s.syncAccount,
      toggleAutoSync: s.toggleAutoSync,
      loadSyncState: s.loadSyncState,
      editingDraftForMessageId: s.editingDraftForMessageId,
      setEditingDraftForMessageId: s.setEditingDraftForMessageId,
      subFocus: s.subFocus,
      setSubFocus: s.setSubFocus,
    }))
  )

  const primaryAccountId = accounts[0]?.id
  const draftRefineConnect = useDraftRefineStore((s) => s.connect)

  /** Derive tab counts from allMessages + preview state. useMemo prevents new object every render → infinite loop. */
  const tabCounts = useMemo(
    () =>
      deriveTabCountsWithPreview(allMessages, {
        pendingDeletePreviewExpiries,
        archivePreviewExpiries,
        pendingReviewPreviewExpiries,
        keptDuringPreviewIds,
        keptDuringArchivePreviewIds,
        keptDuringReviewPreviewIds,
      }),
    [
      allMessages,
      pendingDeletePreviewExpiries,
      archivePreviewExpiries,
      pendingReviewPreviewExpiries,
      keptDuringPreviewIds,
      keptDuringArchivePreviewIds,
      keptDuringReviewPreviewIds,
    ]
  )

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
  const [sortFailureToast, setSortFailureToast] = useState<string | null>(null)
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
  const isSortingRef = useRef(false)
  const autoSortedIdsRef = useRef<Set<string>>(new Set())

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
  /** Toolbar bulk actions operate on messages only. Count excludes drafts (no draft checkbox). */
  const selectedCount = multiSelectIds.size
  const batchMessages = sortedMessages
  const allInBatchSelected =
    batchMessages.length > 0 && batchMessages.every((m) => multiSelectIds.has(m.id))
  const someInBatchSelected = batchMessages.some((m) => multiSelectIds.has(m.id))

  const handleBatchCheckboxToggle = useCallback(() => {
    if (allInBatchSelected || someInBatchSelected) {
      clearMultiSelect()
    } else {
      batchMessages.forEach((m) => {
        if (!multiSelectIds.has(m.id)) toggleMultiSelect(m.id)
      })
    }
  }, [allInBatchSelected, someInBatchSelected, batchMessages, multiSelectIds, clearMultiSelect, toggleMultiSelect])

  const batchCheckboxRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = batchCheckboxRef.current
    if (el) {
      ;(el as HTMLInputElement & { indeterminate?: boolean }).indeterminate =
        someInBatchSelected && !allInBatchSelected
    }
  }, [someInBatchSelected, allInBatchSelected])

  const totalPages =
    bulkBatchSize === 'all' ? 1 : Math.max(1, Math.ceil(total / bulkBatchSize))
  const canPrev = bulkPage > 0
  const canNext = bulkPage < totalPages - 1

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

  /** On mount and page 0: fetch all tabs for instant switching. On page change: fetch current page. */
  useEffect(() => {
    if (bulkPage === 0) {
      fetchAllMessages()
    } else {
      fetchMessages()
    }
  }, [fetchAllMessages, fetchMessages, bulkPage])

  /** When user selects "All" from dropdown, select all messages once they load. */
  useEffect(() => {
    if (shouldSelectAllWhenReady && messages.length > 0) {
      messages.forEach((m) => {
        if (!multiSelectIds.has(m.id)) toggleMultiSelect(m.id)
      })
      setShouldSelectAllWhenReady(false)
    }
  }, [shouldSelectAllWhenReady, messages, multiSelectIds, toggleMultiSelect])

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
    if (!ids.length || !window.emailInbox?.moveToPendingReview) return
    const res = await window.emailInbox.moveToPendingReview(ids)
    if (res.ok) {
      clearMultiSelect()
      await refreshMessages()
    }
  }, [multiSelectIds, clearMultiSelect, refreshMessages])

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

  const URGENCY_THRESHOLD = 7

  /**
   * Run AI categorize for given ids. Per-message calls with progressive UI updates.
   * POLICY (FIX-C4): AI Auto-Sort must ONLY run on explicit user click.
   * - NEVER call from useEffect, onNewMessages, syncAccount, fetchMessages, or store subscribers.
   * - Valid callers: handleAiAutoSort (toolbar button), Retry Auto-Sort (per-message button).
   */
  const runAiCategorizeForIds = useCallback(
    async (ids: string[], clearSelection: boolean, isRetry = false): Promise<{ processedIds: string[]; failedIds: string[] }> => {
      if (isSortingRef.current && !isRetry) return { processedIds: [], failedIds: ids }
      if (!ids.length || !window.emailInbox?.aiClassifySingle) return { processedIds: [], failedIds: [] }
      isSortingRef.current = true
      useEmailInboxStore.getState().setSortingActive(true)
      setAiSortProgress(`Analyzing ${ids.length} message${ids.length !== 1 ? 's' : ''}…`)
      setAiSortPhase('analyzing')
      const CONCURRENCY = 3
      const VALID_ACTIONS: BulkRecommendedAction[] = ['pending_delete', 'pending_review', 'archive', 'keep_for_manual_action', 'draft_reply_ready']
      const VALID_CATEGORIES: SortCategory[] = ['urgent', 'important', 'normal', 'newsletter', 'spam', 'irrelevant', 'pending_review']
      const processedIds: string[] = []
      const failedIds: string[] = []
      try {
        for (let i = 0; i < ids.length; i += CONCURRENCY) {
          const batch = ids.slice(i, i + CONCURRENCY)
          await Promise.all(
            batch.map(async (messageId) => {
              const result = await window.emailInbox!.aiClassifySingle(messageId)
              if (result.error) {
                failedIds.push(messageId)
                console.warn('[SORT] Failed to analyze message:', messageId, result.error)
                const failureReason = (result.error === 'timeout' ? 'timeout' : 'llm_error') as 'timeout' | 'llm_error'
                setBulkAiOutputs((prev) => ({
                  ...prev,
                  [messageId]: {
                    summary: failureReason === 'timeout' ? 'Timed out.' : result.error === 'parse_failed' ? 'AI analysis returned no result for this message.' : 'Analysis failed.',
                    autosortFailure: true,
                    failureReason,
                    status: 'classified',
                  },
                }))
                return
              }
              const category = (VALID_CATEGORIES.includes((result.category ?? '') as SortCategory) ? result.category : 'normal') as SortCategory
              const recommendedAction = (VALID_ACTIONS.includes((result.recommended_action ?? '') as BulkRecommendedAction)
                ? result.recommended_action
                : 'keep_for_manual_action') as BulkRecommendedAction
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
              /** Urgent messages stay unsorted — never add previews. */
              const isUrgent = entry.urgencyScore >= URGENCY_THRESHOLD
              if (!isUrgent && result.pending_delete && recommendedAction === 'pending_delete') {
                entry.pendingDeletePreviewUntil = new Date(Date.now() + GRACE_SECONDS * 1000).toISOString()
                addPendingDeletePreview([messageId])
              }
              if (!isUrgent && result.pending_review && recommendedAction === 'pending_review') {
                entry.pendingReviewPreviewUntil = new Date(Date.now() + GRACE_SECONDS * 1000).toISOString()
                addPendingReviewPreview([messageId])
              }
              if (!isUrgent && recommendedAction === 'archive') {
                entry.archivePreviewUntil = new Date(Date.now() + GRACE_SECONDS * 1000).toISOString()
                addArchivePreview([messageId])
              }
              processedIds.push(messageId)
              setBulkAiOutputs((prev) => ({ ...prev, [messageId]: entry }))
              useEmailInboxStore.getState().removeBulkDraftManualCompose(messageId)
            })
          )
        }
        const missedIds = ids.filter((id) => !processedIds.includes(id) && !failedIds.includes(id))
        const toRetry = ids.filter((id) => !processedIds.includes(id))
        console.log('[SORT] First pass. Processed:', processedIds.length, 'Failed:', failedIds.length, 'Missed:', missedIds.length, 'To retry:', toRetry.length)
        let allProcessedIds = [...processedIds]
        let allFailedIds = [...failedIds]
        if (toRetry.length === 0) {
          console.log('[SORT] All messages sorted successfully')
        } else if (!isRetry) {
          if (missedIds.length > 0) console.warn('[SORT] Missed IDs:', missedIds)
          const retryResult = await runAiCategorizeForIds(toRetry, false, true)
          allProcessedIds = [...processedIds, ...retryResult.processedIds]
          allFailedIds = retryResult.failedIds
          console.log('[SORT] Retry. Processed:', retryResult.processedIds.length, 'Failed:', retryResult.failedIds.length)
        }
        const finalUnsortedIds = ids.filter((id) => !allProcessedIds.includes(id))
        console.log('[SORT] Final. All processed:', allProcessedIds.length, 'Final unsorted:', finalUnsortedIds.length, finalUnsortedIds)
        if (finalUnsortedIds.length > 0 && !isRetry) {
          setSortFailureToast(`${finalUnsortedIds.length} message${finalUnsortedIds.length !== 1 ? 's' : ''} could not be auto-sorted`)
          setTimeout(() => setSortFailureToast(null), 4000)
        }
        if (clearSelection) clearMultiSelect()
        await refreshMessages()
        setAiSortPhase('reordered')
        setTimeout(() => setAiSortPhase('idle'), 380)
        return { processedIds: allProcessedIds, failedIds: allFailedIds }
      } catch {
        const failOutputs: AiOutputs = {}
        for (const id of ids) {
          failOutputs[id] = {
            summary: 'Analysis failed.',
            autosortFailure: true,
            failureReason: 'llm_error',
            status: 'classified',
          }
        }
        setBulkAiOutputs((prev) => ({ ...prev, ...failOutputs }))
        setAiSortPhase('idle')
        return { processedIds: [], failedIds: ids }
      } finally {
        ids.forEach((id) => autoSortedIdsRef.current.add(id))
        useEmailInboxStore.getState().triggerAnalysisRestart()
        if (!isRetry) {
          isSortingRef.current = false
          useEmailInboxStore.getState().setSortingActive(false)
          setAiSortProgress(null)
        }
      }
    },
    [clearMultiSelect, refreshMessages, addPendingDeletePreview, addPendingReviewPreview, addArchivePreview, setSortFailureToast]
  )

  /** AI Auto-Sort: ONLY runs on explicit user click. Button disabled when selectedCount === 0.
   * Operates on message IDs only; drafts excluded (multiSelectIds contains only message IDs from checkbox).
   * A. Freeze target set once — do not read mutating selection during run.
   * Do NOT filter by allMessages; selected IDs must not be dropped due to stale/incomplete data. */
  const handleAiAutoSort = useCallback(() => {
    const targetIds = Array.from(new Set(multiSelectIds))
      .filter((id): id is string => !!id && typeof id === 'string')
    if (!targetIds.length) return
    console.log('[SORT] Start. Selected:', multiSelectIds.size, 'Target:', targetIds.length, targetIds)
    autoSortedIdsRef.current.clear()
    runAiCategorizeForIds(targetIds, true)
  }, [multiSelectIds, runAiCategorizeForIds])

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
      await refreshMessages()
    },
    [refreshMessages, setPendingDeleteToast, removeRecentPendingDeleteBatch, decrementBulkSessionPendingDelete, clearPendingDeleteStateForIds]
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

  /** Cancel the scheduled pending-review move for one message during the 5s preview. */
  const handleKeepDuringReviewPreview = useCallback(
    (messageId: string) => {
      keepDuringReviewPreview(messageId)
    },
    [keepDuringReviewPreview]
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

  /** Move to Pending Review (14-day grace). Use when AI recommends pending_review or manual. */
  const handleMoveToPendingReviewOne = useCallback(
    async (msg: InboxMessage) => {
      if (!window.emailInbox?.moveToPendingReview) return
      const res = await window.emailInbox.moveToPendingReview([msg.id])
      if (res.ok) {
        useEmailInboxStore.getState().clearBulkAiOutputsForIds([msg.id])
        await refreshMessages()
      }
    },
    [refreshMessages]
  )

  /** Render structured Action Card when BulkAiResult exists; otherwise fallback. */
  const renderActionCard = useCallback(
    (msg: InboxMessage, output: BulkAiResultEntry | undefined, isExpanded: boolean) => {
      /** FIX-H4: Undo visibility based SOLELY on current filter. No other conditions. */
      const currentFilter = filter.filter
      const showUndo = ['pending_delete', 'pending_review', 'archived'].includes(currentFilter)
      const hasFullStructured = !!(output?.category && output?.recommendedAction)
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
        const isTimeout = output.failureReason === 'timeout'
        return (
          <div className="bulk-action-card bulk-action-card--failure">
            <div className="bulk-action-card-state-content bulk-action-card-failure-content">
              <span className="bulk-action-card-state-label bulk-action-card-failure-label">
                {isTimeout ? 'Timed out' : 'Analysis failed'}
              </span>
              <span className="bulk-action-card-state-detail bulk-action-card-failure-detail">
                {output.summary || (isTimeout ? 'Ollama may be slow or unavailable.' : 'No result from AI for this message.')}
              </span>
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

      if (hasFullStructured || hasDraftReady) {
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
            handleKeepDuringPreview={handleKeepDuringPreview}
            handleKeepDuringArchivePreview={handleKeepDuringArchivePreview}
            handleKeepDuringReviewPreview={handleKeepDuringReviewPreview}
            handleUndoPendingDelete={handleUndoPendingDelete}
            handleUndoPendingReview={handleUndoPendingReview}
            handleUndoArchived={handleUndoArchived}
            focusedMessageId={focusedMessageId ?? null}
            editingDraftForMessageId={editingDraftForMessageId ?? null}
  subFocus={subFocus}
  setSubFocus={setSubFocus}
  onSelectMessage={onSelectMessage}
            keptDuringPreviewIds={keptDuringPreviewIds}
            keptDuringArchivePreviewIds={keptDuringArchivePreviewIds}
            keptDuringReviewPreviewIds={keptDuringReviewPreviewIds}
            pendingDeletePreviewExpiries={pendingDeletePreviewExpiries}
            archivePreviewExpiries={archivePreviewExpiries}
            pendingReviewPreviewExpiries={pendingReviewPreviewExpiries}
          />
        )
      }

      // Fallback: summary / errors only (draft success uses BulkActionCardStructured above)
      if (output?.summary || output?.summaryError || output?.draftError) {
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
      handleKeepDuringPreview,
      handleKeepDuringArchivePreview,
      handleKeepDuringReviewPreview,
      handleUndoPendingDelete,
      handleUndoPendingReview,
      handleUndoArchived,
      focusedMessageId,
      editingDraftForMessageId,
      subFocus,
      setSubFocus,
      onSelectMessage,
      runAiCategorizeForIds,
      keptDuringPreviewIds,
      keptDuringArchivePreviewIds,
      keptDuringReviewPreviewIds,
      pendingDeletePreviewExpiries,
      archivePreviewExpiries,
      pendingReviewPreviewExpiries,
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
      const inPendingDeleteGrace =
        focusedMsg &&
        pendingDeletePreviewExpiries[focusedMsg.id] &&
        !keptDuringPreviewIds.has(focusedMsg.id)
      const inArchiveGrace =
        focusedMsg &&
        archivePreviewExpiries[focusedMsg.id] &&
        !keptDuringArchivePreviewIds.has(focusedMsg.id)
      const inReviewGrace =
        focusedMsg &&
        pendingReviewPreviewExpiries[focusedMsg.id] &&
        !keptDuringReviewPreviewIds.has(focusedMsg.id)
      const inGracePeriod = inPendingDeleteGrace || inArchiveGrace || inReviewGrace

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
        else if (inReviewGrace) handleKeepDuringReviewPreview(focusedMsg.id)
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
    pendingReviewPreviewExpiries,
    keptDuringPreviewIds,
    keptDuringArchivePreviewIds,
    keptDuringReviewPreviewIds,
    expandedCardIds,
    selectedCount,
    focusAdjacentRow,
    toggleCardExpand,
    handleKeepDuringPreview,
    handleKeepDuringArchivePreview,
    handleKeepDuringReviewPreview,
    triggerPrimaryAction,
    handleBulkArchive,
    handleArchiveOne,
    handleBulkDelete,
    handleDeleteOne,
    handlePendingDeleteOne,
  ])

  return (
    <div className={`bulk-view-root ${bulkCompactMode ? 'bulk-view--compact' : ''}`}>
      {/* Toolbar — three groups: left (selection+sort), center (filter tabs), right (sync+tools) */}
      <div className="bulk-view-toolbar">
        <div className="bulk-view-toolbar-left">
          {/* GROUP 1: Selection + Sort */}
          <input
            type="checkbox"
            checked={allInBatchSelected}
            ref={batchCheckboxRef}
            onChange={handleBatchCheckboxToggle}
            title={allInBatchSelected ? 'Deselect all' : someInBatchSelected ? 'Deselect all' : 'Select all in batch'}
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
            onClick={handleAiAutoSort}
            disabled={selectedCount === 0}
            title={selectedCount === 0 ? 'Select messages first, then click to run AI Auto-Sort' : 'AI Auto-Sort selected messages'}
          >
            ⚡ AI Auto-Sort
          </button>
          <span className="bulk-view-selection-group-count selected-count">
            {selectedCount} selected
          </span>
        </div>

        <div className="bulk-view-toolbar-center">
          {/* GROUP 2: Filter tabs */}
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

        <div className="bulk-view-toolbar-right">
          {/* GROUP 3: Sync & Tools */}
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
          <button
            type="button"
            className="bulk-view-wr-expert-btn"
            onClick={() => setShowWrExpertModal(true)}
            title="Edit AI inbox rules (WRExpert.md)"
          >
            WR Expert
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
            {bulkCompactMode && (bulkBatchSize === 'all' || bulkBatchSize >= 24) && messages.length > 0 && (
              <div className="bulk-view-compact-hint" role="status" title="Keyboard: j/k nav, a archive, d delete, g keep, Enter expand, Space primary">
                Compact mode · {messages.length} messages · j/k nav, a archive, d delete
              </div>
            )}
            {sendEmailToast && (
              <div className="bulk-view-recent-actions" style={{ margin: '0 12px 12px' }}>
                <div
                  className={sendEmailToast.type === 'success' ? 'bulk-view-toast-primary' : 'bulk-view-toast-primary'}
                  style={{
                    background: sendEmailToast.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    borderColor: sendEmailToast.type === 'success' ? '#22c55e' : '#ef4444',
                  }}
                >
                  <span>{sendEmailToast.message}</span>
                  <button type="button" onClick={() => setSendEmailToast(null)}>Dismiss</button>
                </div>
              </div>
            )}
            {sortFailureToast && (
              <div className="bulk-view-recent-actions" style={{ margin: '0 12px 12px' }}>
                <div
                  className="bulk-view-toast-primary"
                  style={{ background: 'rgba(239,68,68,0.15)', borderColor: '#ef4444' }}
                >
                  <span>{sortFailureToast}</span>
                  <button type="button" onClick={() => setSortFailureToast(null)}>Dismiss</button>
                </div>
              </div>
            )}
            {/* FIX-ISSUE-1: Single consolidated status only — no Undo buttons (prevent layout overflow during bulk sort) */}
            {pendingDeleteToast && (
              <div className="bulk-view-recent-actions" style={{ margin: '0 12px 12px' }}>
                <UndoFadeWrapper onFadeComplete={() => setPendingDeleteToast(null)}>
                  <div className="bulk-view-toast-primary bulk-view-toast-status-only">
                    <span>
                      {pendingDeleteToast.count} message{pendingDeleteToast.count !== 1 ? 's' : ''} moved to Pending Delete.
                    </span>
                  </div>
                </UndoFadeWrapper>
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
              const output = bulkAiOutputs[msg.id] ?? parsePersistedAnalysis(msg.ai_analysis_json)
              const bodyContent = (msg.body_text || '').trim() || '(No body)'
              const hasAttachments = msg.has_attachments === 1
              const isDeleted = msg.deleted === 1
              const isPendingDelete = (msg as InboxMessage & { pending_delete?: number }).pending_delete === 1
              const urgencyScore = output?.urgencyScore ?? msg.urgency_score ?? 5
              const isUrgent = urgencyScore >= URGENCY_THRESHOLD || msg.sort_category === 'urgent'
              const category = (isUrgent ? 'urgent' : (output?.category ?? msg.sort_category ?? 'normal')) as keyof typeof CATEGORY_BORDER
              /* FIX-H3: When message is unsorted (no sort state), show no color — reset after undo */
              const isUnsorted = !msg.sort_category && msg.pending_delete !== 1 && msg.archived !== 1
              const borderColor = isUnsorted ? undefined : (CATEGORY_BORDER[category] ?? 'transparent')
              const bgTint = isUnsorted ? undefined : (CATEGORY_BG[category] ?? 'transparent')
              const needsReply = msg.needs_reply === 1

              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  data-row-index={aiSortPhase === 'reordered' ? rowIndex : undefined}
                  className={`bulk-view-row ${isRemoving ? 'bulk-view-row--removing' : ''} ${isMultiSelected ? 'bulk-view-row--multi' : ''} ${isFocused ? 'bulk-view-row--focused' : ''} ${isCardExpanded ? 'bulk-view-row--expanded' : ''} ${output?.draftReply ? 'bulk-view-row--has-draft' : ''} ${aiSortPhase === 'reordered' && !isRemoving ? 'bulk-view-row--reorder-enter' : ''}`}
                  onAnimationEnd={isRemoving ? () => setRemovingItems((prev) => { const next = new Map(prev); next.delete(msg.id); return next; }) : undefined}
                  style={{
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
                    className={`bulk-view-message ${isMultiSelected ? 'bulk-view-message--multi' : ''} ${isFocused ? 'bulk-view-message--focused' : ''} ${editingDraftForMessageId === msg.id ? 'bulk-view-message--editing-draft' : ''}`}
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
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, flexShrink: 0 }}>
                          {msg.subject || '(No subject)'}
                        </div>
                        {((output?.summary || output?.reason || msg.sort_reason) ?? '').trim() && (
                          <div style={{ fontSize: 11, fontStyle: 'italic', color: MUTED, marginBottom: 6, flexShrink: 0 }}>
                            {((output?.summary || output?.reason || msg.sort_reason) ?? '').trim().slice(0, 120)}
                            {((output?.summary || output?.reason || msg.sort_reason) ?? '').trim().length > 120 ? '…' : ''}
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
                      </div>
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
                      <span
                        className="action-card-badge action-card-badge--type"
                        style={{
                          background: msg.source_type === 'email_plain' ? '#f1f5f9' : 'rgba(147,51,234,0.1)',
                          color: msg.source_type === 'email_plain' ? '#64748b' : 'var(--purple-accent, #7c3aed)',
                        }}
                      >
                        {formatSourceBadge(msg.source_type)}
                      </span>
                      {isUrgent && (
                        <span
                          className="action-card-badge action-card-badge--urgency"
                          title={msg.sort_reason || output?.urgencyReason || 'Requires attention'}
                        >
                          {getUrgencyBadgeText(output?.urgencyReason ?? msg.sort_reason, needsReply)}
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
                    {renderActionCard(msg, output, isCardExpanded)}
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
