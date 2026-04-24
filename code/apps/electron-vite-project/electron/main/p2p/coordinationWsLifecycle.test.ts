/**
 * Relay WebSocket holder: single ref, disconnect clears so reconnect can allocate a new client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setCoordinationWsClient,
  getCoordinationWsClient,
  disconnectCoordinationWsForAccountSwitch,
} from './coordinationWsHolder'

describe('coordinationWsHolder lifecycle', () => {
  beforeEach(() => {
    disconnectCoordinationWsForAccountSwitch('account_switch')
  })

  it('getCoordinationWsClient is null after disconnect', () => {
    const fake = { disconnect: vi.fn() }
    setCoordinationWsClient(fake as any, 'u1|iss')
    expect(getCoordinationWsClient()).toBe(fake)
    disconnectCoordinationWsForAccountSwitch('logout')
    expect(fake.disconnect).toHaveBeenCalled()
    expect(getCoordinationWsClient()).toBeNull()
  })

  it('allows new setCoordinationWsClient after disconnect (reconnect path)', () => {
    const a = { disconnect: vi.fn() }
    const b = { disconnect: vi.fn() }
    setCoordinationWsClient(a as any, 'a')
    disconnectCoordinationWsForAccountSwitch('logout')
    setCoordinationWsClient(b as any, 'b')
    expect(getCoordinationWsClient()).toBe(b)
    expect(a.disconnect).toHaveBeenCalled()
  })
})
