import { describe, expect, it } from 'vitest'
import { coordinationP2pSignal403IsRegistryDrift } from '../relaySync'

describe('coordinationP2pSignal403IsRegistryDrift', () => {
  it('returns true for RELAY_RECIPIENT_RESOLUTION_FAILED', () => {
    expect(
      coordinationP2pSignal403IsRegistryDrift(
        JSON.stringify({ error: 'RELAY_RECIPIENT_RESOLUTION_FAILED' }),
      ),
    ).toBe(true)
  })
  it('returns true for RELAY_RECEIVER_DEVICE_MISMATCH', () => {
    expect(
      coordinationP2pSignal403IsRegistryDrift(
        JSON.stringify({ error: 'RELAY_RECEIVER_DEVICE_MISMATCH' }),
      ),
    ).toBe(true)
  })
  it('returns true for RELAY_SENDER_UNAUTHORIZED', () => {
    expect(
      coordinationP2pSignal403IsRegistryDrift(JSON.stringify({ error: 'RELAY_SENDER_UNAUTHORIZED' })),
    ).toBe(true)
  })
  it('returns false for unrelated 403 shape', () => {
    expect(coordinationP2pSignal403IsRegistryDrift(JSON.stringify({ error: 'forbidden' }))).toBe(false)
    expect(coordinationP2pSignal403IsRegistryDrift('')).toBe(false)
  })
})
