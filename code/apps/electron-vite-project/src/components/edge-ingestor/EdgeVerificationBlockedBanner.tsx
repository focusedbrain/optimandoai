/**
 * Persistent banner when edge verification is unreachable and messages are held (Prompt D).
 */

import { useCallback, useEffect, useState } from 'react'
import { WRDESK_EXPAND_EMAIL_ACCOUNTS_SECTION } from '../../lib/wrdeskUiEvents.js'

interface IngestionBannerState {
  mode: string
  holdQueueCount: number
  configurationState: string
}

function readBannerState(raw: unknown): IngestionBannerState {
  const snap = raw as Record<string, unknown>
  const hold = snap.holdQueue as { count?: number } | undefined
  const settings = snap.settings as Record<string, unknown> | undefined
  let configurationState = 'not_configured'
  if (settings?.enabled === 'pending') {
    configurationState = 'setup_in_progress'
  } else if (settings?.enabled === true) {
    configurationState = snap.mode === 'Blocked' ? 'configured_unreachable' : 'configured_active'
  }
  return {
    mode: typeof snap.mode === 'string' ? snap.mode : '',
    holdQueueCount: hold?.count ?? 0,
    configurationState,
  }
}

export function EdgeVerificationBlockedBanner() {
  const [state, setState] = useState<IngestionBannerState>({
    mode: '',
    holdQueueCount: 0,
    configurationState: 'not_configured',
  })

  const refresh = useCallback(async () => {
    const api = window.ingestionMode
    if (!api?.get) return
    const snap = await api.get()
    setState(readBannerState(snap))
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.ingestionMode?.onUpdated?.((snap) => setState(readBannerState(snap)))
    return () => off?.()
  }, [refresh])

  const show =
    state.mode === 'Blocked' &&
    state.configurationState === 'configured_unreachable' &&
    state.holdQueueCount > 0

  if (!show) return null

  const noun = state.holdQueueCount === 1 ? 'email is' : 'emails are'

  return (
    <div
      data-testid="edge-verification-blocked-banner"
      style={{
        margin: '0 0 12px',
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid rgba(245,158,11,0.45)',
        background: 'rgba(254,243,199,0.85)',
        color: '#92400e',
        fontSize: 12,
        lineHeight: 1.45,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ flex: '1 1 220px' }}>
        Your verification server is unreachable. {state.holdQueueCount} {noun} being held safely.
      </span>
      <button
        type="button"
        data-testid="edge-verification-blocked-open-settings"
        onClick={() => window.dispatchEvent(new CustomEvent(WRDESK_EXPAND_EMAIL_ACCOUNTS_SECTION))}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid rgba(146,64,14,0.35)',
          background: '#fff',
          color: '#92400e',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}
      >
        Open Email verification settings
      </button>
    </div>
  )
}
