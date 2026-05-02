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
        policyAllowsRemote: true,
        ollama_ok: true,
        models_count: 2,
      }),
    ).toBe('no_host_published_direct_endpoint')
  })
})
