/**
 * Regression: HOST_AI_PROVIDER_ADVERTISEMENT must use getHandshakeDbForInternalInference — not a non-existent
 * getHandshakeDb export from handshake/db.ts (would throw "is not a function").
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wrdesk-host-ai-prov-ad-test' } }))

const { getHandshakeDbForInternalInference } = vi.hoisted(() => ({
  getHandshakeDbForInternalInference: vi.fn(() => Promise.resolve({ _ledger: true as const })),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: (...args: unknown[]) => getHandshakeDbForInternalInference(...args),
}))

vi.mock('../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'device-unit-test',
  getOrchestratorMode: () => ({ mode: 'sandbox' }),
  isSandboxMode: () => true,
}))

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => ({ allowSandboxInference: false, timeoutMs: 12_000 }),
}))

vi.mock('../listInferenceTargets', () => ({
  hasActiveInternalLedgerLocalHostPeerSandboxForHostUi: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('../hostAiEffectiveRole', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../hostAiEffectiveRole')>()
  return {
    ...orig,
    getHostAiLedgerRoleSummaryFromDb: vi.fn(() => ({
      can_publish_host_endpoint: false,
      can_probe_host_endpoint: true,
      any_orchestrator_mismatch: true,
      effective_host_ai_role: 'sandbox',
    })),
  }
})

vi.mock('../p2pEndpointRepair', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../p2pEndpointRepair')>()
  return {
    ...actual,
    getHostPublishedMvpDirectP2pIngestUrl: () => 'http://10.0.0.2:51249/beap/ingest',
    hostDirectP2pAdvertisementHeaders: () => ({
      [actual.P2P_DIRECT_P2P_ENDPOINT_HEADER]: 'http://10.0.0.2:51249/beap/ingest',
    }),
  }
})

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
})
