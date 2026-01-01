/**
 * RecipientHandshakeSelect Component
 * 
 * Dropdown/list for selecting a verified handshake as the message recipient.
 * Only visible in PRIVATE (qBEAP) mode.
 * 
 * Display format:
 * - Primary: "<Company / Org Name> — Verified"
 * - Secondary: "Fingerprint: <short_fingerprint>" (copyable)
 */

import React, { useState } from 'react'
import type { Handshake } from '../../handshake/types'

export interface SelectedRecipient {
  handshake_id: string
  receiver_display_name: string
  receiver_fingerprint_full: string
  receiver_fingerprint_short: string
  receiver_email_list: string[]
  receiver_organization?: string
}

export interface RecipientHandshakeSelectProps {
  handshakes: Handshake[]
  selectedHandshakeId: string | null
  onSelect: (recipient: SelectedRecipient | null) => void
  theme: 'professional' | 'hacker'
  disabled?: boolean
  isLoading?: boolean
}

export const RecipientHandshakeSelect: React.FC<RecipientHandshakeSelectProps> = ({
  handshakes,
  selectedHandshakeId,
  onSelect,
  theme,
  disabled = false,
  isLoading = false
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.2)' : 'rgba(255,255,255,0.2)'
  const bgColor = isProfessional ? 'white' : 'rgba(255,255,255,0.08)'

  // Filter to only verified handshakes
  const verifiedHandshakes = handshakes.filter(h => 
    h.status === 'VERIFIED_WR' || h.status === 'LOCAL'
  )

  const handleSelect = (handshake: Handshake) => {
    if (disabled) return
    
    const recipient: SelectedRecipient = {
      handshake_id: handshake.id,
      receiver_display_name: handshake.displayName,
      receiver_fingerprint_full: handshake.fingerprint_full,
      receiver_fingerprint_short: handshake.fingerprint_short,
      receiver_email_list: handshake.email ? [handshake.email] : [],
      receiver_organization: handshake.organization
    }
    
    onSelect(recipient)
  }

  const handleCopyFingerprint = async (fingerprint: string, id: string) => {
    try {
      await navigator.clipboard.writeText(fingerprint)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy fingerprint:', err)
    }
  }

  const getStatusBadge = (status: string) => {
    if (status === 'VERIFIED_WR') {
      return (
        <span style={{
          fontSize: '9px',
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: '4px',
          background: isProfessional ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.25)',
          color: isProfessional ? '#15803d' : '#86efac',
          display: 'flex',
          alignItems: 'center',
          gap: '3px'
        }}>
          ✓ WR Verified
        </span>
      )
    }
    return (
      <span style={{
        fontSize: '9px',
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: '4px',
        background: isProfessional ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.25)',
        color: isProfessional ? '#2563eb' : '#93c5fd'
      }}>
        Local
      </span>
    )
  }

  if (isLoading) {
    return (
      <div style={{
        padding: '16px',
        textAlign: 'center',
        color: mutedColor,
        fontSize: '12px'
      }}>
        Loading handshakes...
      </div>
    )
  }

  if (verifiedHandshakes.length === 0) {
    return (
      <div style={{
        padding: '16px',
        background: isProfessional ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.15)',
        borderRadius: '8px',
        border: `1px dashed ${isProfessional ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.4)'}`,
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🤝</div>
        <div style={{ 
          fontSize: '13px', 
          fontWeight: 600, 
          color: isProfessional ? '#dc2626' : '#fca5a5',
          marginBottom: '4px'
        }}>
          No Verified Handshakes
        </div>
        <div style={{ 
          fontSize: '11px', 
          color: mutedColor,
          lineHeight: '1.4'
        }}>
          Establish a handshake with a recipient first to send private BEAP messages.
          Use the Handshake mode in WR Chat to initiate.
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{
        fontSize: '11px',
        fontWeight: 600,
        marginBottom: '8px',
        display: 'block',
        color: mutedColor,
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        Select Recipient Handshake
      </label>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        maxHeight: '200px',
        overflowY: 'auto',
        padding: '2px'
      }}>
        {verifiedHandshakes.map((handshake) => {
          const isSelected = selectedHandshakeId === handshake.id
          const isCopied = copiedId === handshake.id

          return (
            <div
              key={handshake.id}
              onClick={() => handleSelect(handshake)}
              style={{
                padding: '12px',
                background: isSelected 
                  ? (isProfessional ? 'rgba(59,130,246,0.1)' : 'rgba(139,92,246,0.2)')
                  : bgColor,
                border: isSelected
                  ? (isProfessional ? '2px solid #3b82f6' : '2px solid #8b5cf6')
                  : `1px solid ${borderColor}`,
                borderRadius: '8px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                transition: 'all 0.15s ease'
              }}
            >
              {/* Header: Name + Status */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{ fontSize: '18px' }}>
                    {handshake.status === 'VERIFIED_WR' ? '🔐' : '🤝'}
                  </span>
                  <div>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: textColor
                    }}>
                      {handshake.organization || handshake.displayName}
                    </div>
                    {handshake.organization && (
                      <div style={{
                        fontSize: '11px',
                        color: mutedColor
                      }}>
                        {handshake.displayName}
                      </div>
                    )}
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {getStatusBadge(handshake.status)}
                  {isSelected && (
                    <span style={{
                      fontSize: '14px',
                      color: isProfessional ? '#3b82f6' : '#a78bfa'
                    }}>
                      ✓
                    </span>
                  )}
                </div>
              </div>

              {/* Fingerprint Row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
                borderRadius: '4px'
              }}>
                <div style={{
                  fontSize: '10px',
                  color: mutedColor,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <span>Fingerprint:</span>
                  <code style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: isProfessional ? '#1e40af' : '#bfdbfe'
                  }}>
                    {handshake.fingerprint_short}
                  </code>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyFingerprint(handshake.fingerprint_full, handshake.id)
                  }}
                  style={{
                    background: isCopied 
                      ? '#22c55e' 
                      : (isProfessional ? 'rgba(59,130,246,0.1)' : 'rgba(139,92,246,0.2)'),
                    border: 'none',
                    color: isCopied ? 'white' : (isProfessional ? '#3b82f6' : '#a78bfa'),
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '9px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {isCopied ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              {/* Email hint if available */}
              {handshake.email && (
                <div style={{
                  marginTop: '6px',
                  fontSize: '10px',
                  color: mutedColor,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <span>📧</span>
                  <span>{handshake.email}</span>
                  <span style={{ 
                    opacity: 0.6, 
                    fontStyle: 'italic',
                    marginLeft: '4px'
                  }}>
                    (delivery hint only)
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Selection required hint */}
      {!selectedHandshakeId && (
        <div style={{
          marginTop: '8px',
          padding: '8px 10px',
          background: isProfessional ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.15)',
          borderRadius: '6px',
          fontSize: '11px',
          color: isProfessional ? '#92400e' : '#fcd34d',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span>⚠️</span>
          <span>Select a handshake recipient to continue with private distribution.</span>
        </div>
      )}
    </div>
  )
}

export default RecipientHandshakeSelect

