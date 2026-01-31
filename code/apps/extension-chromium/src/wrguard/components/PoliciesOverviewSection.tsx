/**
 * PoliciesOverviewSection
 * 
 * Read-only summary of current local policy posture.
 * No editing controls - just visibility.
 * 
 * @version 1.0.0
 */

import React from 'react'
import { useWRGuardStore } from '../useWRGuardStore'
import type { PolicyPosture } from '../types'

interface PoliciesOverviewSectionProps {
  theme: 'default' | 'dark' | 'professional' | 'standard' | 'pro'
  onOpenAdvancedSettings?: () => void
}

export const PoliciesOverviewSection: React.FC<PoliciesOverviewSectionProps> = ({
  theme,
  onOpenAdvancedSettings
}) => {
  const isLightTheme = theme === 'professional' || theme === 'standard'
  const textColor = isLightTheme ? '#0f172a' : 'white'
  const mutedColor = isLightTheme ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isLightTheme ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isLightTheme ? '#ffffff' : 'rgba(255,255,255,0.05)'
  
  const { policyOverview } = useWRGuardStore()
  
  // =========================================================================
  // Posture Badge Helper
  // =========================================================================
  
  const getPostureBadge = (posture: PolicyPosture) => {
    const configs = {
      restrictive: { label: 'Restrictive', color: '#22c55e', icon: '🔒' },
      balanced: { label: 'Balanced', color: '#f59e0b', icon: '⚖️' },
      permissive: { label: 'Permissive', color: '#ef4444', icon: '⚠️' }
    }
    
    const config = configs[posture]
    
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '10px',
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: '12px',
        color: config.color,
        background: `${config.color}15`
      }}>
        {config.icon} {config.label}
      </span>
    )
  }
  
  // =========================================================================
  // Policy Card Component
  // =========================================================================
  
  const PolicyCard: React.FC<{
    icon: string
    title: string
    posture?: PolicyPosture
    summary: string
    details?: React.ReactNode
  }> = ({ icon, title, posture, summary, details }) => (
    <div style={{
      background: cardBg,
      border: `1px solid ${borderColor}`,
      borderRadius: '10px',
      padding: '16px',
      marginBottom: '12px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>{icon}</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>
            {title}
          </span>
        </div>
        {posture && getPostureBadge(posture)}
      </div>
      
      <p style={{
        margin: 0,
        fontSize: '12px',
        color: mutedColor,
        lineHeight: '1.5'
      }}>
        {summary}
      </p>
      
      {details && (
        <div style={{ marginTop: '12px' }}>
          {details}
        </div>
      )}
    </div>
  )
  
  // =========================================================================
  // Render
  // =========================================================================
  
  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '20px'
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: textColor }}>
            📋 Policy Overview
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: mutedColor }}>
            Current local policy posture (read-only view)
          </p>
        </div>
        
        <span style={{
          fontSize: '10px',
          padding: '4px 10px',
          borderRadius: '12px',
          background: isLightTheme ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
          color: mutedColor
        }}>
          Last updated: {new Date(policyOverview.lastUpdated).toLocaleString()}
        </span>
      </div>
      
      {/* Read-Only Notice */}
      <div style={{
        background: isLightTheme ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)',
        border: `1px solid ${isLightTheme ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.25)'}`,
        borderRadius: '8px',
        padding: '12px 14px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <span style={{ fontSize: '16px' }}>👁️</span>
        <span style={{ fontSize: '12px', color: textColor }}>
          This is a <strong>read-only</strong> view. To modify policies, use the Advanced Policy Settings.
        </span>
      </div>
      
      {/* Ingress Policy */}
      <PolicyCard
        icon="📥"
        title="Ingress Policy"
        posture={policyOverview.ingress.posture}
        summary={policyOverview.ingress.summary}
      />
      
      {/* Egress Policy */}
      <PolicyCard
        icon="📤"
        title="Egress Policy"
        posture={policyOverview.egress.posture}
        summary={policyOverview.egress.summary}
      />
      
      {/* Attachment Handling */}
      <PolicyCard
        icon="📎"
        title="Attachment Handling"
        summary={policyOverview.attachments.summary}
        details={
          <div style={{
            display: 'flex',
            gap: '20px',
            fontSize: '11px',
            color: mutedColor
          }}>
            <div>
              <span style={{ fontWeight: 500 }}>Max size:</span>{' '}
              {(policyOverview.attachments.maxSize / (1024 * 1024)).toFixed(0)} MB
            </div>
            <div>
              <span style={{ fontWeight: 500 }}>Allowed types:</span>{' '}
              {policyOverview.attachments.allowedTypes.length} categories
            </div>
          </div>
        }
      />
      
      {/* Execution Defaults */}
      <PolicyCard
        icon="⚡"
        title="Execution Defaults"
        summary={policyOverview.execution.summary}
        details={
          <div style={{
            display: 'flex',
            gap: '16px',
            flexWrap: 'wrap',
            marginTop: '4px'
          }}>
            <div style={{
              fontSize: '10px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: isLightTheme ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <span style={{ fontWeight: 500 }}>Automation:</span>
              <span style={{
                color: policyOverview.execution.automationMode === 'deny' ? '#ef4444'
                  : policyOverview.execution.automationMode === 'review' ? '#f59e0b'
                  : '#22c55e'
              }}>
                {policyOverview.execution.automationMode.toUpperCase()}
              </span>
            </div>
            
            <div style={{
              fontSize: '10px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: isLightTheme ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <span style={{ fontWeight: 500 }}>Offline preferred:</span>
              <span style={{ color: policyOverview.execution.offlinePreferred ? '#22c55e' : mutedColor }}>
                {policyOverview.execution.offlinePreferred ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        }
      />
      
      {/* Summary Stats */}
      <div style={{
        background: cardBg,
        border: `1px solid ${borderColor}`,
        borderRadius: '10px',
        padding: '16px',
        marginTop: '20px'
      }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
          Policy Summary
        </div>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#22c55e' }}>
              🔒
            </div>
            <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>
              Ingress
            </div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#22c55e' }}>
              🔒
            </div>
            <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>
              Egress
            </div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>
              ⚖️
            </div>
            <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>
              Attachments
            </div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>
              👁️
            </div>
            <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>
              Automation
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

