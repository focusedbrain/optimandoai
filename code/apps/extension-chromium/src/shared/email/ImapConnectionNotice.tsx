/**
 * Honest IMAP limitations copy — Connect Email wizard (IMAP path), optional debug panel, etc.
 * Collapse/dismiss is remembered per account id in localStorage (Electron + extension).
 */

import React, { useCallback, useMemo, useState } from 'react'

const STORAGE_PREFIX = 'wr_desk_imap_notice_collapsed:'

export type ImapNoticeVariant = 'account-card' | 'debug' | 'wizard-compact' | 'wizard-full'

export interface ImapConnectionNoticeProps {
  /** Used for dismiss persistence; use "global" for non-account contexts */
  accountId: string
  variant: ImapNoticeVariant
  theme: 'professional' | 'dark'
  /** Optional doc URL — omit to hide "Learn more" */
  learnMoreUrl?: string
}

const BODY_PARAGRAPHS = [
  'This account uses IMAP (basic email protocol). First inbox pull uses a Smart Sync window (default: last 30 days, up to 500 messages) plus Pull More for older mail — same as other providers.',
  'Remote folder sync (moving sorted emails back to your mailbox) may be slow or unreliable depending on your email provider’s connection limits.',
  'For best results, use a provider with API access:',
  '• Microsoft 365 / Outlook — Smart Sync ✓',
  '• Gmail — Smart Sync via Gmail API ✓',
  '• Zoho Mail — Smart Sync via Zoho API ✓',
  'IMAP limitations:',
  '• Sorting back to remote folders may take 30–60+ minutes for large mailboxes',
  '• Some providers (web.de, GMX) limit connections and may interrupt sync',
  '• Pull and classification work normally — only remote folder mirroring is affected',
  'Pulling and classifying your emails works fully with IMAP. Remote folder sync runs in the background — check progress in the Debug panel.',
]

export function ImapConnectionNotice({
  accountId,
  variant,
  theme,
  learnMoreUrl,
}: ImapConnectionNoticeProps) {
  const isPro = theme === 'professional'
  const storageKey = `${STORAGE_PREFIX}${accountId}`

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })

  const toggle = useCallback(() => {
    const next = !collapsed
    setCollapsed(next)
    try {
      if (next) localStorage.setItem(storageKey, '1')
      else localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
  }, [collapsed, storageKey])

  const boxStyle = useMemo((): React.CSSProperties => {
    const base: React.CSSProperties = {
      borderRadius: 8,
      border: isPro ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(251, 191, 36, 0.35)',
      background: isPro ? 'rgba(254, 243, 199, 0.95)' : 'rgba(120, 53, 15, 0.35)',
      color: isPro ? '#78350f' : 'rgba(255, 255, 255, 0.92)',
    }
    if (variant === 'wizard-compact') {
      return { ...base, padding: '10px 12px', fontSize: 11, lineHeight: 1.45, marginBottom: 12 }
    }
    if (variant === 'wizard-full') {
      return { ...base, padding: '12px 14px', fontSize: 11, lineHeight: 1.5, marginTop: 12 }
    }
    if (variant === 'debug') {
      return { ...base, padding: '12px 14px', fontSize: 11, lineHeight: 1.5, marginBottom: 12 }
    }
    return { ...base, padding: '10px 12px', fontSize: 11, lineHeight: 1.5, marginTop: 8 }
  }, [isPro, variant])

  if (collapsed && variant !== 'wizard-compact') {
    return (
      <button
        type="button"
        onClick={toggle}
        style={{
          ...boxStyle,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span>⚠️ IMAP — remote sync may be slow (tap to expand)</span>
        <span style={{ opacity: 0.8 }}>▼</span>
      </button>
    )
  }

  const showFull = variant !== 'wizard-compact'

  return (
    <div style={boxStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: showFull ? 8 : 0 }}>
        <div style={{ fontWeight: 700, fontSize: variant === 'wizard-compact' ? 11 : 12 }}>⚠️ IMAP connection</div>
        {variant !== 'wizard-compact' ? (
          <button
            type="button"
            onClick={toggle}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 10,
              opacity: 0.85,
              whiteSpace: 'nowrap',
            }}
          >
            Collapse
          </button>
        ) : null}
      </div>
      {showFull ? (
        <div style={{ opacity: 0.95 }}>
          {BODY_PARAGRAPHS.map((line, i) => (
            <div key={i} style={{ marginBottom: line.startsWith('•') || line.startsWith('IMAP') ? 4 : 6 }}>
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ opacity: 0.95 }}>
          Remote folder mirroring over IMAP can be slow or interrupted (provider limits). Pull & classify work fully. Prefer
          Microsoft 365 for fastest remote sync.
        </div>
      )}
      {learnMoreUrl ? (
        <a
          href={learnMoreUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            marginTop: 8,
            fontSize: 10,
            fontWeight: 600,
            color: isPro ? '#b45309' : '#fcd34d',
          }}
        >
          Learn more (sync behavior)
        </a>
      ) : null}
    </div>
  )
}
