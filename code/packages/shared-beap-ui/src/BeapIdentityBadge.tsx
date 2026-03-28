import React from 'react'

export interface BeapIdentityBadgeProps {
  handshakeId?: string | null
  counterpartyLabel?: string
  trustNote?: string
  compact?: boolean
}

/**
 * Small identity badge showing handshake status and trust level.
 * Presentation-only — no crypto, no IPC.
 */
export function BeapIdentityBadge({
  handshakeId,
  counterpartyLabel,
  trustNote,
  compact = false,
}: BeapIdentityBadgeProps) {
  if (!handshakeId && !counterpartyLabel) return null

  const rootClass = `beap-ui-identity-badge${compact ? ' beap-ui--compact' : ''}`

  return (
    <span className={rootClass}>
      {counterpartyLabel && (
        <span className="beap-ui-identity-name">{counterpartyLabel}</span>
      )}
      {handshakeId && (
        <span className="beap-ui-identity-handshake" title={`Handshake: ${handshakeId}`}>
          🤝 Handshake
        </span>
      )}
      {trustNote && (
        <span className="beap-ui-identity-trust">{trustNote}</span>
      )}
    </span>
  )
}
