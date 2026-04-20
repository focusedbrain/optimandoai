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
  // Device role for this internal handshake. Initialised from the persisted
  // orchestrator mode (Settings → Orchestrator mode) via getDeviceInfo so the form
  // matches what the user already configured globally, but kept as local state so
  // the user can override per-handshake from this modal. Forwarded to
  // SendHandshakeDelivery → handshake.initiate IPC as `device_role`; the receiver
  // device must be the opposite role for the capsule to validate on accept.
  const [deviceRole, setDeviceRole] = useState<'host' | 'sandbox'>('sandbox')
  const [deviceName, setDeviceName] = useState('')
  /** This device's local 6-digit pairing code, used for the self-pair guard in
   *  SendHandshakeDelivery. Surfaced from orchestrator preload (getDeviceInfo). */
  const [localPairingCode, setLocalPairingCode] = useState<string>('')
  /** Local orchestrator instanceId. Surfaced only as a presence flag so the form
   *  can render a Settings gap notice when it's empty (instead of letting the IPC
   *  reject with INTERNAL_ENDPOINT_INCOMPLETE). Never echoed onto the wire. */
  const [localInstanceId, setLocalInstanceId] = useState<string>('')
  const [recipientEmail, setRecipientEmail] = useState('')

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
        getDeviceInfo?: () => Promise<{ pairingCode?: string; deviceName?: string; instanceId?: string; mode?: string } | null | undefined>
      }
    }).orchestratorMode
    let cancelled = false
    const fallbackFromLocalStorage = () => {
      try {
        const stored = JSON.parse(localStorage.getItem('optimando-orchestrator-mode') || '{}') as { deviceName?: string; mode?: string }
        if (!cancelled) {
          setDeviceName(typeof stored.deviceName === 'string' ? stored.deviceName : '')
          if (stored.mode === 'host' || stored.mode === 'sandbox') setDeviceRole(stored.mode)
        }
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
          const iid = typeof info?.instanceId === 'string' ? info.instanceId.trim() : ''
          setDeviceName(n)
          setLocalPairingCode(code)
          setLocalInstanceId(iid)
          if (info?.mode === 'host' || info?.mode === 'sandbox') setDeviceRole(info.mode)
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

        {/* Host / Sandbox role picker (internal handshakes only).
            Initialised from Settings → Orchestrator mode (`getDeviceInfo().mode`)
            but overridable per-handshake. The receiver device must be the opposite
            role for the capsule to validate on accept (see validateInternalEndpointPair). */}
        {isInternal && (
          <div style={{ padding: '12px 16px 0' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>This device is:</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setDeviceRole('host')}
                aria-pressed={deviceRole === 'host'}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: deviceRole === 'host' ? '#534AB7' : 'transparent',
                  color: deviceRole === 'host' ? '#fff' : '#6b7280',
                  border: deviceRole === 'host' ? 'none' : '1px solid rgba(147,51,234,0.18)',
                }}
              >Host</button>
              <button
                type="button"
                onClick={() => setDeviceRole('sandbox')}
                aria-pressed={deviceRole === 'sandbox'}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: deviceRole === 'sandbox' ? '#534AB7' : 'transparent',
                  color: deviceRole === 'sandbox' ? '#fff' : '#6b7280',
                  border: deviceRole === 'sandbox' ? 'none' : '1px solid rgba(147,51,234,0.18)',
                }}
              >Sandbox</button>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280', lineHeight: 1.45 }}>
              The other device must be set as <strong>{deviceRole === 'host' ? 'Sandbox' : 'Host'}</strong> for the handshake to complete.
            </p>
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
          localInstanceId={isInternal ? localInstanceId : undefined}
        />
      </div>
    </div>
  )
}
