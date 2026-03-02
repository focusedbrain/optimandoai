/**
 * Protected Sites List Component
 * 
 * Displays and manages the list of protected sites for WRGuard overlay enforcement.
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import { useWRGuardStore } from '../useWRGuardStore'
import type { ProtectedSite, ProtectedSiteSource } from '../types'

interface ProtectedSitesListProps {
  theme?: 'default' | 'dark' | 'professional'
}

const SOURCE_LABELS: Record<ProtectedSiteSource, { label: string; icon: string }> = {
  default: { label: 'Default', icon: '🛡️' },
  user: { label: 'Custom', icon: '➕' },
}

export function ProtectedSitesList({ theme = 'default' }: ProtectedSitesListProps) {
  const {
    protectedSites,
    runtimeConfig,
    addSite,
    removeSite,
    toggleSite,
    updateRuntimeConfig
  } = useWRGuardStore()
  
  const [showAddForm, setShowAddForm] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const bgColor = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)'
  
  const handleAddSite = () => {
    if (!newDomain.trim()) return
    
    addSite({
      domain: newDomain.trim(),
      description: newDisplayName.trim() || undefined,
      enabled: true,
    })
    
    setNewDomain('')
    setNewDisplayName('')
    setShowAddForm(false)
  }
  
  const groupedSites = protectedSites.reduce((acc, site) => {
    if (!acc[site.source]) acc[site.source] = []
    acc[site.source].push(site)
    return acc
  }, {} as Record<ProtectedSiteSource, ProtectedSite[]>)
  
  return (
    <div style={{ padding: '16px' }}>
      {/* Global Toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px',
        background: runtimeConfig.protectionEnabled
          ? (isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.05)')
          : (isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)'),
        border: `1px solid ${runtimeConfig.protectionEnabled ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
        borderRadius: '10px',
        marginBottom: '16px'
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '16px' }}>🛡️</span>
            Overlay Protection
          </div>
          <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
            {runtimeConfig.protectionEnabled ? 'Active on all protected sites' : 'Protection disabled'}
          </div>
        </div>
        <button
          onClick={() => updateRuntimeConfig({ protectionEnabled: !runtimeConfig.protectionEnabled })}
          style={{
            padding: '6px 14px',
            fontSize: '11px',
            fontWeight: 600,
            background: runtimeConfig.protectionEnabled ? '#22c55e' : '#ef4444',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            cursor: 'pointer'
          }}
        >
          {runtimeConfig.protectionEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>
      
      {/* Sites by Source */}
      {(Object.keys(SOURCE_LABELS) as ProtectedSiteSource[]).map(source => {
        const sites = groupedSites[source] || []
        if (sites.length === 0 && source !== 'user') return null
        
        return (
          <div key={source} style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              color: mutedColor,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span>{SOURCE_LABELS[source].icon}</span>
              {SOURCE_LABELS[source].label}
            </div>
            
            {sites.map(site => (
              <div
                key={site.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: cardBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '8px',
                  marginBottom: '6px'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: textColor }}>
                    {site.description ?? site.domain}
                  </div>
                  <div style={{ fontSize: '11px', color: mutedColor, fontFamily: 'monospace' }}>
                    {site.domain}
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {site.source === 'default' && (
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      color: mutedColor,
                      background: bgColor,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      textTransform: 'uppercase'
                    }}>
                      Default
                    </span>
                  )}
                  
                  <button
                    onClick={() => toggleSite(site.id)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '10px',
                      fontWeight: 600,
                      background: site.enabled
                        ? (isDark ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.1)')
                        : (isDark ? 'rgba(156, 163, 175, 0.2)' : 'rgba(156, 163, 175, 0.1)'),
                      border: 'none',
                      borderRadius: '4px',
                      color: site.enabled ? '#22c55e' : mutedColor,
                      cursor: 'pointer'
                    }}
                  >
                    {site.enabled ? 'ON' : 'OFF'}
                  </button>
                  
                  {site.source !== 'default' && (
                    <button
                      onClick={() => removeSite(site.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        fontSize: '14px',
                        cursor: 'pointer',
                        padding: '2px'
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
            
            {source === 'user' && sites.length === 0 && (
              <div style={{
                padding: '20px',
                textAlign: 'center',
                fontSize: '12px',
                color: mutedColor,
                fontStyle: 'italic',
                background: cardBg,
                borderRadius: '8px',
                border: `1px dashed ${borderColor}`
              }}>
                No custom sites added yet
              </div>
            )}
          </div>
        )
      })}
      
      {/* Add Site Form */}
      {showAddForm ? (
        <div style={{
          padding: '14px',
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '10px',
          marginTop: '12px'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
            Add Protected Site
          </div>
          
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="Domain (e.g., web.whatsapp.com)"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '12px',
              background: bgColor,
              border: `1px solid ${borderColor}`,
              borderRadius: '6px',
              color: textColor,
              marginBottom: '8px',
              outline: 'none'
            }}
          />
          
          <input
            type="text"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '12px',
              background: bgColor,
              border: `1px solid ${borderColor}`,
              borderRadius: '6px',
              color: textColor,
              marginBottom: '8px',
              outline: 'none'
            }}
          />
          
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowAddForm(false)}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                background: 'transparent',
                border: `1px solid ${borderColor}`,
                borderRadius: '6px',
                color: textColor,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddSite}
              disabled={!newDomain.trim()}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                cursor: newDomain.trim() ? 'pointer' : 'not-allowed',
                opacity: newDomain.trim() ? 1 : 0.5
              }}
            >
              Add Site
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '12px',
            fontWeight: 500,
            background: cardBg,
            border: `1px dashed ${borderColor}`,
            borderRadius: '8px',
            color: mutedColor,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            marginTop: '8px'
          }}
        >
          <span>➕</span>
          Add Protected Site
        </button>
      )}
    </div>
  )
}



