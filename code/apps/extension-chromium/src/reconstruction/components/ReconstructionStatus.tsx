/**
 * Reconstruction Status Component
 * 
 * Shows reconstruction state and provides actions:
 * - Not reconstructed → Reconstruct button
 * - Reconstructing → Progress indicator
 * - Reconstructed → Success badge
 * - Failed → Error + Retry button
 * 
 * @version 1.0.0
 */

import React from 'react'
import type { ReconstructionState } from '../types'

interface ReconstructionStatusProps {
  state: ReconstructionState
  error?: string
  onReconstruct: () => void
  isProcessing?: boolean
  theme: 'default' | 'dark' | 'professional'
}

export const ReconstructionStatus: React.FC<ReconstructionStatusProps> = ({
  state,
  error,
  onReconstruct,
  isProcessing,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)'
  
  const renderContent = () => {
    switch (state) {
      case 'none':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
                📄 Content Not Reconstructed
              </div>
              <div style={{ fontSize: '11px', color: mutedColor }}>
                Extract semantic text and generate safe previews
              </div>
            </div>
            <button
              onClick={onReconstruct}
              disabled={isProcessing}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: isProcessing 
                  ? mutedColor 
                  : 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                color: 'white',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isProcessing ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isProcessing ? '⏳ Processing...' : '🔄 Reconstruct'}
            </button>
          </div>
        )
        
      case 'running':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              border: `3px solid ${borderColor}`,
              borderTopColor: '#a855f7',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
                🔄 Reconstructing...
              </div>
              <div style={{ fontSize: '11px', color: mutedColor }}>
                Extracting text and generating previews
              </div>
            </div>
            <style>{`
              @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )
        
      case 'done':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '14px'
            }}>
              ✓
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e', marginBottom: '4px' }}>
                ✓ Reconstruction Complete
              </div>
              <div style={{ fontSize: '11px', color: mutedColor }}>
                Safe previews are available below
              </div>
            </div>
          </div>
        )
        
      case 'failed':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: 'rgba(239,68,68,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444',
              fontSize: '14px'
            }}>
              ✗
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444', marginBottom: '4px' }}>
                ✗ Reconstruction Failed
              </div>
              <div style={{ fontSize: '11px', color: mutedColor }}>
                {error || 'An error occurred during reconstruction'}
              </div>
            </div>
            <button
              onClick={onReconstruct}
              disabled={isProcessing}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: `1px solid ${isProfessional ? '#ef4444' : 'rgba(239,68,68,0.4)'}`,
                background: isProfessional ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.2)',
                color: '#ef4444',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isProcessing ? 'wait' : 'pointer'
              }}
            >
              {isProcessing ? '⏳ Retrying...' : '🔄 Retry'}
            </button>
          </div>
        )
        
      default:
        return null
    }
  }
  
  return (
    <div style={{
      padding: '16px',
      background: cardBg,
      borderRadius: '10px',
      border: `1px solid ${borderColor}`
    }}>
      {renderContent()}
    </div>
  )
}

