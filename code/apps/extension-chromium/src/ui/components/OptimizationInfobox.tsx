import React from 'react'
import { useChatFocusStore } from '../../stores/chatFocusStore'

function isIconUrl(icon: string): boolean {
  const t = icon.trim()
  return /^https?:\/\//i.test(t) || t.startsWith('data:') || t.startsWith('blob:')
}

export default function OptimizationInfobox({ theme = 'pro' }: { theme?: string }) {
  const chatFocusMode = useChatFocusStore((s) => s.chatFocusMode)
  const exitOptimizationFocus = useChatFocusStore((s) => s.exitOptimizationFocus)
  const optimizationLastRunAt = useChatFocusStore((s) => s.optimizationLastRunAt)
  const optimizationSuggestionCount = useChatFocusStore((s) => s.optimizationSuggestionCount)

  if (chatFocusMode.mode !== 'auto-optimizer') return null

  const isLight = theme === 'standard'
  const bg = isLight ? 'rgba(59,130,246,0.12)' : 'rgba(99,102,241,0.22)'
  const border = isLight ? '1px solid rgba(59,130,246,0.35)' : '1px solid rgba(167,139,250,0.4)'
  const textColor = isLight ? '#0f172a' : '#f1f5f9'
  const muted = isLight ? 'rgba(15,23,42,0.55)' : 'rgba(241,245,249,0.65)'

  const rawIcon = chatFocusMode.projectIcon?.trim() || ''
  const title = chatFocusMode.projectTitle?.trim() || 'Project'
  const mile = chatFocusMode.milestoneTitle?.trim()

  const iconEl =
    rawIcon && isIconUrl(rawIcon) ? (
      <img
        src={rawIcon}
        alt=""
        style={{ width: 14, height: 14, objectFit: 'contain', flexShrink: 0, verticalAlign: 'middle' }}
      />
    ) : (
      <span aria-hidden style={{ flexShrink: 0 }}>
        {rawIcon || '📊'}
      </span>
    )

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
        <div
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {iconEl}
          <span style={{ fontWeight: 700 }}>{title}</span>
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            fontWeight: 400,
            lineHeight: 1.35,
            whiteSpace: 'normal',
            color: textColor,
          }}
        >
          <span>Optimization active</span>
          {mile ? (
            <>
              <span style={{ opacity: 0.85 }}> · </span>
              <span style={{ color: muted, fontWeight: 400 }}>{mile}</span>
            </>
          ) : null}
        </div>
        {optimizationLastRunAt && optimizationSuggestionCount != null ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1.35,
              color: muted,
            }}
          >
            Last run:{' '}
            {(() => {
              try {
                return new Date(optimizationLastRunAt).toLocaleString(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              } catch {
                return optimizationLastRunAt
              }
            })()}{' '}
            · {optimizationSuggestionCount} suggestion{optimizationSuggestionCount === 1 ? '' : 's'}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        title="Exit optimization focus"
        aria-label="Exit optimization focus"
        onClick={() => exitOptimizationFocus()}
        style={{
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          borderRadius: 6,
          cursor: 'pointer',
          padding: '2px 6px',
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1.2,
          color: isLight ? '#2563eb' : '#a5b4fc',
          textDecoration: 'underline',
        }}
      >
        Exit focus
      </button>
    </div>
  )
}
