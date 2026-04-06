import React from 'react'
import { useChatFocusStore } from '../../stores/chatFocusStore'

export default function ChatFocusBanner({ theme = 'pro' }: { theme?: string }) {
  const chatFocusMode = useChatFocusStore((s) => s.chatFocusMode)
  const focusMeta = useChatFocusStore((s) => s.focusMeta)
  const clearChatFocusMode = useChatFocusStore((s) => s.clearChatFocusMode)

  if (chatFocusMode.mode === 'default') return null

  const isLight = theme === 'standard'
  const bg = isLight ? 'rgba(59,130,246,0.12)' : 'rgba(99,102,241,0.22)'
  const border = isLight ? '1px solid rgba(59,130,246,0.35)' : '1px solid rgba(167,139,250,0.4)'
  const textColor = isLight ? '#0f172a' : '#f1f5f9'

  let label: React.ReactNode
  if (chatFocusMode.mode === 'scam-watchdog') {
    label = <>🐕 ScamWatchdog</>
  } else {
    const icon = focusMeta?.projectIcon?.trim() || '📊'
    const title = focusMeta?.projectTitle?.trim() || 'Project'
    label = (
      <>
        <span aria-hidden>{icon}</span> Optimizing: {title}
      </>
    )
  }

  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 10px',
        marginBottom: 8,
        borderRadius: 8,
        background: bg,
        border,
        fontSize: 11,
        fontWeight: 600,
        color: textColor,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <button
        type="button"
        title="Clear focus mode"
        aria-label="Clear focus mode"
        onClick={() => clearChatFocusMode()}
        style={{
          flexShrink: 0,
          border: 'none',
          background: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.12)',
          borderRadius: 6,
          cursor: 'pointer',
          padding: '2px 8px',
          fontSize: 12,
          lineHeight: 1.2,
          color: textColor,
        }}
      >
        ✕
      </button>
    </div>
  )
}
