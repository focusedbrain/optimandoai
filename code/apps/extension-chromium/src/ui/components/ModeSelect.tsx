/**
 * ModeSelect — compact grouped selector: built-in WR Chat modes, custom modes, then + Add Mode, then workspaces.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../stores/useUIStore'
import { useCustomModesStore } from '../../stores/useCustomModesStore'
import {
  Mode,
  MODE_INFO,
  WORKSPACE_INFO,
  getAvailableModes,
  BuiltInMode,
} from '../../shared/ui/uiState'
import { isCustomModeId } from '../../shared/ui/customModeTypes'
import { safeCustomModeRowLabel } from '../../shared/ui/customModeDisplay'
import { CustomModeWizard } from './CustomModeWizard'

const ADD_MODE_VALUE = '__add_mode__'
const NO_CUSTOM_PLACEHOLDER = '__no_custom_modes__'

/** Lightweight visual cue in the dropdown (custom rows only). */
const CUSTOM_OPTION_PREFIX = '✎ '

interface ModeSelectProps {
  compact?: boolean
  theme?: 'default' | 'dark' | 'professional'
  className?: string
}

export const ModeSelect: React.FC<ModeSelectProps> = ({
  compact = false,
  theme = 'default',
  className = '',
}) => {
  const { workspace, mode, role, setMode, setWorkspace } = useUIStore()
  const customModes = useCustomModesStore((s) => s.modes)
  const addMode = useCustomModesStore((s) => s.addMode)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const availableModes = getAvailableModes(role)

  useEffect(() => {
    if (!isCustomModeId(mode)) return
    const exists = customModes.some((m) => m.id === mode)
    if (!exists) {
      setMode('commands')
    }
  }, [mode, customModes, setMode])

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [])

  const currentValue = workspace === 'wr-chat' ? `mode:${mode}` : `workspace:${workspace}`

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (value === ADD_MODE_VALUE) {
      setWizardOpen(true)
      return
    }
    if (value === NO_CUSTOM_PLACEHOLDER) {
      return
    }
    if (value.startsWith('mode:')) {
      const newMode = value.slice('mode:'.length) as Mode
      setWorkspace('wr-chat')
      setMode(newMode)
    } else if (value.startsWith('workspace:')) {
      const newWorkspace = value.replace('workspace:', '') as typeof workspace
      setWorkspace(newWorkspace)
    }
  }

  const getDisplayText = () => {
    if (workspace !== 'wr-chat') {
      const ws = WORKSPACE_INFO[workspace]
      return `${ws.icon} ${ws.label}`
    }
    const ws = WORKSPACE_INFO[workspace]
    if (isCustomModeId(mode)) {
      const cm = customModes.find((m) => m.id === mode)
      const { label, iconChar } = safeCustomModeRowLabel(cm?.name, cm?.icon)
      return compact ? `${ws.icon} ${iconChar} ${label}` : `${ws.icon} ${ws.label} · ${label}`
    }
    const m = MODE_INFO[mode as BuiltInMode]
    return compact ? `${ws.icon} ${m.shortLabel}` : `${ws.icon} ${ws.label} · ${m.label}`
  }

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
      transition: 'all 0.2s ease',
    }

    switch (theme) {
      case 'professional':
        return {
          ...baseStyles,
          background: 'rgba(15,23,42,0.08)',
          border: '1px solid rgba(15,23,42,0.2)',
          color: '#0f172a',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%230f172a' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
        }
      case 'dark':
        return {
          ...baseStyles,
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#e5e7eb',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23e5e7eb' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
        }
      default:
        return {
          ...baseStyles,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.25)',
          color: 'white',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
        }
    }
  }

  const optionStyle: React.CSSProperties = {
    background: theme === 'professional' ? '#ffffff' : '#1e293b',
    color: theme === 'professional' ? '#0f172a' : 'white',
  }

  const announceId = 'mode-select-success-announcer'

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: compact ? 4 : 6 }}>
        <select
          value={currentValue}
          onChange={handleChange}
          style={getStyles()}
          className={className}
          title={getDisplayText()}
          aria-label="Workspace, built-in mode, custom modes, and workspaces"
        >
          <optgroup label="Built-in" style={optionStyle}>
            {availableModes.map((modeId) => {
              const info = MODE_INFO[modeId]
              return (
                <option key={modeId} value={`mode:${modeId}`} style={optionStyle}>
                  {info.icon} {info.label}
                  {info.isPlaceholder ? ' (UI Only)' : ''}
                </option>
              )
            })}
          </optgroup>

          <optgroup label="Custom" style={optionStyle}>
            {customModes.length === 0 ? (
              <option value={NO_CUSTOM_PLACEHOLDER} disabled style={optionStyle}>
                No custom modes yet — add one below
              </option>
            ) : (
              customModes.map((cm) => {
                const { label, iconChar } = safeCustomModeRowLabel(cm.name, cm.icon)
                return (
                  <option key={cm.id} value={`mode:${cm.id}`} style={optionStyle}>
                    {CUSTOM_OPTION_PREFIX}
                    {iconChar} {label}
                  </option>
                )
              })
            )}
          </optgroup>

          <optgroup label="Add" style={optionStyle}>
            <option value={ADD_MODE_VALUE} style={optionStyle}>
              + Add Mode
            </option>
          </optgroup>

          <optgroup label="Workspaces" style={optionStyle}>
            <option value="workspace:mailguard" style={optionStyle}>
              {WORKSPACE_INFO.mailguard.icon} {WORKSPACE_INFO.mailguard.label}
            </option>
            <option value="workspace:overlay" style={optionStyle}>
              {WORKSPACE_INFO.overlay.icon} {WORKSPACE_INFO.overlay.label}
            </option>
          </optgroup>
        </select>

        {successMessage ? (
          <span
            id={announceId}
            role="status"
            aria-live="polite"
            style={{
              fontSize: compact ? 10 : 11,
              fontWeight: 600,
              color: theme === 'professional' ? '#15803d' : theme === 'dark' ? '#86efac' : 'rgba(255,255,255,0.95)',
              lineHeight: 1.3,
            }}
          >
            {successMessage}
          </span>
        ) : null}
      </div>

      <CustomModeWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        theme={theme}
        onSave={(draft) => {
          const id = addMode(draft)
          setWorkspace('wr-chat')
          setMode(id)
        }}
        onSaved={() => {
          if (successTimerRef.current) clearTimeout(successTimerRef.current)
          setSuccessMessage('Custom mode created and selected.')
          successTimerRef.current = setTimeout(() => {
            setSuccessMessage(null)
            successTimerRef.current = null
          }, 4500)
        }}
      />
    </>
  )
}

export default ModeSelect
