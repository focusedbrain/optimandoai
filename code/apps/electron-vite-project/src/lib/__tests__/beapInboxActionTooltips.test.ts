import { describe, test, expect } from 'vitest'
import {
  BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_CONNECTED,
  BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_NOT_CONFIGURED,
  BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_OFFLINE,
  BEAP_INBOX_REPLY_TOOLTIP,
  beapHostSandboxCloneTooltipForAvailability,
  beapInboxReplyTooltipProps,
} from '../beapInboxActionTooltips'
import { defaultSandboxAvailability } from '../../types/sandboxOrchestratorAvailability'

const SHORT = 'Send a clone to Sandbox'

describe('beapInboxActionTooltips', () => {
  test('beapHostSandboxCloneTooltip: short title for hover; long aria for tri-state', () => {
    const c = beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'connected' })
    expect(c.title).toBe(SHORT)
    expect(c['aria-label']).toBe(`${SHORT}. ${BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_CONNECTED}`)

    const nc = beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'not_configured' })
    expect(nc.title).toBe(SHORT)
    expect(nc['aria-label']).toBe(`${SHORT}. ${BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_NOT_CONFIGURED}`)

    const off = beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'exists_but_offline' })
    expect(off.title).toBe(SHORT)
    expect(off['aria-label']).toBe(`${SHORT}. ${BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_OFFLINE}`)
  })

  test('beapInboxReplyTooltipProps: Reply for title/aria (icon-only; no visible label in UI)', () => {
    const p = beapInboxReplyTooltipProps()
    expect(p.title).toBe(BEAP_INBOX_REPLY_TOOLTIP)
    expect(p['aria-label']).toBe('Reply')
  })
})
