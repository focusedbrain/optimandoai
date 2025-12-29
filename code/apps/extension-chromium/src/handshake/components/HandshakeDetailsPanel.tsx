/**
 * HandshakeDetailsPanel Component
 * 
 * Detailed view of a handshake showing:
 * - Full fingerprint (grouped, copyable)
 * - Status (Local/Verified) with verify action
 * - Automation mode selector
 * - Policy override note
 */

import React, { useState } from 'react'
import type { Handshake, AutomationMode } from '../types'
import { formatFingerprintGrouped } from '../fingerprint'
import { 
  BADGE_TEXT, 
  AUTOMATION_LABELS, 
  AUTOMATION_DESCRIPTIONS,
  TOOLTIPS,
  POLICY_NOTES,
  ACTION_LABELS,
  STATUS_MESSAGES,
} from '../microcopy'

interface HandshakeDetailsPanelProps {
  handshake: Handshake
  theme?: 'default' | 'dark' | 'professional'
  onAutomationChange?: (mode: AutomationMode) => void
  onVerify?: () => void
  onClose?: () => void
}

export const HandshakeDetailsPanel: React.FC<HandshakeDetailsPanelProps> = ({
  handshake,
  theme = 'default',
  onAutomationChange,
  onVerify,
  onClose,
}) => {
  const [copySuccess, setCopySuccess] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  
  const isProfessional = theme === 'professional'
  
  const handleCopyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(handshake.fingerprint_full)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy fingerprint:', err)
    }
  }
  
  // Styles
  const panelStyle: React.CSSProperties = {
    background: isProfessional ? '#ffffff' : 'rgba(30, 30, 40, 0.95)',
    borderRadius: '12px',
    border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    overflow: 'hidden',
  }
  
  const headerStyle: React.CSSProperties = {
    padding: '16px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  }
  
  const sectionStyle: React.CSSProperties = {
    padding: '16px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'}`,
  }
  
  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  }
  
  const fingerprintStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: isProfessional ? '#1f2937' : 'white',
    background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
    padding: '12px',
    borderRadius: '8px',
    wordBreak: 'break-all',
    lineHeight: 1.6,
    position: 'relative',
  }
  
  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: '6px',
    background: handshake.status === 'VERIFIED_WR' 
      ? (isProfessional ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.15)')
      : (isProfessional ? 'rgba(107, 114, 128, 0.1)' : 'rgba(255, 255, 255, 0.08)'),
    color: handshake.status === 'VERIFIED_WR'
      ? '#22c55e'
      : (isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)'),
    border: `1px solid ${handshake.status === 'VERIFIED_WR' ? 'rgba(34, 197, 94, 0.3)' : 'transparent'}`,
  }
  
  const buttonStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
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
      ...buttonStyle,
      flex: 1,
      background: isActive ? c.bg : 'transparent',
      border: `1px solid ${isActive ? c.border : (isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)')}`,
      color: isActive ? c.text : (isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)'),
      fontWeight: isActive ? 600 : 400,
    }
  }
  
  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
            {handshake.displayName}
          </div>
          {handshake.email && (
            <div style={{ fontSize: '12px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
              {handshake.email}
            </div>
          )}
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            style={{
              ...buttonStyle,
              background: 'transparent',
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        )}
      </div>
      
      {/* Fingerprint Section */}
      <div style={sectionStyle}>
        <div style={labelStyle}>
          <span>{TOOLTIPS.FINGERPRINT_TITLE}</span>
          <span 
            style={{ cursor: 'help', fontSize: '12px' }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            title={TOOLTIPS.FINGERPRINT}
          >
            ⓘ
          </span>
        </div>
        
        <div style={fingerprintStyle}>
          {formatFingerprintGrouped(handshake.fingerprint_full)}
        </div>
        
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
          <button
            onClick={handleCopyFingerprint}
            style={{
              ...buttonStyle,
              background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
              color: isProfessional ? '#1f2937' : 'white',
            }}
          >
            {copySuccess ? '✓ Copied' : `📋 ${ACTION_LABELS.COPY_FINGERPRINT}`}
          </button>
        </div>
        
        {/* Tooltip */}
        {showTooltip && (
          <div style={{
            marginTop: '10px',
            padding: '10px 12px',
            background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
            borderRadius: '6px',
            fontSize: '11px',
            color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)',
            lineHeight: 1.5,
          }}>
            {TOOLTIPS.FINGERPRINT}
          </div>
        )}
      </div>
      
      {/* Status Section */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Verification Status</div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={badgeStyle}>
            {handshake.status === 'VERIFIED_WR' ? '✓' : '○'}
            {handshake.status === 'VERIFIED_WR' ? BADGE_TEXT.VERIFIED : BADGE_TEXT.LOCAL}
          </span>
          
          {handshake.status === 'VERIFIED_WR' && handshake.verified_at && (
            <span style={{ fontSize: '11px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)' }}>
              {new Date(handshake.verified_at).toLocaleDateString()}
            </span>
          )}
          
          {handshake.status === 'LOCAL' && onVerify && (
            <button
              onClick={onVerify}
              style={{
                ...buttonStyle,
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                color: 'white',
              }}
            >
              🔗 {ACTION_LABELS.VERIFY_WRCODE}
            </button>
          )}
        </div>
      </div>
      
      {/* Automation Mode Section */}
      <div style={sectionStyle}>
        <div style={labelStyle}>
          Automation
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: '10px' }}>
            (attack surface control)
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['DENY', 'REVIEW', 'ALLOW'] as AutomationMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onAutomationChange?.(mode)}
              style={automationButtonStyle(mode, handshake.automation_mode === mode)}
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
          {AUTOMATION_DESCRIPTIONS[handshake.automation_mode]}
        </div>
      </div>
      
      {/* Policy Note */}
      <div style={{ 
        padding: '12px 16px',
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
    </div>
  )
}

export default HandshakeDetailsPanel

