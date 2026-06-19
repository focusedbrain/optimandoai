/**
 * Phase C — no plaintext HTTP inference fallback when unified relay ON.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { decideHostAiIntentRoute } from '../transport/transportDecide'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { resetUnifiedServiceRpcRelayFlagsForTests } from '../unifiedServiceRpcRelayFlags'
import { shouldRejectHttpInternalInferenceRequest } from '../p2pInferenceFlags'

vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: () => false,
}))

describe('transportDecide unified relay (C1)', () => {
  beforeEach(() => {
    resetP2pInferenceFlagsForTests()
    resetUnifiedServiceRpcRelayFlagsForTests()
    vi.unstubAllEnvs()
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()
  })

  afterEach(() => {
    resetP2pInferenceFlagsForTests()
    resetUnifiedServiceRpcRelayFlagsForTests()
    vi.unstubAllEnvs()
  })

  it('HTTP fallback allowed when unified relay OFF', () => {
    const d = decideHostAiIntentRoute('hs-1', 'request', true)
    expect(d.choice.selected).toBe('http_direct')
    expect(shouldRejectHttpInternalInferenceRequest()).toBe(false)
  })

  it('HTTP fallback blocked when unified relay ON (INV-ENCRYPT data plane)', () => {
    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '1')
    resetUnifiedServiceRpcRelayFlagsForTests()
    const d = decideHostAiIntentRoute('hs-1', 'request', true)
    expect(d.choice.selected).toBe('unavailable')
    expect(d.choice.reason).toBe('p2p_not_ready_no_fallback')
    expect(shouldRejectHttpInternalInferenceRequest()).toBe(true)
  })
})
