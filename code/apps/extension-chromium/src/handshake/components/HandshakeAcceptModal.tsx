/**
 * HandshakeAcceptModal Component
 * 
 * Modal for accepting an incoming handshake request:
 * - Shows sender info
 * - Displays fingerprint prominently
 * - Optional fingerprint comparison
 * - Automation mode selection (default: Review)
 * - Accept/Reject actions
 */

import React, { useState } from 'react'
import type { HandshakeAcceptRequest, AutomationMode } from '../types'
import { formatFingerprintGrouped, compareFingerprints } from '../fingerprint'
import { 
  AUTOMATION_LABELS, 
  AUTOMATION_DESCRIPTIONS,
  TOOLTIPS,
  POLICY_NOTES,
  ACTION_LABELS,
  STATUS_MESSAGES,
} from '../microcopy'

interface HandshakeAcceptModalProps {
  request: HandshakeAcceptRequest
  theme?: 'default' | 'dark' | 'professional'
  onAccept?: (automationMode: AutomationMode) => void
  onReject?: () => void
  onClose?: () => void
}

export const HandshakeAcceptModal: React.FC<HandshakeAcceptModalProps> = ({
  request,
  theme = 'default',
  onAccept,
  onReject,
  onClose,
}) => {
  const [automationMode, setAutomationMode] = useState<AutomationMode>('REVIEW')
  const [expectedFingerprint, setExpectedFingerprint] = useState(request.expected_fingerprint || '')
  const [showCompare, setShowCompare] = useState(false)
  
  const isProfessional = theme === 'professional'
  
  // Check fingerprint match
  const fingerprintsMatch = expectedFingerprint 
    ? compareFingerprints(request.received_fingerprint, expectedFingerprint)
    : null
  
  // Styles
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px',
  }
  
  const modalStyle: React.CSSProperties = {
    background: isProfessional ? '#ffffff' : 'rgba(30, 30, 40, 0.98)',
    borderRadius: '16px',
    border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    maxWidth: '480px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  }
  
  const headerStyle: React.CSSProperties = {
    padding: '20px 24px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  }
  
  const sectionStyle: React.CSSProperties = {
    padding: '20px 24px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'}`,
  }
  
  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '10px',
  }
  
  const fingerprintStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '13px',
    color: isProfessional ? '#1f2937' : 'white',
    background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
    padding: '14px 16px',
    borderRadius: '10px',
    wordBreak: 'break-all',
    lineHeight: 1.6,
    border: `2px solid ${isProfessional ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.3)'}`,
  }
  
  const buttonStyle: React.CSSProperties = {
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.15s ease',
  }
  
  const automationButtonStyle = (mode: AutomationMode, isActive: boolean): React.CSSProperties => {
    const colors = {
      DENY: { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)', text: '#ef4444' },
      REVIEW: { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', text: '#f59e0b' },
      ALLOW: { bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.3)', text: '#22c55e' },
    }
    const c = colors[mode]
    
    return {
      flex: 1,
      padding: '10px 12px',
      borderRadius: '8px',
      fontSize: '12px',
      cursor: 'pointer',
      background: isActive ? c.bg : 'transparent',
      border: `1px solid ${isActive ? c.border : (isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)')}`,
      color: isActive ? c.text : (isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)'),
      fontWeight: isActive ? 600 : 400,
      transition: 'all 0.15s ease',
    }
  }
  
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontSize: '28px' }}>🤝</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
              Incoming Handshake Request
            </div>
            <div style={{ fontSize: '12px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
              from {request.sender_name}
              {request.sender_organization && ` · ${request.sender_organization}`}
            </div>
          </div>
        </div>
        
        {/* Sender Info */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Sender</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
            {request.sender_name}
          </div>
          {request.sender_email && (
            <div style={{ fontSize: '13px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
              {request.sender_email}
            </div>
          )}
          {request.sender_organization && (
            <div style={{ fontSize: '12px', color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
              {request.sender_organization}
            </div>
          )}
        </div>
        
        {/* Fingerprint - PROMINENT */}
        <div style={sectionStyle}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{TOOLTIPS.FINGERPRINT_TITLE}</span>
            <span 
              style={{ cursor: 'help', fontSize: '12px', fontWeight: 400 }}
              title={TOOLTIPS.FINGERPRINT}
            >
              ⓘ
            </span>
          </div>
          
          <div style={fingerprintStyle}>
            {formatFingerprintGrouped(request.received_fingerprint)}
          </div>
          
          {/* Compare Fingerprints */}
          <button
            onClick={() => setShowCompare(!showCompare)}
            style={{
              marginTop: '12px',
              padding: '6px 12px',
              background: 'transparent',
              border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '6px',
              fontSize: '11px',
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
            }}
          >
            {showCompare ? '▼' : '▶'} {TOOLTIPS.COMPARE_FINGERPRINTS}
          </button>
          
          {showCompare && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '11px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>
                Paste expected fingerprint to compare:
              </div>
              <input
                type="text"
                value={expectedFingerprint}
                onChange={(e) => setExpectedFingerprint(e.target.value.toUpperCase().replace(/[^0-9A-F]/gi, ''))}
                placeholder="Paste fingerprint here..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  background: isProfessional ? 'white' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: '8px',
                  color: isProfessional ? '#1f2937' : 'white',
                  boxSizing: 'border-box',
                }}
              />
              
              {expectedFingerprint && (
                <div style={{
                  marginTop: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: fingerprintsMatch 
                    ? 'rgba(34, 197, 94, 0.1)' 
                    : 'rgba(239, 68, 68, 0.1)',
                  color: fingerprintsMatch ? '#22c55e' : '#ef4444',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span>{fingerprintsMatch ? '✓' : '✗'}</span>
                  <span>
                    {fingerprintsMatch ? STATUS_MESSAGES.FINGERPRINTS_MATCH : STATUS_MESSAGES.FINGERPRINTS_MISMATCH}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Automation Mode */}
        <div style={sectionStyle}>
          <div style={labelStyle}>
            Automation Mode
            <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: '4px' }}>
              (attack surface)
            </span>
          </div>
          
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['DENY', 'REVIEW', 'ALLOW'] as AutomationMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setAutomationMode(mode)}
                style={automationButtonStyle(mode, automationMode === mode)}
                title={AUTOMATION_DESCRIPTIONS[mode]}
              >
                {AUTOMATION_LABELS[mode]}
              </button>
            ))}
          </div>
          
          <div style={{ 
            marginTop: '10px', 
            fontSize: '11px', 
            color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)',
            lineHeight: 1.5,
          }}>
            {AUTOMATION_DESCRIPTIONS[automationMode]}
          </div>
        </div>
        
        {/* Policy Note */}
        <div style={{ 
          padding: '14px 24px',
          background: isProfessional ? 'rgba(139, 92, 246, 0.05)' : 'rgba(139, 92, 246, 0.1)',
          fontSize: '11px',
          color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>ℹ️</span>
          <span>{POLICY_NOTES.LOCAL_OVERRIDE}</span>
        </div>
        
        {/* Actions */}
        <div style={{ 
          padding: '20px 24px',
          display: 'flex',
          gap: '12px',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onReject}
            style={{
              ...buttonStyle,
              background: 'transparent',
              border: `1px solid ${isProfessional ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: '#ef4444',
            }}
          >
            {ACTION_LABELS.REJECT_HANDSHAKE}
          </button>
          <button
            onClick={() => onAccept?.(automationMode)}
            style={{
              ...buttonStyle,
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: 'white',
            }}
          >
            ✓ {ACTION_LABELS.ACCEPT_HANDSHAKE}
          </button>
        </div>
      </div>
    </div>
  )
}

export default HandshakeAcceptModal


