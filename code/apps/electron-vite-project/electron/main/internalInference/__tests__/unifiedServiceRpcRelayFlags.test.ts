/**
 * Phase C — WRDESK_UNIFIED_SERVICE_RPC_RELAY flag (default OFF).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isUnifiedServiceRpcRelayEnabled,
  resetUnifiedServiceRpcRelayFlagsForTests,
  blocksPlaintextHttpInferenceFallback,
  getUnifiedServiceRpcRelayFlagFromEnvForTests,
} from '../unifiedServiceRpcRelayFlags'

describe('unifiedServiceRpcRelayFlags (C1)', () => {
  beforeEach(() => {
    resetUnifiedServiceRpcRelayFlagsForTests()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    resetUnifiedServiceRpcRelayFlagsForTests()
    vi.unstubAllEnvs()
  })

  it('default OFF when env unset (INV-HOSTAI-FROZEN)', () => {
    expect(isUnifiedServiceRpcRelayEnabled()).toBe(false)
    expect(getUnifiedServiceRpcRelayFlagFromEnvForTests()).toBe(false)
  })

  it('ON only when WRDESK_UNIFIED_SERVICE_RPC_RELAY=1', () => {
    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '1')
    resetUnifiedServiceRpcRelayFlagsForTests()
    expect(isUnifiedServiceRpcRelayEnabled()).toBe(true)
    expect(getUnifiedServiceRpcRelayFlagFromEnvForTests()).toBe(true)
  })

  it('flip OFF after ON restores default with no persisted state', () => {
    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '1')
    resetUnifiedServiceRpcRelayFlagsForTests()
    expect(isUnifiedServiceRpcRelayEnabled()).toBe(true)

    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '0')
    resetUnifiedServiceRpcRelayFlagsForTests()
    expect(isUnifiedServiceRpcRelayEnabled()).toBe(false)
  })

  it('blocksPlaintextHttpInferenceFallback when unified relay ON', () => {
    expect(blocksPlaintextHttpInferenceFallback()).toBe(false)
    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '1')
    resetUnifiedServiceRpcRelayFlagsForTests()
    expect(blocksPlaintextHttpInferenceFallback()).toBe(true)
  })
})
