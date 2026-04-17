/**
 * HandshakeInitiateModal — wraps SendHandshakeDelivery with vault status
 * and policy selection. Vault hint only shown when action requires vault (e.g. vault profiles).
 */

import { useState, useEffect } from 'react'
import { SendHandshakeDelivery } from '@ext/handshake/components/SendHandshakeDelivery'
import VaultStatusIndicator from './VaultStatusIndicator'
import PolicyRadioGroup, { DEFAULT_AI_POLICY, type PolicySelection } from './PolicyRadioGroup'

async function prefillRecipientEmailAsync(setEmail: (v: string) => void): Promise<void> {
  const auth = (window as unknown as { auth?: { getStatus?: () => Promise<{ email?: string } | null | undefined> } }).auth
  if (typeof auth?.getStatus === 'function') {
    try {
      const st = await auth.getStatus()
      if (st?.email && typeof st.email === 'string') {
        setEmail(st.email)
        return
      }
    } catch {
      /* fall through to extension */
    }
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return
      if (response?.email) setEmail(response.email as string)
    })
  }
}

function prefillRecipientEmail(setEmail: (v: string) => void): void {
  void prefillRecipientEmailAsync(setEmail)
}

interface Props {
  onClose: () => void
  onSuccess?: () => void
  onSubmit?: (data: { recipientEmail: string; deliveryMode: string }) => void
  /** When true, opens in internal (same-account) handshake mode. */
  presetInternal?: boolean
}

export default function HandshakeInitiateModal({ onClose, onSuccess, presetInternal = false }: Props) {
  const [vaultStatus, setVaultStatus] = useState<{ isUnlocked: boolean; name: string | null }>({ isUnlocked: false, name: null })
  const [canUseHsContextProfiles, setCanUseHsContextProfiles] = useState(false)
  const [policies, setPolicies] = useState<PolicySelection>(DEFAULT_AI_POLICY)
  const [requiresVault, setRequiresVault] = useState(false)

  const [isInternal, setIsInternal] = useState(!!presetInternal)
  const [deviceRole, setDeviceRole] = useState<'host' | 'sandbox'>('sandbox')
  const [deviceName, setDeviceName] = useState('')
  /** This device's local 6-digit pairing code, used for the self-pair guard in
   *  SendHandshakeDelivery. Surfaced from orchestrator preload (getDeviceInfo). */
  const [localPairingCode, setLocalPairingCode] = useState<string>('')
  const [recipientEmail, setRecipientEmail] = useState('')
  /** Phase 2: one-time contextual hint shown when the user toggles internal mode. */
  const [showInternalHint, setShowInternalHint] = useState(false)

  useEffect(() => {
    const check = async () => {
      try {
        const s = await window.handshakeView?.getVaultStatus?.()
        setVaultStatus({ isUnlocked: s?.isUnlocked ?? false, name: s?.name ?? null })
        setCanUseHsContextProfiles(s?.canUseHsContextProfiles ?? false)
      } catch {
        setVaultStatus({ isUnlocked: false, name: null })
        setCanUseHsContextProfiles(false)
      }
    }
    check()
    const h = () => check()
    window.addEventListener('vault-status-changed', h)
    return () => window.removeEventListener('vault-status-changed', h)
  }, [])

  useEffect(() => {
    if (presetInternal) {
      setIsInternal(true)
      setShowInternalHint(true)
    }
  }, [presetInternal])

  useEffect(() => {
    if (!isInternal) return
    prefillRecipientEmail(setRecipientEmail)
    // Prefer orchestratorMode IPC (Electron main) so we pick up the canonical deviceName
    // and the local 6-digit pairing code for the self-pair guard in SendHandshakeDelivery.
    // Fall back to localStorage for legacy paths (deviceName only — pairing code is not
    // mirrored to localStorage in the desktop app).
    const om = (window as unknown as {
      orchestratorMode?: {
        getDeviceInfo?: () => Promise<{ pairingCode?: string; deviceName?: string } | null | undefined>
      }
    }).orchestratorMode
    let cancelled = false
    const fallbackFromLocalStorage = () => {
      try {
        const stored = JSON.parse(localStorage.getItem('optimando-orchestrator-mode') || '{}') as { deviceName?: string }
        if (!cancelled) setDeviceName(typeof stored.deviceName === 'string' ? stored.deviceName : '')
      } catch {
        if (!cancelled) setDeviceName('')
      }
    }
    if (typeof om?.getDeviceInfo === 'function') {
      om.getDeviceInfo()
        .then((info) => {
          if (cancelled) return
          const n = typeof info?.deviceName === 'string' ? info.deviceName : ''
          const code = typeof info?.pairingCode === 'string' ? info.pairingCode.trim() : ''
          setDeviceName(n)
          setLocalPairingCode(code)
        })
        .catch(() => {
          fallbackFromLocalStorage()
        })
    } else {
      fallbackFromLocalStorage()
    }
    return () => {
      cancelled = true
    }
  }, [isInternal])

  const handleSuccess = (result?: { handshake_id?: string }) => {
    onSuccess?.()
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '560px',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 60px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(147,51,234,0.14)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px', lineHeight: 1 }} aria-hidden>{'\u{1F91D}'}</span>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1f2937' }}>Handshake Request</h2>
        </div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(147,51,234,0.14)' }}>
          <VaultStatusIndicator
            vaultName={vaultStatus.name}
            isUnlocked={vaultStatus.isUnlocked}
            warningEscalated={false}
            requiresVault={requiresVault}
          />
        </div>
        <div style={{ padding: '16px 16px 0', borderBottom: '1px solid rgba(147,51,234,0.14)' }}>
          <PolicyRadioGroup value={policies} onChange={setPolicies} readOnly={false} variant="light" />
        </div>

        {!presetInternal && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px 0', fontSize: '13px', cursor: 'pointer', color: '#1f2937' }}>
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => {
                const next = e.target.checked
                setIsInternal(next)
                setShowInternalHint(next)
                if (next) {
                  prefillRecipientEmail(setRecipientEmail)
                } else {
                  setRecipientEmail('')
                }
              }}
            />
            Internal handshake (connect my own devices)
          </label>
        )}

        {isInternal && showInternalHint && (
          <div
            data-testid="internal-handshake-hint"
            style={{
              margin: '12px 16px 0',
              padding: '10px 12px',
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.25)',
              borderRadius: '8px',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
              fontSize: '12px',
              color: '#1e40af',
              lineHeight: 1.5,
            }}
          >
            <span style={{ fontSize: '14px', flexShrink: 0 }} aria-hidden>ℹ️</span>
            <span style={{ flex: 1 }}>
              Internal handshakes pair two devices on the same account. You’ll need the{' '}
              <strong>6-digit Pairing code</strong> from the other device — find it in{' '}
              <strong>Settings → Orchestrator mode</strong>.
            </span>
            <button
              type="button"
              onClick={() => setShowInternalHint(false)}
              aria-label="Dismiss internal handshake hint"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#1e40af',
                cursor: 'pointer',
                fontSize: '13px',
                lineHeight: 1,
                padding: '0 2px',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {isInternal && (
          <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {presetInternal ? (
              <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>Internal handshake — connect your own devices on this account. Use the same delivery options as a normal handshake below.</p>
            ) : null}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: '4px' }}>This device name</label>
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="My Computer"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(147,51,234,0.18)',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>This device is:</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setDeviceRole('host')}
                  style={{
                    flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                    background: deviceRole === 'host' ? '#534AB7' : 'transparent',
                    color: deviceRole === 'host' ? '#fff' : '#6b7280',
                    border: deviceRole === 'host' ? 'none' : '1px solid #ddd',
                  }}
                >Host</button>
                <button
                  type="button"
                  onClick={() => setDeviceRole('sandbox')}
                  style={{
                    flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                    background: deviceRole === 'sandbox' ? '#534AB7' : 'transparent',
                    color: deviceRole === 'sandbox' ? '#fff' : '#6b7280',
                    border: deviceRole === 'sandbox' ? 'none' : '1px solid #ddd',
                  }}
                >Sandbox</button>
              </div>
            </div>
          </div>
        )}

        <SendHandshakeDelivery
          theme="standard"
          onBack={onClose}
          fromAccountId=""
          emailAccounts={[]}
          onSuccess={handleSuccess}
          policySelections={policies}
          onRequiresVaultChange={setRequiresVault}
          isVaultUnlocked={vaultStatus.isUnlocked}
          canUseHsContextProfiles={canUseHsContextProfiles}
          isInternalHandshake={isInternal}
          lockedRecipientEmail={isInternal && recipientEmail.trim() ? recipientEmail : undefined}
          deviceName={isInternal ? deviceName : undefined}
          deviceRole={isInternal ? deviceRole : undefined}
          localPairingCode={isInternal ? localPairingCode : undefined}
        />
      </div>
    </div>
  )
}
