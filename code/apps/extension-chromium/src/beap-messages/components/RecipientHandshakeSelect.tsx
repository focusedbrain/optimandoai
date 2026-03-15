/**
 * RecipientHandshakeSelect Component
 *
 * Dropdown/list for selecting an ACTIVE handshake as the message recipient.
 * Only visible in PRIVATE (qBEAP) mode.
 *
 * Reads from the backend via useHandshakes('active').
 * No X25519/ML-KEM fields — crypto is handled entirely by the backend pipeline.
 */

import React, { useState } from 'react'
import type { HandshakeRecord, SelectedHandshakeRecipient } from '../../handshake/rpcTypes'
import { hasHandshakeKeyMaterial } from '../../handshake/rpcTypes'

export type { SelectedHandshakeRecipient }

/** @deprecated Use SelectedHandshakeRecipient instead */
export type SelectedRecipient = SelectedHandshakeRecipient

export interface RecipientHandshakeSelectProps {
  handshakes: HandshakeRecord[]
  selectedHandshakeId: string | null
  onSelect: (recipient: SelectedHandshakeRecipient | null) => void
  theme: 'standard' | 'hacker' | 'pro' | 'dark'
  disabled?: boolean
  isLoading?: boolean
}

export const RecipientHandshakeSelect: React.FC<RecipientHandshakeSelectProps> = ({
  handshakes,
  selectedHandshakeId,
  onSelect,
  theme,
  disabled = false,
  isLoading = false,
}) => {
  const isStandard = theme === 'standard'
  const textColor = isStandard ? '#0f172a' : 'white'
  const mutedColor = isStandard ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isStandard ? 'rgba(15,23,42,0.2)' : 'rgba(255,255,255,0.2)'
  const bgColor = isStandard ? 'white' : 'rgba(255,255,255,0.08)'

  const activeHandshakes = handshakes.filter((h) => h.state === 'ACTIVE')

  const handleSelect = (hs: HandshakeRecord) => {
    if (disabled) return
    if (!hasHandshakeKeyMaterial(hs)) return // Incomplete handshakes are not selectable
    const recipient: SelectedHandshakeRecipient = {
      handshake_id: hs.handshake_id,
      counterparty_email: hs.counterparty_email,
      counterparty_user_id: hs.counterparty_user_id,
      sharing_mode: hs.sharing_mode ?? 'receive-only',
      peerX25519PublicKey: hs.peerX25519PublicKey,
      peerPQPublicKey: hs.peerPQPublicKey,
    }
    onSelect(recipient)
  }

  const getStateBadge = (state: string) => {
    if (state === 'ACTIVE') {
      return (
        <span
          style={{
            fontSize: '9px',
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: '4px',
            background: isStandard ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.25)',
            color: isStandard ? '#15803d' : '#86efac',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          ✓ Active
        </span>
      )
    }
    return null
  }

  if (isLoading) {
    return (
      <div
        style={{
          padding: '16px',
          textAlign: 'center',
          color: mutedColor,
          fontSize: '12px',
        }}
      >
        Loading handshakes...
      </div>
    )
  }

  if (activeHandshakes.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          background: isStandard ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.15)',
          borderRadius: '8px',
          border: `1px dashed ${isStandard ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.4)'}`,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🤝</div>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: isStandard ? '#dc2626' : '#fca5a5',
            marginBottom: '4px',
          }}
        >
          No Active Handshakes
        </div>
        <div style={{ fontSize: '11px', color: mutedColor, lineHeight: '1.4' }}>
          Initiate a handshake with a recipient to send private BEAP messages.
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: '12px' }}>
      <label
        style={{
          fontSize: '11px',
          fontWeight: 600,
          marginBottom: '8px',
          display: 'block',
          color: mutedColor,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        Select Recipient Handshake
      </label>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '200px',
          overflowY: 'auto',
          padding: '2px',
        }}
      >
        {activeHandshakes.map((hs) => {
          const isSelected = selectedHandshakeId === hs.handshake_id
          const hasKeys = hasHandshakeKeyMaterial(hs)
          const isSelectable = hasKeys && !disabled

          return (
            <div
              key={hs.handshake_id}
              onClick={() => handleSelect(hs)}
              style={{
                padding: '12px',
                background: !hasKeys
                  ? isStandard ? 'rgba(107,114,128,0.08)' : 'rgba(107,114,128,0.12)'
                  : isSelected
                    ? isStandard
                      ? 'rgba(59,130,246,0.1)'
                      : 'rgba(139,92,246,0.2)'
                    : bgColor,
                border: !hasKeys
                  ? `1px dashed ${isStandard ? 'rgba(107,114,128,0.3)' : 'rgba(107,114,128,0.4)'}`
                  : isSelected
                    ? isStandard
                      ? '2px solid #3b82f6'
                      : '2px solid #8b5cf6'
                    : `1px solid ${borderColor}`,
                borderRadius: '8px',
                cursor: isSelectable ? 'pointer' : 'not-allowed',
                opacity: hasKeys ? (disabled ? 0.5 : 1) : 0.7,
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px' }}>{hasKeys ? '🔒' : '⚠️'}</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: hasKeys ? textColor : mutedColor }}>
                      {hs.counterparty_email}
                    </div>
                    {hasKeys ? (
                      hs.sharing_mode && (
                        <div style={{ fontSize: '11px', color: mutedColor }}>
                          {hs.sharing_mode === 'reciprocal' ? 'Reciprocal' : 'Receive-only'}
                        </div>
                      )
                    ) : (
                      <div style={{ fontSize: '11px', color: isStandard ? '#b91c1c' : '#fca5a5', fontWeight: 500 }}>
                        ⚠️ Incomplete — delete and re-establish
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {getStateBadge(hs.state)}
                  {isSelected && hasKeys && (
                    <span style={{ fontSize: '14px', color: isStandard ? '#3b82f6' : '#a78bfa' }}>
                      ✓
                    </span>
                  )}
                </div>
              </div>

              {hs.activated_at && hasKeys && (
                <div
                  style={{
                    fontSize: '10px',
                    color: mutedColor,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>Activated:</span>
                  <span>{new Date(hs.activated_at).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!selectedHandshakeId && (
        <div
          style={{
            marginTop: '8px',
            padding: '8px 10px',
            background: isStandard ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.15)',
            borderRadius: '6px',
            fontSize: '11px',
            color: isStandard ? '#92400e' : '#fcd34d',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>⚠️</span>
          <span>Select a handshake recipient to continue with private distribution.</span>
        </div>
      )}
    </div>
  )
}

export default RecipientHandshakeSelect
