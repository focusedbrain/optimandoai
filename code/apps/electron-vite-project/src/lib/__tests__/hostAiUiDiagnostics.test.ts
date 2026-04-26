import { describe, expect, it } from 'vitest'
import {
  HOST_AI_MSG,
  HostAiProbeCode,
  hostAiUserFacingMessageFromTarget,
  shouldSuppressOllamaUnreachableSandboxAsHostFailure,
} from '../hostAiUiDiagnostics'

describe('hostAiUserFacingMessageFromTarget', () => {
  it('maps HOST_AI_ENDPOINT_OWNER_MISMATCH to product string', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.ownerMismatch)
  })
  it('maps HOST_AI_DIRECT_PEER_BEAP_MISSING to host-not-published string', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.hostEndpointNotPublished)
  })
  it('maps HOST_AI_ENDPOINT_PROVENANCE_MISSING to product string', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.provenanceMissing)
  })
  it('maps HOST_DIRECT_ENDPOINT_MISSING to same as provenance (missing / not advertised)', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_DIRECT_ENDPOINT_MISSING,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.provenanceMissing)
  })
  it('maps PROBE_AUTH_REJECTED', () => {
    const m = hostAiUserFacingMessageFromTarget({ inference_error_code: HostAiProbeCode.PROBE_AUTH_REJECTED })
    expect(m?.primary).toBe(HOST_AI_MSG.authRejected)
  })
  it('maps PROBE_RATE_LIMITED', () => {
    const m = hostAiUserFacingMessageFromTarget({ inference_error_code: HostAiProbeCode.PROBE_RATE_LIMITED })
    expect(m?.primary).toBe(HOST_AI_MSG.rateLimited)
  })
  it('maps INTERNAL_RELAY_P2P_NOT_READY', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.INTERNAL_RELAY_P2P_NOT_READY,
      unavailable_reason: 'INTERNAL_RELAY_P2P_NOT_READY',
    })
    expect(m?.primary).toBe(HOST_AI_MSG.relayNotReady)
  })
  it('maps ICE_FAILED', () => {
    const m = hostAiUserFacingMessageFromTarget({ inference_error_code: 'ICE_FAILED' })
    expect(m?.primary).toBe(HOST_AI_MSG.iceFailed)
  })
  it('maps HOST_PROVIDER_UNAVAILABLE', () => {
    const m = hostAiUserFacingMessageFromTarget({ inference_error_code: HostAiProbeCode.HOST_PROVIDER_UNAVAILABLE })
    expect(m?.primary).toBe(HOST_AI_MSG.hostProviderUnavailable)
  })
  it('suppresses OLLAMA_UNREACHABLE_ON_SANDBOX when host wire says Ollama is up on Host', () => {
    const m = hostAiUserFacingMessageFromTarget(
      { inference_error_code: HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX, hostWireOllamaReachable: true },
      { hostWireOllamaReachableOverride: true },
    )
    expect(m).toBeNull()
  })
  it('exposes OLLAMA_UNREACHABLE_ON_SANDBOX when not suppressed', () => {
    const m = hostAiUserFacingMessageFromTarget({ inference_error_code: HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX })
    expect(m?.primary).toMatch(/local Ollama was unreachable on the Sandbox/i)
  })
})

describe('shouldSuppressOllamaUnreachableSandboxAsHostFailure', () => {
  it('is true when code matches and host Ollama is reachable', () => {
    expect(
      shouldSuppressOllamaUnreachableSandboxAsHostFailure(HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX, true),
    ).toBe(true)
  })
  it('is false when host Ollama is not known up', () => {
    expect(
      shouldSuppressOllamaUnreachableSandboxAsHostFailure(HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX, false),
    ).toBe(false)
  })
})
