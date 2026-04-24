import { describe, test, expect } from 'vitest'
import {
  BEAP_HOST_SANDBOX_CLONE_TOOLTIP,
  BEAP_INBOX_REPLY_TOOLTIP,
  beapHostSandboxCloneTooltipProps,
  beapInboxReplyTooltipProps,
} from '../beapInboxActionTooltips'

describe('beapInboxActionTooltips', () => {
  test('host sandbox clone tooltip documents unchanged original', () => {
    expect(BEAP_HOST_SANDBOX_CLONE_TOOLTIP).toContain('original message stays unchanged')
  })

  test('beapHostSandboxCloneTooltipProps returns title', () => {
    const p = beapHostSandboxCloneTooltipProps()
    expect(p.title).toBe(BEAP_HOST_SANDBOX_CLONE_TOOLTIP)
  })

  test('beapInboxReplyTooltipProps is Reply for title and aria-label', () => {
    const p = beapInboxReplyTooltipProps()
    expect(p.title).toBe(BEAP_INBOX_REPLY_TOOLTIP)
    expect(p['aria-label']).toBe('Reply')
    expect(p.title).toBe('Reply')
  })
})
