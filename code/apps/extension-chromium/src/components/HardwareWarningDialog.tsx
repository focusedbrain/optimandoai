/**
 * Hardware Warning Dialog Component
 * Shows friendly warning when hardware is too old for local LLMs
 */

import React from 'react'

export interface HardwareWarningProps {
  show: boolean
  onUseTurboMode: () => void
  onStayLocal: () => void
  reasons?: string[]
}

export const HardwareWarningDialog: React.FC<HardwareWarningProps> = ({
  show,
  onUseTurboMode,
  onStayLocal,
  reasons = []
}) => {
  if (!show) return null
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2147483640,
      padding: '20px',
    }}>
      <div style={{
        background: 'linear-gradient(160deg, #1a0533 0%, #2d1052 40%, #1a0533 100%)',
        border: '1px solid rgba(168,85,247,0.25)',
        borderRadius: '16px',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(168,85,247,0.2)',
        maxWidth: '440px',
        width: '100%',
        padding: '32px 28px',
        color: '#f5f3ff',
        fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
      }}>
        {/* Icon */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #a855f7 100%)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(168,85,247,0.4)',
          }}>
            <span style={{ fontSize: '30px' }}>🚀</span>
          </div>
        </div>

        <h2 style={{ margin: '0 0 12px 0', fontSize: '17px', fontWeight: 700, textAlign: 'center', color: '#f5f3ff', lineHeight: 1.3 }}>
          Local AI on this PC will be slow — that's a hardware limit.
        </h2>

        <div style={{ fontSize: '13px', color: 'rgba(245,243,255,0.75)', lineHeight: 1.6, marginBottom: '20px' }}>
          <p style={{ margin: '0 0 10px 0' }}>
            Your computer is missing modern CPU features (like AVX2), so on-device models run in a slow fallback mode.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: '#f5f3ff' }}>Cloud/Turbo models are NOT affected and will run at full speed.</strong>
          </p>
          {reasons.length > 0 && (
            <details style={{ marginTop: '12px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '11px', color: 'rgba(245,243,255,0.5)' }}>
                Technical details
              </summary>
              <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: '11px', color: 'rgba(245,243,255,0.5)' }}>
                {reasons.map((reason, i) => (
                  <li key={i} style={{ marginBottom: '3px' }}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={onUseTurboMode}
            style={{
              width: '100%',
              padding: '13px 16px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #a855f7 100%)',
              border: 'none',
              borderRadius: '10px',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(168,85,247,0.35)',
              transition: 'all 0.18s',
            }}
          >
            Use Turbo Mode (recommended)
          </button>

          <button
            onClick={onStayLocal}
            style={{
              width: '100%',
              padding: '11px 16px',
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(168,85,247,0.25)',
              borderRadius: '10px',
              color: 'rgba(245,243,255,0.75)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.18s',
            }}
          >
            Run Locally anyway (slow)
          </button>
        </div>

        <p style={{ margin: '16px 0 0 0', fontSize: '11px', color: 'rgba(245,243,255,0.4)', textAlign: 'center' }}>
          You can change this anytime in Settings
        </p>
      </div>
    </div>
  )
}

export default HardwareWarningDialog

