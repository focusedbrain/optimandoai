/**
 * Popup Chat Entry Point
 * 
 * React entry for the Command Chat popup window.
 * Uses shared components from the UI library.
 */

import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useUIStore } from './stores/useUIStore'
import { 
  ModeSelect, 
  ModeHeaderBadge,
  CommandChatView,
  P2PChatPlaceholder,
  P2PStreamPlaceholder,
  GroupChatPlaceholder,
  AdminPoliciesPlaceholder
} from './ui/components'
import { WORKSPACE_INFO } from './shared/ui/uiState'

// =============================================================================
// Theme Type
// =============================================================================

type Theme = 'default' | 'dark' | 'professional'

// Get initial theme from window (set by inline script in HTML)
const getInitialTheme = (): Theme => {
  const t = (window as any).__INITIAL_THEME__
  if (t === 'professional' || t === 'dark') return t
  return 'default'
}

// =============================================================================
// Main App Component
// =============================================================================

function PopupChatApp() {
  const [theme] = useState<Theme>(getInitialTheme)
  const { workspace, mode, role, setRole } = useUIStore()
  
  // For debugging: toggle admin role with keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+A to toggle admin
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        setRole(role === 'admin' ? 'user' : 'admin')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [role, setRole])

  // Render the appropriate view based on workspace and mode
  const renderContent = () => {
    // Non-chat workspaces
    if (workspace === 'mailguard') {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '40px' }}>{WORKSPACE_INFO.mailguard.icon}</span>
            <div style={{ marginTop: '12px', fontSize: '14px', fontWeight: 600 }}>
              {WORKSPACE_INFO.mailguard.label}
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.7 }}>
              Switch to Docked Panel for MailGuard
            </div>
          </div>
        </div>
      )
    }
    
    if (workspace === 'overlay') {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '40px' }}>{WORKSPACE_INFO.overlay.icon}</span>
            <div style={{ marginTop: '12px', fontSize: '14px', fontWeight: 600 }}>
              {WORKSPACE_INFO.overlay.label}
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.7 }}>
              Switch to Docked Panel for Overlay
            </div>
          </div>
        </div>
      )
    }

    // WR Chat modes
    switch (mode) {
      case 'commands':
        return <CommandChatView theme={theme} />
      case 'p2p':
        return <P2PChatPlaceholder theme={theme} />
      case 'p2p_stream':
        return <P2PStreamPlaceholder theme={theme} />
      case 'group':
        return <GroupChatPlaceholder theme={theme} />
      case 'admin_policies':
        return <AdminPoliciesPlaceholder theme={theme} />
      default:
        return <CommandChatView theme={theme} />
    }
  }

  // Theme-based container styles
  const containerStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden'
  }

  const headerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    gap: '10px',
    borderBottom: theme === 'professional' 
      ? '1px solid #e2e8f0'
      : '1px solid rgba(255,255,255,0.15)',
    background: theme === 'professional'
      ? 'rgba(248,250,252,0.95)'
      : 'rgba(0,0,0,0.15)'
  }

  return (
    <div style={containerStyles}>
      {/* Header with Mode Select */}
      <header style={headerStyles}>
        <ModeSelect theme={theme} compact />
        <ModeHeaderBadge theme={theme} compact />
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </main>

      {/* Footer: Role indicator (debug) */}
      {process.env.NODE_ENV === 'development' && (
        <footer style={{
          padding: '4px 12px',
          fontSize: '10px',
          opacity: 0.5,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>Role: {role}</span>
          <span>Ctrl+Shift+A to toggle admin</span>
        </footer>
      )}
    </div>
  )
}

// =============================================================================
// Mount React App
// =============================================================================

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<PopupChatApp />)
}

