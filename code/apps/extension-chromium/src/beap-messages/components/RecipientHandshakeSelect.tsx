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
import type { HandshakeRecord, HandshakeState, SelectedHandshakeRecipient } from '../../handshake/rpcTypes'
import { hasHandshakeKeyMaterial } from '../../handshake/rpcTypes'
import {
  formatInternalBeapTargetSummary,
  formatInternalListSubtitle,
  isInternalHandshake,
} from '@shared/handshake/internalIdentityUi'

export type { SelectedHandshakeRecipient }

/** @deprecated Use SelectedHandshakeRecipient instead */
export type SelectedRecipient = SelectedHandshakeRecipient

/** Relative hint for optional capsule lease metadata (not used to invalidate trust). */
function formatExpiry(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt) - Date.now()
  if (Number.isNaN(ms) || ms < 0) return null
  if (ms > 86400000) return null
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) return `Expires in ${hours}h`
  return `Expires in ${minutes}m`
}

/** Absolute date for any handshake with expires_at (capsule builder awareness). */
function formatExpiryAbsolute(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export interface RecipientHandshakeSelectProps {
  handshakes: HandshakeRecord[]
  selectedHandshakeId: string | null
  onSelect: (recipient: SelectedHandshakeRecipient | null) => void
  theme: 'standard' | 'hacker' | 'pro' | 'dark'
  disabled?: boolean
  isLoading?: boolean
  /** Set when useHandshakes() failed — show instead of misleading "No Active Handshakes". */
  fetchError?: string | null
  /** Typically useHandshakes().refresh */
  onRetry?: () => void
}

export const RecipientHandshakeSelect: React.FC<RecipientHandshakeSelectProps> = ({
  handshakes,
  selectedHandshakeId,
  onSelect,
  theme,
  disabled = false,
  isLoading = false,
  fetchError = null,
  onRetry,
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
      p2pEndpoint: hs.p2pEndpoint,
      localX25519PublicKey: hs.localX25519PublicKey,
      internal_target_summary: isInternalHandshake(hs) ? formatInternalBeapTargetSummary(hs) : null,
    }
    onSelect(recipient)
  }

  const getStateBadge = (state: HandshakeState) => {
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
    const labels: Record<HandshakeState, string> = {
      DRAFT: 'Draft',
      PENDING_ACCEPT: 'Pending',
      PENDING_REVIEW: 'Review',
      ACCEPTED: 'Accepted',
      ACTIVE: 'Active',
      EXPIRED: 'Expired',
      REVOKED: 'Revoked',
    }
    return (
      <span
        style={{
          fontSize: '9px',
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: '4px',
          background: isStandard ? 'rgba(107,114,128,0.12)' : 'rgba(107,114,128,0.22)',
          color: isStandard ? '#475569' : 'rgba(255,255,255,0.65)',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
        }}
      >
        {labels[state]}
      </span>
    )
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

  if (fetchError) {
    return (
      <div
        style={{
          padding: '16px',
          background: isStandard ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.15)',
          borderRadius: '8px',
          border: `1px solid ${isStandard ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.45)'}`,
        }}
      >
        <div style={{ fontSize: '12px', color: textColor, lineHeight: 1.5, marginBottom: '10px' }}>
          Could not load handshakes: {fetchError}
        </div>
        <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.5, marginBottom: '12px' }}>
          Make sure WR Desk™ is running and your vault is unlocked.
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: isStandard ? '#2563eb' : 'rgba(139,92,246,0.9)',
              color: 'white',
            }}
          >
            Retry
          </button>
        )}
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
          const expiryHint = formatExpiry(hs.expires_at)
          const expiryAbsolute = formatExpiryAbsolute(hs.expires_at)
          const showExpiryBadge = expiryHint != null
          const internalListLine = isInternalHandshake(hs) ? formatInternalListSubtitle(hs) : null

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
                    {internalListLine && (
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          color: isStandard ? '#4338ca' : '#a5b4fc',
                          marginTop: '4px',
                          lineHeight: 1.35,
                        }}
                      >
                        {internalListLine}
                      </div>
                    )}
                    {hasKeys ? (
                      <>
                        {hs.sharing_mode && (
                          <div style={{ fontSize: '11px', color: mutedColor }}>
                            {hs.sharing_mode === 'reciprocal' ? 'Reciprocal' : 'Receive-only'}
                          </div>
                        )}
                        {expiryAbsolute && !expiryHint && (
                          <div style={{ fontSize: '10px', color: mutedColor, marginTop: hs.sharing_mode ? '2px' : 0 }}>
                            Expires: {expiryAbsolute}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '11px', color: isStandard ? '#b91c1c' : '#fca5a5', fontWeight: 500 }}>
                          ⚠️ Incomplete — delete and re-establish
                        </div>
                        {expiryAbsolute && !expiryHint && (
                          <div style={{ fontSize: '10px', color: mutedColor, marginTop: '2px' }}>
                            Expires: {expiryAbsolute}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {showExpiryBadge && (
                    <span
                      title={expiryAbsolute ? `Expires ${expiryAbsolute}` : undefined}
                      style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background:
                          expiryHint === 'Expired'
                            ? isStandard
                              ? 'rgba(239,68,68,0.15)'
                              : 'rgba(239,68,68,0.25)'
                            : isStandard
                              ? 'rgba(245,158,11,0.15)'
                              : 'rgba(245,158,11,0.22)',
                        color:
                          expiryHint === 'Expired'
                            ? isStandard
                              ? '#b91c1c'
                              : '#fca5a5'
                            : isStandard
                              ? '#b45309'
                              : '#fcd34d',
                        border:
                          expiryHint === 'Expired'
                            ? `1px solid ${isStandard ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.45)'}`
                            : `1px solid ${isStandard ? 'rgba(245,158,11,0.35)' : 'rgba(245,158,11,0.4)'}`,
                        maxWidth: '140px',
                        textAlign: 'center',
                      }}
                    >
                      {expiryHint === 'Expired' ? '⛔ ' : '⏱ '}
                      {expiryHint}
                    </span>
                  )}
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
