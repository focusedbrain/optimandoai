/**
 * PROMPT 4 — dedicated missing read-provider status helpers.
 */
import { describe, it, expect } from 'vitest'
import {
  hostAckIndicatesMissingReadProvider,
  hostAckIndicatesPollUnreachable,
  sandboxDedicatedMissingReadProvider,
} from '../dedicatedSandboxReadProviderStatus'

describe('dedicatedSandboxReadProviderStatus', () => {
  it('sandboxDedicatedMissingReadProvider is true with zero accounts', () => {
    expect(sandboxDedicatedMissingReadProvider([])).toBe(true)
  })

  it('hostAckIndicatesMissingReadProvider reads held_read_consent_missing', () => {
    const acks = new Map([
      ['acc-1', { pollStatus: 'held_read_consent_missing' }],
    ])
    expect(hostAckIndicatesMissingReadProvider(acks, ['acc-1'])).toBe(true)
    expect(hostAckIndicatesPollUnreachable(acks, ['acc-1'])).toBe(false)
  })

  it('hostAckIndicatesPollUnreachable reads held_fetch_failed and trigger_unreachable', () => {
    expect(
      hostAckIndicatesPollUnreachable(
        new Map([['acc-1', { pollStatus: 'held_fetch_failed' }]]),
        ['acc-1'],
      ),
    ).toBe(true)
    expect(
      hostAckIndicatesPollUnreachable(
        new Map([['acc-1', { pollStatus: 'trigger_unreachable' }]]),
        ['acc-1'],
      ),
    ).toBe(true)
  })
})
