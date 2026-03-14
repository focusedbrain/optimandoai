/**
 * HsContextDocumentUpload
 *
 * PDF upload within a profile. Shows extraction status badge and
 * a snippet of the extracted text once available.
 *
 * Auto-polling: while any document is in 'pending' extraction state the
 * component calls onDocumentsChanged every 2 s so the parent refreshes the
 * document list independently of any other user action.
 *
 * BYOK Vision card: when extraction fails with error_code='NO_TEXT_EXTRACTED',
 * the user can supply an Anthropic API key to retry extraction via Vision API.
 * The key is encrypted and stored in the vault — subsequent failures show a
 * one-click "Extract with AI" button instead of the key entry form.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { ProfileDocumentSummary } from '../hsContextProfilesRpc'
import {
  uploadHsProfileDocument,
  deleteHsProfileDocument,
  updateHsProfileDocumentMeta,
  getHsOwnerDocumentContent,
  saveAnthropicApiKey,
  hasAnthropicApiKey,
  retryExtractionWithVision,
} from '../hsContextProfilesRpc'
import { HsContextDocumentReader } from './HsContextDocumentReader'
import { validateDocumentLabel } from '@shared/handshake/hsContextFieldValidation'

/** Trigger a browser download for a base64-encoded file. */
function triggerDownload(contentBase64: string, filename: string, mimeType: string): void {
  const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: mimeType || 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Suggest a human-readable label from filename (strip .pdf, replace separators) */
function suggestLabelFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, '').trim()
  if (!base) return ''
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Suggest document type from filename using keyword heuristics.
 * Order matters — more specific patterns appear first.
 */
function suggestTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase().replace(/\.pdf$/i, '')

  if (/\binvoice\b|\brechnung\b|\bfactura\b|\breceipt\b|\bquittung\b|\bbeleg\b/.test(lower)) return 'invoice'
  if (/\bcontract\b|\bagreement\b|\bnda\b|\bterms\b|\bvereinbarung\b|\bvertrag\b/.test(lower)) return 'contract'
  if (/\bmanual\b|user[- ]?guide\b|\bhandbook\b|\binstructions?\b|\bhandbuch\b|\banleitung\b/.test(lower)) return 'manual'
  if (/\bcertificate\b|\bcert\b|\btrademark\b|\bregistration\b|\blicen[cs]e\b|\bwarranty\b|\bzertifikat\b|\burkunde\b|\blizenz\b/.test(lower)) return 'certificate'
  if (/\bprice\b|\bpricelist\b|\bpricing\b|\bquotation\b|\bquote\b|\bangebot\b|\bpreisliste\b/.test(lower)) return 'pricelist'
  if (/\bdatasheet\b|\bspec(?:ification)?s?\b|\btechnical\b|\bdatenblatt\b|\btechnisch\b/.test(lower)) return 'datasheet'
  if (/\bbrochure\b|\bcatalog(?:ue)?\b|\bflyer\b|\bbrosch[uü]re\b|\bkatalog\b|\bprospekt\b/.test(lower)) return 'brochure'

  return 'custom'
}

interface Props {
  /** When undefined, upload will call onGetOrCreateProfileId before uploading. */
  profileId?: string
  documents: ProfileDocumentSummary[]
  onDocumentsChanged: () => void
  /** Called when user uploads and profileId is missing — returns new profile ID. Enables upload-triggered draft creation. */
  onGetOrCreateProfileId?: () => Promise<string>
  theme?: 'dark' | 'standard'
  disabled?: boolean
}

function StatusBadge({ status }: { status: ProfileDocumentSummary['extraction_status'] }) {
  const configs = {
    pending: { label: 'Extracting…', bg: 'rgba(251,191,36,0.15)', color: '#d97706', border: 'rgba(251,191,36,0.35)' },
    success: { label: 'Text ready', bg: 'rgba(34,197,94,0.12)', color: '#16a34a', border: 'rgba(34,197,94,0.35)' },
    failed:  { label: 'Failed',     bg: 'rgba(239,68,68,0.12)',  color: '#dc2626', border: 'rgba(239,68,68,0.35)' },
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
  onGetOrCreateProfileId,
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
  const [markNextAsSensitive, setMarkNextAsSensitive] = useState(false)
  const [nextLabel, setNextLabel] = useState('')
  const [nextDocumentType, setNextDocumentType] = useState<string>('')
  const [editingDoc, setEditingDoc] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editType, setEditType] = useState('')
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [readerDoc, setReaderDoc] = useState<ProfileDocumentSummary | null>(null)

  // BYOK Vision state
  const [hasStoredKey, setHasStoredKey] = useState<boolean | null>(null)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [pendingApiKey, setPendingApiKey] = useState('')
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  // docId being retried — used to show spinner on the right row
  const [retryingVisionDoc, setRetryingVisionDoc] = useState<string | null>(null)

  const DOCUMENT_TYPES = ['', 'manual', 'contract', 'invoice', 'certificate', 'pricelist', 'datasheet', 'brochure', 'custom'] as const

  // ── Check whether a Vision API key is already stored ─────────────────────
  // Run once when any document has error_code='NO_TEXT_EXTRACTED'.
  const hasImageOnlyFailure = documents.some(
    (d) => d.extraction_status === 'failed' && d.error_code === 'NO_TEXT_EXTRACTED'
  )

  useEffect(() => {
    if (!hasImageOnlyFailure || hasStoredKey !== null) return
    hasAnthropicApiKey()
      .then((r) => setHasStoredKey(r.hasKey))
      .catch(() => setHasStoredKey(false))
  }, [hasImageOnlyFailure, hasStoredKey])

  // ── Auto-polling while extraction is in-flight ────────────────────────────
  const onChangedRef = useRef(onDocumentsChanged)
  useEffect(() => { onChangedRef.current = onDocumentsChanged })

  const hasPending = documents.some((d) => d.extraction_status === 'pending')

  useEffect(() => {
    if (!hasPending) return

    let attempts = 0
    const MAX_ATTEMPTS = 180 // 6 min at 2 s intervals — matches server-side timeout

    const timer = setInterval(() => {
      attempts++
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer)
        return
      }
      onChangedRef.current()
    }, 2000)

    return () => clearInterval(timer)
  }, [hasPending])

  // ── Vision retry handlers ─────────────────────────────────────────────────

  const startVisionPolling = useCallback(() => {
    // The doc will flip to 'pending' on the server; the polling effect above
    // picks it up automatically as soon as onDocumentsChanged fires.
    onDocumentsChanged()
  }, [onDocumentsChanged])

  /** One-click retry using the already-stored key. */
  const handleRetryWithStoredKey = async (docId: string) => {
    setRetryingVisionDoc(docId)
    setApiKeyError(null)
    try {
      await retryExtractionWithVision(docId)
      startVisionPolling()
    } catch (err: any) {
      setApiKeyError(err?.message ?? 'Retry failed')
    } finally {
      setRetryingVisionDoc(null)
    }
  }

  /** Save new key (validates server-side) then retry. */
  const handleSaveKeyAndRetry = async (docId: string) => {
    if (!pendingApiKey.startsWith('sk-ant-')) {
      setApiKeyError('API key must start with sk-ant-')
      return
    }
    setRetryingVisionDoc(docId)
    setApiKeyError(null)
    try {
      // RPC validates key against Anthropic before storing — throws on invalid key
      await saveAnthropicApiKey(pendingApiKey)
      setHasStoredKey(true)
      setShowApiKeyInput(false)
      setPendingApiKey('')
      await retryExtractionWithVision(docId)
      startVisionPolling()
    } catch (err: any) {
      setApiKeyError(err?.message ?? 'Failed to save key or start extraction')
    } finally {
      setRetryingVisionDoc(null)
    }
  }

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

    let pid = profileId
    if (!pid && onGetOrCreateProfileId) {
      try {
        pid = await onGetOrCreateProfileId()
      } catch (err: any) {
        setUploadError(err?.message ?? 'Failed to create profile for upload')
        return
      }
    }
    if (!pid) {
      setUploadError('Profile not ready — save the profile first to enable uploads')
      return
    }

    const suggestedLabel = suggestLabelFromFilename(file.name)
    const suggestedType = suggestTypeFromFilename(file.name)
    const labelVal = (nextLabel.trim() || suggestedLabel) || null
    const documentTypeVal = (nextDocumentType.trim() || suggestedType) || null

    if (labelVal) {
      const r = validateDocumentLabel(labelVal)
      if (!r.ok) { setUploadError(r.error); return }
    }
    setUploading(true)
    setUploadError(null)
    try {
      await uploadHsProfileDocument(pid, file, markNextAsSensitive, labelVal, documentTypeVal)
      setNextLabel('')
      setNextDocumentType('')
      onDocumentsChanged()
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleUpdateMeta = async (docId: string) => {
    const labelVal = editLabel.trim() || null
    if (labelVal) {
      const r = validateDocumentLabel(labelVal)
      if (!r.ok) { alert(r.error); return }
    }
    try {
      await updateHsProfileDocumentMeta(docId, { label: labelVal, document_type: editType.trim() || null })
      setEditingDoc(null)
      onDocumentsChanged()
    } catch (err: any) {
      alert('Failed to update: ' + err?.message)
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

  const handleOwnerDownload = async (docId: string) => {
    setDownloadingDoc(docId)
    setDownloadError(null)
    try {
      const result = await getHsOwnerDocumentContent(docId)
      if (result.success) {
        triggerDownload(result.contentBase64, result.filename, result.mimeType)
      } else {
        setDownloadError(result.error)
      }
    } catch (err: any) {
      setDownloadError(err?.message ?? 'Download failed')
    } finally {
      setDownloadingDoc(null)
    }
  }

  const addPdfBtnStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, padding: '5px 12px',
    background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    border: 'none', borderRadius: '6px',
    color: '#ffffff',
    cursor: disabled || uploading ? 'not-allowed' : 'pointer',
    opacity: disabled || uploading ? 0.6 : 1,
  }

  const primaryBtnStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, padding: '5px 12px',
    background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    border: 'none', borderRadius: '6px', color: '#ffffff', cursor: 'pointer',
  }
  const secondaryBtnStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 500, padding: '5px 10px',
    background: 'transparent',
    border: `1px solid ${borderColor}`, borderRadius: '6px',
    color: mutedColor, cursor: 'pointer',
  }
  const linkBtnStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 500, padding: '2px 0',
    background: 'none', border: 'none',
    color: isDark ? '#a78bfa' : '#7c3aed', cursor: 'pointer',
    textDecoration: 'underline', textDecorationStyle: 'dotted',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── Upload controls row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '4px', flexWrap: 'wrap', gap: '10px',
      }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          PDF Upload
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <input
            type="text"
            placeholder="Label (optional — from filename)"
            value={nextLabel}
            onChange={(e) => setNextLabel(e.target.value)}
            style={{
              fontSize: '11px', padding: '4px 8px', maxWidth: '140px',
              background: isDark ? 'rgba(255,255,255,0.07)' : 'white',
              border: `1px solid ${borderColor}`, borderRadius: '6px', color: textColor,
            }}
          />
          <select
            value={nextDocumentType}
            onChange={(e) => setNextDocumentType(e.target.value)}
            style={{
              fontSize: '11px', padding: '4px 8px',
              background: isDark ? 'rgba(255,255,255,0.07)' : 'white',
              border: `1px solid ${borderColor}`, borderRadius: '6px', color: textColor,
            }}
          >
            <option value="">Type (optional — from filename)</option>
            {DOCUMENT_TYPES.filter(Boolean).map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', color: mutedColor }}>
            <input type="checkbox" checked={markNextAsSensitive} onChange={() => setMarkNextAsSensitive(!markNextAsSensitive)} style={{ margin: 0 }} />
            <span>Sensitive</span>
            <span
              title="If enabled, this item stays restricted to the inner vault of the receiving orchestrator and must not be queryable by external AI."
              style={{ cursor: 'help' }}
            >ⓘ</span>
          </label>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading}
            style={addPdfBtnStyle}
          >
            {uploading ? '⏳ Uploading…' : '+ Add PDF'}
          </button>
        </div>
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

      {downloadError && (
        <div style={{
          padding: '8px 12px', background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
          fontSize: '12px', color: '#ef4444',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Download failed: {downloadError}</span>
          <button onClick={() => setDownloadError(null)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>✕</button>
        </div>
      )}

      {/* ── Empty state ── */}
      {documents.length === 0 && (
        <div style={{
          padding: '16px 18px', border: `1px dashed ${borderColor}`, borderRadius: '10px',
          background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          display: 'flex', alignItems: 'flex-start', gap: '12px',
        }}>
          <span style={{ fontSize: '20px', lineHeight: 1, marginTop: '1px', opacity: 0.55 }}>📄</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>No documents yet</div>
            <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.55 }}>
              Add contracts, manuals, pricelists, brochures, or certificates.
              Label and type are suggested from the filename — review before uploading.
              Files are parsed immediately; originals stay protected.
            </div>
          </div>
        </div>
      )}

      {/* ── Document rows ── */}
      {documents.map((doc) => {
        const isImageOnlyFailure = doc.extraction_status === 'failed' && doc.error_code === 'NO_TEXT_EXTRACTED'
        const isRetrying = retryingVisionDoc === doc.id

        return (
          <div
            key={doc.id}
            style={{ background: rowBg, border: `1px solid ${borderColor}`, borderRadius: '8px', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '16px' }}>📄</span>
                {editingDoc === doc.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Label"
                      style={{ fontSize: '11px', padding: '3px 6px', flex: 1, maxWidth: '120px', background: isDark ? 'rgba(0,0,0,0.2)' : 'white', border: `1px solid ${borderColor}`, borderRadius: '4px', color: textColor }}
                    />
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value)}
                      style={{ fontSize: '10px', padding: '3px 6px', background: isDark ? 'rgba(0,0,0,0.2)' : 'white', border: `1px solid ${borderColor}`, borderRadius: '4px', color: textColor }}
                    >
                      <option value="">Type</option>
                      {DOCUMENT_TYPES.filter(Boolean).map((t) => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                    <button onClick={() => handleUpdateMeta(doc.id)} style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '4px', color: '#22c55e', cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditingDoc(null)} style={{ fontSize: '10px', padding: '2px 6px', background: 'transparent', border: `1px solid ${borderColor}`, borderRadius: '4px', color: mutedColor, cursor: 'pointer' }}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: '12px', color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {doc.label?.trim() || doc.filename}
                      {doc.document_type && <span style={{ fontSize: '10px', color: mutedColor, marginLeft: '4px' }}>({doc.document_type})</span>}
                    </span>
                    <StatusBadge status={doc.extraction_status} />
                    <button onClick={() => { setEditingDoc(doc.id); setEditLabel(doc.label ?? ''); setEditType(doc.document_type ?? '') }} style={{ fontSize: '9px', padding: '2px 4px', background: 'transparent', border: `1px solid ${borderColor}`, borderRadius: '4px', color: mutedColor, cursor: 'pointer' }}>Edit</button>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {doc.extraction_status === 'success' && doc.extracted_text && (
                  <>
                    <button
                      onClick={() => setReaderDoc(doc)}
                      style={{ fontSize: '10px', padding: '3px 8px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '4px', color: isDark ? '#c4b5fd' : '#7c3aed', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Open Document Reader
                    </button>
                    <button
                      onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                      style={{ fontSize: '10px', padding: '3px 8px', background: 'transparent', border: `1px solid ${borderColor}`, borderRadius: '4px', color: mutedColor, cursor: 'pointer' }}
                    >
                      {expandedDoc === doc.id ? 'Hide' : 'Preview'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => handleOwnerDownload(doc.id)}
                  disabled={downloadingDoc === doc.id}
                  title="Download original PDF (you are the owner — no consent required)"
                  style={{
                    fontSize: '10px', padding: '3px 8px',
                    background: 'transparent',
                    border: `1px solid ${isDark ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.3)'}`,
                    borderRadius: '4px',
                    color: isDark ? '#c4b5fd' : '#7c3aed',
                    cursor: downloadingDoc === doc.id ? 'not-allowed' : 'pointer',
                    opacity: downloadingDoc === doc.id ? 0.6 : 1,
                  }}
                >
                  {downloadingDoc === doc.id ? '…' : '↓ Original'}
                </button>
                <button
                  onClick={() => handleDelete(doc.id)}
                  style={{ fontSize: '10px', padding: '3px 8px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px', color: '#ef4444', cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
            </div>

            {/* ── Extracted text preview ── */}
            {expandedDoc === doc.id && doc.extracted_text && (
              <div style={{ padding: '10px 12px', borderTop: `1px solid ${borderColor}`, background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '6px', fontWeight: 600 }}>EXTRACTED TEXT PREVIEW</div>
                <pre style={{
                  fontSize: '11px', color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: '72px', overflowY: 'auto', margin: 0, fontFamily: 'inherit', lineHeight: 1.5,
                }}>
                  {doc.extracted_text.split('\n').slice(0, 3).join('\n')}{(doc.extracted_text.split('\n').length > 3 ? '\n…' : '')}
                </pre>
              </div>
            )}

            {/* ── Pending: OCR page progress ── */}
            {doc.extraction_status === 'pending' && doc.error_message && (
              <div style={{ padding: '6px 12px', borderTop: `1px solid ${borderColor}`, fontSize: '11px', color: mutedColor, fontStyle: 'italic' }}>
                {doc.error_message}
              </div>
            )}

            {/* ── Failed: BYOK Vision card (for image-only PDFs) ── */}
            {isImageOnlyFailure && (
              <div style={{
                padding: '12px 14px',
                borderTop: '1px solid rgba(251,191,36,0.25)',
                background: isDark ? 'rgba(251,191,36,0.06)' : 'rgba(251,191,36,0.04)',
              }}>
                {/* Explanation text */}
                {doc.error_message && (
                  <p style={{ fontSize: '11px', color: isDark ? 'rgba(255,255,255,0.75)' : '#374151', margin: '0 0 10px 0', lineHeight: 1.6 }}>
                    {doc.error_message}
                  </p>
                )}

                {/* ── One-click retry (stored key exists) ── */}
                {hasStoredKey && !showApiKeyInput && (
                  <div>
                    <p style={{ fontSize: '11px', color: mutedColor, margin: '0 0 8px 0' }}>
                      You have an Anthropic API key saved. Extract text using AI Vision?
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleRetryWithStoredKey(doc.id)}
                        disabled={isRetrying}
                        style={{ ...primaryBtnStyle, opacity: isRetrying ? 0.6 : 1 }}
                      >
                        {isRetrying ? 'Extracting…' : 'Extract with AI ▶'}
                      </button>
                      <button
                        onClick={() => { setShowApiKeyInput(true); setHasStoredKey(false) }}
                        style={linkBtnStyle}
                      >
                        Use a different key
                      </button>
                    </div>
                    {apiKeyError && (
                      <p style={{ fontSize: '11px', color: '#ef4444', margin: '6px 0 0 0' }}>{apiKeyError}</p>
                    )}
                  </div>
                )}

                {/* ── No stored key — show setup prompt ── */}
                {!hasStoredKey && !showApiKeyInput && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => { setShowApiKeyInput(true); setApiKeyError(null) }}
                      style={secondaryBtnStyle}
                    >
                      🔑 Enter API Key &amp; Retry
                    </button>
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={linkBtnStyle}
                    >
                      How to get an API key ↗
                    </a>
                  </div>
                )}

                {/* ── API key input form ── */}
                {showApiKeyInput && (
                  <div style={{
                    padding: '10px 12px', borderRadius: '8px',
                    background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.04)',
                    border: `1px solid ${borderColor}`,
                    display: 'flex', flexDirection: 'column', gap: '8px',
                  }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: textColor }}>Anthropic API Key</label>
                    <input
                      type="password"
                      value={pendingApiKey}
                      onChange={(e) => { setPendingApiKey(e.target.value); setApiKeyError(null) }}
                      placeholder="sk-ant-api03-…"
                      autoFocus
                      style={{
                        fontSize: '12px', padding: '6px 10px',
                        background: isDark ? 'rgba(255,255,255,0.08)' : 'white',
                        border: `1px solid ${apiKeyError ? '#ef4444' : borderColor}`,
                        borderRadius: '6px', color: textColor, fontFamily: 'monospace',
                      }}
                    />
                    <p style={{ fontSize: '10px', color: mutedColor, margin: 0, lineHeight: 1.5 }}>
                      Your key is stored locally in your vault, encrypted with your master password.
                      It is only sent directly to Anthropic's API for text extraction.
                      Typical cost: ~€0.01 per page.
                    </p>
                    {apiKeyError && (
                      <p style={{ fontSize: '11px', color: '#ef4444', margin: 0 }}>{apiKeyError}</p>
                    )}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => { setShowApiKeyInput(false); setPendingApiKey(''); setApiKeyError(null) }}
                        style={secondaryBtnStyle}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveKeyAndRetry(doc.id)}
                        disabled={!pendingApiKey || isRetrying}
                        style={{ ...primaryBtnStyle, opacity: (!pendingApiKey || isRetrying) ? 0.6 : 1 }}
                      >
                        {isRetrying ? 'Validating & Extracting…' : 'Extract with AI ▶'}
                      </button>
                      <a
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...linkBtnStyle, fontSize: '10px' }}
                      >
                        Get a key ↗
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Failed: other error codes (password, timeout, etc.) ── */}
            {doc.extraction_status === 'failed' && !isImageOnlyFailure && doc.error_message && (
              <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(239,68,68,0.2)', fontSize: '11px', color: '#ef4444' }}>
                {doc.error_code === 'PASSWORD_PROTECTED'
                  ? doc.error_message
                  : doc.error_code === 'EXTRACTION_TIMEOUT'
                    ? doc.error_message
                    : `Error: ${doc.error_message}`
                }
              </div>
            )}
          </div>
        )
      })}

      {/* ── Document reader modal ── */}
      {readerDoc && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => e.target === e.currentTarget && setReaderDoc(null)}
        >
          <div style={{ width: '100%', maxWidth: 900, height: '85vh', maxHeight: 700 }} onClick={(e) => e.stopPropagation()}>
            <HsContextDocumentReader
              documentId={readerDoc.id}
              filename={readerDoc.label?.trim() || readerDoc.filename}
              mimeType={readerDoc.mime_type || 'application/pdf'}
              canViewOriginal={true}
              onViewOriginal={async () => {
                setReaderDoc(null)
                await handleOwnerDownload(readerDoc.id)
              }}
              onClose={() => setReaderDoc(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
