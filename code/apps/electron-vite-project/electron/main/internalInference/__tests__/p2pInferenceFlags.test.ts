import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  getP2pInferenceFlags,
  isP2pInferenceFeatureTouched,
  resetP2pInferenceFlagsForTests,
  shouldRejectHttpInternalInferenceRequest,
} from '../p2pInferenceFlags'

describe('p2pInferenceFlags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
  })

  test('defaults: P2P off, webRTC off, HTTP fallback off (non-packaged/CI; use WRDESK_P2P_INFERENCE_HTTP_FALLBACK=1 for local HTTP), verbose off', () => {
    const f = getP2pInferenceFlags()
    expect(f.p2pInferenceEnabled).toBe(false)
    expect(f.p2pInferenceSignalingEnabled).toBe(false)
    expect(f.p2pInferenceWebrtcEnabled).toBe(false)
    expect(f.p2pInferenceCapsOverP2p).toBe(false)
    expect(f.p2pInferenceRequestOverP2p).toBe(false)
    expect(f.p2pInferenceHttpFallback).toBe(false)
    expect(f.p2pInferenceHttpInternalCompat).toBe(false)
    expect(f.p2pInferenceVerboseLogs).toBe(false)
    expect(f.p2pInferenceAnalysisLog).toBe(false)
    expect(isP2pInferenceFeatureTouched()).toBe(false)
    expect(shouldRejectHttpInternalInferenceRequest()).toBe(false)
  })

  test('WRDESK_P2P_INFERENCE_ENABLED enables master flag', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    resetP2pInferenceFlagsForTests()
    expect(getP2pInferenceFlags().p2pInferenceEnabled).toBe(true)
    expect(isP2pInferenceFeatureTouched()).toBe(true)
  })

  test('WRDESK_P2P_INFERENCE_VERBOSE_LOGS and legacy WRDESK_P2P_INFERENCE_ANALYSIS_LOG', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_VERBOSE_LOGS', '1')
    resetP2pInferenceFlagsForTests()
    expect(getP2pInferenceFlags().p2pInferenceVerboseLogs).toBe(true)
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ANALYSIS_LOG', 'true')
    resetP2pInferenceFlagsForTests()
    expect(getP2pInferenceFlags().p2pInferenceAnalysisLog).toBe(true)
  })

  test('WRDESK_P2P_INFERENCE_HTTP_FALLBACK=0 disables fallback', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '0')
    resetP2pInferenceFlagsForTests()
    expect(getP2pInferenceFlags().p2pInferenceHttpFallback).toBe(false)
  })

  test('WRDESK_P2P_INFERENCE_HTTP_FALLBACK=1 enables fallback', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '1')
    resetP2pInferenceFlagsForTests()
    expect(getP2pInferenceFlags().p2pInferenceHttpFallback).toBe(true)
  })

  test('WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1 disallows reject path', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT', '1')
    resetP2pInferenceFlagsForTests()
    expect(shouldRejectHttpInternalInferenceRequest()).toBe(false)
  })

  test('shouldRejectHttpInternalInferenceRequest when P2P request plane on and internal compat off', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '1')
    resetP2pInferenceFlagsForTests()
    expect(shouldRejectHttpInternalInferenceRequest()).toBe(true)
  })

  test('DC_* env names alias to caps/request over P2P', () => {
    vi.stubEnv('WRDESK_P2P_INFERENCE_DC_CAPABILITIES', '1')
    resetP2pInferenceFlagsForTests()
    expect(getP2pInferenceFlags().p2pInferenceCapsOverP2p).toBe(true)
    expect(getP2pInferenceFlags().p2pInferenceDataChannelCapabilities).toBe(true)
  })
})
