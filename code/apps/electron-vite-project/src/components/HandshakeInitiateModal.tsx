/**
 * HandshakeInitiateModal — wraps SendHandshakeDelivery with vault status
 * and policy selection. Vault hint only shown when action requires vault (e.g. vault profiles).
 */

import { useState, useEffect } from 'react'
import { SendHandshakeDelivery } from '@ext/handshake/components/SendHandshakeDelivery'
import VaultStatusIndicator from './VaultStatusIndicator'
import PolicyRadioGroup, { DEFAULT_AI_POLICY, type PolicySelection } from './PolicyRadioGroup'

interface Props {
  onClose: () => void
  onSuccess?: () => void
  onSubmit?: (data: { recipientEmail: string; deliveryMode: string }) => void
}

export default function HandshakeInitiateModal({ onClose, onSuccess }: Props) {
  const [vaultStatus, setVaultStatus] = useState<{ isUnlocked: boolean; name: string | null }>({ isUnlocked: false, name: null })
  const [policies, setPolicies] = useState<PolicySelection>(DEFAULT_AI_POLICY)
  const [requiresVault, setRequiresVault] = useState(false)

  useEffect(() => {
    const check = async () => {
      try {
        const s = await window.handshakeView?.getVaultStatus?.()
        setVaultStatus({ isUnlocked: s?.isUnlocked ?? false, name: s?.name ?? null })
      } catch {
        setVaultStatus({ isUnlocked: false, name: null })
      }
    }
    check()
    const h = () => check()
    window.addEventListener('vault-status-changed', h)
    return () => window.removeEventListener('vault-status-changed', h)
  }, [])

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
          width: '100%', maxWidth: '520px',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 60px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(147,51,234,0.14)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🤝</span>
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
        <SendHandshakeDelivery
          theme="standard"
          onBack={onClose}
          fromAccountId=""
          emailAccounts={[]}
          onSuccess={handleSuccess}
          policySelections={policies}
          onRequiresVaultChange={setRequiresVault}
          // TODO(feature-gate): Wire to actual plan/subscription check.
          // Context Profiles require Publisher or Enterprise plan.
          // Currently hardcoded to true — all users get access.
          canUseHsContextProfiles={true}
        />
      </div>
    </div>
  )
}
