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
import {
  getThemeTokens,
  overlayStyle,
  panelStyle,
  headerStyle,
  headerTitleStyle,
  headerMainTitleStyle,
  headerSubtitleStyle,
  closeButtonStyle,
  bodyStyle,
  cardStyle,
  secondaryButtonStyle,
  primaryButtonStyle,
  notificationStyle,
} from '../../shared/ui/lightboxTheme'

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

  const t = getThemeTokens(theme)
  const textColor = t.text
  const mutedColor = t.textMuted
  const borderColor = t.border

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
    <div style={overlayStyle(t)}>
      <div style={panelStyle(t)}>
        {/* Header */}
        <div style={headerStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>🔔</span>
            <div>
              <p style={headerMainTitleStyle()}>Permission Request</p>
              <p style={headerSubtitleStyle()}>
                <strong style={{ color: '#fbbf24' }}>{senderName}</strong> is requesting additional permissions
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={bodyStyle(t)}>
          <div style={{ maxWidth: '620px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Permissions */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Requested Permissions
              </div>
              {denials.length === 0 ? (
                <div style={notificationStyle('success')}>✓ No additional permissions required</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {denials.map((denial, i) => (
                    <label
                      key={i}
                      style={{
                        ...cardStyle(t),
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        cursor: 'pointer',
                        background: selectedDenials.has(i) || selectedDenials.size === 0 ? 'rgba(234,179,8,0.1)' : t.cardBg,
                        border: `1px solid ${selectedDenials.has(i) || selectedDenials.size === 0 ? 'rgba(234,179,8,0.35)' : t.border}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDenials.has(i) || selectedDenials.size === 0}
                        onChange={() => toggleDenial(i)}
                        style={{ marginTop: '2px', accentColor: '#eab308' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, color: textColor, fontSize: '13px', marginBottom: '2px' }}>
                          {formatCapability(denial.capability)}
                        </div>
                        <div style={{ fontSize: '12px', color: mutedColor }}>{denial.reason}</div>
                      </div>
                      <span style={{ padding: '2px 6px', fontSize: '10px', fontWeight: 600, borderRadius: '4px', background: 'rgba(234,179,8,0.2)', color: '#eab308', textTransform: 'uppercase' }}>
                        {denial.domain}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Scope Selection */}
            {denials.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Duration
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {scopes.map(scope => (
                    <button
                      key={scope.id}
                      onClick={() => setSelectedScope(scope.id)}
                      style={{
                        padding: '12px',
                        background: selectedScope === scope.id ? 'rgba(139,92,246,0.15)' : 'transparent',
                        border: `1px solid ${selectedScope === scope.id ? t.accentColor : t.border}`,
                        borderRadius: '9px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span>{scope.icon}</span>
                        <span style={{ fontWeight: 600, color: selectedScope === scope.id ? t.accentColor : textColor, fontSize: '13px' }}>
                          {scope.label}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: mutedColor }}>{scope.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Warning */}
            {denials.some(d => d.capability === 'allowDynamicContent' || d.capability === 'allowBulkExport' || d.capability === 'credentials') && (
              <div style={{ ...notificationStyle('error'), display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⚠️</span>
                <span>This request includes high-risk permissions. Proceed with caution.</span>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px' }}>
              <button onClick={onDeny} style={secondaryButtonStyle(t)}>Deny</button>
              <button
                onClick={handleApprove}
                disabled={denials.length === 0}
                style={primaryButtonStyle(t, denials.length === 0)}
              >
                {denials.length > 0 ? 'Allow' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
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



