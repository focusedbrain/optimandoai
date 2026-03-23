/**
 * InboxDetailAiPanel — Right column: per-message AI suggestions (normal inbox).
 * Advisory only; user confirms send/archive/delete.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftAttachment } from './EmailComposeOverlay'
import { useEmailInboxStore, type InboxMessage } from '../stores/useEmailInboxStore'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import type { NormalInboxAiResult } from '../types/inboxAi'
import { tryParsePartialAnalysis, tryParseAnalysis, type NormalInboxAiResultKey } from '../utils/parseInboxAiJson'
import { reconcileAnalyzeTriage } from '../lib/inboxClassificationReconcile'
import { sortSourceWeightingFromMessageRow } from '../lib/inboxSortSourceWeighting'
import { InboxUrgencyMeter } from './InboxUrgencyMeter'

export interface InboxDetailAiPanelProps {
  messageId: string
  message: InboxMessage | null
  onSendDraft?: (draft: string, message: InboxMessage, attachments?: DraftAttachment[]) => void | Promise<boolean>
  onArchive?: (messageIds: string[]) => void
  onDelete?: (messageIds: string[]) => void
  onCollapsedChange?: (collapsed: boolean) => void
}

export function InboxDetailAiPanel({ messageId, message, onSendDraft, onArchive, onDelete, onCollapsedChange }: InboxDetailAiPanelProps) {
  const [analysis, setAnalysis] = useState<NormalInboxAiResult | null>(null)
  const [receivedFields, setReceivedFields] = useState<Set<NormalInboxAiResultKey>>(new Set())
  const [analysisLoading, setAnalysisLoading] = useState(false)
  /** Manual Summarize (IPC) — separate from auto-analysis stream so the button stays usable while streaming. */
  const [summarizeLoading, setSummarizeLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState(false)
  const [editedDraft, setEditedDraft] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [actionChecked, setActionChecked] = useState<Record<number, boolean>>({})
  const [analysisExpanded, setAnalysisExpanded] = useState(true)
  const summaryRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLDivElement>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  /**
   * When the user runs manual Summarize while the analysis stream is still running (or before it finishes),
   * stream chunks / completion must not overwrite that summary. Cleared on message change and when a fresh stream starts (e.g. Retry).
   */
  const manualSummaryOverrideRef = useRef<{ messageId: string; summary: string } | null>(null)

  const draftRefineConnect = useDraftRefineStore((s) => s.connect)
  const draftRefineDisconnect = useDraftRefineStore((s) => s.disconnect)
  const draftRefineConnected = useDraftRefineStore((s) => s.connected)
  const draftRefineMessageId = useDraftRefineStore((s) => s.messageId)
  const refinedDraftText = useDraftRefineStore((s) => s.refinedDraftText)
  const acceptRefinement = useDraftRefineStore((s) => s.acceptRefinement)

  const runAnalysisStream = useCallback(async () => {
    console.log('[ANALYSIS] runAnalysisStream triggered for:', messageId)
    if (!window.emailInbox?.aiAnalyzeMessageStream || !window.emailInbox.onAiAnalyzeChunk) return
    const cached = useEmailInboxStore.getState().analysisCache[messageId]
    if (cached) {
      const sortW = message ? sortSourceWeightingFromMessageRow(message) : undefined
      const tri = reconcileAnalyzeTriage(
        {
          urgencyScore: cached.urgencyScore,
          needsReply: cached.needsReply,
          urgencyReason: cached.urgencyReason,
          summary: cached.summary,
        },
        { subject: message?.subject, body: message?.body_text },
        sortW
      )
      const cachedAdj = {
        ...cached,
        urgencyScore: tri.urgencyScore,
        needsReply: tri.needsReply,
        draftReply: tri.needsReply ? cached.draftReply : null,
      }
      setAnalysis(cachedAdj)
      setReceivedFields(new Set(['needsReply', 'needsReplyReason', 'summary', 'urgencyScore', 'urgencyReason', 'actionItems', 'archiveRecommendation', 'archiveReason', 'draftReply']))
      if (cachedAdj.draftReply) {
        setDraft(cachedAdj.draftReply)
        setEditedDraft(cachedAdj.draftReply)
      } else {
        setDraft(null)
        setEditedDraft('')
      }
      setAnalysisLoading(false)
      return
    }
    streamCleanupRef.current?.()
    manualSummaryOverrideRef.current = null
    setAnalysisLoading(true)
    setAnalysis(null)
    setAnalysisError(null)
    let accumulatedText = ''

    const DEFAULTS: NormalInboxAiResult = {
      needsReply: false,
      needsReplyReason: '',
      summary: '',
      urgencyScore: 5,
      urgencyReason: '',
      actionItems: [],
      archiveRecommendation: 'keep',
      archiveReason: '',
    }

    const cleanup = () => {
      unsubChunk()
      unsubDone()
      unsubError()
      streamCleanupRef.current = null
    }

    const unsubChunk = window.emailInbox.onAiAnalyzeChunk(({ messageId: mid, chunk }) => {
      if (mid !== messageId) return
      accumulatedText += chunk
      const parsed = tryParsePartialAnalysis(accumulatedText)
      if (parsed) {
        setAnalysis((prev) => {
          const merged = { ...DEFAULTS, ...(prev ?? {}), ...parsed.partial } as NormalInboxAiResult
          const ov = manualSummaryOverrideRef.current
          if (ov && ov.messageId === messageId && ov.summary.trim()) {
            merged.summary = ov.summary
          }
          return merged
        })
        setReceivedFields((prev) => new Set([...prev, ...parsed.receivedKeys]))
        if (parsed.receivedKeys.includes('draftReply') && parsed.partial.draftReply) {
          setDraft(parsed.partial.draftReply)
          setEditedDraft(parsed.partial.draftReply)
        }
      }
    })

    const unsubDone = window.emailInbox.onAiAnalyzeDone(({ messageId: mid }) => {
      if (mid !== messageId) return
      setAnalysisLoading(false)
      const final = tryParseAnalysis(accumulatedText)
      if (final) {
        const sortW = message ? sortSourceWeightingFromMessageRow(message) : undefined
        const tri = reconcileAnalyzeTriage(
          {
            urgencyScore: final.urgencyScore,
            needsReply: final.needsReply,
            urgencyReason: final.urgencyReason,
            summary: final.summary,
          },
          { subject: message?.subject, body: message?.body_text },
          sortW
        )
        let adjusted = {
          ...final,
          urgencyScore: tri.urgencyScore,
          needsReply: tri.needsReply,
          draftReply: tri.needsReply ? final.draftReply : null,
        }
        const ov = manualSummaryOverrideRef.current
        if (ov && ov.messageId === messageId && ov.summary.trim()) {
          adjusted = { ...adjusted, summary: ov.summary }
        }
        setAnalysis(adjusted)
        setReceivedFields(new Set(['needsReply', 'needsReplyReason', 'summary', 'urgencyScore', 'urgencyReason', 'actionItems', 'archiveRecommendation', 'archiveReason', 'draftReply']))
        if (adjusted.draftReply) {
          setDraft(adjusted.draftReply)
          setEditedDraft(adjusted.draftReply)
        } else {
          setDraft(null)
          setEditedDraft('')
        }
        useEmailInboxStore.getState().setAnalysisCache(messageId, adjusted)
      }
      cleanup()
    })

    const unsubError = window.emailInbox.onAiAnalyzeError(({ messageId: mid, error }) => {
      if (mid !== messageId) return
      setAnalysisLoading(false)
      setAnalysisError(
        error === 'timeout'
          ? 'Analysis timed out. Ollama may be slow or unavailable.'
          : 'Analysis failed. Check that Ollama is running.'
      )
      cleanup()
    })

    streamCleanupRef.current = cleanup

    try {
      await window.emailInbox.aiAnalyzeMessageStream(messageId)
    } catch {
      setAnalysisLoading(false)
      setAnalysisError('Analysis failed. Check that Ollama is running.')
      cleanup()
    }
  }, [messageId, message?.subject, message?.body_text, message?.source_type, message?.handshake_id])

  useEffect(() => {
    if (!messageId) return
    manualSummaryOverrideRef.current = null
    setAnalysis(null)
    setReceivedFields(new Set())
    setSummarizeLoading(false)
    setDraft(null)
    setEditedDraft('')
    setActionChecked({})
    setAnalysisExpanded(true)
    draftRefineDisconnect()
    runAnalysisStream()
    return () => {
      streamCleanupRef.current?.()
    }
  }, [messageId, runAnalysisStream, draftRefineDisconnect])

  /** FIX-H6: Clear draft-edit indicator when switching to a different message. */
  useEffect(() => {
    const store = useEmailInboxStore.getState()
    if (store.editingDraftForMessageId && store.editingDraftForMessageId !== messageId) {
      store.setEditingDraftForMessageId(null)
    }
  }, [messageId])

  /** Analysis visibility controlled ONLY by user toggle. Never auto-collapse when draft is generated (FIX-H1). */
  /** Analysis collapse only hides content; panel width stays constant. Never trigger panel collapse. */
  useEffect(() => {
    onCollapsedChange?.(false)
  }, [onCollapsedChange])

  const toggleAnalysisExpanded = useCallback(() => {
    setAnalysisExpanded((prev) => !prev)
  }, [])

  /** Connect to chat bar for draft refinement — on click or focus (FIX-ISSUE-5). */
  const handleDraftRefineConnect = useCallback(() => {
    const text = (editedDraft || draft) ?? ''
    if (!text.trim()) return
    const subject = message?.subject ?? null
    draftRefineConnect(messageId, subject, text, (refined) => {
      setDraft(refined)
      setEditedDraft(refined)
    })
  }, [messageId, message?.subject, editedDraft, draft, draftRefineConnect])

  useEffect(() => {
    if (!draftRefineConnected || draftRefineMessageId !== messageId) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (draftRef.current && !draftRef.current.contains(target)) {
        draftRefineDisconnect()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [draftRefineConnected, draftRefineMessageId, messageId, draftRefineDisconnect])

  useEffect(() => {
    if (draftRefineConnected && draftRefineMessageId === messageId) {
      useDraftRefineStore.getState().updateDraftText(editedDraft || draft || '')
    }
  }, [draftRefineConnected, draftRefineMessageId, messageId, editedDraft, draft])

  const handleSummarize = useCallback(async () => {
    if (!window.emailInbox?.aiSummarize) {
      console.warn(`[AI-SUMMARIZE][detail] missing bridge messageId=${messageId}`)
      setAnalysisError(
        'Summarize unavailable: email AI API is not connected (reload the app or check the preload bridge).'
      )
      return
    }
    console.log(`[AI-SUMMARIZE][detail] start messageId=${messageId}`)
    setSummarizeLoading(true)
    setAnalysisError(null)
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
        console.warn(`[AI-SUMMARIZE][detail] fail messageId=${messageId} reason=${failReason}`)
        setAnalysisError(
          'Couldn’t generate a summary. Check that Ollama is running, then try Summarize again.'
        )
      } else {
        console.log(`[AI-SUMMARIZE][detail] ok messageId=${messageId}`)
        const summaryText = data!.summary!
        manualSummaryOverrideRef.current = { messageId, summary: summaryText }
        setAnalysis((prev) => {
          const next = prev
            ? { ...prev, summary: summaryText }
            : {
                needsReply: false,
                needsReplyReason: '',
                summary: summaryText,
                urgencyScore: 5,
                urgencyReason: '',
                actionItems: [],
                archiveRecommendation: 'keep',
                archiveReason: '',
              }
          useEmailInboxStore.getState().setAnalysisCache(messageId, next)
          return next
        })
        setReceivedFields((prev) => new Set([...prev, 'summary' as NormalInboxAiResultKey]))
      }
    } catch (err) {
      console.warn(`[AI-SUMMARIZE][detail] fail messageId=${messageId} reason=exception`, err)
      setAnalysisError(
        'Summarize failed (unexpected error). Check the developer console and try again.'
      )
    } finally {
      setSummarizeLoading(false)
    }
    summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messageId])

  useEffect(() => {
    setAttachments([])
  }, [messageId])

  const handleDraftReply = useCallback(async () => {
    if (!window.emailInbox?.aiDraftReply) return
    setDraftLoading(true)
    setDraft(null)
    setDraftError(false)
    setAttachments([])
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

  const handleAddAttachment = useCallback(async () => {
    if (!window.emailInbox?.showOpenDialogForAttachments) return
    const res = await window.emailInbox.showOpenDialogForAttachments()
    if (res?.ok && res?.data?.files?.length) {
      setAttachments((prev) => [...prev, ...res.data.files])
    }
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const [sending, setSending] = useState(false)

  const handleSend = useCallback(async () => {
    if (!message || !onSendDraft) return
    const draftToSend = (editedDraft || draft) ?? ''
    if (!draftToSend.trim()) return
    setSending(true)
    try {
      const result = await onSendDraft(draftToSend, message, attachments.length > 0 ? attachments : undefined)
      if (result) {
        setDraft(null)
        setEditedDraft('')
        setAttachments([])
      }
    } finally {
      setSending(false)
    }
  }, [message, onSendDraft, editedDraft, draft, attachments])

  const handleArchive = useCallback(() => {
    if (onArchive && messageId) onArchive([messageId])
  }, [onArchive, messageId])

  const handleDelete = useCallback(() => {
    if (onDelete && messageId) onDelete([messageId])
  }, [onDelete, messageId])

  const handleRetryAnalysis = useCallback(() => {
    setAnalysisError(null)
    runAnalysisStream()
  }, [runAnalysisStream])

  const handleRetryDraft = useCallback(() => {
    setDraftError(false)
    handleDraftReply()
  }, [handleDraftReply])

  const toggleActionChecked = useCallback((idx: number) => {
    setActionChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }, [])

  const isDepackaged = message?.source_type === 'email_plain'

  return (
    <div className="inbox-detail-ai-inner inbox-detail-ai-premium" data-has-draft={draft ? 'true' : undefined}>
      <div className="inbox-detail-ai-advisory-banner">
        AI suggestions — you decide what to do
      </div>
      <div className="inbox-detail-ai-actions">
        <button type="button" onClick={handleSummarize} disabled={summarizeLoading || draftLoading}>
          {summarizeLoading ? 'Summarizing…' : 'Summarize'}
        </button>
        <button type="button" onClick={handleDraftReply} disabled={analysisLoading || draftLoading}>
          {draftLoading ? 'Generating…' : draft ? 'Regenerate' : 'Draft Reply'}
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
            <span>{analysisError}</span>
            <button type="button" onClick={handleRetryAnalysis}>Retry</button>
          </div>
        )}

        {/* Collapsible analysis header */}
        <div
          className="ai-analysis-toggle"
          onClick={toggleAnalysisExpanded}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && toggleAnalysisExpanded()}
        >
          <span>Analysis</span>
          <span>{analysisExpanded ? '▾' : '▸'}</span>
        </div>

        {/* Collapsible analysis body — toggles visibility via data-collapsed, panel width unchanged */}
        <div className="ai-analysis-body" data-collapsed={!analysisExpanded}>
            {/* Response Needed */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Response Needed</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('needsReply') ? (
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

            {/* Summary */}
            <div className="inbox-detail-ai-row" ref={summaryRef}>
              <span className="inbox-detail-ai-row-label">Summary</span>
              <div className="inbox-detail-ai-row-value">
                {summarizeLoading ? (
                  <span className="inbox-detail-ai-skeleton-inline" style={{ width: '80%' }} aria-busy="true" />
                ) : analysisLoading && !receivedFields.has('summary') ? (
                  <span className="inbox-detail-ai-skeleton-inline" style={{ width: '80%' }} />
                ) : analysis?.summary ? (
                  <span className="inbox-detail-ai-text">{analysis.summary}</span>
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>

            {/* Urgency */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Urgency</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('urgencyScore') ? (
                  <span className="inbox-detail-ai-skeleton-inline" />
                ) : analysis ? (
                  <InboxUrgencyMeter
                    score={analysis.urgencyScore}
                    variant="panel"
                    reason={analysis.urgencyReason || '—'}
                  />
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>

            {/* Action Items */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Action Items</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('actionItems') ? (
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

            {/* Suggested action */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Suggested action</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('archiveRecommendation') ? (
                  <span className="inbox-detail-ai-skeleton-inline" />
                ) : analysis ? (
                  <>
                    <span className="inbox-detail-ai-text">
                      {analysis.archiveRecommendation === 'archive'
                        ? `Consider archiving — ${analysis.archiveReason || '—'}`
                        : `Keep for now — ${analysis.archiveReason || '—'}`}
                    </span>
                    {analysis.archiveRecommendation === 'archive' && onArchive && (
                      <button type="button" className="inbox-detail-ai-btn-primary inbox-detail-ai-archive-btn" onClick={handleArchive}>Archive</button>
                    )}
                  </>
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>
        </div>

        {/* Draft Reply — always below, outside collapsible; fills height when draft exists */}
        <div
          className={`inbox-detail-ai-row inbox-detail-ai-row-draft${draft ? ' ai-draft-expanded' : ''}${draftRefineConnected && draftRefineMessageId === messageId ? ' ai-draft-connected' : ''}`}
          ref={draftRef}
          style={draft ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}
        >
          <div className="ai-section-draft-header">
            <span className="inbox-detail-ai-row-label">{draft ? 'DRAFT REPLY' : 'Draft Reply'}</span>
            {draft && (
              <span className="ai-draft-connect-hint">click to refine with AI ↑</span>
            )}
          </div>
          <div className="inbox-detail-ai-row-value" style={draft ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
            {draftLoading ? (
              <span className="inbox-detail-ai-skeleton-inline" style={{ width: '90%', height: 48 }} />
            ) : draft ? (
              <>
                {draftRefineConnected && draftRefineMessageId === messageId && (
                  <span className="ai-draft-connect-hint" style={{ marginBottom: 4 }}>Connected to chat ↑ — type instructions to refine</span>
                )}
                {draftError && (
                  <div className="inbox-detail-ai-error-banner">
                    <span>Draft generation failed.</span>
                    <button type="button" onClick={handleRetryDraft}>Retry</button>
                  </div>
                )}
                <textarea
                  ref={draftTextareaRef}
                  value={editedDraft || draft}
                  onChange={(e) => setEditedDraft(e.target.value)}
                  onClick={handleDraftRefineConnect}
                  onFocus={() => {
                    useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)
                    handleDraftRefineConnect()
                  }}
                  onBlur={() => useEmailInboxStore.getState().setEditingDraftForMessageId(null)}
                  className="inbox-detail-ai-draft-textarea"
                  placeholder="Edit draft before sending…"
                />
                {refinedDraftText && draftRefineConnected && draftRefineMessageId === messageId && (
                  <div className="inbox-detail-ai-refined-preview">
                    <div className="inbox-detail-ai-refined-header">
                      <span className="inbox-detail-ai-refined-label">Suggested refinement:</span>
                      <button
                        type="button"
                        className="inbox-detail-ai-accept-refinement"
                        onClick={acceptRefinement}
                        title="Apply refined draft"
                        aria-label="Apply refined draft"
                      >
                        ✓ Accept
                      </button>
                    </div>
                    <div className="inbox-detail-ai-refined-content">{refinedDraftText}</div>
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="draft-attachments">
                    {attachments.map((a, i) => (
                      <div key={i} className="attachment-chip">
                        <span>{a.name}</span>
                        <span className="attachment-size">{Math.round(a.size / 1024)}KB</span>
                        <button type="button" onClick={() => removeAttachment(i)} aria-label="Remove attachment">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="inbox-detail-ai-draft-actions">
                  {isDepackaged && (
                    <button type="button" className="inbox-detail-ai-btn-attach" onClick={handleAddAttachment} title="Add attachment">
                      📎 Attach
                    </button>
                  )}
                  <button type="button" className="inbox-detail-ai-btn-secondary" onClick={handleRegenerateDraft}>Regenerate</button>
                  {message && onSendDraft && !draftError && (
                    <button type="button" className="inbox-detail-ai-btn-primary" onClick={handleSend} disabled={sending}>
                      {sending ? 'Sending...' : isDepackaged ? 'Send via Email' : 'Send via Handshake'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <span className="inbox-detail-ai-muted">{analysis?.needsReply ? 'Draft will appear with analysis…' : 'Click &quot;Draft Reply&quot; to generate.'}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

