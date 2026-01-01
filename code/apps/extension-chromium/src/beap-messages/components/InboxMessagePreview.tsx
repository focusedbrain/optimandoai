/**
 * InboxMessagePreview
 * 
 * Preview panel for Inbox messages with verification actions.
 * Shows Verify button for pending messages, Open button for accepted.
 * 
 * @version 1.0.0
 */

import React, { useState, useEffect } from 'react'
import type { BeapMessageUI } from '../types'
import { STATUS_CONFIG, DELIVERY_METHOD_CONFIG } from '../types'
import { SafePreviewPanel } from '../../reconstruction'
import { AuditTrailPanel, ArchiveButton } from '../../audit'

interface InboxMessagePreviewProps {
  message: BeapMessageUI | null
  theme: 'default' | 'dark' | 'professional'
  onVerify?: (id: string) => Promise<void>
  onOpen?: (id: string) => void
}

export const InboxMessagePreview: React.FC<InboxMessagePreviewProps> = ({
  message,
  theme,
  onVerify,
  onOpen
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  
  const [isVerifying, setIsVerifying] = useState(false)
  const [isOpenView, setIsOpenView] = useState(false)
  const [activeTab, setActiveTab] = useState<'content' | 'audit'>('content')
  
  // Reset views when message changes
  useEffect(() => {
    setIsOpenView(false)
    setActiveTab('content')
  }, [message?.id])
  
  // Empty state
  if (!message) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        textAlign: 'center',
        color: mutedColor
      }}>
        <span style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📥</span>
        <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>
          Select a message
        </div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          Choose a message from the list to preview
        </div>
      </div>
    )
  }
  
  const statusConfig = STATUS_CONFIG[message.status]
  const deliveryConfig = DELIVERY_METHOD_CONFIG[message.deliveryMethod]
  const isPendingVerification = message.verificationStatus === 'pending_verification'
  const isVerificationInProgress = message.verificationStatus === 'verifying'
  const isAccepted = message.verificationStatus === 'accepted'
  
  const handleVerify = async () => {
    if (!onVerify || isVerifying) return
    setIsVerifying(true)
    try {
      await onVerify(message.id)
    } finally {
      setIsVerifying(false)
    }
  }
  
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: `1px solid ${borderColor}`,
        background: cardBg
      }}>
        {/* Status + Method badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '4px',
            color: statusConfig.color,
            background: statusConfig.bgColor
          }}>
            {statusConfig.label}
          </span>
          <span style={{
            fontSize: '10px',
            fontWeight: 500,
            padding: '3px 8px',
            borderRadius: '4px',
            color: mutedColor,
            background: isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)'
          }}>
            {deliveryConfig.icon} {deliveryConfig.label}
          </span>
          {message.hardwareAttestation === 'verified' && (
            <span style={{
              fontSize: '10px',
              fontWeight: 500,
              padding: '3px 8px',
              borderRadius: '4px',
              color: '#22c55e',
              background: 'rgba(34,197,94,0.15)'
            }}>
              🔐 HW Verified
            </span>
          )}
        </div>
        
        {/* Title */}
        <h3 style={{
          margin: '0 0 8px 0',
          fontSize: '16px',
          fontWeight: 600,
          color: textColor
        }}>
          {message.title}
        </h3>
        
        {/* Metadata */}
        <div style={{ fontSize: '11px', color: mutedColor, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {message.senderName && (
            <span>From: <strong style={{ color: textColor }}>{message.senderName}</strong></span>
          )}
          <span>Fingerprint: <code style={{ fontSize: '10px', opacity: 0.8 }}>{message.fingerprint}</code></span>
          <span>{new Date(message.timestamp).toLocaleString()}</span>
        </div>
      </div>
      
      {/* Tab Bar (for accepted messages) */}
      {isAccepted && (
        <div style={{
          display: 'flex',
          gap: '0',
          borderBottom: `1px solid ${borderColor}`,
          background: cardBg
        }}>
          <button
            onClick={() => { setActiveTab('content'); setIsOpenView(false); }}
            style={{
              padding: '10px 20px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'content' ? '2px solid #a855f7' : '2px solid transparent',
              color: activeTab === 'content' ? textColor : mutedColor,
              cursor: 'pointer'
            }}
          >
            📄 Content
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            style={{
              padding: '10px 20px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'audit' ? '2px solid #a855f7' : '2px solid transparent',
              color: activeTab === 'audit' ? textColor : mutedColor,
              cursor: 'pointer'
            }}
          >
            📋 Audit Trail
          </button>
        </div>
      )}
      
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* Audit Trail Tab */}
        {isAccepted && activeTab === 'audit' && (
          <AuditTrailPanel
            messageId={message.id}
            theme={theme}
            canExportProof={true}
          />
        )}
        
        {/* Content Tab - Safe Preview Panel (for accepted + opened) */}
        {isAccepted && activeTab === 'content' && isOpenView && (
          <SafePreviewPanel
            message={message}
            theme={theme}
          />
        )}
        
        {/* Content Tab - Standard view (not open view) */}
        {(activeTab !== 'audit') && (!isOpenView || !isAccepted) && (
          <>
        {/* Verification Notice (for pending) */}
        {(isPendingVerification || isVerificationInProgress) && (
          <div style={{
            padding: '14px 16px',
            background: isProfessional ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
          }}>
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
                {isVerificationInProgress ? 'Verifying...' : 'Verification Required'}
              </div>
              <div style={{ fontSize: '12px', color: mutedColor }}>
                {isVerificationInProgress
                  ? 'Checking envelope integrity, boundaries, and WRGuard policies...'
                  : 'This message has not been verified. Verify the envelope before viewing content.'}
              </div>
            </div>
          </div>
        )}
        
        {/* Envelope Summary (for accepted) */}
        {isAccepted && message.envelopeSummary && (
          <div style={{
            padding: '14px 16px',
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
              📋 Envelope Summary
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '10px',
              fontSize: '11px'
            }}>
              <div>
                <span style={{ color: mutedColor }}>Envelope ID:</span>{' '}
                <code style={{ color: textColor }}>{message.envelopeSummary.envelopeIdShort}</code>
              </div>
              <div>
                <span style={{ color: mutedColor }}>Channel:</span>{' '}
                <span style={{ color: textColor }}>{message.envelopeSummary.channelDisplay}</span>
              </div>
              <div>
                <span style={{ color: mutedColor }}>Sender:</span>{' '}
                <code style={{ color: textColor }}>{message.envelopeSummary.senderFingerprintDisplay}</code>
              </div>
              <div>
                <span style={{ color: mutedColor }}>Signature:</span>{' '}
                <span style={{ color: message.envelopeSummary.signatureStatusDisplay.includes('✓') ? '#22c55e' : '#ef4444' }}>
                  {message.envelopeSummary.signatureStatusDisplay}
                </span>
              </div>
              <div>
                <span style={{ color: mutedColor }}>Ingress:</span>{' '}
                <span style={{ color: textColor }}>{message.envelopeSummary.ingressSummary}</span>
              </div>
              <div>
                <span style={{ color: mutedColor }}>Egress:</span>{' '}
                <span style={{ color: textColor }}>{message.envelopeSummary.egressSummary}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Capsule Metadata (for accepted) */}
        {isAccepted && message.capsuleMetadata && (
          <div style={{
            padding: '14px 16px',
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
              📦 Capsule Metadata
            </div>
            <div style={{ fontSize: '12px', color: mutedColor }}>
              <div style={{ marginBottom: '6px' }}>
                <span style={{ fontWeight: 500 }}>Title:</span>{' '}
                <span style={{ color: textColor }}>{message.capsuleMetadata.title}</span>
              </div>
              {message.capsuleMetadata.attachmentCount > 0 && (
                <div style={{ marginBottom: '6px' }}>
                  <span style={{ fontWeight: 500 }}>Attachments ({message.capsuleMetadata.attachmentCount}):</span>{' '}
                  <span style={{ color: textColor }}>
                    {message.capsuleMetadata.attachmentNames.join(', ')}
                  </span>
                </div>
              )}
              {message.capsuleMetadata.sessionRefCount > 0 && (
                <div style={{ marginBottom: '6px' }}>
                  <span style={{ fontWeight: 500 }}>Session Refs:</span>{' '}
                  <span style={{ color: textColor }}>{message.capsuleMetadata.sessionRefCount}</span>
                </div>
              )}
              {message.capsuleMetadata.hasDataRequest && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  background: 'rgba(139,92,246,0.1)',
                  borderRadius: '4px',
                  fontSize: '10px',
                  color: '#8b5cf6',
                  fontWeight: 500
                }}>
                  ⚡ Contains Data Request
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Attachments (always visible) */}
        {message.attachments.length > 0 && (
          <div style={{
            padding: '14px 16px',
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '10px' }}>
              📎 Attachments ({message.attachments.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {message.attachments.map((att, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  background: isProfessional ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)',
                  borderRadius: '6px',
                  fontSize: '12px'
                }}>
                  <span>📄</span>
                  <span style={{ flex: 1, color: textColor }}>{att.name}</span>
                  {att.size && (
                    <span style={{ color: mutedColor, fontSize: '10px' }}>
                      {(att.size / 1024).toFixed(0)} KB
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Notice for non-accepted messages */}
        {!isAccepted && (
          <div style={{
            padding: '12px 14px',
            background: isProfessional ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)',
            borderRadius: '8px',
            fontSize: '11px',
            color: mutedColor,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}>
            <span style={{ fontSize: '14px' }}>ℹ️</span>
            <span>
              Message content and attachments are encrypted and cannot be displayed until the envelope is verified.
              No decryption, parsing, or rendering occurs before verification.
            </span>
          </div>
        )}
          </>
        )}
      </div>
      
      {/* Action Bar */}
      <div style={{
        padding: '12px 16px',
        borderTop: `1px solid ${borderColor}`,
        background: cardBg,
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px'
      }}>
        {isPendingVerification && (
          <button
            onClick={handleVerify}
            disabled={isVerifying}
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background: isVerifying
                ? mutedColor
                : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: isVerifying ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isVerifying ? '⏳ Verifying...' : '🔍 Verify'}
          </button>
        )}
        
        {isVerificationInProgress && (
          <button
            disabled
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background: mutedColor,
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'wait',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            ⏳ Verifying...
          </button>
        )}
        
        {isAccepted && !isOpenView && (
          <button
            onClick={() => {
              setIsOpenView(true)
              onOpen?.(message.id)
            }}
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📂 Open
          </button>
        )}
        
        {isAccepted && isOpenView && (
          <button
            onClick={() => setIsOpenView(false)}
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.15)',
              border: 'none',
              color: textColor,
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            ← Back to Summary
          </button>
        )}
        
        {/* Archive Button (for accepted messages) */}
        {isAccepted && (
          <ArchiveButton
            message={message}
            theme={theme}
            onArchived={() => console.log('[BEAP] Message archived')}
          />
        )}
      </div>
    </div>
  )
}

