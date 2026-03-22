/**
 * InboxAttachmentRow — Attachment row for email message view.
 * PDFs: handshake-style Document Reader (HsContextDocumentReader) + extraction failure UI.
 * Non-PDF: metadata + Open original only (no text reader).
 */

import { useState, useEffect, useCallback } from 'react'
import type { InboxAttachment } from '../stores/useEmailInboxStore'
import ProtectedAccessWarningDialog from './ProtectedAccessWarningDialog'
import { HsContextDocumentReader } from './HsContextDocumentReader'
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
  /** Fetched full text for Document Reader; `undefined` = not loaded yet. */
  const [readerText, setReaderText] = useState<string | undefined>(undefined)
  const [readerLoading, setReaderLoading] = useState(false)
  const [showOriginalWarning, setShowOriginalWarning] = useState(false)

  const isSelected = selectedAttachmentId === attachment.id
  const icon = getFileIcon(attachment.content_type, attachment.filename)
  const typeLabel = getTypeLabel(attachment.content_type, attachment.filename)
  const isPdf = isPdfAttachment(attachment.content_type, attachment.filename)
  const mimeForReader =
    attachment.content_type?.trim() || (isPdf ? 'application/pdf' : 'application/octet-stream')

  const extractionFailed = attachment.text_extraction_status === 'failed'
  const extractionError = attachment.text_extraction_error?.trim() || null

  // Load extracted text when PDF reader opens
  useEffect(() => {
    if (!readerOpen || !isPdf || !attachment.id || extractionFailed) return
    setReaderLoading(true)
    setReaderText(undefined)
    window.emailInbox
      ?.getAttachmentText(attachment.id)
      .then((res) => {
        if (res.ok && res.data) {
          setReaderText(res.data.text ?? '')
        } else {
          setReaderText('')
        }
      })
      .catch(() => setReaderText(''))
      .finally(() => setReaderLoading(false))
  }, [readerOpen, isPdf, attachment.id, extractionFailed])

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
                onClick={() => setReaderOpen((o) => !o)}
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
                Open Document Reader
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

        {readerOpen && !extractionFailed && (
          <div style={{ marginTop: 12 }}>
            {readerLoading || readerText === undefined ? (
              <div
                style={{
                  padding: 24,
                  color: MUTED,
                  fontSize: 13,
                  background: 'var(--color-bg, #0f172a)',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                Extracting text…
              </div>
            ) : (
              <HsContextDocumentReader
                documentId={attachment.id}
                filename={attachment.filename || 'document.pdf'}
                mimeType={mimeForReader}
                api={null}
                fullText={readerText}
                hideSyntheticPageBanner
                canViewOriginal
                onViewOriginal={handleViewOriginalFromReader}
                onClose={() => setReaderOpen(false)}
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}
