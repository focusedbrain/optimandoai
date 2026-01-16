/**
 * Runtime Configuration Lightbox
 * 
 * Modal for configuring WRGuard runtime settings.
 * Opens as a lightbox from WRGuard entry point.
 * 
 * @version 1.0.0
 */

import React from 'react'
import { useWRGuardStore } from '../useWRGuardStore'

interface RuntimeConfigLightboxProps {
  theme?: 'default' | 'dark' | 'professional'
  onClose: () => void
}

export function RuntimeConfigLightbox({ theme = 'default', onClose }: RuntimeConfigLightboxProps) {
  const { runtimeConfig, updateRuntimeConfig } = useWRGuardStore()
  
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const bgColor = isDark ? '#1e293b' : '#ffffff'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)'
  
  const toggleOptions = [
    {
      key: 'protectionEnabled' as const,
      label: 'Overlay Protection',
      description: 'Block suspicious content on protected sites',
      icon: '🛡️'
    },
    {
      key: 'logBlockedEvents' as const,
      label: 'Log Blocked Events',
      description: 'Keep a record of all blocked content',
      icon: '📝'
    },
    {
      key: 'showNotifications' as const,
      label: 'Show Notifications',
      description: 'Alert when content is blocked',
      icon: '🔔'
    },
    {
      key: 'autoQuarantine' as const,
      label: 'Auto-Quarantine',
      description: 'Automatically quarantine suspicious packages',
      icon: '🚫'
    },
    {
      key: 'strictMode' as const,
      label: 'Strict Mode',
      description: 'No bypass allowed for blocked content',
      icon: '🔒'
    }
  ]
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 10000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        maxHeight: '80vh',
        background: bgColor,
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚡</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: textColor }}>
                Runtime Configuration
              </h3>
              <p style={{ margin: 0, fontSize: '11px', color: mutedColor }}>
                Adjust live operational settings
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: mutedColor,
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
        
        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {toggleOptions.map(option => (
            <label
              key={option.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px',
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '10px',
                marginBottom: '10px',
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '18px' }}>{option.icon}</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>
                    {option.label}
                  </div>
                  <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
                    {option.description}
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={runtimeConfig[option.key]}
                onChange={(e) => updateRuntimeConfig({ [option.key]: e.target.checked })}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </label>
          ))}
          
          {/* Warning for Strict Mode */}
          {runtimeConfig.strictMode && (
            <div style={{
              padding: '12px 14px',
              background: isDark ? 'rgba(251, 146, 60, 0.1)' : 'rgba(251, 146, 60, 0.05)',
              border: '1px solid rgba(251, 146, 60, 0.3)',
              borderRadius: '10px',
              marginTop: '16px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fb923c', marginBottom: '4px' }}>
                ⚠️ Strict Mode Active
              </div>
              <div style={{ fontSize: '11px', color: mutedColor }}>
                Users cannot bypass blocked content. This may affect productivity if legitimate content is flagged.
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '10px',
          background: cardBg
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}



