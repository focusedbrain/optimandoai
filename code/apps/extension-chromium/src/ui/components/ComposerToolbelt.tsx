/**
 * ComposerToolbelt Component
 * 
 * Compact toolbar for switching composer input modes.
 * Buttons are enabled/disabled based on current mode.
 */

import React from 'react'
import { useUIStore } from '../../stores/useUIStore'
import { ComposerMode } from '../../shared/ui/uiState'
import { 
  COMPOSER_BUTTONS, 
  isComposerButtonEnabled,
  isComposerVisible 
} from '../../shared/ui/capabilities'

interface ComposerToolbeltProps {
  /** Theme variant */
  theme?: 'default' | 'dark' | 'professional'
  /** Show labels next to icons */
  showLabels?: boolean
  /** Callback when AI Assist is clicked */
  onAIAssistClick?: () => void
  /** Custom class name */
  className?: string
}

export const ComposerToolbelt: React.FC<ComposerToolbeltProps> = ({
  theme = 'default',
  showLabels = false,
  onAIAssistClick,
  className = ''
}) => {
  const { mode, composerMode, setComposerMode } = useUIStore()

  // Don't render if composer is hidden for this mode
  if (!isComposerVisible(mode)) {
    return null
  }

  const handleButtonClick = (buttonMode: ComposerMode) => {
    if (buttonMode === 'ai_assist' && onAIAssistClick) {
      onAIAssistClick()
    }
    setComposerMode(buttonMode)
  }

  // Theme-based button styles
  const getButtonStyles = (buttonId: ComposerMode, isEnabled: boolean, isActive: boolean): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: showLabels ? '4px' : '0',
      height: '28px',
      minWidth: showLabels ? 'auto' : '28px',
      padding: showLabels ? '0 8px' : '0 6px',
      borderRadius: '6px',
      fontSize: '12px',
      cursor: isEnabled ? 'pointer' : 'not-allowed',
      opacity: isEnabled ? 1 : 0.4,
      transition: 'all 0.15s ease',
      border: 'none'
    }

    const getThemeColors = () => {
      switch (theme) {
        case 'professional':
          return {
            activeBg: 'rgba(59,130,246,0.15)',
            activeBorder: '1px solid rgba(59,130,246,0.3)',
            activeColor: '#2563eb',
            defaultBg: 'rgba(15,23,42,0.08)',
            defaultBorder: '1px solid rgba(15,23,42,0.15)',
            defaultColor: '#475569'
          }
        case 'dark':
          return {
            activeBg: 'rgba(139,92,246,0.25)',
            activeBorder: '1px solid rgba(139,92,246,0.4)',
            activeColor: '#a78bfa',
            defaultBg: 'rgba(255,255,255,0.1)',
            defaultBorder: '1px solid rgba(255,255,255,0.15)',
            defaultColor: '#94a3b8'
          }
        default: // purple
          return {
            activeBg: 'rgba(255,255,255,0.25)',
            activeBorder: '1px solid rgba(255,255,255,0.4)',
            activeColor: 'white',
            defaultBg: 'rgba(255,255,255,0.1)',
            defaultBorder: '1px solid rgba(255,255,255,0.2)',
            defaultColor: 'rgba(255,255,255,0.8)'
          }
      }
    }

    const colors = getThemeColors()

    if (isActive && isEnabled) {
      return {
        ...baseStyles,
        background: colors.activeBg,
        border: colors.activeBorder,
        color: colors.activeColor
      }
    }

    return {
      ...baseStyles,
      background: colors.defaultBg,
      border: colors.defaultBorder,
      color: colors.defaultColor
    }
  }

  return (
    <div 
      className={className}
      style={{
        display: 'flex',
        gap: '4px',
        alignItems: 'center'
      }}
    >
      {COMPOSER_BUTTONS.map(button => {
        const isEnabled = isComposerButtonEnabled(mode, button.id)
        const isActive = composerMode === button.id
        
        return (
          <button
            key={button.id}
            onClick={() => isEnabled && handleButtonClick(button.id)}
            disabled={!isEnabled}
            title={`${button.title}${!isEnabled ? ' (disabled for this mode)' : ''}`}
            style={getButtonStyles(button.id, isEnabled, isActive)}
          >
            <span>{button.icon}</span>
            {showLabels && <span style={{ fontSize: '11px' }}>{button.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default ComposerToolbelt






