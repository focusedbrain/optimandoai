/**
 * Consent Dialog Component
 * 
 * Shown when a Capsule Ask Policy (CAP) requests capabilities
 * beyond what the Handshake/Sender Policy (HSP) allows.
 */

import { useState } from 'react'
import type { CanonicalPolicy } from '../schema'
import { getDeniedCapabilities, type PolicyDenial } from '../engine'
import { RiskLabel } from './RiskLabel'

interface ConsentDialogProps {
  capsulePolicy: CanonicalPolicy
  effectivePolicy: CanonicalPolicy
  senderName: string
  onApprove: (scope: ConsentScope, denials: PolicyDenial[]) => void
  onDeny: () => void
  theme?: 'default' | 'dark' | 'professional'
}

export type ConsentScope = 'once' | 'session' | 'always' | 'time_bounded'

interface ConsentGrant {
  id: string
  capsuleId: string
  senderId: string
  denials: PolicyDenial[]
  scope: ConsentScope
  grantedAt: number
  expiresAt?: number
  revokedAt?: number
}

export function ConsentDialog({
  capsulePolicy,
  effectivePolicy,
  senderName,
  onApprove,
  onDeny,
  theme = 'default',
}: ConsentDialogProps) {
  const [selectedScope, setSelectedScope] = useState<ConsentScope>('once')
  const [selectedDenials, setSelectedDenials] = useState<Set<number>>(new Set())

  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'

  // Get denied capabilities
  const denials = getDeniedCapabilities(capsulePolicy, effectivePolicy)

  const handleApprove = () => {
    // If specific denials selected, only approve those
    const approvedDenials = selectedDenials.size > 0
      ? denials.filter((_, i) => selectedDenials.has(i))
      : denials
    
    onApprove(selectedScope, approvedDenials)
    
    // Log the consent grant
    logConsentGrant({
      id: crypto.randomUUID(),
      capsuleId: capsulePolicy.id,
      senderId: senderName,
      denials: approvedDenials,
      scope: selectedScope,
      grantedAt: Date.now(),
      expiresAt: selectedScope === 'time_bounded' ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
    })
  }

  const toggleDenial = (index: number) => {
    const newSelected = new Set(selectedDenials)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedDenials(newSelected)
  }

  const scopes: { id: ConsentScope; label: string; description: string; icon: string }[] = [
    { id: 'once', label: 'Just This Time', description: 'Allow only for this request', icon: '1️⃣' },
    { id: 'session', label: 'This Session', description: 'Allow until you close the browser', icon: '⏱️' },
    { id: 'time_bounded', label: '24 Hours', description: 'Allow for the next 24 hours', icon: '📅' },
    { id: 'always', label: 'Always Allow', description: 'Remember for this sender', icon: '✅' },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          background: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: `1px solid ${borderColor}`,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${borderColor}`,
          background: isDark ? 'rgba(234, 179, 8, 0.1)' : 'rgba(234, 179, 8, 0.05)',
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px',
            marginBottom: '8px',
          }}>
            <span style={{ fontSize: '24px' }}>🔔</span>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: textColor }}>
              Permission Request
            </h2>
          </div>
          <p style={{ margin: 0, color: mutedColor, fontSize: '14px' }}>
            <strong style={{ color: '#eab308' }}>{senderName}</strong> is requesting additional permissions
          </p>
        </div>

        {/* Requested Permissions */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${borderColor}` }}>
          <div style={{ 
            fontSize: '12px', 
            color: mutedColor, 
            marginBottom: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Requested Permissions
          </div>

          {denials.length === 0 ? (
            <div style={{ 
              padding: '16px', 
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: '8px',
              color: '#22c55e',
              fontSize: '14px',
            }}>
              ✓ No additional permissions required
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {denials.map((denial, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'start',
                    gap: '10px',
                    padding: '12px',
                    background: selectedDenials.has(i) || selectedDenials.size === 0 
                      ? 'rgba(234, 179, 8, 0.1)' 
                      : cardBg,
                    border: `1px solid ${
                      selectedDenials.has(i) || selectedDenials.size === 0 
                        ? 'rgba(234, 179, 8, 0.3)' 
                        : borderColor
                    }`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedDenials.has(i) || selectedDenials.size === 0}
                    onChange={() => toggleDenial(i)}
                    style={{ marginTop: '2px', accentColor: '#eab308' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ 
                      fontWeight: 500, 
                      color: textColor, 
                      fontSize: '13px',
                      marginBottom: '2px',
                    }}>
                      {formatCapability(denial.capability)}
                    </div>
                    <div style={{ fontSize: '12px', color: mutedColor }}>
                      {denial.reason}
                    </div>
                  </div>
                  <span style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    background: 'rgba(234, 179, 8, 0.2)',
                    color: '#eab308',
                    textTransform: 'uppercase',
                  }}>
                    {denial.domain}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Scope Selection */}
        {denials.length > 0 && (
          <div style={{ padding: '20px 24px', borderBottom: `1px solid ${borderColor}` }}>
            <div style={{ 
              fontSize: '12px', 
              color: mutedColor, 
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Duration
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {scopes.map(scope => (
                <button
                  key={scope.id}
                  onClick={() => setSelectedScope(scope.id)}
                  style={{
                    padding: '12px',
                    background: selectedScope === scope.id 
                      ? isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)'
                      : 'transparent',
                    border: `1px solid ${selectedScope === scope.id ? '#8b5cf6' : borderColor}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px',
                    marginBottom: '4px',
                  }}>
                    <span>{scope.icon}</span>
                    <span style={{ 
                      fontWeight: 600, 
                      color: selectedScope === scope.id ? '#8b5cf6' : textColor,
                      fontSize: '13px',
                    }}>
                      {scope.label}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: mutedColor }}>
                    {scope.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{
          padding: '16px 24px',
          display: 'flex',
          gap: '12px',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onDeny}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              color: textColor,
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Deny
          </button>
          <button
            onClick={handleApprove}
            disabled={denials.length === 0}
            style={{
              padding: '10px 20px',
              background: denials.length > 0 ? '#8b5cf6' : '#6b7280',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontSize: '14px',
              fontWeight: 600,
              cursor: denials.length > 0 ? 'pointer' : 'not-allowed',
              opacity: denials.length > 0 ? 1 : 0.6,
            }}
          >
            {denials.length > 0 ? 'Allow' : 'Continue'}
          </button>
        </div>

        {/* Risk Warning */}
        {denials.some(d => 
          d.capability === 'allowDynamicContent' || 
          d.capability === 'allowBulkExport' ||
          d.capability === 'credentials'
        ) && (
          <div style={{
            padding: '12px 24px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderTop: '1px solid rgba(239, 68, 68, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span>⚠️</span>
            <span style={{ fontSize: '12px', color: '#ef4444' }}>
              This request includes high-risk permissions. Proceed with caution.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper function to format capability names
function formatCapability(capability: string): string {
  return capability
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/allowed|require/gi, '')
    .trim()
}

// Audit logging for consent grants
function logConsentGrant(grant: ConsentGrant): void {
  console.log('[Consent Audit]', {
    type: 'CONSENT_GRANTED',
    ...grant,
    timestamp: new Date().toISOString(),
  })
  
  // Store in chrome.storage for audit trail
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(['consent_audit_log'], (result) => {
      const log = result.consent_audit_log || []
      log.push({
        ...grant,
        type: 'CONSENT_GRANTED',
        timestamp: new Date().toISOString(),
      })
      // Keep last 1000 entries
      chrome.storage.local.set({ 
        consent_audit_log: log.slice(-1000) 
      })
    })
  }
}

// Export consent grant storage for use elsewhere
export async function getConsentAuditLog(): Promise<any[]> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const result = await chrome.storage.local.get(['consent_audit_log'])
    return result.consent_audit_log || []
  }
  return []
}

export async function revokeConsentGrant(grantId: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const result = await chrome.storage.local.get(['consent_audit_log'])
    const log = result.consent_audit_log || []
    const updatedLog = log.map((entry: any) => 
      entry.id === grantId 
        ? { ...entry, revokedAt: Date.now() }
        : entry
    )
    await chrome.storage.local.set({ consent_audit_log: updatedLog })
    
    console.log('[Consent Audit]', {
      type: 'CONSENT_REVOKED',
      grantId,
      timestamp: new Date().toISOString(),
    })
  }
}



