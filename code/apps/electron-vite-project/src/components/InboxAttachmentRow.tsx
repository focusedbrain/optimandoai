/**
 * InboxAttachmentRow — Reusable attachment row matching handshake DOCUMENTS pattern.
 * File icon, filename + type, three buttons: Select for chat, Open Document Reader, Open original.
 * Inline text reader toggles below the row (dark theme, line numbers, Copy Page | Download Full Text | Close).
 */

import { useState, useEffect, useCallback } from 'react'
import type { InboxAttachment } from '../stores/useEmailInboxStore'
import '../components/handshakeViewTypes'

const ACCENT = '#8b5cf6'
const MUTED = 'var(--color-text-muted, #94a3b8)'
const READER_BG = '#1a1a2e'
const READER_TEXT = '#e0e0e0'
const GUTTER_BORDER = '#333'

function getFileIcon(contentType: string | null, filename: string): string {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  if (/pdf/i.test(ct) || fn.endsWith('.pdf')) return '📄'
  if (/image\//.test(ct) || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(fn)) return '🖼'
  return '📎'
}

function getTypeLabel(contentType: string | null, filename: string): string {
  const ct = (contentType || '').toLowerCase()
  const fn = (filename || '').toLowerCase()
  if (/pdf/i.test(ct) || fn.endsWith('.pdf')) return 'PDF'
  if (/image\//.test(ct) || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(fn)) return 'Image'
  return 'Attachment'
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
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  const isSelected = selectedAttachmentId === attachment.id
  const icon = getFileIcon(attachment.content_type, attachment.filename)
  const typeLabel = getTypeLabel(attachment.content_type, attachment.filename)

  // Fetch text when reader opens
  useEffect(() => {
    if (!readerOpen || !attachment.id) return
    setLoading(true)
    setText(null)
    window.emailInbox
      ?.getAttachmentText(attachment.id)
      .then((res) => {
        if (res.ok && res.data?.text != null) {
          setText(res.data.text)
        } else {
          setText('')
        }
      })
      .catch(() => setText(''))
      .finally(() => setLoading(false))
  }, [readerOpen, attachment.id])

  const handleCopyPage = useCallback(() => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 1500)
    }).catch(() => {})
  }, [text])

  const handleDownloadFullText = useCallback(() => {
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (attachment.filename || 'attachment').replace(/\.[^.]+$/, '.txt') || 'attachment.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [text, attachment.filename])

  const handleOpenOriginal = useCallback(() => {
    window.emailInbox?.openAttachmentOriginal(attachment.id)
  }, [attachment.id])

  const lines = (text ?? '').split('\n')

  return (
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
          <button
            type="button"
            onClick={handleOpenOriginal}
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

      {/* Inline text reader */}
      {readerOpen && (
        <div
          style={{
            marginTop: '10px',
            background: READER_BG,
            color: READER_TEXT,
            fontFamily: "'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace",
            borderRadius: '6px',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Header bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: `1px solid ${GUTTER_BORDER}`,
              background: 'rgba(255,255,255,0.03)',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {icon} {attachment.filename || 'Attachment'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={handleCopyPage}
                disabled={loading || !text}
                style={{
                  fontSize: 11,
                  padding: '5px 10px',
                  background: 'transparent',
                  border: `1px solid ${GUTTER_BORDER}`,
                  borderRadius: 6,
                  color: copySuccess ? '#22c55e' : READER_TEXT,
                  cursor: loading || !text ? 'not-allowed' : 'pointer',
                  opacity: loading || !text ? 0.5 : 1,
                }}
              >
                {copySuccess ? '✓ Copied' : 'Copy Page'}
              </button>
              <button
                type="button"
                onClick={handleDownloadFullText}
                disabled={loading || !text}
                style={{
                  fontSize: 11,
                  padding: '5px 10px',
                  background: 'transparent',
                  border: `1px solid ${GUTTER_BORDER}`,
                  borderRadius: 6,
                  color: READER_TEXT,
                  cursor: loading || !text ? 'not-allowed' : 'pointer',
                  opacity: loading || !text ? 0.5 : 1,
                }}
              >
                Download Full Text
              </button>
              <button
                type="button"
                onClick={() => setReaderOpen(false)}
                style={{
                  fontSize: 11,
                  padding: '5px 10px',
                  background: 'transparent',
                  border: `1px solid ${GUTTER_BORDER}`,
                  borderRadius: 6,
                  color: MUTED,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>

          {/* Line-numbered content */}
          <div
            style={{
              maxHeight: 400,
              overflowY: 'auto',
              padding: '16px 20px',
            }}
          >
            {loading ? (
              <div style={{ fontSize: 12, color: MUTED }}>Extracting text…</div>
            ) : text === null ? (
              <div style={{ fontSize: 12, color: MUTED }}>Extracting text…</div>
            ) : text === '' ? (
              <div style={{ fontSize: 12, color: MUTED }}>No text content available.</div>
            ) : (
              <div style={{ display: 'flex' }}>
                <div
                  style={{
                    paddingRight: 16,
                    color: MUTED,
                    fontSize: 11,
                    fontFamily: 'inherit',
                    userSelect: 'none',
                    minWidth: 32,
                    textAlign: 'right',
                    borderRight: `1px solid ${GUTTER_BORDER}`,
                    marginRight: 16,
                  }}
                >
                  {lines.map((_, i) => (
                    <div key={i} style={{ lineHeight: 1.6 }}>
                      {i + 1}
                    </div>
                  ))}
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    flex: 1,
                    fontFamily: 'inherit',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {text}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
