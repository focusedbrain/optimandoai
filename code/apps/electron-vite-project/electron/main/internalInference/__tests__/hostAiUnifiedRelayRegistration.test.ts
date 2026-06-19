/**
 * Phase C — registration bridge for unified relay outbound (no p2pSignalRelayPost import).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getRegisteredHostAiUnifiedRelaySend,
  registerHostAiUnifiedRelaySend,
  resetHostAiUnifiedRelayRegistrationForTests,
} from '../hostAiUnifiedRelayRegistration'
import {
  isUnifiedServiceRpcRelayEnabled,
  resetUnifiedServiceRpcRelayFlagsForTests,
} from '../unifiedServiceRpcRelayFlags'

describe('hostAiUnifiedRelayRegistration (C1)', () => {
  beforeEach(() => {
    resetHostAiUnifiedRelayRegistrationForTests()
    resetUnifiedServiceRpcRelayFlagsForTests()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    resetHostAiUnifiedRelayRegistrationForTests()
    resetUnifiedServiceRpcRelayFlagsForTests()
    vi.unstubAllEnvs()
  })

  it('default: no registered sender (legacy path only)', () => {
    expect(getRegisteredHostAiUnifiedRelaySend()).toBeNull()
    expect(isUnifiedServiceRpcRelayEnabled()).toBe(false)
  })

  it('register + flag ON enables experimental sender; reset clears without persisted state', async () => {
    const send = vi.fn(async () => ({ ok: true as const, status: 200 as const }))
    registerHostAiUnifiedRelaySend(send)
    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '1')
    resetUnifiedServiceRpcRelayFlagsForTests()

    expect(isUnifiedServiceRpcRelayEnabled()).toBe(true)
    expect(getRegisteredHostAiUnifiedRelaySend()).toBe(send)

    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '0')
    resetUnifiedServiceRpcRelayFlagsForTests()
    resetHostAiUnifiedRelayRegistrationForTests()

    expect(isUnifiedServiceRpcRelayEnabled()).toBe(false)
    expect(getRegisteredHostAiUnifiedRelaySend()).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})
