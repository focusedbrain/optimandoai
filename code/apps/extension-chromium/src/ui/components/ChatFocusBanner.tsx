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
  let hint: React.ReactNode
  if (chatFocusMode.mode === 'scam-watchdog') {
    label = <>🐕 ScamWatchdog</>
    hint =
      'Share anything that looks suspicious: photos, pasted text, links, or attachments. We help assess scam, fraud, or phishing risk.'
  } else {
    const icon = focusMeta?.projectIcon?.trim() || '📊'
    const title = focusMeta?.projectTitle?.trim() || 'Project'
    label = (
      <>
        <span aria-hidden>{icon}</span> Optimizing: {title}
      </>
    )
    hint = (
      <>
        <p style={{ margin: 0 }}>
          Auto-Optimization mode turns wrchat into a focused optimization workspace.
        </p>
        <p style={{ margin: '6px 0 0' }}>
          In this mode, wrchat uses the project description and milestones as the foundation for improving the
          project automatically. Users can also add extra information such as goals, constraints, milestones, or
          relevant files to give the optimizer more context and help it make better optimization decisions.
        </p>
      </>
    )
  }

  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 10px',
        marginBottom: 8,
        borderRadius: 8,
        background: bg,
        border,
        fontSize: 11,
        fontWeight: 600,
        color: textColor,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            fontWeight: 400,
            lineHeight: 1.35,
            opacity: 0.92,
            whiteSpace: 'normal',
          }}
        >
          {hint}
        </div>
      </div>
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
