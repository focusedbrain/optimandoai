/**
 * VaultStatusIndicator — 3-state vault status for handshake flow
 *
 * State 1: Informational (vault locked, no failed action yet)
 * State 2: Warning escalated (user tried to proceed without unlock)
 * State 3: Vault unlocked (compact)
 *
 * requiresVault: When false and vault is locked, do NOT show "Vault unlock required".
 * Only show the blocking hint when the current action actually needs vault access
 * (sign, accept, attach vault profiles, sensitive context).
 */

interface VaultStatusIndicatorProps {
  vaultName: string | null
  isUnlocked: boolean
  warningEscalated: boolean
  /** When false and locked: hide the "Vault unlock required" block. Default true for backward compat. */
  requiresVault?: boolean
}

export default function VaultStatusIndicator({
  vaultName,
  isUnlocked,
  warningEscalated,
  requiresVault = true,
}: VaultStatusIndicatorProps) {
  const displayName = vaultName ?? 'Default Vault'

  // When action doesn't require vault and vault is locked: don't show blocking hint
  if (!isUnlocked && !requiresVault) {
    return null
  }

  if (isUnlocked) {
    return (
      <div
        style={{
          marginBottom: '16px',
          padding: '10px 14px',
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: '8px',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', marginBottom: '4px' }}>
          Vault active
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
          Active Vault: {displayName} (Unlocked)
        </div>
        <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginTop: '2px' }}>
          Handshake data will be stored securely.
        </div>
      </div>
    )
  }

  if (warningEscalated) {
    return (
      <div
        style={{
          marginBottom: '16px',
          padding: '14px 16px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '8px',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444', marginBottom: '6px' }}>
          Vault access required
        </div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#fca5a5', marginBottom: '6px' }}>
          You must unlock the vault before sensitive data can be stored.
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.5, marginBottom: '10px' }}>
          Sensitive handshake data is stored securely in your vault, including identity verification data,
          cryptographic signatures, and contract metadata.
          <br />
          Unlock your vault to complete the handshake and store this data securely.
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
          Active Vault: {displayName} (Locked)
        </div>
        <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
          Only one vault can be unlocked at a time. The active vault stores handshake data.
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
          Unlock your vault manually to continue.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        marginBottom: '16px',
        padding: '14px 16px',
        background: 'rgba(59,130,246,0.08)',
        border: '1px solid rgba(59,130,246,0.3)',
        borderRadius: '8px',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#3b82f6', marginBottom: '6px' }}>
        Vault unlock required
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.5, marginBottom: '10px' }}>
        Sensitive handshake data is stored securely in your vault, including identity verification data,
        cryptographic signatures, and contract metadata.
        <br />
        Unlock your vault to complete the handshake and store this data securely.
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
        Active Vault: {displayName} (Locked)
      </div>
      <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
        Only one vault can be unlocked at a time. The active vault stores handshake data.
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
        Unlock your vault manually to continue.
      </div>
    </div>
  )
}
