import { describe, expect, it } from 'vitest'
import {
  HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP,
  HOST_AI_MSG,
  HostAiProbeCode,
  hostAiUserFacingMessageFromTarget,
  shouldSuppressOllamaUnreachableSandboxAsHostFailure,
} from '../hostAiUiDiagnostics'

describe('hostAiUserFacingMessageFromTarget', () => {
  it('maps HOST_AI_ENDPOINT_OWNER_MISMATCH (no self deny) to route ownership copy', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
      hostAiEndpointDenyDetail: 'host_owner_mismatch',
    })
    expect(m?.primary).toBe(HOST_AI_MSG.routeOwnerMismatch)
  })

  it('maps HOST_AI_ENDPOINT_OWNER_MISMATCH + self BEAP deny to route-rejected self copy', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
      hostAiEndpointDenyDetail: 'self_local_beap_selected',
    })
    expect(m?.primary).toBe(HOST_AI_MSG.routeRejectedSelfBeap)
  })

  it('maps HOST_AI_DIRECT_PEER_BEAP_MISSING to peer direct-endpoint copy', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.peerNoDirectEndpoint)
  })

  it('maps HOST_AI_ENDPOINT_PROVENANCE_MISSING to peer direct-endpoint copy', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.peerNoDirectEndpoint)
  })

  it('maps HOST_DIRECT_ENDPOINT_MISSING to peer direct-endpoint copy', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_DIRECT_ENDPOINT_MISSING,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.peerNoDirectEndpoint)
  })

  it('maps HOST_AI_NO_VERIFIED_PEER_ROUTE to no verified route copy', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_NO_VERIFIED_PEER_ROUTE,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.noVerifiedPeerRoute)
  })

  it('maps HOST_AI_CAPABILITY_ROLE_REJECTED to role gate copy', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.HOST_AI_CAPABILITY_ROLE_REJECTED,
    })
    expect(m?.primary).toBe(HOST_AI_MSG.roleGateFailed)
  })

  it('prefers terminal structured reason over PROBE_AUTH_REJECTED (no verified route)', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.PROBE_AUTH_REJECTED,
      hostAiStructuredUnavailableReason: 'host_no_verified_peer_route',
    })
    expect(m?.primary).toBe(HOST_AI_MSG.noVerifiedPeerRoute)
  })

  it('prefers terminal structured reason over PROBE_AUTH_REJECTED (role gate)', () => {
    const m = hostAiUserFacingMessageFromTarget({
      inference_error_code: HostAiProbeCode.PROBE_AUTH_REJECTED,
      hostAiStructuredUnavailableReason: 'host_capability_role_rejected',
    })
    expect(m?.primary).toBe(HOST_AI_MSG.roleGateFailed)
  })

  it('maps real PROBE_AUTH_REJECTED without terminal structured reason to auth copy', () => {
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

describe('HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP', () => {
  it('includes coordination ids, route fields, and rejection_reason', () => {
    expect(HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP.local_device_id).toMatch(/coord-sandbox/)
    expect(HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP.peer_host_device_id).toMatch(/coord-host/)
    expect(HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP.selected_endpoint).toContain('/beap/ingest')
    expect(HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP.selected_endpoint_owner).toBe(
      HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP.local_device_id,
    )
    expect(HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP.rejection_reason).toContain('HOST_AI_ENDPOINT_OWNER_MISMATCH')
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
