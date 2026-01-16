/**
 * RuntimeControlsSection
 * 
 * Gateway to advanced policy configuration.
 * Provides entry point to deeper settings without exposing them directly.
 * 
 * @version 1.0.0
 */

import React from 'react'
import { useWRGuardStore } from '../useWRGuardStore'

interface RuntimeControlsSectionProps {
  theme: 'default' | 'dark' | 'professional'
  onOpenAdvancedSettings?: () => void
}

export const RuntimeControlsSection: React.FC<RuntimeControlsSectionProps> = ({
  theme,
  onOpenAdvancedSettings
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  
  const { policyOverview, protectedSites, providers } = useWRGuardStore()
  
  const connectedProviders = providers.filter(p => p.status === 'connected').length
  const enabledSites = protectedSites.filter(s => s.enabled).length
  
  // =========================================================================
  // Quick Stats
  // =========================================================================
  
  const stats = [
    {
      icon: '📧',
      label: 'Email Providers',
      value: `${connectedProviders} connected`,
      color: connectedProviders > 0 ? '#22c55e' : '#f59e0b'
    },
    {
      icon: '🛡️',
      label: 'Protected Sites',
      value: `${enabledSites} active`,
      color: enabledSites > 0 ? '#22c55e' : '#f59e0b'
    },
    {
      icon: '📥',
      label: 'Ingress Posture',
      value: policyOverview.ingress.posture,
      color: policyOverview.ingress.posture === 'restrictive' ? '#22c55e'
        : policyOverview.ingress.posture === 'balanced' ? '#f59e0b'
        : '#ef4444'
    },
    {
      icon: '📤',
      label: 'Egress Posture',
      value: policyOverview.egress.posture,
      color: policyOverview.egress.posture === 'restrictive' ? '#22c55e'
        : policyOverview.egress.posture === 'balanced' ? '#f59e0b'
        : '#ef4444'
    }
  ]
  
  // =========================================================================
  // Control Links
  // =========================================================================
  
  const controlLinks = [
    {
      icon: '⚙️',
      title: 'Advanced Policy Settings',
      description: 'Fine-tune ingress, egress, and execution policies',
      action: onOpenAdvancedSettings || (() => console.log('[WRGuard] Opening advanced settings...')),
      primary: true
    },
    {
      icon: '🔐',
      title: 'Handshake Management',
      description: 'View and manage trusted handshakes',
      action: () => console.log('[WRGuard] Opening handshake management...'),
      primary: false
    },
    {
      icon: '📊',
      title: 'Audit Log',
      description: 'Review policy enforcement history',
      action: () => console.log('[WRGuard] Opening audit log...'),
      primary: false
    },
    {
      icon: '🔄',
      title: 'Sync Settings',
      description: 'Configure cross-device synchronization',
      action: () => console.log('[WRGuard] Opening sync settings...'),
      primary: false
    }
  ]
  
  // =========================================================================
  // Render
  // =========================================================================
  
  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: textColor }}>
          ⚙️ Runtime Controls
        </h3>
        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: mutedColor }}>
          Advanced configuration and system controls
        </p>
      </div>
      
      {/* Quick Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '12px',
        marginBottom: '24px'
      }}>
        {stats.map((stat, idx) => (
          <div
            key={idx}
            style={{
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '10px',
              padding: '14px',
              textAlign: 'center'
            }}
          >
            <span style={{ fontSize: '20px', display: 'block', marginBottom: '6px' }}>
              {stat.icon}
            </span>
            <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
              {stat.label}
            </div>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: stat.color,
              textTransform: 'capitalize'
            }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
      
      {/* Primary Control: Advanced Policy Settings */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(124,58,237,0.15) 100%)',
        border: '1px solid rgba(139,92,246,0.25)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px'
          }}>
            ⚙️
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: textColor }}>
              Advanced Policy Settings
            </div>
            <div style={{ fontSize: '12px', color: mutedColor, marginTop: '2px' }}>
              Configure fine-grained ingress, egress, and execution policies
            </div>
          </div>
        </div>
        
        <button
          onClick={controlLinks[0].action}
          style={{
            padding: '10px 20px',
            fontSize: '13px',
            fontWeight: 600,
            background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            border: 'none',
            color: 'white',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          Open Settings
          <span style={{ fontSize: '14px' }}>→</span>
        </button>
      </div>
      
      {/* Secondary Controls */}
      <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
        Other Controls
      </div>
      
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px'
      }}>
        {controlLinks.slice(1).map((link, idx) => (
          <div
            key={idx}
            onClick={link.action}
            style={{
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '10px',
              padding: '16px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#8b5cf6'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = borderColor
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px' }}>
              {link.icon}
            </span>
            <div style={{ fontSize: '13px', fontWeight: 500, color: textColor, marginBottom: '4px' }}>
              {link.title}
            </div>
            <div style={{ fontSize: '11px', color: mutedColor }}>
              {link.description}
            </div>
          </div>
        ))}
      </div>
      
      {/* Info Footer */}
      <div style={{
        marginTop: '24px',
        padding: '14px 16px',
        background: isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.03)',
        borderRadius: '10px',
        border: `1px solid ${borderColor}`
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px'
        }}>
          <span style={{ fontSize: '16px' }}>ℹ️</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 500, color: textColor, marginBottom: '4px' }}>
              About WRGuard Runtime Controls
            </div>
            <div style={{ fontSize: '11px', color: mutedColor, lineHeight: '1.5' }}>
              WRGuard is the local enforcement context where providers, protected sites, and policy posture are configured.
              Changes made here are declarative — enforcement logic is applied when processing BEAP packages.
              For questions, refer to the documentation.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

