/**
 * ProtectedSitesSection
 * 
 * Define which external websites are considered protected execution targets.
 * This is declarative configuration only - no enforcement logic.
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import { useWRGuardStore } from '../useWRGuardStore'

interface ProtectedSitesSectionProps {
  theme: 'default' | 'dark' | 'professional'
}

export const ProtectedSitesSection: React.FC<ProtectedSitesSectionProps> = ({ theme }) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  const successColor = '#22c55e'
  const accentColor = '#8b5cf6'
  
  const {
    protectedSites,
    addProtectedSite,
    removeProtectedSite,
    toggleProtectedSite,
    resetProtectedSites
  } = useWRGuardStore()
  
  const [newDomain, setNewDomain] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  
  // =========================================================================
  // Handlers
  // =========================================================================
  
  const handleAddSite = () => {
    if (!newDomain.trim()) return
    
    addProtectedSite(newDomain.trim(), newDescription.trim() || undefined)
    setNewDomain('')
    setNewDescription('')
    setShowAddForm(false)
  }
  
  const handleRemoveSite = (id: string) => {
    removeProtectedSite(id)
  }
  
  const handleToggleSite = (id: string) => {
    toggleProtectedSite(id)
  }
  
  const handleReset = () => {
    if (confirm('Reset to default protected sites? User-added sites will be removed.')) {
      resetProtectedSites()
    }
  }
  
  // Sort sites: defaults first, then user-added, alphabetically within each group
  const sortedSites = [...protectedSites].sort((a, b) => {
    if (a.source === 'default' && b.source !== 'default') return -1
    if (a.source !== 'default' && b.source === 'default') return 1
    return a.domain.localeCompare(b.domain)
  })
  
  const defaultCount = protectedSites.filter(s => s.source === 'default').length
  const userCount = protectedSites.filter(s => s.source === 'user').length
  const enabledCount = protectedSites.filter(s => s.enabled).length
  
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
            🛡️ Protected Sites
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: mutedColor }}>
            Define which external websites are considered protected execution targets
          </p>
          <div style={{
            display: 'flex',
            gap: '12px',
            marginTop: '8px',
            fontSize: '11px'
          }}>
            <span style={{ color: mutedColor }}>
              <strong style={{ color: textColor }}>{protectedSites.length}</strong> total
            </span>
            <span style={{ color: mutedColor }}>
              <strong style={{ color: successColor }}>{enabledCount}</strong> enabled
            </span>
            <span style={{ color: mutedColor }}>
              <strong style={{ color: accentColor }}>{defaultCount}</strong> default
            </span>
            <span style={{ color: mutedColor }}>
              <strong style={{ color: textColor }}>{userCount}</strong> user-added
            </span>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleReset}
            style={{
              padding: '8px 12px',
              fontSize: '11px',
              background: 'transparent',
              border: `1px solid ${borderColor}`,
              color: mutedColor,
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Reset to Defaults
          </button>
          <button
            onClick={() => setShowAddForm(true)}
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
            + Add Site
          </button>
        </div>
      </div>
      
      {/* Add Site Form */}
      {showAddForm && (
        <div style={{
          background: cardBg,
          border: `1px solid ${accentColor}50`,
          borderRadius: '10px',
          padding: '16px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
            Add Protected Site
          </div>
          
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
                Domain / Origin *
              </label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSite()}
                placeholder="e.g., slack.com, web.whatsapp.com"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  outline: 'none'
                }}
              />
            </div>
            
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
                Description (optional)
              </label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="e.g., Slack messaging"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  outline: 'none'
                }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              onClick={() => setShowAddForm(false)}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: 'transparent',
                border: `1px solid ${borderColor}`,
                color: textColor,
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddSite}
              disabled={!newDomain.trim()}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                background: newDomain.trim() ? successColor : mutedColor,
                border: 'none',
                color: 'white',
                borderRadius: '6px',
                cursor: newDomain.trim() ? 'pointer' : 'not-allowed'
              }}
            >
              Add Site
            </button>
          </div>
        </div>
      )}
      
      {/* Sites List */}
      <div style={{
        background: cardBg,
        border: `1px solid ${borderColor}`,
        borderRadius: '10px',
        overflow: 'hidden'
      }}>
        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr 120px 80px 100px',
          gap: '12px',
          padding: '10px 14px',
          background: isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.03)',
          borderBottom: `1px solid ${borderColor}`,
          fontSize: '10px',
          fontWeight: 600,
          color: mutedColor,
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          <span></span>
          <span>Domain</span>
          <span>Source</span>
          <span>Status</span>
          <span style={{ textAlign: 'right' }}>Actions</span>
        </div>
        
        {/* Sites */}
        {sortedSites.map((site, index) => (
          <div
            key={site.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr 120px 80px 100px',
              gap: '12px',
              padding: '12px 14px',
              alignItems: 'center',
              borderBottom: index < sortedSites.length - 1 ? `1px solid ${borderColor}` : 'none',
              opacity: site.enabled ? 1 : 0.5
            }}
          >
            {/* Toggle */}
            <div>
              <div
                onClick={() => handleToggleSite(site.id)}
                style={{
                  width: '32px',
                  height: '18px',
                  borderRadius: '9px',
                  background: site.enabled ? successColor : (isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.2)'),
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
              >
                <div style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '7px',
                  background: 'white',
                  position: 'absolute',
                  top: '2px',
                  left: site.enabled ? '16px' : '2px',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                }} />
              </div>
            </div>
            
            {/* Domain */}
            <div>
              <div style={{
                fontSize: '13px',
                fontWeight: 500,
                color: textColor,
                fontFamily: 'monospace'
              }}>
                🌐 {site.domain}
              </div>
              {site.description && (
                <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
                  {site.description}
                </div>
              )}
            </div>
            
            {/* Source */}
            <div>
              <span style={{
                fontSize: '10px',
                fontWeight: 500,
                padding: '3px 8px',
                borderRadius: '4px',
                background: site.source === 'default'
                  ? 'rgba(139,92,246,0.1)'
                  : 'rgba(34,197,94,0.1)',
                color: site.source === 'default' ? accentColor : successColor
              }}>
                {site.source === 'default' ? '⚙️ Default' : '👤 User'}
              </span>
            </div>
            
            {/* Status */}
            <div style={{
              fontSize: '11px',
              color: site.enabled ? successColor : mutedColor
            }}>
              {site.enabled ? '✓ Active' : '○ Disabled'}
            </div>
            
            {/* Actions */}
            <div style={{ textAlign: 'right' }}>
              {site.source === 'user' && (
                <button
                  onClick={() => handleRemoveSite(site.id)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    background: 'transparent',
                    border: `1px solid rgba(239,68,68,0.3)`,
                    color: '#ef4444',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              )}
              {site.source === 'default' && (
                <span style={{ fontSize: '10px', color: mutedColor }}>
                  Protected
                </span>
              )}
            </div>
          </div>
        ))}
        
        {sortedSites.length === 0 && (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: mutedColor
          }}>
            No protected sites configured
          </div>
        )}
      </div>
      
      {/* Info Footer */}
      <div style={{
        marginTop: '16px',
        padding: '12px 14px',
        background: isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.03)',
        borderRadius: '8px',
        fontSize: '11px',
        color: mutedColor,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px'
      }}>
        <span style={{ fontSize: '14px' }}>ℹ️</span>
        <span>
          Protected sites are execution targets where WRGuard policies will be enforced.
          This is declarative configuration only — enforcement logic is applied in later steps.
        </span>
      </div>
    </div>
  )
}

