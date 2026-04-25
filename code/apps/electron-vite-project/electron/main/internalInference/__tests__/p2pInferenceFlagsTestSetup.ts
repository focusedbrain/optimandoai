import { vi } from 'vitest'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'

/**
 * Shipped app defaults: P2P on. Unit tests for legacy direct HTTP / policy paths expect
 * `getP2pInferenceFlags()` off unless they stub env — call from `beforeEach` in those files.
 */
export function stubP2pInferenceEnvLegacyHttpOnlyForTests(): void {
  vi.unstubAllEnvs()
  vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', '0')
  vi.stubEnv('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', '0')
  resetP2pInferenceFlagsForTests()
}
