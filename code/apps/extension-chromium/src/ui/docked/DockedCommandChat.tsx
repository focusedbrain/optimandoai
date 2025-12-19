/**
 * DockedCommandChat Component
 * 
 * Docked version of the Command Chat for use in the sidepanel.
 * Slightly different layout density than the popup version.
 */

import React, { useState } from 'react'
import { useUIStore } from '../../stores/useUIStore'
import { 
  ModeSelect, 
  ModeHeaderBadge,
  CommandChatView,
  P2PChatPlaceholder,
  P2PStreamPlaceholder,
  GroupChatPlaceholder,
  AdminPoliciesPlaceholder
} from '../components'
import { WORKSPACE_INFO } from '../../shared/ui/uiState'

interface DockedCommandChatProps {
  /** Theme variant */
  theme?: 'default' | 'dark' | 'professional'
  /** Height of the chat panel */
  height?: number
  /** Callback when message is sent (to integrate with existing logic) */
  onSend?: (text: string) => void
  /** Current model name */
  modelName?: string
  /** Whether currently processing */
  isLoading?: boolean
  /** Additional toolbar buttons (bucket, pencil, tags, etc.) */
  toolbarExtras?: React.ReactNode
  /** Callback to close/unpin the chat */
  onClose?: () => void
  /** Custom class name */
  className?: string
}

export const DockedCommandChat: React.FC<DockedCommandChatProps> = ({
  theme = 'default',
  height = 300,
  onSend,
  modelName = 'Local',
  isLoading = false,
  toolbarExtras,
  onClose,
  className = ''
}) => {
  const { workspace, mode } = useUIStore()

  // Container styles based on theme
  const getContainerStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      height: `${height}px`,
      borderRadius: '8px',
      overflow: 'hidden',
      position: 'relative'
    }

    switch (theme) {
      case 'professional':
        return {
          ...base,
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
        }
      case 'dark':
        return {
          ...base,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }
      default:
        return {
          ...base,
          background: 'rgba(118,75,162,0.4)',
          border: '1px solid rgba(255,255,255,0.20)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }
    }
  }

  const getHeaderStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      gap: '8px'
    }

    switch (theme) {
      case 'professional':
        return {
          ...base,
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          color: '#0f172a'
        }
      case 'dark':
        return {
          ...base,
          background: 'rgba(0,0,0,0.2)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          color: '#e5e7eb'
        }
      default:
        return {
          ...base,
          background: 'rgba(0,0,0,0.15)',
          borderBottom: '1px solid rgba(255,255,255,0.2)',
          color: 'white'
        }
    }
  }

  const getCloseButtonStyles = (): React.CSSProperties => {
    return {
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      fontSize: '16px',
      opacity: 0.6,
      padding: '4px',
      color: 'inherit',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }

  // Render content based on workspace and mode
  const renderContent = () => {
    // Non-chat workspaces show a hint to use main panel
    if (workspace === 'mailguard' || workspace === 'overlay') {
      const info = WORKSPACE_INFO[workspace]
      return (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          padding: '20px',
          textAlign: 'center',
          opacity: 0.6
        }}>
          <div>
            <span style={{ fontSize: '32px' }}>{info.icon}</span>
            <div style={{ marginTop: '8px', fontSize: '12px', fontWeight: 600 }}>
              {info.label}
            </div>
            <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.7 }}>
              Use the main panel below
            </div>
          </div>
        </div>
      )
    }

    // WR Chat modes
    switch (mode) {
      case 'commands':
        return (
          <CommandChatView 
            theme={theme} 
            onSend={onSend}
            modelName={modelName}
            isLoading={isLoading}
          />
        )
      case 'p2p':
        return <P2PChatPlaceholder theme={theme} />
      case 'p2p_stream':
        return <P2PStreamPlaceholder theme={theme} />
      case 'group':
        return <GroupChatPlaceholder theme={theme} />
      case 'admin_policies':
        return <AdminPoliciesPlaceholder theme={theme} />
      default:
        return <CommandChatView theme={theme} onSend={onSend} />
    }
  }

  return (
    <div style={getContainerStyles()} className={className}>
      {/* Header */}
      <div style={getHeaderStyles()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ModeSelect theme={theme} compact />
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Extra toolbar buttons from parent */}
          {toolbarExtras}
          
          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              style={getCloseButtonStyles()}
              title="Close chat"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </div>
    </div>
  )
}

export default DockedCommandChat


