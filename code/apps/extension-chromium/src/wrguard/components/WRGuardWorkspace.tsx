/**
 * WRGuardWorkspace
 * 
 * Main workspace component for WRGuard configuration.
 * Contains tabs for Email Providers, Protected Sites, Policies, and Runtime Controls.
 * 
 * @version 1.0.0
 */

import React, { useEffect } from 'react'
import { useWRGuardStore } from '../useWRGuardStore'
import { WRGUARD_SECTIONS, WRGuardSection } from '../types'
import { EmailProvidersSection } from './EmailProvidersSection'
import { ProtectedSitesSection } from './ProtectedSitesSection'
import { PoliciesOverviewSection } from './PoliciesOverviewSection'
import { RuntimeControlsSection } from './RuntimeControlsSection'

interface WRGuardWorkspaceProps {
  theme: 'default' | 'dark' | 'professional'
  onOpenAdvancedSettings?: () => void
}

export const WRGuardWorkspace: React.FC<WRGuardWorkspaceProps> = ({
  theme,
  onOpenAdvancedSettings
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.02)'
  const headerBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  
  const { activeSection, setActiveSection, initialize, initialized } = useWRGuardStore()
  
  // Initialize WRGuard on mount
  useEffect(() => {
    if (!initialized) {
      initialize()
    }
  }, [initialized, initialize])
  
  // =========================================================================
  // Render Section Content
  // =========================================================================
  
  const renderSectionContent = () => {
    switch (activeSection) {
      case 'providers':
        return <EmailProvidersSection theme={theme} />
      case 'protected-sites':
        return <ProtectedSitesSection theme={theme} />
      case 'policies':
        return <PoliciesOverviewSection theme={theme} onOpenAdvancedSettings={onOpenAdvancedSettings} />
      case 'runtime-controls':
        return <RuntimeControlsSection theme={theme} onOpenAdvancedSettings={onOpenAdvancedSettings} />
      default:
        return <EmailProvidersSection theme={theme} />
    }
  }
  
  // =========================================================================
  // Render
  // =========================================================================
  
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      background: bgColor,
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${borderColor}`,
        background: headerBg
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px'
          }}>
            🛡️
          </div>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 700,
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              WRGuard
              <span style={{
                fontSize: '10px',
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: '4px',
                background: isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
                color: '#8b5cf6'
              }}>
                Configuration
              </span>
            </h1>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: mutedColor }}>
              Local enforcement and policy configuration context
            </p>
          </div>
        </div>
      </div>
      
      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '0',
        padding: '0 20px',
        borderBottom: `1px solid ${borderColor}`,
        background: headerBg
      }}>
        {WRGUARD_SECTIONS.map(section => {
          const isActive = activeSection === section.id
          
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '12px 16px',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 400,
                background: 'transparent',
                border: 'none',
                borderBottom: isActive
                  ? '2px solid #8b5cf6'
                  : '2px solid transparent',
                color: isActive ? '#8b5cf6' : mutedColor,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                marginBottom: '-1px'
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = textColor
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = mutedColor
                }
              }}
            >
              <span style={{ fontSize: '14px' }}>{section.icon}</span>
              {section.label}
            </button>
          )
        })}
      </div>
      
      {/* Section Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {renderSectionContent()}
      </div>
    </div>
  )
}

export default WRGuardWorkspace

