/**
 * Regression: HOST_AI_PROVIDER_ADVERTISEMENT must use getHandshakeDbForInternalInference — not a non-existent
 * getHandshakeDb export from handshake/db.ts (would throw "is not a function").
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wrdesk-host-ai-prov-ad-test' } }))

vi.mock('../../handshake/ledger', () => ({
  getLedgerDb: () => null,
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({}),
}))

const { getHandshakeDbForInternalInference } = vi.hoisted(() => ({
  getHandshakeDbForInternalInference: vi.fn(() => Promise.resolve({ _ledger: true as const })),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: (...args: unknown[]) => getHandshakeDbForInternalInference(...args),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'device-unit-test',
  getOrchestratorMode: () => ({ mode: 'sandbox' }),
  isSandboxMode: () => true,
}))

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => ({ allowSandboxInference: false, timeoutMs: 12_000 }),
}))

vi.mock('../hostAiRemoteInferencePolicyResolve', () => ({
  resolveHostAiRemoteInferencePolicy: vi.fn(() => ({
    allowRemoteInference: false,
    explicitUserDisabled: false,
    denialReason: 'not_ledger_eligible_host',
    policySource: 'default_deny_no_ledger_host' as const,
    remoteChoice: 'unset' as const,
  })),
  logHostAiRemotePolicyDecision: vi.fn(),
  hostAiBeapAdPublishShouldRetryAfterPolicyDenial: vi.fn(() => true),
}))

vi.mock('../listInferenceTargets', () => ({
  hasActiveInternalLedgerLocalHostPeerSandboxForHostUi: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('../hostAiEffectiveRole', () => ({
  getEffectiveHostAiRoleForHandshake: vi.fn(() => ({
    can_publish_host_endpoint: false,
    effective_host_ai_role: 'sandbox',
  })),
  getHostAiLedgerRoleSummaryFromDb: vi.fn(() => ({
    can_publish_host_endpoint: false,
    can_probe_host_endpoint: true,
    any_orchestrator_mismatch: true,
    effective_host_ai_role: 'sandbox',
  })),
}))

vi.mock('../p2pEndpointRepair', () => ({
  P2P_DIRECT_P2P_ENDPOINT_HEADER: 'X-BEAP-Direct-P2P-Endpoint',
  getHostPublishedMvpDirectP2pIngestUrl: () => 'http://10.0.0.2:51249/beap/ingest',
  hostDirectP2pAdvertisementHeaders: () => ({
    'X-BEAP-Direct-P2P-Endpoint': 'http://10.0.0.2:51249/beap/ingest',
  }),
}))

import * as handshakeDb from '../../handshake/db'

describe('buildHostAiProviderAdvertisementPayload', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses getHandshakeDbForInternalInference and completes without throwing', async () => {
    const { buildHostAiProviderAdvertisementPayload } = await import('../hostAiProviderAdvertisementLog')
    const payload = await buildHostAiProviderAdvertisementPayload({
      ledgerProvesInternalSandboxToHost: true,
      mergeHostInternalInference: true,
      ollamaDiscoveryOk: true,
      ollamaModelCount: 2,
    })

    expect(getHandshakeDbForInternalInference).toHaveBeenCalledTimes(1)
    expect(payload.db_open_ok).toBe(true)
    expect(payload.current_device_id.length).toBeGreaterThan(0)
    expect(typeof payload.configured_mode).toBe('string')
    expect(payload.host_ai_ledger.role_source).toBe('handshake')
    expect(payload.host_ai_ledger.can_probe_host_endpoint).toBe(true)
    expect(payload.local_derived_role).toBe('sandbox')
    expect(payload.host_published_direct_endpoint).toBeNull()
    expect(payload.advertisement_headers_can_generate).toBe(false)
    expect(payload.role).toBe('sandbox')
    expect(payload.models_count).toBe(0)
  })

  it('handshake/db must not export getHandshakeDb (prevents broken dynamic import in main)', () => {
    expect(Object.prototype.hasOwnProperty.call(handshakeDb, 'getHandshakeDb')).toBe(false)
    expect((handshakeDb as Record<string, unknown>)['getHandshakeDb']).toBeUndefined()
  })

  it('deriveProviderAdvertisementBlockedReason maps explicit user policy disable', async () => {
    const { deriveProviderAdvertisementBlockedReason } = await import('../hostAiProviderAdvertisementLog')
    expect(
      deriveProviderAdvertisementBlockedReason({
        effective_role: 'host',
        can_publish_host_endpoint: true,
        policyAllowsRemote: false,
        policyExplicitUserDisabled: true,
        ollama_ok: true,
        models_count: 2,
        host_published_direct_endpoint: 'http://x/beap/ingest',
        advertisement_headers_can_generate: true,
      }),
    ).toBe('explicit_user_disabled_remote_inference')
  })

  it('deriveProviderAdvertisementBlockedReason reports no_ollama_models when policy allows', async () => {
    const { deriveProviderAdvertisementBlockedReason } = await import('../hostAiProviderAdvertisementLog')
    expect(
      deriveProviderAdvertisementBlockedReason({
        effective_role: 'host',
        can_publish_host_endpoint: true,
        policyAllowsRemote: true,
        policyExplicitUserDisabled: false,
        ollama_ok: true,
        models_count: 0,
        host_published_direct_endpoint: 'http://x/beap/ingest',
        advertisement_headers_can_generate: true,
      }),
    ).toBe('no_ollama_models')
  })
})
