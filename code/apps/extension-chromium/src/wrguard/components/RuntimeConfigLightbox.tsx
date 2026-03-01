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
  primaryButtonStyle,
} from '../../shared/ui/lightboxTheme'

interface RuntimeConfigLightboxProps {
  theme?: 'default' | 'dark' | 'professional'
  onClose: () => void
}

export function RuntimeConfigLightbox({ theme = 'default', onClose }: RuntimeConfigLightboxProps) {
  const { runtimeConfig, updateRuntimeConfig } = useWRGuardStore()
  
  const t = getThemeTokens(theme)
  const textColor = t.text
  const mutedColor = t.textMuted
  const borderColor = t.border
  
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
    <div style={overlayStyle(t)}>
      <div style={panelStyle(t)}>
        {/* Header */}
        <div style={headerStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>⚡</span>
            <div>
              <p style={headerMainTitleStyle()}>Runtime Configuration</p>
              <p style={headerSubtitleStyle()}>Adjust live WRGuard operational settings</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={closeButtonStyle(t)}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.closeHoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.closeBg; }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={bodyStyle(t)}>
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            {toggleOptions.map(option => (
              <label
                key={option.key}
                style={{
                  ...cardStyle(t),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '18px' }}>{option.icon}</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>{option.label}</div>
                    <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>{option.description}</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={runtimeConfig[option.key]}
                  onChange={(e) => updateRuntimeConfig({ [option.key]: e.target.checked })}
                  style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: t.accentColor }}
                />
              </label>
            ))}

            {runtimeConfig.strictMode && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(251,146,60,0.12)',
                border: '1px solid rgba(251,146,60,0.35)',
                borderRadius: '10px',
                marginTop: '16px',
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
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '10px',
          background: t.cardBg,
          flexShrink: 0,
        }}>
          <button onClick={onClose} style={primaryButtonStyle(t)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}



