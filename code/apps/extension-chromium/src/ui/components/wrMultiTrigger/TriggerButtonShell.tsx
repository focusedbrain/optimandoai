import React, { useCallback } from 'react'

export interface TriggerButtonShellProps {
  icon: React.ReactNode
  scanning: boolean
  intervalOn: boolean
  cleanFlash: boolean
  onIconClick: () => void
  onCheckboxToggle: (enabled: boolean) => void
  checkboxChecked: boolean
  disabled?: boolean
  /** Optional slot between icon and checkbox (e.g. speech bubble). */
  middleSlot?: React.ReactNode
  /** Visual theme — matches WrChatWatchdogButton (standard | dark | pro). */
  theme?: string
  /** `title` on the icon control. */
  scanButtonTitle: string
  /** `aria-label` on the icon control. */
  scanButtonAriaLabel: string
  /** Screen-reader text when `cleanFlash` (visually hidden). */
  cleanFlashAnnouncement?: string
}

const stopCheckboxBubble = (e: React.MouseEvent) => {
  e.stopPropagation()
}

export function TriggerButtonShell({
  icon,
  scanning,
  intervalOn,
  cleanFlash,
  onIconClick,
  onCheckboxToggle,
  checkboxChecked,
  disabled = false,
  middleSlot,
  theme = 'pro',
  scanButtonTitle,
  scanButtonAriaLabel,
  cleanFlashAnnouncement = 'Nothing suspicious found on the screens',
}: TriggerButtonShellProps) {
  const isLight = theme === 'standard'
  const isDark = theme === 'dark'
  const shellBorder = isLight
    ? '1px solid #94a3b8'
    : isDark
      ? '1px solid rgba(148,163,184,0.35)'
      : '1px solid rgba(167,139,250,0.45)'
  const shellBg = isLight ? '#ffffff' : isDark ? 'rgba(15,23,42,0.5)' : 'rgba(49,32,68,0.55)'
  const fg = isLight ? '#0f172a' : '#f5f3ff'

  const pulse = intervalOn && !cleanFlash
  const iconGlow = cleanFlash
    ? '0 0 10px rgba(34,197,94,0.85)'
    : pulse
      ? '0 0 8px rgba(251,191,36,0.75)'
      : scanning
        ? '0 0 8px rgba(96,165,250,0.7)'
        : undefined

  const handleCheckbox = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckboxToggle(e.target.checked)
    },
    [onCheckboxToggle],
  )

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 8,
        border: shellBorder,
        background: shellBg,
        color: fg,
        opacity: disabled ? 0.55 : 1,
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        title={scanButtonTitle}
        aria-label={scanButtonAriaLabel}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!disabled) onIconClick()
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: cleanFlash
            ? 'rgba(34,197,94,0.35)'
            : isLight
              ? 'rgba(15,23,42,0.06)'
              : 'rgba(255,255,255,0.08)',
          boxShadow: iconGlow,
          color: fg,
        }}
      >
        {icon}
      </button>
      {middleSlot}
      <label
        onClick={stopCheckboxBubble}
        onMouseDown={stopCheckboxBubble}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 10,
          userSelect: 'none',
        }}
        title="Continuous monitoring"
      >
        <input
          type="checkbox"
          checked={checkboxChecked}
          disabled={disabled}
          onChange={handleCheckbox}
          onClick={stopCheckboxBubble}
          style={{ accentColor: '#22c55e', cursor: disabled ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ opacity: 0.85, fontSize: 9 }}>⟳</span>
      </label>
      {cleanFlash ? (
        <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          {cleanFlashAnnouncement}
        </span>
      ) : null}
    </div>
  )
}
