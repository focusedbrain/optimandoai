import { describe, test, expect } from 'vitest'
import {
  BEAP_INBOX_REDIRECT_ARIA,
  BEAP_INBOX_REDIRECT_TIP,
  BEAP_INBOX_REPLY_TOOLTIP,
  beapHostSandboxCloneTooltipForAvailability,
  beapInboxRedirectTooltipPropsForDetail,
  beapInboxRedirectTooltipPropsForRow,
  beapInboxReplyTooltipProps,
} from '../beapInboxActionTooltips'
import { defaultSandboxAvailability } from '../../types/sandboxOrchestratorAvailability'

const SANDBOX_HOVER =
  'Clone this BEAP message and send it to the Sandbox orchestrator. If the Sandbox is offline, the clone will be queued.'

describe('beapInboxActionTooltips', () => {
  test('Sandbox: same hover regardless of tri-state (relay is not a visibility input)', () => {
    const c = beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'connected' }, 'detail')
    expect(c.title).toBe(SANDBOX_HOVER)
    expect(c['aria-label']).toMatch(/^Clone to Sandbox/)
    const nc = beapHostSandboxCloneTooltipForAvailability(
      { ...defaultSandboxAvailability, status: 'not_configured' },
      'detail',
    )
    expect(nc.title).toBe(SANDBOX_HOVER)
  })

  test('beapInboxReplyTooltipProps: icon-only Reply', () => {
    const p = beapInboxReplyTooltipProps()
    expect(p.title).toBe(BEAP_INBOX_REPLY_TOOLTIP)
    expect(p['aria-label']).toBe('Reply')
  })

  test('Redirect row + detail: full sentence tip', () => {
    const row = beapInboxRedirectTooltipPropsForRow()
    expect(row.title).toBe(BEAP_INBOX_REDIRECT_TIP)
    expect(row['aria-label']).toBe(BEAP_INBOX_REDIRECT_ARIA)
    const detail = beapInboxRedirectTooltipPropsForDetail()
    expect(detail.title).toBe(BEAP_INBOX_REDIRECT_TIP)
    expect(detail['aria-label']).toBe(BEAP_INBOX_REDIRECT_ARIA)
  })
})
