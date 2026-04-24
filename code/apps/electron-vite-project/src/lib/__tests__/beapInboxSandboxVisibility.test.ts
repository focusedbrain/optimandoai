import { describe, test, expect } from 'vitest'
import {
  canShowSandboxAction,
  isReceivedBeapMessageForSandbox,
  isOutboundQbeapEchoForSandboxAction,
} from '../beapInboxSandboxVisibility'
import type { InboxMessage } from '../../stores/useEmailInboxStore'

function beapMsg(partial: Partial<InboxMessage> & { source_type: 'direct_beap' | 'email_beap' }): InboxMessage {
  return {
    id: 'm1',
    source_type: partial.source_type,
    subject: 's',
    body_text: '',
    from_address: 'a@b.com',
    to_addresses: '',
    received_at: '2020-01-01T00:00:00.000Z',
    read_status: 0,
    account_id: 'acc',
    ...partial,
  } as InboxMessage
}

describe('beapInboxSandboxVisibility', () => {
  test('isReceivedBeapMessageForSandbox for direct and email', () => {
    expect(isReceivedBeapMessageForSandbox({ source_type: 'direct_beap' })).toBe(true)
    expect(isReceivedBeapMessageForSandbox({ source_type: 'email_beap' })).toBe(true)
    expect(isReceivedBeapMessageForSandbox({ source_type: 'email_plain' })).toBe(false)
  })

  test('isOutboundQbeapEchoForSandboxAction when depackaged format is outbound', () => {
    const echo = beapMsg({
      source_type: 'direct_beap',
      depackaged_json: JSON.stringify({ format: 'beap_qbeap_outbound' }),
    })
    expect(isOutboundQbeapEchoForSandboxAction(echo)).toBe(true)
  })

  test('canShowSandboxAction: host + received BEAP + not echo', () => {
    const received = beapMsg({ source_type: 'email_beap' })
    expect(
      canShowSandboxAction({ modeReady: true, isHost: true, message: received }),
    ).toBe(true)
  })

  test('canShowSandboxAction: hide when not Host (Sandbox orchestrator or unknown)', () => {
    const received = beapMsg({ source_type: 'direct_beap' })
    expect(canShowSandboxAction({ modeReady: true, isHost: false, message: received })).toBe(false)
  })

  test('canShowSandboxAction: hide when mode not ready (avoid flicker)', () => {
    const received = beapMsg({ source_type: 'direct_beap' })
    expect(canShowSandboxAction({ modeReady: false, isHost: true, message: received })).toBe(false)
  })

  test('canShowSandboxAction: hide for outbound qBEAP echo', () => {
    const echo = beapMsg({
      source_type: 'direct_beap',
      depackaged_json: JSON.stringify({ format: 'beap_qbeap_outbound' }),
    })
    expect(
      canShowSandboxAction({ modeReady: true, isHost: true, message: echo }),
    ).toBe(false)
  })
})
