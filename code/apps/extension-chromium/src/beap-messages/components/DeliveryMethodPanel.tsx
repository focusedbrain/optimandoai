/**
 * DeliveryMethodPanel Component
 * 
 * Displays delivery-method-specific UI that adapts to recipient mode.
 * 
 * Email:
 *   PRIVATE: Auto-filled from handshake email, restricted selection
 *   PUBLIC: Freeform "To" field (delivery hint only)
 * 
 * Messenger:
 *   PRIVATE: "Recipient: <Company Name> (Fingerprint <short>)"
 *   PUBLIC: "Public distribution (pBEAP)"
 * 
 * Download:
 *   PRIVATE: Filename includes short fingerprint
 *   PUBLIC: Filename includes "PUBLIC" marker
 */

import React, { useState, useEffect } from 'react'
import type { RecipientMode, SelectedRecipient } from './RecipientModeSwitch'

export type DeliveryMethod = 'email' | 'messenger' | 'download'

export interface DeliveryMethodPanelProps {
  deliveryMethod: DeliveryMethod
  recipientMode: RecipientMode
  selectedRecipient: SelectedRecipient | null
  emailTo: string
  onEmailToChange: (value: string) => void
  theme: 'professional' | 'hacker' | 'default'
  ourFingerprintShort: string
}

export const DeliveryMethodPanel: React.FC<DeliveryMethodPanelProps> = ({
  deliveryMethod,
  recipientMode,
  selectedRecipient,
  emailTo,
  onEmailToChange,
  theme,
  ourFingerprintShort
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.2)' : 'rgba(255,255,255,0.2)'
  const bgColor = isProfessional ? 'white' : 'rgba(255,255,255,0.1)'

  // For PRIVATE mode email, auto-fill from handshake
  const [selectedEmail, setSelectedEmail] = useState<string>('')
  
  // Auto-select first email when recipient changes
  useEffect(() => {
    if (recipientMode === 'private' && selectedRecipient?.receiver_email_list?.length) {
      const firstEmail = selectedRecipient.receiver_email_list[0]
      setSelectedEmail(firstEmail)
      onEmailToChange(firstEmail)
    } else if (recipientMode === 'public') {
      setSelectedEmail('')
    }
  }, [recipientMode, selectedRecipient, onEmailToChange])

  // Generate filename preview
  const getFilenamePreview = (): string => {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    if (recipientMode === 'private' && selectedRecipient) {
      const shortFp = selectedRecipient.receiver_fingerprint_short.replace(/[…\.]/g, '').slice(0, 8)
      return `beap_${timestamp}_${shortFp}.beap`
    }
    return `beap_${timestamp}_PUBLIC.beap`
  }

  // ==========================================================================
  // EMAIL DELIVERY
  // ==========================================================================
  if (deliveryMethod === 'email') {
    // PRIVATE mode: Restricted to handshake emails
    if (recipientMode === 'private') {
      const emails = selectedRecipient?.receiver_email_list || []
      
      if (!selectedRecipient) {
        return (
          <div style={{
            padding: '12px',
            background: isProfessional ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.15)',
            borderRadius: '8px',
            border: `1px dashed ${isProfessional ? 'rgba(251,191,36,0.3)' : 'rgba(251,191,36,0.4)'}`,
            fontSize: '12px',
            color: isProfessional ? '#92400e' : '#fcd34d'
          }}>
            ⚠️ Select a handshake recipient above to see delivery options.
          </div>
        )
      }
      
      if (emails.length === 0) {
        return (
          <div style={{
            padding: '12px',
            background: isProfessional ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.15)',
            borderRadius: '8px',
            border: `1px solid ${borderColor}`
          }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: isProfessional ? '#3b82f6' : '#93c5fd', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Recipient (No Email on Record)
            </div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: textColor }}>
              {selectedRecipient.receiver_display_name}
              {selectedRecipient.receiver_organization && ` — ${selectedRecipient.receiver_organization}`}
            </div>
            <div style={{ fontSize: '11px', color: mutedColor, marginTop: '6px' }}>
              📋 This handshake has no email address. The package will be created for manual delivery.
            </div>
          </div>
        )
      }
      
      return (
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recipient Email (from Handshake)
          </label>
          {emails.length === 1 ? (
            // Single email - show as readonly display
            <div style={{
              padding: '10px 12px',
              background: isProfessional ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.12)',
              border: isProfessional ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(34,197,94,0.3)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '14px' }}>🔐</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: textColor }}>
                  {emails[0]}
                </div>
                <div style={{ fontSize: '10px', color: isProfessional ? '#15803d' : '#86efac', marginTop: '2px' }}>
                  Identity-bound to handshake: {selectedRecipient.receiver_fingerprint_short}
                </div>
              </div>
              <span style={{ 
                fontSize: '9px', 
                fontWeight: 600, 
                padding: '2px 6px', 
                borderRadius: '4px',
                background: isProfessional ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.25)',
                color: isProfessional ? '#15803d' : '#86efac'
              }}>
                VERIFIED
              </span>
            </div>
          ) : (
            // Multiple emails - show dropdown
            <select
              value={selectedEmail}
              onChange={(e) => {
                setSelectedEmail(e.target.value)
                onEmailToChange(e.target.value)
              }}
              style={{
                width: '100%',
                background: bgColor,
                border: `1px solid ${borderColor}`,
                color: textColor,
                borderRadius: '6px',
                padding: '10px 12px',
                fontSize: '13px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {emails.map((email, idx) => (
                <option key={idx} value={email} style={{ background: isProfessional ? 'white' : '#1f2937' }}>
                  {email}
                </option>
              ))}
            </select>
          )}
          <div style={{ fontSize: '10px', color: mutedColor, marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>🔐</span>
            <span>Email restricted to handshake-verified addresses (identity bound)</span>
          </div>
        </div>
      )
    }
    
    // PUBLIC mode: Freeform email field
    return (
      <div>
        <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block', color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          To (Delivery Hint Only)
        </label>
        <input
          type="email"
          value={emailTo}
          onChange={(e) => onEmailToChange(e.target.value)}
          placeholder="recipient@example.com (optional)"
          className="beap-input"
          style={{
            width: '100%',
            background: bgColor,
            border: `1px solid ${borderColor}`,
            color: textColor,
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '13px',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ 
          fontSize: '10px', 
          color: mutedColor, 
          marginTop: '6px',
          padding: '8px 10px',
          background: isProfessional ? 'rgba(34,197,94,0.05)' : 'rgba(34,197,94,0.1)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span>🌐</span>
          <span>Public mode: Email is for delivery only — no identity binding. Package is fully auditable.</span>
        </div>
      </div>
    )
  }

  // ==========================================================================
  // MESSENGER DELIVERY
  // ==========================================================================
  if (deliveryMethod === 'messenger') {
    return (
      <div style={{
        padding: '14px',
        background: isProfessional 
          ? (recipientMode === 'private' ? 'rgba(139,92,246,0.06)' : 'rgba(34,197,94,0.06)')
          : (recipientMode === 'private' ? 'rgba(139,92,246,0.12)' : 'rgba(34,197,94,0.12)'),
        borderRadius: '8px',
        border: `1px solid ${isProfessional 
          ? (recipientMode === 'private' ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.15)')
          : (recipientMode === 'private' ? 'rgba(139,92,246,0.25)' : 'rgba(34,197,94,0.25)')}`
      }}>
        <div style={{ 
          fontSize: '10px', 
          fontWeight: 600, 
          textTransform: 'uppercase', 
          letterSpacing: '0.5px', 
          color: isProfessional 
            ? (recipientMode === 'private' ? '#7c3aed' : '#15803d')
            : (recipientMode === 'private' ? '#c4b5fd' : '#86efac'),
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span>{recipientMode === 'private' ? '🔐' : '🌐'}</span>
          <span>{recipientMode === 'private' ? 'Private Distribution' : 'Public Distribution'}</span>
        </div>
        
        {recipientMode === 'private' ? (
          selectedRecipient ? (
            <>
              <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
                Recipient: {selectedRecipient.receiver_organization || selectedRecipient.receiver_display_name}
              </div>
              <div style={{ fontSize: '12px', color: mutedColor, fontFamily: 'monospace' }}>
                Fingerprint: {selectedRecipient.receiver_fingerprint_short}
              </div>
            </>
          ) : (
            <div style={{ fontSize: '12px', color: isProfessional ? '#92400e' : '#fcd34d' }}>
              ⚠️ Select a handshake recipient to configure messenger delivery.
            </div>
          )
        ) : (
          <>
            <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
              Public distribution (pBEAP)
            </div>
            <div style={{ fontSize: '12px', color: mutedColor }}>
              Package will be fully auditable with no recipient binding.
            </div>
          </>
        )}
        
        <div style={{ 
          marginTop: '12px', 
          paddingTop: '10px', 
          borderTop: `1px solid ${borderColor}`,
          fontSize: '11px',
          color: mutedColor
        }}>
          💬 Payload will be copied to clipboard for pasting into any messenger platform.
        </div>
      </div>
    )
  }

  // ==========================================================================
  // DOWNLOAD DELIVERY
  // ==========================================================================
  if (deliveryMethod === 'download') {
    const filename = getFilenamePreview()
    
    return (
      <div style={{
        padding: '14px',
        background: isProfessional 
          ? (recipientMode === 'private' ? 'rgba(139,92,246,0.06)' : 'rgba(34,197,94,0.06)')
          : (recipientMode === 'private' ? 'rgba(139,92,246,0.12)' : 'rgba(34,197,94,0.12)'),
        borderRadius: '8px',
        border: `1px solid ${isProfessional 
          ? (recipientMode === 'private' ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.15)')
          : (recipientMode === 'private' ? 'rgba(139,92,246,0.25)' : 'rgba(34,197,94,0.25)')}`
      }}>
        <div style={{ 
          fontSize: '10px', 
          fontWeight: 600, 
          textTransform: 'uppercase', 
          letterSpacing: '0.5px', 
          color: isProfessional 
            ? (recipientMode === 'private' ? '#7c3aed' : '#15803d')
            : (recipientMode === 'private' ? '#c4b5fd' : '#86efac'),
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span>{recipientMode === 'private' ? '🔐' : '🌐'}</span>
          <span>{recipientMode === 'private' ? 'Private Package' : 'Public Package'}</span>
        </div>
        
        {recipientMode === 'private' && !selectedRecipient && (
          <div style={{ fontSize: '12px', color: isProfessional ? '#92400e' : '#fcd34d', marginBottom: '10px' }}>
            ⚠️ Select a handshake recipient to generate the package.
          </div>
        )}
        
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px',
          padding: '10px 12px',
          background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
          borderRadius: '6px'
        }}>
          <span style={{ fontSize: '24px' }}>📦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: mutedColor, marginBottom: '2px' }}>
              Filename Preview
            </div>
            <code style={{ 
              fontSize: '12px', 
              fontFamily: 'monospace', 
              color: isProfessional ? '#1e40af' : '#bfdbfe',
              wordBreak: 'break-all'
            }}>
              {filename}
            </code>
          </div>
        </div>
        
        {recipientMode === 'private' && selectedRecipient && (
          <div style={{ fontSize: '11px', color: mutedColor, marginTop: '10px' }}>
            Package encrypted for: <strong>{selectedRecipient.receiver_display_name}</strong>
          </div>
        )}
        
        <div style={{ 
          marginTop: '12px', 
          paddingTop: '10px', 
          borderTop: `1px solid ${borderColor}`,
          fontSize: '11px',
          color: mutedColor
        }}>
          💾 Package will be downloaded for USB/wallet/manual transfer.
        </div>
      </div>
    )
  }

  return null
}

export default DeliveryMethodPanel

