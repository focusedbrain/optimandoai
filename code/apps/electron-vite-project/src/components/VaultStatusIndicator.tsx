/**
 * VaultStatusIndicator — 3-state vault status for handshake flow
 *
 * State 1: Informational (vault locked, no failed action yet)
 * State 2: Warning escalated (user tried to proceed without unlock)
 * State 3: Vault unlocked (compact)
 */

interface VaultStatusIndicatorProps {
  vaultName: string | null
  isUnlocked: boolean
  warningEscalated: boolean
  onUnlockClick?: () => void
}

export default function VaultStatusIndicator({
  vaultName,
  isUnlocked,
  warningEscalated,
  onUnlockClick,
}: VaultStatusIndicatorProps) {
  const displayName = vaultName ?? 'Default Vault'

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
        {onUnlockClick && (
          <button
            onClick={onUnlockClick}
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'rgba(239,68,68,0.2)',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Unlock Vault
          </button>
        )}
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
      {onUnlockClick && (
        <button
          onClick={onUnlockClick}
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 600,
            background: 'rgba(59,130,246,0.2)',
            color: '#3b82f6',
            border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Unlock Vault
        </button>
      )}
    </div>
  )
}
