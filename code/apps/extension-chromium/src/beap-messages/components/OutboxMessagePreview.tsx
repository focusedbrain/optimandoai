/**
 * OutboxMessagePreview
 * 
 * Enhanced preview panel for Outbox messages with delivery-specific actions:
 * - Email: Retry (if failed)
 * - Messenger: Copy payload, Mark as sent
 * - Download: Download again, Mark as delivered
 * - Chat: Open only
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import type { BeapMessageUI } from '../types'
import { STATUS_CONFIG, DELIVERY_METHOD_CONFIG } from '../types'

interface OutboxMessagePreviewProps {
  message: BeapMessageUI | null
  theme: 'default' | 'dark' | 'professional'
  
  // Actions
  onRetry?: (id: string) => Promise<void>
  onCopyPayload?: (id: string) => Promise<boolean>
  onMarkSent?: (id: string) => void
  onDownloadAgain?: (id: string) => void
  onMarkDelivered?: (id: string) => void
  onOpen?: (id: string) => void
  onArchive?: (id: string) => void
}

export const OutboxMessagePreview: React.FC<OutboxMessagePreviewProps> = ({
  message,
  theme,
  onRetry,
  onCopyPayload,
  onMarkSent,
  onDownloadAgain,
  onMarkDelivered,
  onOpen,
  onArchive
}) => {
  const [isCopying, setIsCopying] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.04)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  
  if (!message) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bgColor,
        color: mutedColor,
        fontSize: '14px',
        padding: '20px',
        textAlign: 'center'
      }}>
        Select a message to view its details.
      </div>
    )
  }
  
  const statusConfig = STATUS_CONFIG[message.status] || { label: message.status, color: mutedColor, bgColor: 'transparent' }
  const deliveryConfig = DELIVERY_METHOD_CONFIG[message.deliveryMethod] || DELIVERY_METHOD_CONFIG.unknown
  
  // =========================================================================
  // Handlers
  // =========================================================================
  
  const handleCopy = async () => {
    if (!onCopyPayload) return
    
    setIsCopying(true)
    setCopySuccess(false)
    
    try {
      const success = await onCopyPayload(message.id)
      if (success) {
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 2000)
      }
    } finally {
      setIsCopying(false)
    }
  }
  
  const handleRetry = async () => {
    if (!onRetry) return
    
    setIsRetrying(true)
    try {
      await onRetry(message.id)
    } finally {
      setIsRetrying(false)
    }
  }
  
  // =========================================================================
  // Render
  // =========================================================================
  
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: bgColor,
      overflowY: 'auto'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: `1px solid ${borderColor}`,
        background: cardBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>{deliveryConfig.icon}</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: textColor }}>
              {message.title || '(No subject)'}
            </h3>
            <span style={{ fontSize: '12px', color: mutedColor }}>
              {deliveryConfig.label} • {new Date(message.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
        
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: '6px',
          color: statusConfig.color,
          background: statusConfig.bgColor
        }}>
          {statusConfig.label}
        </span>
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
        {/* Metadata */}
        <div style={{
          background: cardBg,
          padding: '14px',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: textColor }}>
            Delivery Details
          </h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '6px 12px',
            fontSize: '13px'
          }}>
            <span style={{ color: mutedColor }}>Method:</span>
            <span style={{ color: textColor }}>{deliveryConfig.icon} {deliveryConfig.label}</span>
            
            <span style={{ color: mutedColor }}>Status:</span>
            <span style={{ color: statusConfig.color }}>{statusConfig.label}</span>
            
            {message.deliveryError && (
              <>
                <span style={{ color: mutedColor }}>Error:</span>
                <span style={{ color: '#ef4444' }}>{message.deliveryError}</span>
              </>
            )}
            
            <span style={{ color: mutedColor }}>Package ID:</span>
            <span style={{ fontFamily: 'monospace', color: textColor, fontSize: '11px' }}>
              {message.packageId || 'N/A'}
            </span>
            
            <span style={{ color: mutedColor }}>Envelope:</span>
            <span style={{ fontFamily: 'monospace', color: textColor, fontSize: '11px' }}>
              {message.envelopeRef || 'N/A'}
            </span>
            
            <span style={{ color: mutedColor }}>Attempts:</span>
            <span style={{ color: textColor }}>
              {message.deliveryAttempts?.length || 1}
            </span>
          </div>
        </div>
        
        {/* Message Body */}
        <div style={{
          background: cardBg,
          padding: '14px',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: textColor }}>
            Message Content
          </h4>
          <div style={{
            fontSize: '13px',
            color: textColor,
            lineHeight: '1.5',
            whiteSpace: 'pre-wrap'
          }}>
            {message.bodyText || '(Empty message)'}
          </div>
        </div>
        
        {/* Attachments */}
        {message.attachments.length > 0 && (
          <div style={{
            background: cardBg,
            padding: '14px',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: textColor }}>
              Attachments ({message.attachments.length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {message.attachments.map((att, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px',
                  background: isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.03)',
                  borderRadius: '4px'
                }}>
                  <span style={{ fontSize: '13px', color: textColor }}>📎 {att.name}</span>
                  {att.size && (
                    <span style={{ fontSize: '11px', color: mutedColor }}>
                      {(att.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Messenger Payload (if applicable) */}
        {message.deliveryMethod === 'messenger' && message.messengerPayload && (
          <div style={{
            background: isProfessional ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)',
            padding: '14px',
            borderRadius: '8px',
            marginBottom: '16px',
            border: `1px solid ${isProfessional ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.25)'}`
          }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: '#3b82f6' }}>
              📋 Messenger Payload
            </h4>
            <pre style={{
              margin: 0,
              fontSize: '11px',
              color: textColor,
              background: isProfessional ? '#f1f5f9' : 'rgba(0,0,0,0.2)',
              padding: '10px',
              borderRadius: '6px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '150px',
              overflowY: 'auto'
            }}>
              {message.messengerPayload}
            </pre>
          </div>
        )}
        
        {/* Delivery Attempts Log */}
        {message.deliveryAttempts && message.deliveryAttempts.length > 0 && (
          <div style={{
            background: cardBg,
            padding: '14px',
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: textColor }}>
              Delivery History
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {message.deliveryAttempts.map((attempt, idx) => {
                const attemptStatus = STATUS_CONFIG[attempt.status as keyof typeof STATUS_CONFIG] 
                  || { label: attempt.status, color: mutedColor }
                
                return (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    background: isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.03)',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}>
                    <span style={{ color: attemptStatus.color }}>{attemptStatus.label}</span>
                    <span style={{ color: mutedColor }}>
                      {new Date(attempt.at).toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      
      {/* Action Buttons */}
      <div style={{
        padding: '14px 16px',
        borderTop: `1px solid ${borderColor}`,
        background: isProfessional ? '#f1f5f9' : 'rgba(0,0,0,0.15)',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
        flexWrap: 'wrap'
      }}>
        {/* Email Actions */}
        {message.deliveryMethod === 'email' && message.status === 'failed' && (
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 500,
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              border: 'none',
              color: 'white',
              borderRadius: '6px',
              cursor: isRetrying ? 'wait' : 'pointer',
              opacity: isRetrying ? 0.7 : 1
            }}
          >
            {isRetrying ? 'Retrying...' : '↻ Retry'}
          </button>
        )}
        
        {/* Messenger Actions */}
        {message.deliveryMethod === 'messenger' && (
          <>
            <button
              onClick={handleCopy}
              disabled={isCopying}
              style={{
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 500,
                background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.12)',
                border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.2)'}`,
                color: copySuccess ? '#22c55e' : textColor,
                borderRadius: '6px',
                cursor: isCopying ? 'wait' : 'pointer',
                opacity: isCopying ? 0.7 : 1
              }}
            >
              {copySuccess ? '✓ Copied!' : isCopying ? 'Copying...' : '📋 Copy Payload'}
            </button>
            
            {message.status === 'pending_user_action' && onMarkSent && (
              <button
                onClick={() => onMarkSent(message.id)}
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  border: 'none',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                ✓ Mark as Sent
              </button>
            )}
          </>
        )}
        
        {/* Download Actions */}
        {message.deliveryMethod === 'download' && (
          <>
            {message.downloadRef && onDownloadAgain && (
              <button
                onClick={() => onDownloadAgain(message.id)}
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.12)',
                  border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.2)'}`,
                  color: textColor,
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                💾 Download Again
              </button>
            )}
            
            {message.status === 'pending_user_action' && onMarkDelivered && (
              <button
                onClick={() => onMarkDelivered(message.id)}
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  border: 'none',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                ✓ Mark as Delivered
              </button>
            )}
          </>
        )}
        
        {/* Archive (for sent messages) */}
        {['sent', 'sent_manual', 'sent_chat'].includes(message.status) && onArchive && (
          <button
            onClick={() => onArchive(message.id)}
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 500,
              background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.12)',
              border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.2)'}`,
              color: textColor,
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            📁 Archive
          </button>
        )}
        
        {/* Open (always available) */}
        {onOpen && (
          <button
            onClick={() => onOpen(message.id)}
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 500,
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              border: 'none',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Open
          </button>
        )}
      </div>
    </div>
  )
}

