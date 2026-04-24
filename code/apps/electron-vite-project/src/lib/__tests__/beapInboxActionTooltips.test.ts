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

const SANDBOX_HOVER = 'Clone this message and send it to your Sandbox orchestrator for safe testing.'

describe('beapInboxActionTooltips', () => {
  test('Sandbox: connected — single-line hover + aria short + suffix', () => {
    const c = beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'connected' }, 'detail')
    expect(c.title).toBe(SANDBOX_HOVER)
    expect(c['aria-label']).toMatch(/^Clone message to Sandbox/)
  })

  test('Sandbox: not configured — title has second line', () => {
    const nc = beapHostSandboxCloneTooltipForAvailability(
      { ...defaultSandboxAvailability, status: 'not_configured' },
      'detail',
    )
    expect(nc.title).toContain(SANDBOX_HOVER)
    expect(nc['aria-label']).toMatch(/^Clone message to Sandbox/)
  })

  test('beapInboxReplyTooltipProps: icon-only Reply', () => {
    const p = beapInboxReplyTooltipProps()
    expect(p.title).toBe(BEAP_INBOX_REPLY_TOOLTIP)
    expect(p['aria-label']).toBe('Reply')
  })

  test('Redirect row + detail: “Redirect” / “Redirect message”', () => {
    const row = beapInboxRedirectTooltipPropsForRow()
    expect(row.title).toBe(BEAP_INBOX_REDIRECT_TIP)
    expect(row['aria-label']).toBe(BEAP_INBOX_REDIRECT_ARIA)
    const detail = beapInboxRedirectTooltipPropsForDetail()
    expect(detail.title).toBe(BEAP_INBOX_REDIRECT_TIP)
    expect(detail['aria-label']).toBe(BEAP_INBOX_REDIRECT_ARIA)
  })
})
