/**
 * Compact bulk inbox card — attachment list below the AI action card (right column).
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

function typeShort(contentType: string | null, filename: string): string {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  if (ct.includes('/')) return (ct.split('/')[1] || 'file').toUpperCase()
  if (fn.endsWith('.pdf')) return 'PDF'
  return 'FILE'
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
        className="bulk-action-card-attachments-loading"
        style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #e2e8f0', fontSize: 10, color: '#94a3b8' }}
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
              }
            : null
        }
        onOpenOriginalWarning={() => readerAtt && setOriginalAtt(readerAtt)}
      />
      <div
        data-subfocus="attachment"
        style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0', flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
          📎 Attachments ({attachments.length})
        </div>
        {attachments.map((att) => {
          const isSel = selectedAttachmentId === att.id
          const isPdf = isPdfAttachment(att.content_type, att.filename)
          const extractionFailed = att.text_extraction_status === 'failed'
          return (
            <div
              key={att.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 6,
                fontSize: 11,
                padding: '4px 0',
                color: '#334155',
              }}
            >
              <span style={{ fontWeight: 500 }}>📄 {att.filename || 'Attachment'}</span>
              <span style={{ color: '#94a3b8' }}>
                ({typeShort(att.content_type, att.filename)}, {formatKb(att.size_bytes)})
              </span>
              <button
                type="button"
                className="bulk-attachment-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  handleSelectChat(att)
                }}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid #c4b5fd',
                  background: isSel ? 'rgba(139,92,246,0.2)' : '#f5f3ff',
                  color: '#6d28d9',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {isSel ? 'Selected for chat' : 'Select for chat'}
              </button>
              {isPdf && !extractionFailed ? (
                <button
                  type="button"
                  className="bulk-attachment-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setReaderAtt(att)
                  }}
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #c4b5fd',
                    background: '#fafafa',
                    color: '#6d28d9',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Open Reader
                </button>
              ) : null}
              <button
                type="button"
                className="bulk-attachment-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setOriginalAtt(att)
                }}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid #e2e8f0',
                  background: '#fff',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Open original
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
