import { describe, test, expect } from 'vitest'
import {
  BEAP_HOST_SANDBOX_CLONE_TOOLTIP_CONNECTED,
  BEAP_HOST_SANDBOX_CLONE_TOOLTIP_NOT_CONFIGURED,
  BEAP_HOST_SANDBOX_CLONE_TOOLTIP_OFFLINE,
  BEAP_INBOX_REPLY_TOOLTIP,
  beapHostSandboxCloneTooltipForAvailability,
  beapInboxReplyTooltipProps,
} from '../beapInboxActionTooltips'
import { defaultSandboxAvailability } from '../../types/sandboxOrchestratorAvailability'

describe('beapInboxActionTooltips', () => {
  test('connected tooltip: clone semantics and unchanged original', () => {
    expect(BEAP_HOST_SANDBOX_CLONE_TOOLTIP_CONNECTED).toContain('clone')
    expect(BEAP_HOST_SANDBOX_CLONE_TOOLTIP_CONNECTED).toContain('original stays unchanged')
  })

  test('beapHostSandboxCloneTooltipForAvailability: tri-state titles (list + detail use same helper)', () => {
    expect(
      beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'connected' }).title,
    ).toBe(BEAP_HOST_SANDBOX_CLONE_TOOLTIP_CONNECTED)
    expect(
      beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'not_configured' }).title,
    ).toBe(BEAP_HOST_SANDBOX_CLONE_TOOLTIP_NOT_CONFIGURED)
    expect(
      beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'exists_but_offline' })
        .title,
    ).toBe(BEAP_HOST_SANDBOX_CLONE_TOOLTIP_OFFLINE)
    expect(BEAP_HOST_SANDBOX_CLONE_TOOLTIP_NOT_CONFIGURED).toMatch(/connecting a Sandbox orchestrator under the same identity/i)
  })

  test('beapInboxReplyTooltipProps is Reply for title and aria-label', () => {
    const p = beapInboxReplyTooltipProps()
    expect(p.title).toBe(BEAP_INBOX_REPLY_TOOLTIP)
    expect(p['aria-label']).toBe('Reply')
    expect(p.title).toBe('Reply')
  })
})
