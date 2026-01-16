/**
 * RejectedMessagePreview
 * 
 * Preview panel for Rejected messages.
 * Shows rejection reason, envelope summary (read-only), but NO capsule content.
 * 
 * @version 1.0.0
 */

import React from 'react'
import type { BeapMessageUI } from '../types'
import { DELIVERY_METHOD_CONFIG } from '../types'

interface RejectedMessagePreviewProps {
  message: BeapMessageUI | null
  theme: 'default' | 'dark' | 'professional'
}

/**
 * Get rejection code display config
 */
function getRejectionCodeConfig(code: string): { icon: string; label: string; color: string } {
  const configs: Record<string, { icon: string; label: string; color: string }> = {
    envelope_missing: { icon: '📭', label: 'Envelope Missing', color: '#ef4444' },
    envelope_hash_missing: { icon: '🔗', label: 'Hash Missing', color: '#ef4444' },
    envelope_hash_invalid: { icon: '🔓', label: 'Hash Invalid', color: '#ef4444' },
    signature_invalid: { icon: '✗', label: 'Signature Invalid', color: '#ef4444' },
    signature_missing: { icon: '📝', label: 'Signature Missing', color: '#ef4444' },
    ingress_missing: { icon: '📥', label: 'Ingress Missing', color: '#f59e0b' },
    egress_missing: { icon: '📤', label: 'Egress Missing', color: '#f59e0b' },
    provider_not_configured: { icon: '📧', label: 'Provider Not Configured', color: '#f59e0b' },
    egress_not_allowed_by_wrguard: { icon: '🛡️', label: 'Egress Not Allowed', color: '#f59e0b' },
    ingress_not_allowed_by_wrguard: { icon: '🚫', label: 'Ingress Not Allowed', color: '#f59e0b' },
    envelope_expired: { icon: '⏰', label: 'Envelope Expired', color: '#f59e0b' },
    handshake_not_found: { icon: '🤝', label: 'Handshake Not Found', color: '#f59e0b' },
    evaluation_error: { icon: '⚠️', label: 'Evaluation Error', color: '#ef4444' }
  }
  
  return configs[code] || { icon: '❓', label: code, color: '#ef4444' }
}

/**
 * Get failed step display
 */
function getFailedStepDisplay(step?: string): { label: string; step: number } {
  const steps: Record<string, { label: string; step: number }> = {
    envelope_verification: { label: 'Envelope Verification', step: 1 },
    boundary_check: { label: 'Boundary Check', step: 2 },
    wrguard_intersection: { label: 'WRGuard Intersection', step: 3 }
  }
  
  return steps[step || ''] || { label: 'Unknown Step', step: 0 }
}

export const RejectedMessagePreview: React.FC<RejectedMessagePreviewProps> = ({
  message,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  const errorColor = '#ef4444'
  
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
        <span style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>🚫</span>
        <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>
          Select a message
        </div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          Choose a rejected message to view details
        </div>
      </div>
    )
  }
  
  const deliveryConfig = DELIVERY_METHOD_CONFIG[message.deliveryMethod]
  const rejectionReason = message.rejectionReasonData
  const rejectionCodeConfig = rejectionReason 
    ? getRejectionCodeConfig(rejectionReason.code) 
    : { icon: '❓', label: 'Unknown', color: errorColor }
  const failedStep = rejectionReason 
    ? getFailedStepDisplay(rejectionReason.failedStep) 
    : { label: 'Unknown', step: 0 }
  
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
        {/* Status badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '4px',
            color: errorColor,
            background: 'rgba(239,68,68,0.15)'
          }}>
            🚫 Rejected
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
          <span>Fingerprint: <code style={{ fontSize: '10px', opacity: 0.8 }}>{message.fingerprint}</code></span>
          <span>{new Date(message.timestamp).toLocaleString()}</span>
        </div>
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* Rejection Reason - Primary Focus */}
        <div style={{
          padding: '18px 20px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: '10px',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'rgba(239,68,68,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              flexShrink: 0
            }}>
              {rejectionCodeConfig.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '14px',
                fontWeight: 600,
                color: errorColor,
                marginBottom: '6px'
              }}>
                {rejectionCodeConfig.label}
              </div>
              <div style={{
                fontSize: '13px',
                color: textColor,
                lineHeight: 1.5,
                marginBottom: '10px'
              }}>
                {rejectionReason?.humanSummary || message.rejectReason || 'No reason provided'}
              </div>
              {rejectionReason?.details && (
                <div style={{
                  fontSize: '11px',
                  color: mutedColor,
                  padding: '10px 12px',
                  background: isProfessional ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  marginTop: '8px'
                }}>
                  <strong>Details:</strong> {rejectionReason.details}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Failed Step Indicator */}
        {rejectionReason && (
          <div style={{
            padding: '14px 16px',
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
              📊 Evaluation Progress
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { step: 1, label: 'Envelope' },
                { step: 2, label: 'Boundaries' },
                { step: 3, label: 'WRGuard' }
              ].map((s) => {
                const isCompleted = s.step < failedStep.step
                const isFailed = s.step === failedStep.step
                const isPending = s.step > failedStep.step
                
                return (
                  <div
                    key={s.step}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '6px',
                      textAlign: 'center',
                      background: isCompleted
                        ? 'rgba(34,197,94,0.1)'
                        : isFailed
                        ? 'rgba(239,68,68,0.1)'
                        : isProfessional
                        ? 'rgba(15,23,42,0.04)'
                        : 'rgba(255,255,255,0.05)',
                      border: isFailed
                        ? '1px solid rgba(239,68,68,0.3)'
                        : '1px solid transparent'
                    }}
                  >
                    <div style={{
                      fontSize: '16px',
                      marginBottom: '4px'
                    }}>
                      {isCompleted ? '✓' : isFailed ? '✗' : '○'}
                    </div>
                    <div style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      color: isCompleted
                        ? '#22c55e'
                        : isFailed
                        ? errorColor
                        : mutedColor
                    }}>
                      {s.label}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        
        {/* Envelope Summary (read-only) */}
        {message.envelopeSummary && (
          <div style={{
            padding: '14px 16px',
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
              📋 Envelope Summary (Read-only)
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
                <span style={{
                  color: message.envelopeSummary.signatureStatusDisplay.includes('✓')
                    ? '#22c55e'
                    : message.envelopeSummary.signatureStatusDisplay.includes('✗')
                    ? errorColor
                    : mutedColor
                }}>
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
        
        {/* Rejection Timestamp */}
        {rejectionReason?.timestamp && (
          <div style={{
            fontSize: '11px',
            color: mutedColor,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span>Rejected at:</span>
            <span style={{ color: textColor }}>
              {new Date(rejectionReason.timestamp).toLocaleString()}
            </span>
          </div>
        )}
        
        {/* No Capsule Content Notice */}
        <div style={{
          marginTop: '20px',
          padding: '12px 14px',
          background: isProfessional ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.05)',
          borderRadius: '8px',
          fontSize: '11px',
          color: mutedColor,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px'
        }}>
          <span style={{ fontSize: '14px' }}>🔒</span>
          <span>
            Capsule content is not displayed for rejected messages.
            No decryption, parsing, or rendering is performed on rejected packages.
          </span>
        </div>
      </div>
    </div>
  )
}

