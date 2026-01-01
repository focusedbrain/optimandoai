/**
 * Full-Auto Status Banner
 * 
 * Displays Full-Auto status as HANDSHAKE-SCOPED only, never as global baseline.
 * 
 * INVARIANTS:
 * - Full-Auto is NEVER shown as a selectable global option
 * - Only shows "Full-Auto active (handshake-scoped)" when handshake permits
 * - If no trusted handshake: Full-Auto hidden/disabled with explanation
 * 
 * @version 1.0.0
 */

import React from 'react'
import type { FullAutoStatus } from '../types'

interface FullAutoStatusBannerProps {
  status: FullAutoStatus
  theme?: 'default' | 'dark' | 'professional'
}

export function FullAutoStatusBanner({ status, theme = 'default' }: FullAutoStatusBannerProps) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  
  if (!status.hasAnyFullAuto) {
    // No Full-Auto available - show explanation
    return (
      <div style={{
        padding: '12px 14px',
        background: isDark ? 'rgba(156, 163, 175, 0.1)' : 'rgba(156, 163, 175, 0.05)',
        border: `1px solid ${isDark ? 'rgba(156, 163, 175, 0.3)' : 'rgba(156, 163, 175, 0.2)'}`,
        borderRadius: '10px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <span style={{ fontSize: '16px', opacity: 0.5 }}>🤖</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: mutedColor }}>
              Full-Auto Unavailable
            </div>
            <div style={{ fontSize: '11px', color: mutedColor, marginTop: '4px' }}>
              {status.explanation}
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // Full-Auto available (handshake-scoped)
  return (
    <div style={{
      padding: '12px 14px',
      background: isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.05)',
      border: `1px solid ${isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.2)'}`,
      borderRadius: '10px',
      marginBottom: '16px'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <span style={{ fontSize: '16px' }}>🤖</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e' }}>
              Full-Auto Active
            </span>
            <span style={{
              fontSize: '9px',
              fontWeight: 600,
              color: textColor,
              background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
              padding: '2px 6px',
              borderRadius: '4px',
              textTransform: 'uppercase'
            }}>
              Handshake-Scoped
            </span>
          </div>
          <div style={{ fontSize: '11px', color: mutedColor, marginTop: '4px' }}>
            {status.explanation}
          </div>
          
          {/* List of handshakes with Full-Auto */}
          {status.fullAutoHandshakes.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              {status.fullAutoHandshakes.map(hs => (
                <div
                  key={hs.handshakeId}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
                    borderRadius: '6px',
                    marginRight: '6px',
                    marginBottom: '4px'
                  }}
                >
                  <span style={{ fontSize: '12px' }}>🤝</span>
                  <span style={{ fontSize: '11px', color: textColor, fontWeight: 500 }}>
                    {hs.displayName}
                  </span>
                  <span style={{ fontSize: '10px', color: mutedColor, fontFamily: 'monospace' }}>
                    {hs.fingerprint}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}



