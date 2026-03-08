/**
 * CapsuleUploadZone — Drag-and-drop + file browse for .beap files
 *
 * Client-side pre-validation (UX only, not security):
 *   - JSON parse
 *   - Check schema_version, capsule_type, handshake_id presence
 *   - File < 64KB
 *
 * Shows a preview of detected capsule metadata before submission.
 * Submits raw file content to Electron via IPC for full pipeline processing.
 */

import { useState, useRef, useCallback, useEffect } from 'react'

const MAX_FILE_SIZE = 64 * 1024

interface CapsulePreview {
  capsule_type: string
  handshake_id: string
  sender_email: string
  timestamp: string
  schema_version: number
  rawJson: string
}

interface Props {
  onSubmitted?: () => void
}

function mapPipelineError(raw: string | undefined): string {
  if (!raw) return 'Processing failed. Please try again.'
  const r = raw.toLowerCase()
  if (r.includes('handshake_not_found')) return 'No matching handshake found. Import the initiate capsule first, then accept.'
  if (r.includes('handshake_ownership_violation')) return 'Cannot process a capsule you sent yourself.'
  if (r.includes('handshake_already_exists')) return 'This handshake has already been imported.'
  if (r.includes('db_unavailable') || r.includes('vault')) return 'Database unavailable. Please unlock your vault or ensure you are logged in.'
  if (r.includes('not_initiate_capsule')) return 'Only initiate capsules can be imported. Use Submit for verification for other capsule types.'
  if (r.includes('denied field')) return `The capsule contains disallowed fields and was rejected.`
  if (r.includes('missing required field')) {
    const field = raw.match(/field:\s*(\S+)/i)?.[1]
    return field ? `The capsule is incomplete. Missing field: ${field}` : 'The capsule is incomplete.'
  }
  if (r.includes('too large') || r.includes('byte limit')) return 'The capsule is too large (max 64KB).'
  if (r.includes('not a plain object') || r.includes('not serializable')) return 'The file does not contain a valid capsule.'
  if (r.includes('invalid value') || r.includes('does not match')) {
    const field = raw.match(/for\s+(\S+)/i)?.[1] ?? raw.match(/field:\s*(\S+)/i)?.[1]
    return field ? `Invalid format for field: ${field}` : 'A capsule field has an invalid format.'
  }
  if (r.includes('hash') && (r.includes('mismatch') || r.includes('integrity'))) return 'Capsule integrity verification failed. The file may have been modified.'
  if (r.includes('dedup') || r.includes('already processed') || r.includes('already seen')) return 'This capsule has already been processed.'
  if (r.includes('expired') || r.includes('expiry')) return 'The capsule has expired.'
  if (r.includes('ownership') || r.includes('self-send')) return 'Cannot process a capsule you sent yourself.'
  if (r.includes('sso') || r.includes('session')) return 'Authentication required. Please log in first.'
  if (r.includes('VAULT_LOCKED') || (r.includes('vault') && r.includes('locked'))) return 'Vault is locked. Please unlock first.'
  if (r.includes('NOT_LOGGED_IN') || r.includes('no active session') || r.includes('please log in')) return 'Authentication required. Please log in first.'
  return raw
}

export default function CapsuleUploadZone({ onSubmitted }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<CapsulePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetState = useCallback(() => {
    setPreview(null)
    setError(null)
    setResult(null)
  }, [])

  // Auto-dismiss success message after 5 seconds
  useEffect(() => {
    if (!result?.success) return
    const t = setTimeout(() => setResult(null), 5000)
    return () => clearTimeout(t)
  }, [result?.success])

  const processFile = useCallback(async (file: File) => {
    resetState()

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024).toFixed(1)}KB). Maximum is 64KB.`)
      return
    }

    const ext = file.name.toLowerCase()
    if (!ext.endsWith('.beap') && file.type !== 'application/vnd.beap+json') {
      setError('Only .beap files are accepted.')
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)

      if (typeof parsed !== 'object' || parsed === null) {
        setError('File does not contain valid JSON.')
        return
      }

      if (typeof parsed.schema_version !== 'number') {
        setError('Invalid capsule format (missing schema_version).')
        return
      }

      if (!parsed.capsule_type || !['initiate', 'accept', 'refresh', 'revoke'].includes(parsed.capsule_type)) {
        setError(`Invalid capsule_type: "${parsed.capsule_type || 'missing'}"`)
        return
      }

      if (!parsed.handshake_id || typeof parsed.handshake_id !== 'string') {
        setError('Missing handshake_id.')
        return
      }

      setPreview({
        capsule_type: parsed.capsule_type,
        handshake_id: parsed.handshake_id,
        sender_email: parsed.senderIdentity?.email ?? parsed.sender_email ?? '(unknown)',
        timestamp: parsed.timestamp ?? '(unknown)',
        schema_version: parsed.schema_version,
        rawJson: text,
      })
    } catch {
      setError('The file does not contain valid JSON.')
    }
  }, [resetState])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [processFile])

  const handleSubmit = async () => {
    if (!preview) return
    setSubmitting(true)
    setResult(null)
    try {
      const isInitiate = preview.capsule_type === 'initiate'
      const res = isInitiate
        ? await window.handshakeView?.importCapsule(preview.rawJson)
        : await window.handshakeView?.submitCapsule(preview.rawJson)
      if (res?.success) {
        setResult({
          success: true,
          message: isInitiate
            ? 'Handshake imported. It will appear in your Pending list.'
            : 'Capsule verified and submitted successfully.',
        })
        setPreview(null)
        onSubmitted?.()
      } else {
        const rawError = res?.handshake_result?.reason ?? res?.reason ?? res?.error
        setResult({ success: false, message: mapPipelineError(rawError) })
      }
    } catch (err: any) {
      setResult({ success: false, message: mapPipelineError(err?.message) })
    } finally {
      setSubmitting(false)
    }
  }

  const isInitiate = preview?.capsule_type === 'initiate'
  const submitButtonLabel = isInitiate ? 'Import Handshake' : 'Submit for verification'

  const shortId = (id: string) => id.length > 16 ? `${id.slice(0, 8)}…` : id

  return (
    <div>
      <div style={{
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)',
        marginBottom: '8px',
      }}>
        Import Capsule
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => { setResult(null); fileInputRef.current?.click() }}
        style={{
          padding: '20px 16px', textAlign: 'center',
          border: `2px dashed ${dragOver ? 'var(--color-accent, #a78bfa)' : 'var(--color-border, rgba(255,255,255,0.12))'}`,
          borderRadius: '8px', cursor: 'pointer',
          background: dragOver ? 'var(--color-accent-bg, rgba(139,92,246,0.08))' : 'transparent',
          transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '6px' }}>&#128230;</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
          Drop a <strong>.beap</strong> file here or click to browse
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".beap,application/vnd.beap+json"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Error */}
      {error && (
        <div style={{
          marginTop: '8px', padding: '8px 10px', fontSize: '11px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '6px', color: '#ef4444',
        }}>
          {error}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div style={{
          marginTop: '8px', padding: '10px 12px',
          background: 'var(--color-surface, rgba(255,255,255,0.04))',
          border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text, #e2e8f0)' }}>
            Capsule Preview
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.6 }}>
            <div><strong>Type:</strong> {preview.capsule_type}</div>
            <div><strong>Sender:</strong> {preview.sender_email}</div>
            <div><strong>ID:</strong> {shortId(preview.handshake_id)}</div>
            <div><strong>Timestamp:</strong> {preview.timestamp}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                flex: 1, padding: '7px 12px', fontSize: '11px', fontWeight: 600,
                background: submitting ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.15)',
                color: '#a78bfa',
                border: '1px solid rgba(139,92,246,0.3)', borderRadius: '6px',
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? (isInitiate ? 'Importing…' : 'Verifying…') : submitButtonLabel}
            </button>
            <button
              onClick={resetState}
              disabled={submitting}
              style={{
                padding: '7px 12px', fontSize: '11px', fontWeight: 600,
                background: 'transparent', color: 'var(--color-text-muted, #94a3b8)',
                border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                borderRadius: '6px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          marginTop: '8px', padding: '8px 10px', fontSize: '11px',
          background: result.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${result.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          borderRadius: '6px',
          color: result.success ? '#22c55e' : '#ef4444',
        }}>
          {result.message}
        </div>
      )}
    </div>
  )
}
