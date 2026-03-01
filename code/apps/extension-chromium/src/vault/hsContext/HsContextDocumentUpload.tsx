/**
 * HsContextDocumentUpload
 *
 * PDF upload within a profile. Shows extraction status badge and
 * a snippet of the extracted text once available.
 */

import React, { useRef, useState } from 'react'
import type { ProfileDocumentSummary } from '../hsContextProfilesRpc'
import { uploadHsProfileDocument, deleteHsProfileDocument } from '../hsContextProfilesRpc'

interface Props {
  profileId: string
  documents: ProfileDocumentSummary[]
  onDocumentsChanged: () => void
  theme?: 'dark' | 'standard'
  disabled?: boolean
}

function StatusBadge({ status }: { status: ProfileDocumentSummary['extraction_status'] }) {
  const configs = {
    pending: { label: 'Extracting…', bg: 'rgba(251,191,36,0.15)', color: '#d97706', border: 'rgba(251,191,36,0.35)' },
    success: { label: 'Text ready', bg: 'rgba(34,197,94,0.12)', color: '#16a34a', border: 'rgba(34,197,94,0.35)' },
    failed:  { label: 'Failed', bg: 'rgba(239,68,68,0.12)', color: '#dc2626', border: 'rgba(239,68,68,0.35)' },
  }
  const cfg = configs[status]
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '2px 8px',
      borderRadius: '99px', background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`,
    }}>
      {cfg.label}
    </span>
  )
}

export const HsContextDocumentUpload: React.FC<Props> = ({
  profileId,
  documents,
  onDocumentsChanged,
  theme = 'dark',
  disabled = false,
}) => {
  const isDark = theme === 'dark'
  const textColor = isDark ? '#fff' : '#1f2937'
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : '#6b7280'
  const borderColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'
  const rowBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)'

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      setUploadError('Only PDF files are supported')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError('File size must be under 50 MB')
      return
    }

    setUploading(true)
    setUploadError(null)
    try {
      await uploadHsProfileDocument(profileId, file)
      onDocumentsChanged()
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (docId: string) => {
    if (!confirm('Remove this document?')) return
    try {
      await deleteHsProfileDocument(docId)
      onDocumentsChanged()
    } catch (err: any) {
      alert('Failed to delete: ' + err?.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Documents (PDF)
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          style={{
            fontSize: '11px', fontWeight: 600, padding: '5px 12px',
            background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
            border: 'none', borderRadius: '6px', color: 'white',
            cursor: disabled || uploading ? 'not-allowed' : 'pointer',
            opacity: disabled || uploading ? 0.6 : 1,
          }}
        >
          {uploading ? '⏳ Uploading…' : '+ Add PDF'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {uploadError && (
        <div style={{
          padding: '8px 12px', background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
          fontSize: '12px', color: '#ef4444',
        }}>
          {uploadError}
        </div>
      )}

      {documents.length === 0 && (
        <div style={{
          padding: '16px', textAlign: 'center', color: mutedColor,
          fontSize: '12px', border: `1px dashed ${borderColor}`, borderRadius: '8px',
        }}>
          No documents attached. Upload a PDF pricelist, certificate, or manual.
        </div>
      )}

      {documents.map((doc) => (
        <div
          key={doc.id}
          style={{
            background: rowBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '16px' }}>📄</span>
              <span style={{ fontSize: '12px', color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {doc.filename}
              </span>
              <StatusBadge status={doc.extraction_status} />
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              {doc.extraction_status === 'success' && doc.extracted_text && (
                <button
                  onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                  style={{
                    fontSize: '10px', padding: '3px 8px',
                    background: 'transparent',
                    border: `1px solid ${borderColor}`,
                    borderRadius: '4px', color: mutedColor, cursor: 'pointer',
                  }}
                >
                  {expandedDoc === doc.id ? 'Hide' : 'Preview'}
                </button>
              )}
              <button
                onClick={() => handleDelete(doc.id)}
                style={{
                  fontSize: '10px', padding: '3px 8px',
                  background: 'transparent',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: '4px', color: '#ef4444', cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </div>

          {expandedDoc === doc.id && doc.extracted_text && (
            <div style={{
              padding: '10px 12px',
              borderTop: `1px solid ${borderColor}`,
              background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)',
            }}>
              <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '6px', fontWeight: 600 }}>
                EXTRACTED TEXT PREVIEW
              </div>
              <pre style={{
                fontSize: '11px', color: textColor,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: '180px', overflowY: 'auto',
                margin: 0, fontFamily: 'inherit', lineHeight: 1.5,
              }}>
                {doc.extracted_text.slice(0, 800)}{doc.extracted_text.length > 800 ? '\n…' : ''}
              </pre>
            </div>
          )}

          {doc.extraction_status === 'failed' && doc.error_message && (
            <div style={{
              padding: '8px 12px',
              borderTop: `1px solid rgba(239,68,68,0.2)`,
              fontSize: '11px', color: '#ef4444',
            }}>
              Error: {doc.error_message}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
