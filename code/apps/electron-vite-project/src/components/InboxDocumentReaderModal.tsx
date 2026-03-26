/**
 * PDF document reader modal — shared by InboxAttachmentRow and bulk inbox card strip.
 * Same IPC as Prompt 2 (getAttachmentText + HsContextDocumentReader).
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { HsContextDocumentReader } from './HsContextDocumentReader'
import '../components/handshakeViewTypes'

const MUTED = 'var(--color-text-muted, #94a3b8)'

function isPdfAttachment(contentType: string | null, filename: string): boolean {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  return /pdf/i.test(ct) || fn.endsWith('.pdf')
}

export interface InboxDocumentReaderModalAttachment {
  id: string
  filename: string
  content_type: string | null
  text_extraction_status?: string | null
  text_extraction_error?: string | null
}

export interface InboxDocumentReaderModalProps {
  open: boolean
  onClose: () => void
  attachment: InboxDocumentReaderModalAttachment | null
  /** Called when user clicks View Original in reader (show warning first). */
  onOpenOriginalWarning?: () => void
}

export function InboxDocumentReaderModal({
  open,
  onClose,
  attachment,
  onOpenOriginalWarning,
}: InboxDocumentReaderModalProps) {
  const [readerText, setReaderText] = useState<string | undefined>(undefined)
  const [readerPages, setReaderPages] = useState<string[] | undefined>(undefined)
  const [readerLoading, setReaderLoading] = useState(false)

  const isPdf = attachment
    ? isPdfAttachment(attachment.content_type, attachment.filename)
    : false
  const mimeForReader =
    attachment?.content_type?.trim() ||
    (isPdf ? 'application/pdf' : 'application/octet-stream')
  const extractionFailed = attachment?.text_extraction_status === 'failed'
  const extractionPartial = attachment?.text_extraction_status === 'partial'

  useEffect(() => {
    if (!open || !attachment?.id || !isPdf || extractionFailed) return
    setReaderLoading(true)
    setReaderText(undefined)
    setReaderPages(undefined)
    window.emailInbox
      ?.getAttachmentText(attachment.id)
      .then((res) => {
        if (res.ok && res.data) {
          setReaderText(res.data.text ?? '')
          const p = res.data.pages
          setReaderPages(Array.isArray(p) && p.length > 0 ? p : undefined)
        } else {
          setReaderText('')
          setReaderPages(undefined)
        }
      })
      .catch(() => {
        setReaderText('')
        setReaderPages(undefined)
      })
      .finally(() => setReaderLoading(false))
  }, [open, attachment?.id, isPdf, extractionFailed])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleViewOriginalFromReader = useCallback(() => {
    onOpenOriginalWarning?.()
  }, [onOpenOriginalWarning])

  if (!open || !attachment || !isPdf || extractionFailed) return null

  const partialNotice =
    extractionPartial && attachment.text_extraction_error?.trim()
      ? attachment.text_extraction_error.trim()
      : extractionPartial
        ? 'Text extraction may be incomplete — some pages may have no extractable text.'
        : null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="document-reader-modal-overlay"
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="document-reader-modal"
        role="dialog"
        aria-modal
        aria-label="Document reader"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--color-bg, #0f172a)',
          borderRadius: 8,
          width: '90%',
          maxWidth: 900,
          height: 'min(85vh, 800px)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        }}
      >
        {readerLoading || readerText === undefined ? (
          <div
            style={{
              padding: 32,
              color: MUTED,
              fontSize: 14,
              textAlign: 'center',
            }}
          >
            Extracting text…
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0 }}>
            {partialNotice ? (
              <div
                role="alert"
                style={{
                  flexShrink: 0,
                  padding: '10px 14px',
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: '#b45309',
                  background: 'rgba(251,191,36,0.12)',
                  borderBottom: '1px solid rgba(251,191,36,0.35)',
                }}
              >
                ⚠️ {partialNotice}{' '}
                <button
                  type="button"
                  onClick={handleViewOriginalFromReader}
                  style={{
                    marginLeft: 8,
                    fontSize: 'inherit',
                    cursor: 'pointer',
                    color: '#a78bfa',
                    textDecoration: 'underline',
                    border: 'none',
                    background: 'none',
                    padding: 0,
                  }}
                >
                  Open original
                </button>
              </div>
            ) : null}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <HsContextDocumentReader
                documentId={attachment.id}
                filename={attachment.filename || 'document.pdf'}
                mimeType={mimeForReader}
                api={null}
                fullText={readerText}
                pageTexts={readerPages}
                fillParent
                hideSyntheticPageBanner
                canViewOriginal
                onViewOriginal={handleViewOriginalFromReader}
                onClose={onClose}
              />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
