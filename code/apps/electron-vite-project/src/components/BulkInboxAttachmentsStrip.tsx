/**
 * Compact bulk inbox — attachment list at bottom of LEFT column (message side), below body preview.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  useEmailInboxStore,
  type InboxAttachment,
  type InboxMessage,
} from '../stores/useEmailInboxStore'
import ProtectedAccessWarningDialog from './ProtectedAccessWarningDialog'
import { InboxDocumentReaderModal } from './InboxDocumentReaderModal'
import { isPdfAttachment } from './InboxAttachmentRow'
import '../components/handshakeViewTypes'

function formatKb(sizeBytes: number | null): string {
  if (sizeBytes == null || sizeBytes < 0) return '—'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  return `${Math.round(sizeBytes / 1024)} KB`
}

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
  const [readerAtt, setReaderAtt] = useState<InboxAttachment | null>(null)
  const [originalAtt, setOriginalAtt] = useState<InboxAttachment | null>(null)

  useEffect(() => {
    setLocalAttachments(msg.attachments)
  }, [msg.attachments, msg.id])

  useEffect(() => {
    if (msg.has_attachments !== 1) return
    const atts = msg.attachments
    if (atts && atts.length > 0) return
    let cancelled = false
    window.emailInbox?.getMessage?.(msg.id).then((res) => {
      if (cancelled || !res?.ok || !res.data) return
      const row = res.data as InboxMessage
      const next = row.attachments
      if (next?.length) {
        setLocalAttachments(next)
        mergeMessageAttachments(msg.id, next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [msg.id, msg.has_attachments, msg.attachments, mergeMessageAttachments])

  const attachments = localAttachments ?? msg.attachments ?? []

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
    return (
      <div
        className="bulk-message-attachments-strip bulk-message-attachments-strip--loading"
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
        className="bulk-message-attachments-strip"
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
                >
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
