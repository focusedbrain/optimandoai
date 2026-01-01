/**
 * Inbox Import Bar
 * 
 * Control bar with three import buttons for Inbox:
 * 1. Import from Email
 * 2. Import from Messenger  
 * 3. Import from File
 * 
 * @version 1.0.0
 */

import React, { useState, useCallback } from 'react'
import { ImportEmailModal } from './ImportEmailModal'
import { ImportMessengerModal } from './ImportMessengerModal'
import { ImportFileModal } from './ImportFileModal'

interface InboxImportBarProps {
  theme: 'default' | 'dark' | 'professional'
  onNavigateToWRGuard?: () => void
}

export const InboxImportBar: React.FC<InboxImportBarProps> = ({
  theme,
  onNavigateToWRGuard
}) => {
  const isProfessional = theme === 'professional'
  
  // Theming
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const buttonBg = isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)'
  const buttonHoverBg = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.12)'
  
  // Modal state
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [messengerModalOpen, setMessengerModalOpen] = useState(false)
  const [fileModalOpen, setFileModalOpen] = useState(false)
  
  // Button hover states
  const [hoveredButton, setHoveredButton] = useState<string | null>(null)
  
  const buttonStyle = useCallback((id: string) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '10px',
    border: `1px solid ${borderColor}`,
    background: hoveredButton === id ? buttonHoverBg : buttonBg,
    color: textColor,
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  }), [borderColor, buttonBg, buttonHoverBg, textColor, hoveredButton])
  
  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px 20px',
        borderBottom: `1px solid ${borderColor}`,
        background: isProfessional ? 'rgba(15,23,42,0.02)' : 'rgba(255,255,255,0.02)'
      }}>
        {/* Label */}
        <div style={{
          fontSize: '12px',
          fontWeight: 600,
          color: mutedColor,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginRight: '4px'
        }}>
          Import:
        </div>
        
        {/* Email Button */}
        <button
          onClick={() => setEmailModalOpen(true)}
          onMouseEnter={() => setHoveredButton('email')}
          onMouseLeave={() => setHoveredButton(null)}
          style={buttonStyle('email')}
        >
          <span style={{ fontSize: '16px' }}>📧</span>
          <span>Email</span>
        </button>
        
        {/* Messenger Button */}
        <button
          onClick={() => setMessengerModalOpen(true)}
          onMouseEnter={() => setHoveredButton('messenger')}
          onMouseLeave={() => setHoveredButton(null)}
          style={buttonStyle('messenger')}
        >
          <span style={{ fontSize: '16px' }}>💬</span>
          <span>Messenger</span>
        </button>
        
        {/* File Button */}
        <button
          onClick={() => setFileModalOpen(true)}
          onMouseEnter={() => setHoveredButton('file')}
          onMouseLeave={() => setHoveredButton(null)}
          style={buttonStyle('file')}
        >
          <span style={{ fontSize: '16px' }}>💾</span>
          <span>File</span>
        </button>
        
        {/* Spacer */}
        <div style={{ flex: 1 }} />
        
        {/* Help text */}
        <div style={{
          fontSize: '11px',
          color: mutedColor,
          opacity: 0.7
        }}>
          Import BEAP™ packages for verification
        </div>
      </div>
      
      {/* Modals */}
      <ImportEmailModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        theme={theme}
        onNavigateToWRGuard={onNavigateToWRGuard}
      />
      
      <ImportMessengerModal
        isOpen={messengerModalOpen}
        onClose={() => setMessengerModalOpen(false)}
        theme={theme}
      />
      
      <ImportFileModal
        isOpen={fileModalOpen}
        onClose={() => setFileModalOpen(false)}
        theme={theme}
      />
    </>
  )
}

