/**
 * GroupChatPlaceholder Component
 * 
 * Placeholder UI for Group Chat mode.
 * Shows a multi-user chat layout.
 */

import React from 'react'
import ComposerToolbelt from './ComposerToolbelt'

interface GroupChatPlaceholderProps {
  theme?: 'default' | 'dark' | 'professional'
  className?: string
}

export const GroupChatPlaceholder: React.FC<GroupChatPlaceholderProps> = ({
  theme = 'default',
  className = ''
}) => {
  const getThemeStyles = () => {
    switch (theme) {
      case 'professional':
        return {
          banner: { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#b45309' },
          sidebar: { background: '#f8fafc', borderRight: '1px solid #e2e8f0' },
          member: { background: '#ffffff', border: '1px solid #e2e8f0' },
          chat: { background: '#ffffff' },
          composer: { background: '#f8fafc', borderTop: '1px solid #e2e8f0' },
          textarea: { background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' },
          button: { background: '#3b82f6', color: 'white' }
        }
      case 'dark':
        return {
          banner: { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' },
          sidebar: { background: 'rgba(255,255,255,0.05)', borderRight: '1px solid rgba(255,255,255,0.1)' },
          member: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' },
          chat: { background: 'transparent' },
          composer: { borderTop: '1px solid rgba(255,255,255,0.1)' },
          textarea: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#e5e7eb' },
          button: { background: '#8b5cf6', color: 'white' }
        }
      default:
        return {
          banner: { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', color: '#fcd34d' },
          sidebar: { background: 'rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.15)' },
          member: { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' },
          chat: { background: 'transparent' },
          composer: { borderTop: '1px solid rgba(255,255,255,0.15)' },
          textarea: { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white' },
          button: { background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', color: 'white' }
        }
    }
  }

  const styles = getThemeStyles()
  const mockMembers = [
    { name: 'You', status: 'online' },
    { name: 'Alice', status: 'online' },
    { name: 'Bob', status: 'away' },
    { name: 'Charlie', status: 'offline' }
  ]

  const statusColors: Record<string, string> = {
    online: '#22c55e',
    away: '#f59e0b',
    offline: '#6b7280'
  }

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
        <span><strong>Group Chat</strong> - UI Preview (not functional)</span>
      </div>

      {/* Main Content: Sidebar + Chat */}
      <div style={{ flex: 1, display: 'flex', margin: '0 8px 8px', overflow: 'hidden' }}>
        {/* Members Sidebar */}
        <div style={{
          width: '120px',
          ...styles.sidebar,
          borderRadius: '8px 0 0 8px',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ fontSize: '10px', fontWeight: 600, opacity: 0.7, marginBottom: '4px' }}>
            MEMBERS ({mockMembers.length})
          </div>
          {mockMembers.map((member, i) => (
            <div key={i} style={{
              ...styles.member,
              padding: '6px 8px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px'
            }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: statusColors[member.status]
              }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {member.name}
              </span>
            </div>
          ))}
        </div>

        {/* Chat Area */}
        <div style={{
          flex: 1,
          ...styles.chat,
          borderRadius: '0 8px 8px 0',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Messages Placeholder */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: 0.5
          }}>
            <span style={{ fontSize: '40px' }}>👥</span>
            <div style={{ fontSize: '13px', marginTop: '8px', fontWeight: 600 }}>Group Chat</div>
            <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>
              Secure multi-user messaging
            </div>
          </div>
        </div>
      </div>

      {/* Composer */}
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
            placeholder="Message group (not functional)"
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

export default GroupChatPlaceholder

