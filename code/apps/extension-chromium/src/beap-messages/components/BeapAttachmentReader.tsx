/**
 * BeapAttachmentReader — Shared reader for semantic content
 *
 * Renders extracted text in a styled reader panel matching HsContextDocumentReader.
 * Used by BeapMessageDetailPanel and BeapBulkInbox for attachment semantic content.
 *
 * @version 1.0.0
 */

import React, { useCallback, useState } from 'react'
import type { BeapAttachment } from '../beapInboxTypes'

const CONTENT_FONT = "'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace"
const BORDER = '1px solid rgba(255,255,255,0.08)'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

export interface BeapAttachmentReaderProps {
  attachment: BeapAttachment
  /** Theme for styling. */
  isProfessional?: boolean
  /** Max height of the scrollable content area (px). */
  maxHeight?: number
  /** Show copy button. */
  showCopy?: boolean
}

export const BeapAttachmentReader: React.FC<BeapAttachmentReaderProps> = ({
  attachment,
  isProfessional = false,
  maxHeight = 200,
  showCopy = true,
}) => {
  const [copySuccess, setCopySuccess] = useState(false)
  const content = attachment.semanticContent?.trim() ?? ''
  const textColor = isProfessional ? '#1f2937' : 'var(--color-text, #e2e8f0)'
  const mutedColor = isProfessional ? '#6b7280' : 'var(--color-text-muted, #94a3b8)'
  const borderColor = isProfessional ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const handleCopy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 1500)
    } catch {
      // ignore
    }
  }, [content])

  if (!content) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: mutedColor,
          fontStyle: 'italic',
        }}
      >
        No extracted text. The document may be image-only or still processing.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 80,
        background: isProfessional ? '#ffffff' : 'var(--color-bg, #0f172a)',
        borderRadius: 8,
        overflow: 'hidden',
        border: BORDER,
      }}
    >
      {/* Header: filename, mime, size */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: `1px solid ${borderColor}`,
          background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: textColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 180,
          }}
        >
          📄 {attachment.filename}
        </span>
        <span style={{ fontSize: 11, color: mutedColor, flexShrink: 0 }}>
          {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
        </span>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          background: isProfessional ? '#ffffff' : '#ffffff',
          color: isProfessional ? '#1e293b' : '#1e293b',
          fontFamily: CONTENT_FONT,
          fontSize: 13,
          lineHeight: 1.6,
          maxHeight: maxHeight,
          userSelect: 'text',
        }}
      >
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
          }}
        >
          {content.length > 5000 ? content.slice(0, 5000) + '\n\n… [truncated]' : content}
        </pre>
      </div>

      {/* Footer: copy */}
      {showCopy && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 12px',
            borderTop: `1px solid ${borderColor}`,
            background: isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={handleCopy}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              background: 'transparent',
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              color: copySuccess ? '#22c55e' : textColor,
              cursor: 'pointer',
            }}
          >
            {copySuccess ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

export default BeapAttachmentReader
