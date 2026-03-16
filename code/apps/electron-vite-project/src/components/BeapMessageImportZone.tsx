/**
 * BeapMessageImportZone — Drag-and-drop + file browse for .beap message packages
 *
 * Same visual style as CapsuleUploadZone (dashed border, icon, label).
 * Accepts .beap and .json files. On drop/select: reads file, sends to Electron
 * main via IPC for BEAP message import. Shows Importing... → success or error.
 * On success: message appears in left column list via usePendingP2PBeapIngestion.
 */

import { useState, useRef, useCallback, useEffect } from 'react'

const MAX_FILE_SIZE = 512 * 1024 // 512KB for message packages

interface Props {
  onSubmitted?: () => void
}

declare global {
  interface Window {
    handshakeView?: {
      importBeapMessage?: (packageJson: string) => Promise<{ success: boolean; error?: string }>
    }
  }
}

export default function BeapMessageImportZone({ onSubmitted }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetStatus = useCallback(() => {
    setStatus('idle')
    setStatusMessage('')
  }, [])

  useEffect(() => {
    if (status !== 'success') return
    const t = setTimeout(() => setStatus('idle'), 5000)
    return () => clearTimeout(t)
  }, [status])

  const processFile = useCallback(async (file: File) => {
    resetStatus()

    const ext = file.name.toLowerCase()
    const isBeap = ext.endsWith('.beap') || file.type === 'application/vnd.beap+json'
    const isJson = ext.endsWith('.json') || file.type === 'application/json'
    if (!isBeap && !isJson) {
      setStatus('error')
      setStatusMessage('Only .beap and .json files are accepted.')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setStatus('error')
      setStatusMessage(`File too large (${(file.size / 1024).toFixed(1)}KB). Maximum is 512KB.`)
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) {
        setStatus('error')
        setStatusMessage('File does not contain valid JSON.')
        return
      }

      setStatus('importing')
      setStatusMessage('Importing...')

      const fn = (window as any).handshakeView?.importBeapMessage
      if (!fn) {
        setStatus('error')
        setStatusMessage('BEAP import is not available. Please ensure the app is fully loaded.')
        return
      }

      const result = await fn(text)
      if (result?.success) {
        setStatus('success')
        setStatusMessage('✓ Message imported')
        onSubmitted?.()
      } else {
        setStatus('error')
        setStatusMessage(`✗ Import failed: ${result?.error ?? 'Unknown error'}`)
      }
    } catch (err: any) {
      setStatus('error')
      setStatusMessage(`✗ Import failed: ${err?.message ?? 'Unknown error'}`)
    }
  }, [resetStatus, onSubmitted])

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

  const handleZoneClick = useCallback(() => {
    if (status === 'importing') return
    resetStatus()
    fileInputRef.current?.click()
  }, [status, resetStatus])

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
        onClick={handleZoneClick}
        style={{
          padding: '20px 16px', textAlign: 'center',
          border: `2px dashed ${dragOver ? 'var(--color-accent, #a78bfa)' : 'var(--color-border, rgba(255,255,255,0.12))'}`,
          borderRadius: '8px', cursor: status === 'importing' ? 'wait' : 'pointer',
          background: dragOver ? 'var(--color-accent-bg, rgba(139,92,246,0.08))' : 'transparent',
          transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '6px' }}>📥</div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
          Drop .beap message here
        </div>
        <div style={{ marginTop: '6px' }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleZoneClick() }}
            disabled={status === 'importing'}
            style={{
              fontSize: '11px', fontWeight: 600,
              background: 'transparent',
              border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
              borderRadius: '6px',
              padding: '4px 10px',
              color: 'var(--color-text-muted, #94a3b8)',
              cursor: status === 'importing' ? 'wait' : 'pointer',
            }}
          >
            or browse
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".beap,.json,application/vnd.beap+json,application/json"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {(status === 'success' || status === 'error') && (
        <div style={{
          marginTop: '8px', padding: '8px 10px', fontSize: '11px',
          background: status === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${status === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          borderRadius: '6px',
          color: status === 'success' ? '#22c55e' : '#ef4444',
        }}>
          {statusMessage}
        </div>
      )}

      {status === 'importing' && (
        <div style={{
          marginTop: '8px', padding: '8px 10px', fontSize: '11px',
          background: 'rgba(139,92,246,0.1)',
          border: '1px solid rgba(139,92,246,0.3)',
          borderRadius: '6px',
          color: '#a78bfa',
        }}>
          Importing...
        </div>
      )}
    </div>
  )
}
