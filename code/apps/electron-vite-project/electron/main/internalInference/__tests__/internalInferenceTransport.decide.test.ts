import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import { stubP2pInferenceEnvLegacyHttpOnlyForTests } from './p2pInferenceFlagsTestSetup'

const { mockP2pDcUpMap } = vi.hoisted(() => ({
  mockP2pDcUpMap: new Map<string, boolean>(),
}))

/** `p2pSessionWait` pulls `p2pInferenceSessionManager` and the full main graph. Stub DataChannel state. */
vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: (hid: string) => mockP2pDcUpMap.get(String(hid).trim()) === true,
  waitForP2pDataChannelOrTimeout: async (hid: string) => mockP2pDcUpMap.get(String(hid).trim()) === true,
}))

import { decideHostAiIntentRoute } from '../transport/transportDecide'

describe('decideHostAiIntentRoute', () => {
  beforeEach(() => {
    stubP2pInferenceEnvLegacyHttpOnlyForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    mockP2pDcUpMap.clear()
  })

  test('defaults: direct endpoint → http_direct for capabilities', () => {
    const d = decideHostAiIntentRoute('hs-1', 'capabilities', true)
    expect(d.choice.preferred).toBe('http')
    expect(d.choice.selected).toBe('http_direct')
    expect(d.choice.reason).toBe('http_default')
    expect(d.shouldEmitFallbackLog).toBe(false)
  })

  test('non-direct endpoint → unavailable', () => {
    const d = decideHostAiIntentRoute('hs-1', 'request', false)
    expect(d.choice.selected).toBe('unavailable')
    expect(d.choice.reason).toBe('non_direct_endpoint')
  })

  test('caps over P2P with DC down → await WebRTC data channel (no HTTP fallback for capabilities)', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()
    const d = decideHostAiIntentRoute('hs-1', 'capabilities', true)
    expect(d.choice.preferred).toBe('p2p')
    expect(d.choice.selected).toBe('webrtc_p2p')
    expect(d.choice.reason).toBe('p2p_await_data_channel')
    expect(d.shouldEmitFallbackLog).toBe(false)
  })

  test('caps over P2P + DataChannel up → webrtc_p2p', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    resetP2pInferenceFlagsForTests()
    mockP2pDcUpMap.set('hs-dc', true)
    const d = decideHostAiIntentRoute('hs-dc', 'capabilities', true)
    expect(d.choice.selected).toBe('webrtc_p2p')
    expect(d.choice.reason).toBe('p2p_chosen')
    expect(d.shouldEmitFallbackLog).toBe(false)
  })

  test('request over P2P without HTTP fallback → unavailable', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '0')
    resetP2pInferenceFlagsForTests()
    const d = decideHostAiIntentRoute('hs-1', 'request', true)
    expect(d.choice.selected).toBe('unavailable')
    expect(d.choice.reason).toBe('p2p_not_ready_no_fallback')
  })

  test('request over P2P + DataChannel up → webrtc_p2p', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    resetP2pInferenceFlagsForTests()
    mockP2pDcUpMap.set('hs-req', true)
    const d = decideHostAiIntentRoute('hs-req', 'request', true)
    expect(d.choice.selected).toBe('webrtc_p2p')
    expect(d.choice.reason).toBe('p2p_chosen')
  })
})
