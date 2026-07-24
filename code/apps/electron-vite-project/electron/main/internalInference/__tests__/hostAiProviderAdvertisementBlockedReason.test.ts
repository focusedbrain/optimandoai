import { describe, expect, it } from 'vitest'
import { deriveProviderAdvertisementBlockedReason } from '../hostAiProviderAdvertisementBlockedReason'

describe('deriveProviderAdvertisementBlockedReason', () => {
  const hostOk = {
    effective_role: 'host' as const,
    can_publish_host_endpoint: true,
    host_published_direct_endpoint: 'http://x/beap/ingest',
    advertisement_headers_can_generate: true,
  }

  it('policy denial with no_active_internal_sandbox_peer maps to specific reason', () => {
    expect(
      deriveProviderAdvertisementBlockedReason({
        ...hostOk,
        policyAllowsRemote: false,
        policyExplicitUserDisabled: false,
        policyDenialReason: 'no_active_internal_sandbox_peer',
        ollama_ok: true,
        models_count: 2,
      }),
    ).toBe('host_inference_policy_no_internal_sandbox_peer')
  })

  it('zero models with policy allowed is technical not policy', () => {
    expect(
      deriveProviderAdvertisementBlockedReason({
        ...hostOk,
        policyAllowsRemote: true,
        ollama_ok: true,
        models_count: 0,
      }),
    ).toBe('no_ollama_models')
  })

  it('missing endpoint with policy allowed is technical not policy', () => {
    expect(
      deriveProviderAdvertisementBlockedReason({
        ...hostOk,
        host_published_direct_endpoint: null,
        advertisement_headers_can_generate: false,
        policyAllowsRemote: true,
        ollama_ok: true,
        models_count: 2,
        coordination_ready: true,
        host_peer_sandbox: true,
      }),
    ).toBe('no_host_published_direct_endpoint')
  })

  it('null direct endpoint with sealed-relay generation enabled is not blocked', () => {
    expect(
      deriveProviderAdvertisementBlockedReason({
        ...hostOk,
        host_published_direct_endpoint: null,
        advertisement_headers_can_generate: true,
        policyAllowsRemote: true,
        ollama_ok: true,
        models_count: 2,
        sealed_relay_ad_can_publish: true,
        coordination_ready: true,
        host_peer_sandbox: true,
      }),
    ).toBe('unknown')
  })

  it('missing direct endpoint without coordination reports coordination_unavailable', () => {
    expect(
      deriveProviderAdvertisementBlockedReason({
        ...hostOk,
        host_published_direct_endpoint: null,
        advertisement_headers_can_generate: false,
        policyAllowsRemote: true,
        ollama_ok: true,
        models_count: 2,
        coordination_ready: false,
        host_peer_sandbox: true,
      }),
    ).toBe('coordination_unavailable')
  })
})
