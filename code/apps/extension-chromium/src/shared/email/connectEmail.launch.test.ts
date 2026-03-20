/**
 * Connect-email launcher contract — no DOM / Electron (wizard UI is covered manually).
 */
import { describe, it, expect } from 'vitest'
import { ConnectEmailLaunchSource, formatConnectEmailLaunchSource } from './connectEmailTypes'
import { wizardThemeFromFlowTheme } from './connectEmailFlow'

/** Surfaces that must pass a stable launch source into `openConnectEmail` (see useConnectEmailFlow). */
const REQUIRED_LAUNCH_SOURCES = [
  ConnectEmailLaunchSource.Inbox,
  ConnectEmailLaunchSource.BulkInbox,
  ConnectEmailLaunchSource.WrChatDocked,
  ConnectEmailLaunchSource.WrChatPopup,
  ConnectEmailLaunchSource.BeapInboxDashboard,
  ConnectEmailLaunchSource.BeapBulkInboxDashboard,
] as const

describe('ConnectEmailLaunchSource', () => {
  it('keeps stable string values for logging / analytics', () => {
    expect(ConnectEmailLaunchSource.Inbox).toBe('inbox')
    expect(ConnectEmailLaunchSource.BulkInbox).toBe('bulk_inbox')
    expect(ConnectEmailLaunchSource.WrChatDocked).toBe('wr_chat_docked')
    expect(ConnectEmailLaunchSource.WrChatPopup).toBe('wr_chat_popup')
  })

  it('covers all product entrypoints (Inbox, Bulk, WR Chat docked/popup, legacy BEAP)', () => {
    const keys = new Set(Object.values(ConnectEmailLaunchSource))
    for (const s of REQUIRED_LAUNCH_SOURCES) {
      expect(keys.has(s)).toBe(true)
    }
  })

  it('formatConnectEmailLaunchSource returns non-empty labels for each source', () => {
    for (const s of Object.values(ConnectEmailLaunchSource) as ConnectEmailLaunchSource[]) {
      const label = formatConnectEmailLaunchSource(s)
      expect(label.length).toBeGreaterThan(1)
      expect(label).not.toBe('Email')
    }
  })
})

describe('wizardThemeFromFlowTheme', () => {
  it('maps professional theme; dark falls back to default wizard styling', () => {
    expect(wizardThemeFromFlowTheme('professional')).toBe('professional')
    expect(wizardThemeFromFlowTheme('dark')).toBe('default')
    expect(wizardThemeFromFlowTheme('default')).toBe('default')
  })
})
