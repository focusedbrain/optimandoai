/**
 * PDF document reader modal — shared by InboxAttachmentRow and bulk inbox card strip.
 * Extraction requires explicit consent via inbox:requestPdfExtraction (no lazy parse on open).
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
  message_id?: string | null
}

export interface InboxDocumentReaderModalProps {
  open: boolean
  onClose: () => void
  attachment: InboxDocumentReaderModalAttachment | null
  /** Called when user clicks View Original in reader (show warning first). */
  onOpenOriginalWarning?: () => void
  /** Parent surfaces consent UI; called when user chooses to extract. */
  onRequestConsent?: (attachment: InboxDocumentReaderModalAttachment) => void
}

export function InboxDocumentReaderModal({
  open,
  onClose,
  attachment,
  onOpenOriginalWarning,
  onRequestConsent,
}: InboxDocumentReaderModalProps) {
  const [readerText, setReaderText] = useState<string | undefined>(undefined)
  const [readerPages, setReaderPages] = useState<string[] | undefined>(undefined)
  const [readerLoading, setReaderLoading] = useState(false)
  const [readerStatus, setReaderStatus] = useState<string | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  const isPdf = attachment
    ? isPdfAttachment(attachment.content_type, attachment.filename)
    : false
  const mimeForReader =
    attachment?.content_type?.trim() ||
    (isPdf ? 'application/pdf' : 'application/octet-stream')
  const extractionFailed = attachment?.text_extraction_status === 'failed'
  const extractionPartial = attachment?.text_extraction_status === 'partial'
  const needsConsent = attachment?.text_extraction_status === 'consent_required'
  const hasReadableText =
    attachment?.text_extraction_status === 'done' ||
    attachment?.text_extraction_status === 'partial' ||
    attachment?.text_extraction_status === 'edge_extracted' ||
    attachment?.text_extraction_status === 'host_extracted_with_consent'

  const loadStoredText = useCallback(async () => {
    if (!attachment?.id) return
    setReaderLoading(true)
    setExtractError(null)
    try {
      const res = await window.emailInbox?.getAttachmentText(attachment.id)
      if (res?.ok && res.data) {
        setReaderStatus(res.data.status ?? null)
        if (res.data.status === 'consent_required') {
          setReaderText('')
          setReaderPages(undefined)
        } else {
          setReaderText(res.data.text ?? '')
          const p = res.data.pages
          setReaderPages(Array.isArray(p) && p.length > 0 ? p : undefined)
        }
      } else {
        setReaderText('')
        setExtractError(res?.error ?? 'Could not load attachment text')
      }
    } catch {
      setReaderText('')
      setExtractError('Could not load attachment text')
    } finally {
      setReaderLoading(false)
    }
  }, [attachment?.id])

  useEffect(() => {
    if (!open || !attachment?.id || !isPdf || extractionFailed) return
    void loadStoredText()
  }, [open, attachment?.id, isPdf, extractionFailed, loadStoredText])

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

  const handleRequestExtract = useCallback(() => {
    if (attachment && onRequestConsent) {
      onRequestConsent(attachment)
    }
  }, [attachment, onRequestConsent])

  if (!open || !attachment || !isPdf || extractionFailed) return null

  const partialNotice =
    extractionPartial && attachment.text_extraction_error?.trim()
      ? attachment.text_extraction_error.trim()
      : extractionPartial
        ? 'Text extraction may be incomplete — some pages may have no extractable text.'
        : null

  const showConsentGate =
    needsConsent || readerStatus === 'consent_required' || (!hasReadableText && !readerLoading)

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
        {readerLoading ? (
          <div style={{ padding: 32, color: MUTED, fontSize: 14, textAlign: 'center' }}>
            Loading…
          </div>
        ) : showConsentGate ? (
          <div
            style={{
              padding: 32,
              color: MUTED,
              fontSize: 14,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              alignItems: 'center',
            }}
          >
            <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.5 }}>
              PDF text is not yet available. Parsing runs only after you confirm in the consent
              dialog.
            </p>
            {extractError ? (
              <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{extractError}</p>
            ) : null}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={handleRequestExtract}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#6366f1',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Make PDF readable
              </button>
              <button type="button" onClick={onClose} style={{ padding: '8px 16px', fontSize: 14 }}>
                Close
              </button>
            </div>
          </div>
        ) : readerText === undefined ? (
          <div style={{ padding: 32, color: MUTED, fontSize: 14, textAlign: 'center' }}>
            No text available.
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
