import { useState } from 'react'
import type { HostKeyMismatchPayload } from './hostKeyMismatchTypes.js'
import { HOST_KEY_TRUST_CONFIRM } from './hostKeyMismatchTypes.js'

export interface HostKeyMismatchModalProps {
  payload: HostKeyMismatchPayload
  busy?: boolean
  onTrustNewKey: () => void
  onCancel: () => void
}

export function HostKeyMismatchModal({
  payload,
  busy,
  onTrustNewKey,
  onCancel,
}: HostKeyMismatchModalProps) {
  const [trustInput, setTrustInput] = useState('')
  const canTrust = !busy && trustInput === HOST_KEY_TRUST_CONFIRM

  return (
    <div
      data-testid="host-key-mismatch-modal"
      role="alertdialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
      }}
    >
      <div
        style={{
          width: 'min(560px, 94vw)',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--bg-primary, #fff)',
          borderRadius: 10,
          border: '1px solid #f97316',
          padding: 20,
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>
          Host key changed for {payload.host}:{payload.port}
        </h2>
        <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
          This can happen when the VPS is rebuilt or reinstalled, but it can also indicate someone
          intercepting your connection. Verify with your VPS provider before continuing.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Previously trusted</div>
            <code
              data-testid="host-key-stored-fingerprint"
              style={{ fontSize: 11, wordBreak: 'break-all' }}
            >
              {payload.stored_fingerprint_display}
            </code>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Observed now</div>
            <code
              data-testid="host-key-observed-fingerprint"
              style={{ fontSize: 11, wordBreak: 'break-all' }}
            >
              {payload.observed_fingerprint_display}
            </code>
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
          Type <strong>{HOST_KEY_TRUST_CONFIRM}</strong> to accept the new host key
          <input
            data-testid="host-key-trust-confirm"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              boxSizing: 'border-box',
            }}
            value={trustInput}
            disabled={busy}
            onChange={(e) => setTrustInput(e.target.value)}
            autoComplete="off"
          />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" data-testid="host-key-mismatch-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="host-key-mismatch-trust"
            disabled={!canTrust}
            onClick={onTrustNewKey}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#ea580c',
              color: '#fff',
              opacity: canTrust ? 1 : 0.5,
              cursor: canTrust ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Retrying…' : 'Trust new key and continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
