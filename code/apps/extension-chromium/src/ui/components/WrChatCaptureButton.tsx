import React, { useCallback } from 'react'
import { startWrChatScreenCapture } from './wrChatCaptureDispatch'

const CAPTURE_TITLE = 'Capture a screen region (screenshot or stream) — LmGTFY'

/** Region-select corners + center dot — no emoji; works across fonts and encodings */
export function WrChatCaptureIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  )
}

export type WrChatCaptureButtonProps = {
  variant: 'compact' | 'comfortable'
  theme: 'pro' | 'dark' | 'standard'
  /** Sidepanel docked layouts only */
  sidepanelPreset?: 'enterprise' | 'appBar'
  source?: string
  createTrigger?: boolean
  addCommand?: boolean
}

export const WrChatCaptureButton: React.FC<WrChatCaptureButtonProps> = ({
  variant,
  theme,
  sidepanelPreset,
  source,
  createTrigger,
  addCommand,
}) => {
  const onClick = useCallback(() => {
    startWrChatScreenCapture({ source, createTrigger, addCommand })
  }, [source, createTrigger, addCommand])

  const iconSize = variant === 'comfortable' ? 12 : 18

  // PopupChatView header: match Clear / Tags
  if (variant === 'comfortable') {
    const isLight = theme === 'standard'
    const isDark = theme === 'dark'
    const isPro = theme === 'pro'
    return (
      <button
        type="button"
        onClick={onClick}
        title={CAPTURE_TITLE}
        aria-label="Capture screen region"
        style={{
          padding: '0 10px',
          height: '22px',
          fontSize: '10px',
          fontWeight: 500,
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          border: isLight
            ? '1px solid #e1e8ed'
            : isDark
              ? '1px solid rgba(255,255,255,0.2)'
              : '1px solid rgba(255,255,255,0.45)',
          background: isLight ? '#ffffff' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(118,75,162,0.35)',
          color: isLight ? '#0f172a' : isDark ? '#f1f5f9' : '#ffffff',
          transition: 'background 0.2s ease',
          minWidth: 28,
          boxSizing: 'border-box',
        }}
        onMouseEnter={(e) => {
          if (isLight) {
            e.currentTarget.style.background = '#eef3f6'
            e.currentTarget.style.color = '#0f172a'
          } else if (isDark) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
          } else {
            e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
          }
        }}
        onMouseLeave={(e) => {
          if (isLight) {
            e.currentTarget.style.background = '#ffffff'
            e.currentTarget.style.color = '#0f172a'
          } else if (isDark) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
          } else {
            e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
          }
        }}
        onFocus={(e) => {
          e.currentTarget.style.boxShadow = isLight
            ? '0 0 0 2px rgba(99,102,241,0.45)'
            : '0 0 0 2px rgba(167,139,250,0.55)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <WrChatCaptureIcon size={iconSize} />
        </span>
        <span>Capture</span>
      </button>
    )
  }

  // Compact: sidepanel docked
  const isStandard = theme === 'standard'
  const isDark = theme === 'dark'

  const baseEnterprise = (): React.CSSProperties => ({
    ...chatControlBase(theme),
    borderRadius: '6px',
    padding: '0 8px',
    height: '28px',
    minWidth: '28px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    color: isStandard ? '#0f172a' : isDark ? '#f1f5f9' : '#ffffff',
    border: isStandard ? '1px solid #cbd5e1' : `1px solid ${isDark ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.55)'}`,
    background: isStandard ? '#f1f5f9' : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(118,75,162,0.45)',
    boxShadow: isStandard ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
  })

  const baseAppBar = (): React.CSSProperties => ({
    borderRadius: '6px',
    padding: '0 8px',
    height: '28px',
    minWidth: '28px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#ffffff',
  })

  const preset = sidepanelPreset ?? 'enterprise'
  const styleBase = preset === 'appBar' ? baseAppBar() : baseEnterprise()

  const onMouseEnterEnterprise = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) el.style.background = '#e2e8f0'
    else if (isDark) el.style.background = 'rgba(255,255,255,0.28)'
    else el.style.background = 'rgba(118,75,162,0.65)'
  }
  const onMouseLeaveEnterprise = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) el.style.background = '#f1f5f9'
    else if (isDark) el.style.background = 'rgba(255,255,255,0.14)'
    else el.style.background = 'rgba(118,75,162,0.45)'
  }

  const onMouseEnterAppBar = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) el.style.background = 'rgba(15,23,42,0.12)'
    else if (isDark) el.style.background = 'rgba(255,255,255,0.25)'
    else el.style.background = 'rgba(118,75,162,0.6)'
  }
  const onMouseLeaveAppBar = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    if (isStandard) el.style.background = 'rgba(15,23,42,0.08)'
    else if (isDark) el.style.background = 'rgba(255,255,255,0.15)'
    else el.style.background = 'rgba(118,75,162,0.35)'
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={CAPTURE_TITLE}
      aria-label="Capture screen region"
      style={styleBase}
      onMouseEnter={preset === 'appBar' ? onMouseEnterAppBar : onMouseEnterEnterprise}
      onMouseLeave={preset === 'appBar' ? onMouseLeaveAppBar : onMouseLeaveEnterprise}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.55)'
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = preset === 'enterprise' && isStandard ? '0 1px 2px rgba(15,23,42,0.08)' : 'none'
      }}
    >
      <WrChatCaptureIcon size={iconSize} />
    </button>
  )
}
