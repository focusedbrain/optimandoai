/**
 * P2PChatPlaceholder Component
 * 
 * Placeholder UI for P2P Chat mode.
 * Shows a chat-like layout with "not yet integrated" notice.
 */

import React from 'react'
import ComposerToolbelt from './ComposerToolbelt'

interface P2PChatPlaceholderProps {
  theme?: 'default' | 'dark' | 'professional'
  className?: string
}

export const P2PChatPlaceholder: React.FC<P2PChatPlaceholderProps> = ({
  theme = 'default',
  className = ''
}) => {
  const getThemeStyles = () => {
    switch (theme) {
      case 'professional':
        return {
          banner: { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#b45309' },
          mockChat: { background: '#f8fafc', border: '1px solid #e2e8f0' },
          composer: { background: '#f8fafc', borderTop: '1px solid #e2e8f0' },
          textarea: { background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' },
          button: { background: '#3b82f6', color: 'white' }
        }
      case 'dark':
        return {
          banner: { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' },
          mockChat: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' },
          composer: { borderTop: '1px solid rgba(255,255,255,0.1)' },
          textarea: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#e5e7eb' },
          button: { background: '#8b5cf6', color: 'white' }
        }
      default:
        return {
          banner: { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', color: '#fcd34d' },
          mockChat: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' },
          composer: { borderTop: '1px solid rgba(255,255,255,0.15)' },
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
        padding: '10px 12px',
        margin: '8px',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px'
      }}>
        <span>⚠️</span>
        <div>
          <strong>P2P Chat - UI Preview</strong>
          <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>
            Not yet integrated. This is a placeholder layout.
          </div>
        </div>
      </div>

      {/* Mock Chat Area */}
      <div style={{
        flex: 1,
        margin: '0 8px',
        borderRadius: '8px',
        ...styles.mockChat,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '12px',
        opacity: 0.6
      }}>
        <span style={{ fontSize: '40px' }}>💬</span>
        <div style={{ fontSize: '13px', textAlign: 'center' }}>
          <div style={{ fontWeight: 600 }}>P2P Encrypted Chat</div>
          <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>
            End-to-end encrypted messaging with peers
          </div>
        </div>
      </div>

      {/* Composer Placeholder */}
      <div style={{
        ...styles.composer,
        padding: '8px 12px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <ComposerToolbelt theme={theme} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Message (not functional)"
            disabled
            style={{
              flex: 1,
              ...styles.textarea,
              padding: '10px',
              borderRadius: '8px',
              fontSize: '12px',
              opacity: 0.5
            }}
          />
          <button
            disabled
            style={{
              ...styles.button,
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              fontWeight: 600,
              fontSize: '12px',
              opacity: 0.5,
              cursor: 'not-allowed'
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

export default P2PChatPlaceholder




