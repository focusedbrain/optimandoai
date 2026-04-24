import { describe, test, expect } from 'vitest'
import {
  canShowSandboxAction,
  canShowSandboxCloneAction,
  canShowSandboxCloneIcon,
  getSandboxCloneEligibilityDetail,
} from '../beapInboxSandboxVisibility'
import type { InboxMessage } from '../../stores/useEmailInboxStore'

const listOkHost = {
  internalSandboxListReady: true as const,
  authoritativeDeviceInternalRole: 'host' as const,
  hasActiveInternalSandboxHandshake: true,
}
const listOkNone = {
  internalSandboxListReady: true as const,
  authoritativeDeviceInternalRole: 'none' as const,
  hasActiveInternalSandboxHandshake: true,
}

function msg(over: Partial<InboxMessage> & { id: string }): InboxMessage {
  return {
    id: over.id,
    source_type: over.source_type ?? 'email_plain',
    subject: 's',
    body_text: 'body',
    from_address: 'a@b.com',
    to_addresses: '',
    received_at: '2020-01-01T00:00:00.000Z',
    read_status: 0,
    account_id: 'acc',
    ...over,
  } as InboxMessage
}

function params(p: Partial<import('../beapInboxSandboxVisibility').CanShowSandboxCloneIconParams> & {
  message: InboxMessage | null
  modeReady: boolean
  orchestratorMode: 'host' | 'sandbox' | null
}) {
  return {
    authoritativeDeviceInternalRole: 'host' as const,
    internalSandboxListReady: true,
    hasActiveInternalSandboxHandshake: true,
    ...p,
  } as import('../beapInboxSandboxVisibility').CanShowSandboxCloneIconParams
}

describe('beapInboxSandboxVisibility (every inbox message on Host)', () => {
  test('plain email_plain: show on Host, hide on Sandbox, hide when authoritative sandbox', () => {
    const ordinary = msg({ id: '1' })
    expect(
      canShowSandboxCloneIcon(
        params({ modeReady: true, orchestratorMode: 'host', message: ordinary, ...listOkNone }),
      ),
    ).toBe(true)
    expect(
      canShowSandboxCloneIcon(
        params({ modeReady: true, orchestratorMode: 'sandbox', message: ordinary, ...listOkHost }),
      ),
    ).toBe(false)
    expect(
      canShowSandboxCloneIcon(
        params({
          modeReady: true,
          orchestratorMode: 'host',
          message: ordinary,
          internalSandboxListReady: true,
          authoritativeDeviceInternalRole: 'sandbox',
          hasActiveInternalSandboxHandshake: true,
        }),
      ),
    ).toBe(false)
  })

  test('list still loading: Sandbox icon hidden until internal handshake list is known', () => {
    const ordinary = msg({ id: '2' })
    expect(
      canShowSandboxCloneIcon(
        params({
          modeReady: true,
          orchestratorMode: 'host',
          message: ordinary,
          internalSandboxListReady: false,
          authoritativeDeviceInternalRole: 'none',
          hasActiveInternalSandboxHandshake: false,
        }),
      ),
    ).toBe(false)
  })

  test('direct_beap and email_beap same as plain for visibility', () => {
    const a = msg({ id: '3', source_type: 'direct_beap' })
    const b = msg({ id: '4', source_type: 'email_beap' })
    expect(
      canShowSandboxCloneIcon(params({ modeReady: true, orchestratorMode: 'host', message: a, ...listOkHost })),
    ).toBe(true)
    expect(
      canShowSandboxCloneIcon(params({ modeReady: true, orchestratorMode: 'host', message: b, ...listOkHost })),
    ).toBe(true)
  })

  test('deleted row: not actionable', () => {
    expect(
      canShowSandboxCloneIcon(
        params({
          modeReady: true,
          orchestratorMode: 'host',
          message: msg({ id: 'd', deleted: 1 }),
          ...listOkHost,
        }),
      ),
    ).toBe(false)
  })

  test('canShowSandboxCloneAction matches canShowSandboxAction', () => {
    const p = params({ modeReady: true, orchestratorMode: 'host', message: msg({ id: 'x' }), ...listOkHost })
    expect(canShowSandboxAction(p)).toBe(canShowSandboxCloneAction(p))
  })

  test('getSandboxCloneEligibilityDetail: no active internal handshake => hidden', () => {
    const d = getSandboxCloneEligibilityDetail({
      modeReady: true,
      orchestratorMode: 'host',
      message: msg({ id: 'n' }),
      authoritativeDeviceInternalRole: 'none',
      internalSandboxListReady: true,
      hasActiveInternalSandboxHandshake: false,
    })
    expect(d.show).toBe(false)
    expect(d.reason).toBe('no_active_internal_sandbox_handshake')
  })

  test('orchestrator sandbox hides even if handshake would say host', () => {
    const d = getSandboxCloneEligibilityDetail({
      modeReady: true,
      orchestratorMode: 'sandbox',
      message: msg({ id: 'o' }),
      authoritativeDeviceInternalRole: 'host',
      internalSandboxListReady: true,
    })
    expect(d.show).toBe(false)
    expect(d.reason).toBe('orchestrator_not_host')
  })
})
