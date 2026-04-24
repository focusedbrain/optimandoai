import { describe, test, expect } from 'vitest'
import {
  BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_CONNECTED,
  BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_NOT_CONFIGURED,
  BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_OFFLINE,
  BEAP_INBOX_REDIRECT_TIP,
  BEAP_INBOX_REDIRECT_TIP_DESC,
  BEAP_INBOX_REDIRECT_TIP_DETAIL,
  BEAP_INBOX_REPLY_TOOLTIP,
  BEAP_INBOX_SANDBOX_TIP_DETAIL,
  BEAP_INBOX_SANDBOX_TIP_ROW,
  beapHostSandboxCloneTooltipForAvailability,
  beapInboxRedirectTooltipPropsForDetail,
  beapInboxRedirectTooltipPropsForRow,
  beapInboxReplyTooltipProps,
} from '../beapInboxActionTooltips'
import { defaultSandboxAvailability } from '../../types/sandboxOrchestratorAvailability'

const SHORT = 'Send a clone to Sandbox'

describe('beapInboxActionTooltips', () => {
  test('beapHostSandboxCloneTooltip: detail — connected uses long single-line title; tri-state in aria', () => {
    const c = beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'connected' }, 'detail')
    expect(c.title).toBe(BEAP_INBOX_SANDBOX_TIP_DETAIL)
    expect(c['aria-label']).toBe(`${SHORT}. ${BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_CONNECTED}`)

    const nc = beapHostSandboxCloneTooltipForAvailability(
      { ...defaultSandboxAvailability, status: 'not_configured' },
      'detail',
    )
    expect(nc.title).toContain(BEAP_INBOX_SANDBOX_TIP_DETAIL)
    expect(nc['aria-label']).toBe(`${SHORT}. ${BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_NOT_CONFIGURED}`)

    const off = beapHostSandboxCloneTooltipForAvailability(
      { ...defaultSandboxAvailability, status: 'exists_but_offline' },
      'detail',
    )
    expect(off.title).toContain(BEAP_INBOX_SANDBOX_TIP_DETAIL)
    expect(off['aria-label']).toBe(`${SHORT}. ${BEAP_HOST_SANDBOX_CLONE_ARIA_SUFFIX_OFFLINE}`)
  })

  test('beapHostSandboxCloneTooltip: row — short title Clone to Sandbox; tri-state may add second line', () => {
    const c = beapHostSandboxCloneTooltipForAvailability({ ...defaultSandboxAvailability, status: 'connected' }, 'row')
    expect(c.title).toBe(BEAP_INBOX_SANDBOX_TIP_ROW)
    const nc = beapHostSandboxCloneTooltipForAvailability(
      { ...defaultSandboxAvailability, status: 'not_configured' },
      'row',
    )
    expect(nc.title).toContain(BEAP_INBOX_SANDBOX_TIP_ROW)
  })

  test('beapInboxReplyTooltipProps: Reply for title/aria (icon-only; no visible label in UI)', () => {
    const p = beapInboxReplyTooltipProps()
    expect(p.title).toBe(BEAP_INBOX_REPLY_TOOLTIP)
    expect(p['aria-label']).toBe('Reply')
  })

  test('beapInboxRedirectTooltipPropsForRow: short “Redirect”', () => {
    const p = beapInboxRedirectTooltipPropsForRow()
    expect(p['aria-label']).toBe(`${BEAP_INBOX_REDIRECT_TIP}. ${BEAP_INBOX_REDIRECT_TIP_DESC}`)
    expect(p.title).toBe(BEAP_INBOX_REDIRECT_TIP)
  })

  test('beapInboxRedirectTooltipPropsForDetail: one-line “Redirect this BEAP message”', () => {
    const p = beapInboxRedirectTooltipPropsForDetail()
    expect(p.title).toBe(BEAP_INBOX_REDIRECT_TIP_DETAIL)
    expect(p['aria-label']).toBe(`${BEAP_INBOX_REDIRECT_TIP_DETAIL}. ${BEAP_INBOX_REDIRECT_TIP_DESC}`)
  })
})
