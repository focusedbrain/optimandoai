/**
 * Effective Policy Preview Component
 * 
 * Shows the computed effective policy from multiple layers.
 */

import { useMemo } from 'react'
import type { CanonicalPolicy } from '../schema'
import type { AutomationSessionRestrictions } from '../schema/domains/session-restrictions'
import { computeEffectivePolicy } from '../engine'
import { RiskLabel } from './RiskLabel'
import { getThemeTokens } from '../../shared/ui/lightboxTheme'

type PolicyWithSessionRestrictions = CanonicalPolicy & {
  sessionRestrictions?: Partial<AutomationSessionRestrictions>
}

interface EffectivePreviewProps {
  localPolicy: CanonicalPolicy
  networkPolicy?: CanonicalPolicy
  handshakePolicies: CanonicalPolicy[]
  selectedHandshakeId?: string
  capsulePolicy?: CanonicalPolicy
  theme?: 'default' | 'dark' | 'professional'
}

export function EffectivePreview({
  localPolicy,
  networkPolicy,
  handshakePolicies,
  selectedHandshakeId,
  capsulePolicy,
  theme = 'default',
}: EffectivePreviewProps) {
  const t = getThemeTokens(theme)
  const isDark = !t.isLight
  const textColor = t.text
  const mutedColor = t.textMuted
  const borderColor = t.border
  const cardBg = t.cardBg

  // Find selected handshake
  const selectedHsp = handshakePolicies.find(p => p.id === selectedHandshakeId)

  // Compute effective policy
  const result = useMemo(() => {
    return computeEffectivePolicy({
      nbp: networkPolicy,
      lnp: localPolicy,
      hsp: selectedHsp,
      cap: capsulePolicy,
    })
  }, [networkPolicy, localPolicy, selectedHsp, capsulePolicy])

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${borderColor}`,
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h4 style={{ margin: '0 0 4px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
            🎯 Effective Policy Preview
          </h4>
          <p style={{ margin: 0, color: mutedColor, fontSize: '12px' }}>
            {result.appliedLayers.join(' ∩ ')}
          </p>
        </div>
        <RiskLabel tier={result.effectiveRiskTier} />
      </div>

      {/* Layer Stack Visualization */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${borderColor}` }}>
        <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '12px' }}>
          Policy Stack
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { layer: 'network', label: 'Network Baseline', policy: networkPolicy, icon: '🌐' },
            { layer: 'local', label: 'Local Node', policy: localPolicy, icon: '🏠' },
            { layer: 'handshake', label: 'Handshake', policy: selectedHsp, icon: '🤝' },
            { layer: 'capsule', label: 'Capsule Ask', policy: capsulePolicy, icon: '📦' },
          ].map((item, i) => (
            <div
              key={item.layer}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                background: item.policy 
                  ? isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.05)'
                  : 'transparent',
                border: `1px solid ${item.policy ? 'rgba(139, 92, 246, 0.3)' : borderColor}`,
                borderRadius: '6px',
                opacity: item.policy ? 1 : 0.5,
              }}
            >
              <span style={{ fontSize: '14px' }}>{item.icon}</span>
              <span style={{ 
                flex: 1, 
                fontSize: '12px', 
                fontWeight: item.policy ? 500 : 400,
                color: item.policy ? textColor : mutedColor,
              }}>
                {item.label}
              </span>
              {item.policy ? (
                <span style={{ 
                  fontSize: '11px', 
                  color: '#8b5cf6',
                  fontWeight: 500,
                }}>
                  {item.policy.name.slice(0, 20)}...
                </span>
              ) : (
                <span style={{ fontSize: '11px', color: mutedColor, fontStyle: 'italic' }}>
                  Not configured
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Effective Capabilities - BEAP-aligned */}
      <div style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '12px' }}>
          Effective Automation Authority
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Derivations (what can be processed) */}
          <div>
            <div style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: textColor, 
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              ⚡ Automations
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <CapabilityRow
                label="AI Analysis"
                value={result.effective.derivations?.deriveLlmSummary?.enabled ? '✓' : '✗'}
                theme={theme}
              />
              <CapabilityRow
                label="Workflows"
                value={result.effective.derivations?.deriveAutomationExec?.enabled ? '✓' : '✗'}
                theme={theme}
              />
              <CapabilityRow
                label="API Calls"
                value={result.effective.derivations?.deriveExternalApiCall?.enabled ? '✓' : '✗'}
                isRisky={result.effective.derivations?.deriveExternalApiCall?.enabled}
                theme={theme}
              />
            </div>
          </div>

          {/* Session & Egress Controls */}
          <div>
            <div style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: textColor, 
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              🔒 Guardrails
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <CapabilityRow
                label="Egress Mode"
                value={(result.effective as PolicyWithSessionRestrictions).sessionRestrictions?.egressDuringAutomation === 'none' ? 'Blocked' : 'Allowlist'}
                theme={theme}
              />
              <CapabilityRow
                label="Destinations"
                value={result.effective.egress?.allowedDestinations?.length || 0}
                suffix="allowed"
                theme={theme}
              />
              <CapabilityRow
                label="Concurrent"
                value={(result.effective as PolicyWithSessionRestrictions).sessionRestrictions?.maxConcurrentSessions || 1}
                suffix="max"
                theme={theme}
              />
            </div>
          </div>
        </div>

        {/* Important clarification */}
        <div style={{
          marginTop: '16px',
          padding: '10px 12px',
          background: isDark ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)',
          borderRadius: '8px',
          fontSize: '11px',
          color: mutedColor,
        }}>
          <strong style={{ color: textColor }}>Note:</strong> Receiving a verified BEAP package is always safe. 
          These settings control what automation actions can execute.
        </div>
      </div>

      {/* Denials */}
      {result.denials.length > 0 && (
        <div style={{ 
          padding: '12px 20px',
          borderTop: `1px solid ${borderColor}`,
          background: isDark ? 'rgba(239, 68, 68, 0.05)' : 'rgba(239, 68, 68, 0.03)',
        }}>
          <div style={{ 
            fontSize: '12px', 
            fontWeight: 600, 
            color: '#ef4444', 
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            ⚠️ {result.denials.length} Capabilities Denied
          </div>
          <div style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '4px',
            maxHeight: '60px',
            overflow: 'hidden',
          }}>
            {result.denials.slice(0, 6).map((denial, i) => (
              <span
                key={i}
                style={{
                  padding: '4px 8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '4px',
                  color: '#ef4444',
                  fontSize: '11px',
                }}
              >
                {denial.capability}
              </span>
            ))}
            {result.denials.length > 6 && (
              <span style={{ 
                padding: '4px 8px', 
                color: '#ef4444', 
                fontSize: '11px' 
              }}>
                +{result.denials.length - 6} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Consent Required */}
      {result.requiresConsent && (
        <div style={{ 
          padding: '12px 20px',
          borderTop: `1px solid ${borderColor}`,
          background: isDark ? 'rgba(234, 179, 8, 0.05)' : 'rgba(234, 179, 8, 0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{ fontSize: '16px' }}>🔔</span>
          <span style={{ fontSize: '12px', color: '#eab308', fontWeight: 500 }}>
            User consent required for requested capabilities
          </span>
        </div>
      )}
    </div>
  )
}

function CapabilityRow({ 
  label, 
  value, 
  suffix = '', 
  isRisky = false,
  theme = 'default',
}: { 
  label: string
  value: string | number
  suffix?: string
  isRisky?: boolean
  theme?: string
}) {
  const t = getThemeTokens(theme)
  const textColor = t.text
  const mutedColor = t.textMuted

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '4px 0',
    }}>
      <span style={{ fontSize: '11px', color: mutedColor }}>{label}</span>
      <span style={{ 
        fontSize: '11px', 
        fontWeight: 500,
        color: isRisky ? '#ef4444' : textColor,
      }}>
        {value} {suffix}
      </span>
    </div>
  )
}

