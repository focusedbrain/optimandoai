/**
 * ModeSelect Component
 * 
 * Unified mode selector with grouped options for workspaces and modes.
 * Displays current workspace + mode in closed state.
 */

import React from 'react'
import { useUIStore } from '../../stores/useUIStore'
import { 
  Mode, 
  Workspace, 
  MODE_INFO, 
  WORKSPACE_INFO,
  getAvailableModes 
} from '../../shared/ui/uiState'

interface ModeSelectProps {
  /** Compact mode for smaller layouts */
  compact?: boolean
  /** Theme variant */
  theme?: 'default' | 'dark' | 'professional'
  /** Custom class name */
  className?: string
}

export const ModeSelect: React.FC<ModeSelectProps> = ({ 
  compact = false, 
  theme = 'default',
  className = ''
}) => {
  const { workspace, mode, role, setMode, setWorkspace } = useUIStore()
  const availableModes = getAvailableModes(role)

  // Build combined value for select
  const currentValue = workspace === 'wr-chat' 
    ? `mode:${mode}` 
    : `workspace:${workspace}`

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (value.startsWith('mode:')) {
      const newMode = value.replace('mode:', '') as Mode
      setWorkspace('wr-chat')
      setMode(newMode)
    } else if (value.startsWith('workspace:')) {
      const newWorkspace = value.replace('workspace:', '') as Workspace
      setWorkspace(newWorkspace)
    }
  }

  // Get display text for current selection
  const getDisplayText = () => {
    if (workspace !== 'wr-chat') {
      const ws = WORKSPACE_INFO[workspace]
      return `${ws.icon} ${ws.label}`
    }
    const ws = WORKSPACE_INFO[workspace]
    const m = MODE_INFO[mode]
    return compact 
      ? `${ws.icon} ${m.shortLabel}`
      : `${ws.icon} ${ws.label} · ${m.label}`
  }

  // Theme-based styles
  const getStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      fontSize: compact ? '11px' : '12px',
      fontWeight: 600,
      height: compact ? '28px' : '32px',
      borderRadius: '6px',
      padding: compact ? '0 24px 0 8px' : '0 28px 0 10px',
      cursor: 'pointer',
      outline: 'none',
      appearance: 'none',
      WebkitAppearance: 'none',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 6px center',
      transition: 'all 0.2s ease'
    }

    switch (theme) {
      case 'professional':
        return {
          ...baseStyles,
          background: 'rgba(15,23,42,0.08)',
          border: '1px solid rgba(15,23,42,0.2)',
          color: '#0f172a',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%230f172a' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`
        }
      case 'dark':
        return {
          ...baseStyles,
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#e5e7eb',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23e5e7eb' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`
        }
      default: // purple theme
        return {
          ...baseStyles,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.25)',
          color: 'white',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`
        }
    }
  }

  const optionStyle: React.CSSProperties = {
    background: theme === 'professional' ? '#ffffff' : '#1e293b',
    color: theme === 'professional' ? '#0f172a' : 'white'
  }

  return (
    <select
      value={currentValue}
      onChange={handleChange}
      style={getStyles()}
      className={className}
      title={getDisplayText()}
    >
      {/* WR Chat Modes Group */}
      <optgroup label="WR Chat" style={optionStyle}>
        {availableModes.map(modeId => {
          const info = MODE_INFO[modeId]
          return (
            <option 
              key={modeId} 
              value={`mode:${modeId}`}
              style={optionStyle}
            >
              {info.icon} {info.label}
              {info.isPlaceholder ? ' (UI Only)' : ''}
            </option>
          )
        })}
      </optgroup>
      
      {/* Other Workspaces Group */}
      <optgroup label="Workspaces" style={optionStyle}>
        <option value="workspace:mailguard" style={optionStyle}>
          {WORKSPACE_INFO.mailguard.icon} {WORKSPACE_INFO.mailguard.label}
        </option>
        <option value="workspace:overlay" style={optionStyle}>
          {WORKSPACE_INFO.overlay.icon} {WORKSPACE_INFO.overlay.label}
        </option>
      </optgroup>
    </select>
  )
}

export default ModeSelect


