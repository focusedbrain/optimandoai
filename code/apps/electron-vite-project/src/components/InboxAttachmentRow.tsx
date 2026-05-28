/**
 * InboxAttachmentRow — Attachment row for email message view.
 * PDFs: handshake-style Document Reader (modal) + extraction failure UI.
 * Non-PDF: metadata + Open original only (no text reader).
 */

import { useState, useCallback, useEffect } from 'react'
import type { InboxAttachment } from '../stores/useEmailInboxStore'
import ProtectedAccessWarningDialog from './ProtectedAccessWarningDialog'
import { InboxDocumentReaderModal } from './InboxDocumentReaderModal'
import type { InboxDocumentReaderModalAttachment } from './InboxDocumentReaderModal'
import { usePdfParsingConsent } from '../contexts/PdfParsingConsentContext'
import { WRDESK_FOCUS_AI_CHAT_EVENT } from '../lib/wrdeskUiEvents'
import '../components/handshakeViewTypes'

const MUTED = 'var(--color-text-muted, #94a3b8)'

function getFileIcon(contentType: string | null, filename: string): string {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  if (/pdf/i.test(ct) || fn.endsWith('.pdf')) return '📄'
  if (/image\//.test(ct) || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(fn)) return '🖼'
  return '📎'
}

export function isPdfAttachment(contentType: string | null, filename: string): boolean {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  return /pdf/i.test(ct) || fn.endsWith('.pdf')
}

function getTypeLabel(contentType: string | null, filename: string): string {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  if (/pdf/i.test(ct) || fn.endsWith('.pdf')) return 'PDF'
  if (/image\//.test(ct) || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(fn)) return 'Image'
  return 'Attachment'
}

function formatSize(bytes: number | null): string {
  if (bytes == null || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface InboxAttachmentRowProps {
  attachment: InboxAttachment
  selectedAttachmentId: string | null
  onSelectAttachment: (id: string | null) => void
}

export default function InboxAttachmentRow({
  attachment,
  selectedAttachmentId,
  onSelectAttachment,
}: InboxAttachmentRowProps) {
  const [readerOpen, setReaderOpen] = useState(false)
  const [showOriginalWarning, setShowOriginalWarning] = useState(false)
  const [queryAiBusy, setQueryAiBusy] = useState(false)
  const [localAttachment, setLocalAttachment] = useState(attachment)
  const { ensureInboxPdfReady } = usePdfParsingConsent()

  useEffect(() => {
    setLocalAttachment(attachment)
  }, [attachment])

  const isSelected = selectedAttachmentId === attachment.id
  const icon = getFileIcon(attachment.content_type, attachment.filename)
  const typeLabel = getTypeLabel(attachment.content_type, attachment.filename)
  const isPdf = isPdfAttachment(attachment.content_type, attachment.filename)

  const extractionFailed = localAttachment.text_extraction_status === 'failed'
  const extractionPartial = localAttachment.text_extraction_status === 'partial'
  const extractionError = localAttachment.text_extraction_error?.trim() || null

  const handleOpenOriginalClick = useCallback(() => {
    setShowOriginalWarning(true)
  }, [])

  const handleOriginalAcknowledge = useCallback(() => {
    window.emailInbox?.openAttachmentOriginal(attachment.id)
    setShowOriginalWarning(false)
  }, [attachment.id])

  const handleOriginalCancel = useCallback(() => {
    setShowOriginalWarning(false)
  }, [])

  const handleViewOriginalFromReader = useCallback(() => {
    setShowOriginalWarning(true)
  }, [])

  const closeReader = useCallback(() => setReaderOpen(false), [])

  const readerAttachment: InboxDocumentReaderModalAttachment | null =
    readerOpen && !extractionFailed
      ? {
          id: localAttachment.id,
          message_id: localAttachment.message_id,
          filename: localAttachment.filename || 'document.pdf',
          content_type: localAttachment.content_type,
          text_extraction_status: localAttachment.text_extraction_status,
          text_extraction_error: localAttachment.text_extraction_error,
        }
      : null

  const refreshLocalAttachment = useCallback(async () => {
    const refreshed = await window.emailInbox?.getAttachment?.(localAttachment.id)
    if (refreshed?.ok && refreshed.data && typeof refreshed.data === 'object') {
      setLocalAttachment({ ...localAttachment, ...(refreshed.data as InboxAttachment) })
    }
  }, [localAttachment])

  const handleRequestConsent = useCallback(
    async (_att: InboxDocumentReaderModalAttachment) => {
      const result = await ensureInboxPdfReady(localAttachment)
      if (result.ok) await refreshLocalAttachment()
    },
    [ensureInboxPdfReady, localAttachment, refreshLocalAttachment],
  )

  const handleQueryWithAi = useCallback(async () => {
    onSelectAttachment(localAttachment.id)
    setQueryAiBusy(true)
    try {
      const result = await ensureInboxPdfReady(localAttachment)
      if (!result.ok) return
      await refreshLocalAttachment()
      window.dispatchEvent(new CustomEvent(WRDESK_FOCUS_AI_CHAT_EVENT, { bubbles: true }))
    } finally {
      setQueryAiBusy(false)
    }
  }, [ensureInboxPdfReady, localAttachment, onSelectAttachment, refreshLocalAttachment])

  // ── Non-PDF: metadata + select + open original only ──
  if (!isPdf) {
    return (
      <>
        <ProtectedAccessWarningDialog
          kind="original"
          targetLabel={attachment.filename || 'Attachment'}
          open={showOriginalWarning}
          onClose={handleOriginalCancel}
          onAcknowledge={handleOriginalAcknowledge}
        />
        <div
          style={{
            padding: '12px',
            background: isSelected ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)',
            border: isSelected ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.06)',
            borderRadius: '6px',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
              {isSelected && <span style={{ marginRight: '6px', color: '#a78bfa' }}>✓</span>}
              {icon} {attachment.filename || 'Attachment'}
              <span style={{ fontSize: '11px', color: MUTED, marginLeft: '6px' }}>
                ({typeLabel} · {formatSize(attachment.size_bytes)})
              </span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onSelectAttachment(isSelected ? null : attachment.id)}
                title={isSelected ? 'Deselect for chat' : 'Select for chat'}
                style={{
                  fontSize: '10px',
                  padding: '4px 8px',
                  background: isSelected ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.15)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '4px',
                  color: '#a78bfa',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {isSelected ? 'Selected for chat' : 'Select for chat'}
              </button>
              <button
                type="button"
                onClick={handleOpenOriginalClick}
                style={{
                  fontSize: '10px',
                  padding: '4px 8px',
                  background: 'rgba(139,92,246,0.15)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '4px',
                  color: '#a78bfa',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Open original
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  // ── PDF ──
  return (
    <>
      <ProtectedAccessWarningDialog
        kind="original"
        targetLabel={attachment.filename || 'Attachment'}
        open={showOriginalWarning}
        onClose={handleOriginalCancel}
        onAcknowledge={handleOriginalAcknowledge}
      />
      <InboxDocumentReaderModal
        open={readerOpen && !extractionFailed}
        onClose={closeReader}
        attachment={readerAttachment}
        onOpenOriginalWarning={handleViewOriginalFromReader}
        onRequestConsent={handleRequestConsent}
      />
      <div
        style={{
          padding: '12px',
          background: isSelected ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)',
          border: isSelected ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.06)',
          borderRadius: '6px',
          marginBottom: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
            {isSelected && <span style={{ marginRight: '6px', color: '#a78bfa' }}>✓</span>}
            {icon} {attachment.filename || 'Attachment'}
            <span style={{ fontSize: '11px', color: MUTED, marginLeft: '6px' }}>({typeLabel})</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => void handleQueryWithAi()}
              disabled={queryAiBusy || extractionFailed}
              title="Ask AI about this PDF (consent required before parsing)"
              style={{
                fontSize: '10px',
                padding: '4px 8px',
                background: 'rgba(99,102,241,0.25)',
                border: '1px solid rgba(99,102,241,0.45)',
                borderRadius: '4px',
                color: '#c4b5fd',
                cursor: queryAiBusy ? 'wait' : 'pointer',
                fontWeight: 600,
              }}
            >
              {queryAiBusy ? 'Preparing…' : 'Query with AI'}
            </button>
            <button
              type="button"
              onClick={() => onSelectAttachment(isSelected ? null : attachment.id)}
              title={isSelected ? 'Deselect for chat' : 'Select for chat'}
              style={{
                fontSize: '10px',
                padding: '4px 8px',
                background: isSelected ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '4px',
                color: '#a78bfa',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {isSelected ? 'Selected for chat' : 'Select for chat'}
            </button>
            {!extractionFailed && (
              <button
                type="button"
                onClick={() => setReaderOpen(true)}
                style={{
                  fontSize: '10px',
                  padding: '4px 8px',
                  background: 'rgba(139,92,246,0.15)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '4px',
                  color: '#a78bfa',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {extractionPartial ? 'Open Reader (incomplete text)' : 'Open Document Reader'}
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenOriginalClick}
              style={{
                fontSize: '10px',
                padding: '4px 8px',
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '4px',
                color: '#a78bfa',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Open original
            </button>
          </div>
        </div>

        {extractionFailed && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'rgba(234,179,8,0.1)',
              border: '1px solid rgba(234,179,8,0.35)',
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--color-text, #e2e8f0)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              ⚠️ Text could not be extracted from this PDF. You can still open the original after security review.
            </div>
            {extractionError ? (
              <div style={{ fontSize: 11, color: MUTED, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
                {extractionError}
              </div>
            ) : null}
          </div>
        )}
        {extractionPartial && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.35)',
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--color-text, #e2e8f0)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              ⚠️ Text extraction is incomplete — some pages may be empty. The original document can still be opened for full content.
            </div>
            {extractionError ? (
              <div style={{ fontSize: 11, color: MUTED, wordBreak: 'break-word' }}>{extractionError}</div>
            ) : null}
            <button
              type="button"
              onClick={handleOpenOriginalClick}
              style={{
                marginTop: 8,
                fontSize: '10px',
                padding: '4px 8px',
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '4px',
                color: '#a78bfa',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Open original
            </button>
          </div>
        )}
      </div>
    </>
  )
}
