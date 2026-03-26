/**
 * Bulk inbox — attachment rows rendered inside `.bulk-view-message-attachments-footer` (anchored bottom bar of the left pane).
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  useEmailInboxStore,
  type InboxAttachment,
  type InboxMessage,
} from '../stores/useEmailInboxStore'
import ProtectedAccessWarningDialog from './ProtectedAccessWarningDialog'
import { InboxDocumentReaderModal } from './InboxDocumentReaderModal'
import '../components/handshakeViewTypes'
import {
  hydrationAfterGetMessageIpcError,
  hydrationAfterGetMessageReject,
  hydrationAfterGetMessageSuccess,
} from './bulkInboxAttachmentHydration'

function isPdfAttachment(contentType: string | null, filename: string): boolean {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  return /pdf/i.test(ct) || fn.endsWith('.pdf')
}

function formatKb(sizeBytes: number | null): string {
  if (sizeBytes == null || sizeBytes < 0) return '—'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  return `${Math.round(sizeBytes / 1024)} KB`
}

/** Hydration when list payload omits attachment rows but DB flags say attachments exist. */
type AttachmentHydrationState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'loaded'; attachments: InboxAttachment[] }
  | { phase: 'empty' }
  | { phase: 'error'; message: string }

export interface BulkInboxAttachmentsStripProps {
  msg: InboxMessage
  selectedAttachmentId: string | null
  selectAttachment: (messageId: string, attachmentId: string | null) => void
  onSelectAttachment?: (attachmentId: string | null) => void
}

export function BulkInboxAttachmentsStrip({
  msg,
  selectedAttachmentId,
  selectAttachment,
  onSelectAttachment,
}: BulkInboxAttachmentsStripProps) {
  const mergeMessageAttachments = useEmailInboxStore((s) => s.mergeMessageAttachments)
  const [localAttachments, setLocalAttachments] = useState<InboxAttachment[] | undefined>(msg.attachments)
  const [hydration, setHydration] = useState<AttachmentHydrationState>(() => {
    if (msg.has_attachments === 1 && !(msg.attachments && msg.attachments.length > 0)) {
      return { phase: 'loading' }
    }
    return { phase: 'idle' }
  })
  /** After a successful fetch (any outcome), skip re-fetch for this message id when list still omits rows. */
  const fetchSettledForIdRef = useRef<string | null>(null)
  const [readerAtt, setReaderAtt] = useState<InboxAttachment | null>(null)
  const [originalAtt, setOriginalAtt] = useState<InboxAttachment | null>(null)

  /** When the server/list already includes attachment rows, prefer them and clear fetch guard. */
  useEffect(() => {
    if (msg.attachments && msg.attachments.length > 0) {
      setLocalAttachments(msg.attachments)
      setHydration({ phase: 'loaded', attachments: msg.attachments })
      fetchSettledForIdRef.current = null
    }
  }, [msg.attachments, msg.id])

  useEffect(() => {
    if (msg.has_attachments !== 1) {
      fetchSettledForIdRef.current = null
      setHydration({ phase: 'idle' })
      return
    }
    const atts = msg.attachments
    if (atts && atts.length > 0) return
    if (fetchSettledForIdRef.current === msg.id) return

    let cancelled = false
    setHydration({ phase: 'loading' })

    const p = window.emailInbox?.getMessage?.(msg.id)
    if (!p || typeof p.then !== 'function') {
      fetchSettledForIdRef.current = msg.id
      setHydration({
        phase: 'error',
        message: 'Attachment loader unavailable.',
      })
      return
    }

    p.then((res) => {
      if (cancelled) return
      fetchSettledForIdRef.current = msg.id
      if (!res?.ok || !res.data) {
        setHydration(hydrationAfterGetMessageIpcError(res as { error?: string } | null))
        return
      }
      const row = res.data as InboxMessage
      const next = row.attachments ?? []
      setLocalAttachments(next)
      mergeMessageAttachments(msg.id, next)
      setHydration(hydrationAfterGetMessageSuccess(next))
    }).catch((err: unknown) => {
      if (cancelled) return
      fetchSettledForIdRef.current = msg.id
      setHydration(hydrationAfterGetMessageReject(err))
    })

    return () => {
      cancelled = true
    }
  }, [msg.id, msg.has_attachments, msg.attachments, mergeMessageAttachments])

  const attachments =
    localAttachments ??
    (hydration.phase === 'loaded' ? hydration.attachments : undefined) ??
    msg.attachments ??
    []

  const handleSelectChat = useCallback(
    (att: InboxAttachment) => {
      if (selectedAttachmentId === att.id) {
        selectAttachment(msg.id, null)
        onSelectAttachment?.(null)
      } else {
        selectAttachment(msg.id, att.id)
        onSelectAttachment?.(att.id)
      }
    },
    [msg.id, selectedAttachmentId, selectAttachment, onSelectAttachment],
  )

  const closeReader = useCallback(() => setReaderAtt(null), [])
  const onOriginalAck = useCallback(() => {
    if (originalAtt?.id) window.emailInbox?.openAttachmentOriginal(originalAtt.id)
    setOriginalAtt(null)
  }, [originalAtt])

  if (msg.has_attachments !== 1) return null

  if (!attachments.length) {
    if (hydration.phase === 'loading') {
      return (
        <div
          className="bulk-message-attachments-strip bulk-message-attachments-strip--loading bulk-message-footer-inner bulk-view-attachments-strip"
          data-subfocus="attachment"
        >
          Loading attachments…
        </div>
      )
    }
    if (hydration.phase === 'error') {
      return (
        <div
          className="bulk-message-attachments-strip bulk-message-footer-inner bulk-view-attachments-strip bulk-message-attachments-strip--error"
          data-subfocus="attachment"
          role="status"
        >
          {hydration.message}
        </div>
      )
    }
    if (hydration.phase === 'empty') {
      return (
        <div
          className="bulk-message-attachments-strip bulk-message-footer-inner bulk-view-attachments-strip bulk-message-attachments-strip--empty"
          data-subfocus="attachment"
          role="status"
        >
          No attachments found for this message.
        </div>
      )
    }
    return (
      <div
        className="bulk-message-attachments-strip bulk-message-attachments-strip--loading bulk-message-footer-inner bulk-view-attachments-strip"
        data-subfocus="attachment"
      >
        Loading attachments…
      </div>
    )
  }

  return (
    <>
      <ProtectedAccessWarningDialog
        kind="original"
        targetLabel={originalAtt?.filename || 'Attachment'}
        open={!!originalAtt}
        onClose={() => setOriginalAtt(null)}
        onAcknowledge={onOriginalAck}
      />
      <InboxDocumentReaderModal
        open={!!readerAtt}
        onClose={closeReader}
        attachment={
          readerAtt
            ? {
                id: readerAtt.id,
                filename: readerAtt.filename || 'document.pdf',
                content_type: readerAtt.content_type,
                text_extraction_status: readerAtt.text_extraction_status,
                text_extraction_error: readerAtt.text_extraction_error,
              }
            : null
        }
        onOpenOriginalWarning={() => readerAtt && setOriginalAtt(readerAtt)}
      />
      <div
        className="bulk-message-attachments-strip bulk-message-footer-inner bulk-view-attachments-strip bulk-view-attachments-actions"
        data-subfocus="attachment"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {attachments.map((att) => {
          const isSel = selectedAttachmentId === att.id
          const isPdf = isPdfAttachment(att.content_type, att.filename)
          const failed = att.text_extraction_status === 'failed'
          const partial = att.text_extraction_status === 'partial'
          const showExtractionWarning = failed || partial
          return (
            <div key={att.id} className="bulk-attachment-row">
              <div className="bulk-attachment-row__line">
                <span className="bulk-attachment-row__filename">
                  📎 {att.filename || 'Attachment'}
                  <span className="bulk-attachment-row__size">({formatKb(att.size_bytes)})</span>
                </span>
                <button
                  type="button"
                  className={`bulk-attachment-btn${isSel ? ' bulk-attachment-btn--selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelectChat(att)
                  }}
                  title={isSel ? 'Selected for chat — click to clear' : 'Chat using this attachment'}
                >
                  {isSel ? (
                    <span className="bulk-attachment-btn__finger" aria-hidden>
                      👉
                    </span>
                  ) : null}
                  Chat
                </button>
                {isPdf && !failed ? (
                  <button
                    type="button"
                    className="bulk-attachment-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setReaderAtt(att)
                    }}
                  >
                    Read
                  </button>
                ) : null}
                <button
                  type="button"
                  className="bulk-attachment-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOriginalAtt(att)
                  }}
                >
                  Original
                </button>
              </div>
              {showExtractionWarning ? (
                <div className="bulk-attachment-row__warning">
                  ⚠️{' '}
                  {failed
                    ? 'Text could not be extracted from this PDF.'
                    : 'Text extraction is incomplete — some pages may be empty.'}
                  {att.text_extraction_error ? (
                    <div className="bulk-attachment-row__warning-detail">{att.text_extraction_error}</div>
                  ) : null}
                  <div className="bulk-attachment-row__warning-footer">
                    You can still view the original document securely.{' '}
                    <button
                      type="button"
                      className="bulk-attachment-row__warning-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOriginalAtt(att)
                      }}
                    >
                      Open original
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
