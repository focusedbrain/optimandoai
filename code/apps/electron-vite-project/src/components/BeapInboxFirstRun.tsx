/**
 * BeapInboxFirstRun — Welcome / first-run empty state for BEAP Inbox
 *
 * Shown only when: inbox is completely empty AND no email connected.
 * Once the user has at least one message or connected email, the normal empty
 * state is shown instead.
 *
 * Provides clear next steps: Connect Email, Import File, Go to Handshakes,
 * Compose Message. Not a tutorial wizard — just actionable guidance.
 */

import { useRef, useCallback, useState } from 'react'

function useBeapFileImport(onSuccess?: () => void) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const processFile = useCallback(
    async (file: File) => {
      const ext = file.name.toLowerCase()
      const isBeap = ext.endsWith('.beap') || file.type === 'application/vnd.beap+json'
      const isJson = ext.endsWith('.json') || file.type === 'application/json'
      if (!isBeap && !isJson) {
        setStatus('error')
        setMessage('Only .beap and .json files are accepted.')
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setStatus('error')
        setMessage(`File too large (max 512KB).`)
        return
      }
      setStatus('importing')
      setMessage('')
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null) {
          setStatus('error')
          setMessage('File does not contain valid JSON.')
          return
        }
        const fn = (window as any).handshakeView?.importBeapMessage
        if (!fn) {
          setStatus('error')
          setMessage('Import is not available. Please ensure the app is fully loaded.')
          return
        }
        const result = await fn(text)
        if (result?.success) {
          setStatus('success')
          setMessage('Message imported. It will appear in your inbox shortly.')
          onSuccess?.()
        } else {
          setStatus('error')
          setMessage(result?.error ?? 'Import failed.')
        }
      } catch (err: any) {
        setStatus('error')
        setMessage(err?.message ?? 'Import failed.')
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [onSuccess],
  )

  const triggerFileSelect = useCallback(() => fileInputRef.current?.click(), [])
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) processFile(file)
    },
    [processFile],
  )
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [processFile],
  )

  return { fileInputRef, status, message, triggerFileSelect, handleFileChange, handleDrop }
}

const MAX_FILE_SIZE = 512 * 1024 // 512KB

declare global {
  interface Window {
    handshakeView?: {
      importBeapMessage?: (packageJson: string) => Promise<{ success: boolean; error?: string }>
    }
    analysisDashboard?: {
      openBeapDraft?: () => void
    }
  }
}

export interface BeapInboxFirstRunProps {
  onConnectEmail: () => void
  onNavigateToHandshakes: () => void
  onOpenCompose: () => void
  onImportSuccess?: () => void
}

export default function BeapInboxFirstRun({
  onConnectEmail,
  onNavigateToHandshakes,
  onOpenCompose,
  onImportSuccess,
}: BeapInboxFirstRunProps) {
  const { fileInputRef, status: importStatus, message: importMessage, triggerFileSelect, handleFileChange, handleDrop } =
    useBeapFileImport(onImportSuccess)

  const textColor = 'var(--color-text, #e2e8f0)'
  const mutedColor = 'var(--color-text-muted, #94a3b8)'
  const borderColor = 'var(--color-border, rgba(255,255,255,0.08))'
  const accentColor = '#a78bfa'

  const btnBase = {
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer' as const,
    border: 'none',
    transition: 'all 0.15s',
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 32px',
        overflowY: 'auto',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".beap,.json,application/vnd.beap+json,application/json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div style={{ maxWidth: 420, width: '100%' }}>
        {/* Welcome */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: textColor,
              margin: '0 0 8px 0',
            }}
          >
            Welcome to BEAP™ Messaging
          </h2>
          <p style={{ fontSize: '14px', color: mutedColor, lineHeight: 1.5, margin: 0 }}>
            Your secure AI-powered inbox is ready.
            <br />
            Here&apos;s how to get started:
          </p>
        </div>

        {/* RECEIVE MESSAGES */}
        <div
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.8px',
            color: mutedColor,
            marginBottom: '16px',
            textTransform: 'uppercase',
          }}
        >
          Receive messages
        </div>

        {/* 1. Connect Email */}
        <div
          style={{
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '10px',
            border: `1px solid ${borderColor}`,
            marginBottom: '12px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
            1. Connect your email
          </div>
          <p style={{ fontSize: '12px', color: mutedColor, lineHeight: 1.5, margin: '0 0 10px 0' }}>
            Automatically receive BEAP messages and import your existing emails for AI sorting.
          </p>
          <button
            onClick={onConnectEmail}
            style={{
              ...btnBase,
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
            }}
          >
            Connect Email →
          </button>
        </div>

        {/* 2. Import File */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          style={{
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '10px',
            border: `1px solid ${borderColor}`,
            marginBottom: '24px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
            2. Import a .beap message
          </div>
          <p style={{ fontSize: '12px', color: mutedColor, lineHeight: 1.5, margin: '0 0 10px 0' }}>
            Drop a .beap file here or browse.
          </p>
          <button
            onClick={triggerFileSelect}
            disabled={importStatus === 'importing'}
            style={{
              ...btnBase,
              background: 'rgba(139,92,246,0.2)',
              color: accentColor,
              border: `1px solid rgba(139,92,246,0.4)`,
            }}
          >
            {importStatus === 'importing' ? 'Importing…' : 'Import File'}
          </button>
          {importStatus === 'success' && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#22c55e' }}>✓ {importMessage}</div>
          )}
          {importStatus === 'error' && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#ef4444' }}>✕ {importMessage}</div>
          )}
        </div>

        {/* SEND MESSAGES */}
        <div
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.8px',
            color: mutedColor,
            marginBottom: '16px',
            textTransform: 'uppercase',
          }}
        >
          Send messages
        </div>

        {/* 3. Establish handshake */}
        <div
          style={{
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '10px',
            border: `1px solid ${borderColor}`,
            marginBottom: '12px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
            3. Establish a handshake
          </div>
          <p style={{ fontSize: '12px', color: mutedColor, lineHeight: 1.5, margin: '0 0 10px 0' }}>
            Exchange keys with a contact for encrypted private messaging.
          </p>
          <button
            onClick={onNavigateToHandshakes}
            style={{
              ...btnBase,
              background: 'rgba(139,92,246,0.2)',
              color: accentColor,
              border: `1px solid rgba(139,92,246,0.4)`,
            }}
          >
            Go to Handshakes →
          </button>
        </div>

        {/* 4. Send BEAP message */}
        <div
          style={{
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '10px',
            border: `1px solid ${borderColor}`,
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
            4. Send a BEAP message
          </div>
          <p style={{ fontSize: '12px', color: mutedColor, lineHeight: 1.5, margin: '0 0 8px 0' }}>
            Choose how to deliver:
          </p>
          <ul style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.6, margin: '0 0 10px 16px', padding: 0 }}>
            <li><strong>Email</strong> — attach .beap to an email</li>
            <li><strong>P2P</strong> — send directly to another WR Desk orchestrator</li>
            <li><strong>Download</strong> — save .beap file and transfer manually</li>
          </ul>
          <button
            onClick={onOpenCompose}
            style={{
              ...btnBase,
              background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
              color: 'white',
            }}
          >
            Compose Message →
          </button>
        </div>
      </div>
    </div>
  )
}
