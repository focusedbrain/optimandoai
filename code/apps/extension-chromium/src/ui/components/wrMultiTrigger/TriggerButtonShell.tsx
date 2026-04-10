import React, { useCallback } from 'react'

/**
 * **Monitor** (`continuous-monitor`): Scam Watchdog — scan + **continuous** checkbox only (security monitor).
 * **Snapshot** (`snapshot`): Project WIKI row — **one-shot snapshot** + chat focus; **never** the Watchdog continuous checkbox.
 */

/** Scam Watchdog / monitor: scan + optional continuous interval checkbox (`/api/wrchat/watchdog/*`). */
export type TriggerButtonShellMonitorProps = {
  mode?: 'continuous-monitor'
  selectorSlot?: React.ReactNode
  icon: React.ReactNode
  scanning: boolean
  intervalOn: boolean
  cleanFlash: boolean
  onIconClick: () => void
  onCheckboxToggle: (enabled: boolean) => void
  checkboxChecked: boolean
  /**
   * When false, the continuous-monitoring checkbox is hidden.
   * Prefer `mode="snapshot"` for Project Assistant rows instead of toggling this alone.
   */
  showContinuousCheckbox?: boolean
  disabled?: boolean
  /** Speech bubble — last in the bar, after the continuous monitoring checkbox when shown. */
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

/** Project WIKI row: snapshot + chat focus — **not** Scam Watchdog; no continuous/interval checkbox. */
export type TriggerButtonShellSnapshotProps = {
  mode: 'snapshot'
  selectorSlot?: React.ReactNode
  icon: React.ReactNode
  scanning: boolean
  cleanFlash: boolean
  onIconClick: () => void
  disabled?: boolean
  /** Speech bubble — after scan icon and selector (no interval checkbox in this mode). */
  middleSlot?: React.ReactNode
  theme?: string
  scanButtonTitle: string
  scanButtonAriaLabel: string
  cleanFlashAnnouncement?: string
}

export type TriggerButtonShellProps = TriggerButtonShellMonitorProps | TriggerButtonShellSnapshotProps

const stopCheckboxBubble = (e: React.MouseEvent) => {
  e.stopPropagation()
}

export function TriggerButtonShell(props: TriggerButtonShellProps) {
  const isSnapshot = props.mode === 'snapshot'
  const {
    selectorSlot,
    icon,
    scanning,
    cleanFlash,
    onIconClick,
    disabled = false,
    middleSlot,
    theme = 'pro',
    scanButtonTitle,
    scanButtonAriaLabel,
  } = props

  const cleanFlashAnnouncement =
    props.cleanFlashAnnouncement ??
    (isSnapshot ? 'Snapshot finished' : 'Nothing suspicious found on the screens')

  const mon = !isSnapshot ? (props as TriggerButtonShellMonitorProps) : null
  const showContinuousCheckbox = Boolean(mon && (mon.showContinuousCheckbox ?? true))
  const intervalOn = mon?.intervalOn ?? false
  const checkboxChecked = mon?.checkboxChecked ?? false
  const onCheckboxToggle = mon?.onCheckboxToggle

  const isLight = theme === 'standard'
  const isDark = theme === 'dark'
  const shellBorder = isLight
    ? '1px solid #94a3b8'
    : isDark
      ? '1px solid rgba(148,163,184,0.35)'
      : '1px solid rgba(167,139,250,0.45)'
  const shellBg = isLight ? '#ffffff' : isDark ? 'rgba(15,23,42,0.5)' : 'rgba(49,32,68,0.55)'
  const fg = isLight ? '#0f172a' : '#f5f3ff'

  const pulse = showContinuousCheckbox && intervalOn && !cleanFlash
  const iconGlow = cleanFlash
    ? '0 0 10px rgba(34,197,94,0.85)'
    : pulse
      ? '0 0 8px rgba(251,191,36,0.75)'
      : scanning
        ? '0 0 8px rgba(96,165,250,0.7)'
        : undefined

  const handleCheckbox = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckboxToggle?.(e.target.checked)
    },
    [onCheckboxToggle],
  )

  const groupAria = isSnapshot
    ? 'Project WIKI — run snapshot and chat focus'
    : 'Scam Watchdog — scan and continuous monitoring'

  return (
    <div
      role="group"
      aria-label={groupAria}
      style={{
        position: 'relative',
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
      {selectorSlot}
      {showContinuousCheckbox ? (
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
          title="Continuous monitoring (Scam Watchdog only)"
        >
          <input
            type="checkbox"
            checked={checkboxChecked}
            disabled={disabled}
            onChange={handleCheckbox}
            onClick={stopCheckboxBubble}
            style={{ accentColor: '#22c55e', cursor: disabled ? 'not-allowed' : 'pointer' }}
          />
        </label>
      ) : null}
      {middleSlot}
      {cleanFlash ? (
        <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          {cleanFlashAnnouncement}
        </span>
      ) : null}
    </div>
  )
}
