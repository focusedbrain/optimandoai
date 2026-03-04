import { useState, useEffect, type CSSProperties } from 'react'

interface EmailAccount {
  id: string
  displayName: string
  email: string
  provider: 'gmail' | 'microsoft365' | 'imap'
  status: 'active' | 'error' | 'disabled'
}

type DeliveryMode = 'api' | 'download'
type Status = 'idle' | 'sending' | 'success' | 'error'

interface Props {
  onBack: () => void
}

export default function HandshakeRequestView({ onBack }: Props) {
  const [recipientEmail, setRecipientEmail] = useState('')
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('api')
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    window.emailAccounts?.listAccounts().then(res => {
      if (res.ok && res.data) {
        setEmailAccounts(res.data as EmailAccount[])
        if (res.data.length > 0) setSelectedAccountId(res.data[0].id)
      }
    }).catch(() => {})
  }, [])

  const handleSend = async () => {
    if (!recipientEmail) return
    setStatus('sending')
    setErrorMsg(null)
    try {
      const hv = window.handshakeView
      if (!hv) throw new Error('Handshake IPC not available')
      if (deliveryMode === 'api') {
        const fn = hv.initiateHandshake
        if (!fn) throw new Error('initiateHandshake not available')
        const result = await fn.call(hv, recipientEmail, selectedAccountId || '')
        if (result?.success === false || result?.error) {
          throw new Error(result.error || 'Handshake initiation failed')
        }
      } else {
        const fn = hv.buildForDownload
        if (!fn) throw new Error('buildForDownload not available')
        const result = await fn.call(hv, recipientEmail)
        if (result?.success === false || result?.error) {
          throw new Error(result.error || 'Failed to build handshake for download')
        }
        if (result?.capsuleJson && hv.downloadCapsule) {
          await hv.downloadCapsule(result.capsuleJson, `handshake-${recipientEmail}.beap`)
        }
      }
      setStatus('success')
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err?.message || 'An error occurred')
    }
  }

  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--color-text-muted, rgba(255,255,255,0.6))', marginBottom: '6px', display: 'block' }
  const inputStyle: CSSProperties = { width: '100%', padding: '10px 12px', background: 'var(--color-input-bg, rgba(255,255,255,0.08))', border: '1px solid var(--color-border, rgba(255,255,255,0.12))', borderRadius: '8px', color: 'var(--color-text, #e2e8f0)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as const }

  if (status === 'success') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', textAlign: 'center', gap: '20px' }}>
        <span style={{ fontSize: '64px' }}>🤝</span>
        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)' }}>Handshake Sent!</div>
        <div style={{ fontSize: '14px', color: 'var(--color-text-muted, rgba(255,255,255,0.6))', maxWidth: '360px', lineHeight: 1.6 }}>
          Your handshake request has been delivered to <strong>{recipientEmail}</strong>. Once they accept, the relationship will appear in your Handshakes view.
        </div>
        <button
          onClick={onBack}
          style={{ marginTop: '12px', padding: '12px 28px', borderRadius: '8px', border: 'none', background: 'var(--color-accent, #9333ea)', color: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
        >
          Back to Handshakes
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '560px', margin: '0 auto', padding: '32px 24px', gap: '24px', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, rgba(255,255,255,0.6))', fontSize: '20px', lineHeight: 1, padding: '4px' }}>←</button>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)' }}>New Handshake Request</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-muted, rgba(255,255,255,0.6))' }}>
            Send a BEAP™ Handshake to establish a trusted relationship
          </p>
        </div>
      </div>

      {/* Recipient */}
      <div>
        <label style={labelStyle}>Recipient Email</label>
        <input
          type="email"
          value={recipientEmail}
          onChange={e => setRecipientEmail(e.target.value)}
          placeholder="recipient@example.com"
          style={inputStyle}
          autoFocus
        />
      </div>

      {/* Delivery mode */}
      <div>
        <label style={labelStyle}>Delivery Method</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          {([['api', '📧 Send via Email API'], ['download', '💾 Download .beap File']] as [DeliveryMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setDeliveryMode(mode)}
              style={{
                flex: 1, padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
                border: deliveryMode === mode ? '2px solid var(--color-accent, #9333ea)' : '1px solid var(--color-border, rgba(255,255,255,0.12))',
                background: deliveryMode === mode ? 'rgba(147,51,234,0.15)' : 'var(--color-input-bg, rgba(255,255,255,0.05))',
                color: 'var(--color-text, #e2e8f0)', fontWeight: deliveryMode === mode ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Email account selector — only for API mode */}
      {deliveryMode === 'api' && (
        <div>
          <label style={labelStyle}>Send From</label>
          {emailAccounts.length === 0 ? (
            <div style={{ padding: '14px', background: 'var(--color-bg-surface, rgba(255,255,255,0.04))', borderRadius: '8px', border: '1px dashed var(--color-border, rgba(255,255,255,0.15))', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted, rgba(255,255,255,0.5))' }}>
              No email accounts connected
            </div>
          ) : (
            <select value={selectedAccountId || ''} onChange={e => setSelectedAccountId(e.target.value)} style={inputStyle}>
              {emailAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.email || a.displayName} ({a.provider})</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '13px', color: '#fca5a5' }}>
          {errorMsg}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: 'auto' }}>
        <button onClick={onBack} style={{ padding: '11px 22px', borderRadius: '8px', border: '1px solid var(--color-border, rgba(255,255,255,0.15))', background: 'transparent', color: 'var(--color-text-muted, rgba(255,255,255,0.7))', cursor: 'pointer', fontSize: '13px' }}>
          Cancel
        </button>
        <button
          onClick={handleSend}
          disabled={!recipientEmail || status === 'sending' || (deliveryMode === 'api' && emailAccounts.length === 0)}
          style={{
            padding: '11px 28px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 700,
            cursor: recipientEmail && status !== 'sending' ? 'pointer' : 'not-allowed',
            background: recipientEmail && status !== 'sending' ? 'var(--color-accent, #9333ea)' : 'rgba(147,51,234,0.3)',
            color: 'white', display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          {status === 'sending' ? '⏳ Sending...' : '🤝 Send Handshake'}
        </button>
      </div>
    </div>
  )
}
