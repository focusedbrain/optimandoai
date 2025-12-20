/**
 * P2PStreamPlaceholder Component
 * 
 * Placeholder UI for P2P Stream mode.
 * Shows a video grid placeholder with chat sidebar.
 */

import React from 'react'
import ComposerToolbelt from './ComposerToolbelt'

interface P2PStreamPlaceholderProps {
  theme?: 'default' | 'dark' | 'professional'
  className?: string
}

export const P2PStreamPlaceholder: React.FC<P2PStreamPlaceholderProps> = ({
  theme = 'default',
  className = ''
}) => {
  const getThemeStyles = () => {
    switch (theme) {
      case 'professional':
        return {
          banner: { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#b45309' },
          videoGrid: { background: '#0f172a' },
          videoTile: { background: '#1e293b', border: '1px solid #334155' },
          chatPanel: { background: '#f8fafc', border: '1px solid #e2e8f0' },
          textarea: { background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' },
          button: { background: '#3b82f6', color: 'white' }
        }
      case 'dark':
        return {
          banner: { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' },
          videoGrid: { background: '#0f172a' },
          videoTile: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' },
          chatPanel: { background: 'rgba(255,255,255,0.05)', borderLeft: '1px solid rgba(255,255,255,0.1)' },
          textarea: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#e5e7eb' },
          button: { background: '#8b5cf6', color: 'white' }
        }
      default:
        return {
          banner: { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', color: '#fcd34d' },
          videoGrid: { background: 'rgba(0,0,0,0.3)' },
          videoTile: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' },
          chatPanel: { background: 'rgba(255,255,255,0.08)', borderLeft: '1px solid rgba(255,255,255,0.15)' },
          textarea: { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white' },
          button: { background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', color: 'white' }
        }
    }
  }

  const styles = getThemeStyles()

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Placeholder Banner */}
      <div style={{
        ...styles.banner,
        padding: '8px 12px',
        margin: '8px',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '11px'
      }}>
        <span>⚠️</span>
        <span><strong>P2P Stream</strong> - UI Preview (not functional)</span>
      </div>

      {/* Main Content: Video Grid + Chat */}
      <div style={{ flex: 1, display: 'flex', margin: '0 8px 8px', gap: '8px', overflow: 'hidden' }}>
        {/* Video Grid */}
        <div style={{
          flex: 2,
          ...styles.videoGrid,
          borderRadius: '8px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gridTemplateRows: 'repeat(2, 1fr)',
          gap: '4px',
          padding: '4px'
        }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{
              ...styles.videoTile,
              borderRadius: '6px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '24px', opacity: 0.4 }}>👤</span>
              <span style={{ fontSize: '10px', opacity: 0.4 }}>Participant {i}</span>
            </div>
          ))}
        </div>

        {/* Chat Panel */}
        <div style={{
          flex: 1,
          ...styles.chatPanel,
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          minWidth: '150px'
        }}>
          {/* Chat Messages Placeholder */}
          <div style={{
            flex: 1,
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: 0.5
          }}>
            <span style={{ fontSize: '20px' }}>💬</span>
            <span style={{ fontSize: '10px', marginTop: '4px' }}>Stream Chat</span>
          </div>

          {/* Mini Composer */}
          <div style={{ padding: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="text"
                placeholder="Chat..."
                disabled
                style={{
                  flex: 1,
                  ...styles.textarea,
                  padding: '6px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  opacity: 0.5
                }}
              />
              <button
                disabled
                style={{
                  ...styles.button,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '10px',
                  opacity: 0.5,
                  cursor: 'not-allowed'
                }}
              >
                →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div style={{
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'center',
        gap: '8px'
      }}>
        <ComposerToolbelt theme={theme} />
      </div>
    </div>
  )
}

export default P2PStreamPlaceholder




