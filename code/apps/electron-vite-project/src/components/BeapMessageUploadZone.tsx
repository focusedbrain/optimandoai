/**
 * BeapMessageUploadZone — Drag-and-drop + file browse for .beap message packages
 *
 * Same UX pattern as CapsuleUploadZone. Validates .beap format (JSON, message package structure).
 * Import pipeline requires extension/Electron IPC; when unavailable, shows placeholder message.
 */

import { useState, useRef, useCallback } from 'react'

const MAX_FILE_SIZE = 512 * 1024 // 512KB for message packages

interface BeapMessagePreview {
  messageId?: string
  sender?: string
  timestamp?: string
  rawJson: string
}

interface Props {
  onSubmitted?: () => void
}

export default function BeapMessageUploadZone({ onSubmitted }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<BeapMessagePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetState = useCallback(() => {
    setPreview(null)
    setError(null)
    setResult(null)
  }, [])

  const processFile = useCallback(async (file: File) => {
    resetState()

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024).toFixed(1)}KB). Maximum is 512KB.`)
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

      // BEAP message package: expect envelope or package structure
      const msgId = parsed.message_id ?? parsed.id ?? parsed.envelope?.message_id
      const sender = parsed.sender_fingerprint ?? parsed.senderIdentity?.email ?? parsed.sender_email ?? '(unknown)'
      const ts = parsed.timestamp ?? parsed.created_at ?? '(unknown)'

      setPreview({
        messageId: typeof msgId === 'string' ? msgId : undefined,
        sender: typeof sender === 'string' ? sender : '(unknown)',
        timestamp: typeof ts === 'string' ? ts : String(ts ?? '(unknown)'),
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
    // Electron: no importBeapMessage IPC yet. Show placeholder.
    setResult({
      success: false,
      message: 'BEAP message import via file is not yet wired in the Electron dashboard. Use the extension for full import.',
    })
    onSubmitted?.()
  }

  const shortId = (id: string) => (id?.length > 16 ? `${id.slice(0, 8)}…` : id ?? '—')

  return (
    <div>
      <div style={{
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)',
        marginBottom: '8px',
      }}>
        Import BEAP Message
      </div>

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
        <div style={{ fontSize: '24px', marginBottom: '6px' }}>📥</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
          Drop a <strong>.beap</strong> message file here or click to browse
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".beap,application/vnd.beap+json"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {error && (
        <div style={{
          marginTop: '8px', padding: '8px 10px', fontSize: '11px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '6px', color: '#ef4444',
        }}>
          {error}
        </div>
      )}

      {preview && (
        <div style={{
          marginTop: '8px', padding: '10px 12px',
          background: 'var(--color-surface, rgba(255,255,255,0.04))',
          border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text, #e2e8f0)' }}>
            Message Preview
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.6 }}>
            <div><strong>Sender:</strong> {preview.sender}</div>
            {preview.messageId && <div><strong>ID:</strong> {shortId(preview.messageId)}</div>}
            <div><strong>Timestamp:</strong> {preview.timestamp}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <button
              onClick={handleSubmit}
              style={{
                flex: 1, padding: '7px 12px', fontSize: '11px', fontWeight: 600,
                background: 'rgba(139,92,246,0.85)', color: '#ffffff',
                border: '1px solid rgba(139,92,246,0.9)', borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Import
            </button>
            <button
              onClick={resetState}
              style={{
                padding: '7px 12px', fontSize: '11px', fontWeight: 600,
                background: 'var(--color-input-bg, rgba(255,255,255,0.08))',
                color: 'var(--color-text, #e2e8f0)',
                border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                borderRadius: '6px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
