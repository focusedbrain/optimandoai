/**
 * Host AI: peer BEAP required for sandbox→host selection; provider payload gating (ledger vs orchestrator file).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wrdesk-host-ai-peer-ep-test' } }))

const { getHandshakeDbForInternalInference } = vi.hoisted(() => ({
  getHandshakeDbForInternalInference: vi.fn(() => Promise.resolve({ _db: true as const })),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: (...a: unknown[]) => getHandshakeDbForInternalInference(...a),
}))

const getHostAiLedgerRoleSummaryFromDb = vi.hoisted(() =>
  vi.fn(() => ({
    can_publish_host_endpoint: false,
    can_probe_host_endpoint: true,
    any_orchestrator_mismatch: true,
    effective_host_ai_role: 'sandbox' as const,
  })),
)

vi.mock('../hostAiEffectiveRole', () => ({
  getHostAiLedgerRoleSummaryFromDb: (db: unknown, id: string, mode: string) => getHostAiLedgerRoleSummaryFromDb(db, id, mode),
}))

const getOrchestratorMode = vi.hoisted(() => vi.fn(() => ({ mode: 'host' as const })))
const isSandboxMode = vi.hoisted(() => vi.fn(() => false))

vi.mock('../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'sandbox-device-111',
  getOrchestratorMode: () => getOrchestratorMode()(),
  isSandboxMode: () => isSandboxMode()(),
}))

const hasHostSidePair = vi.hoisted(() => vi.fn(() => Promise.resolve(false)))

vi.mock('../listInferenceTargets', () => ({
  hasActiveInternalLedgerLocalHostPeerSandboxForHostUi: (...a: unknown[]) => hasHostSidePair(...a),
}))

vi.mock('../p2pEndpointRepair', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../p2pEndpointRepair')>()
  return {
    ...actual,
    getHostPublishedMvpDirectP2pIngestUrl: () => 'http://192.168.0.2:9/beap/ingest',
    hostDirectP2pAdvertisementHeaders: () => ({
      [actual.P2P_DIRECT_P2P_ENDPOINT_HEADER]: 'http://192.168.0.2:9/beap/ingest',
    }),
  }
})

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => ({ allowSandboxInference: true, timeoutMs: 12_000 }),
}))

describe('buildHostAiProviderAdvertisementPayload (gating)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    hasHostSidePair.mockResolvedValue(false)
    getHostAiLedgerRoleSummaryFromDb.mockImplementation(() => ({
      can_publish_host_endpoint: false,
      can_probe_host_endpoint: true,
      any_orchestrator_mismatch: true,
      effective_host_ai_role: 'sandbox' as const,
    }))
    getOrchestratorMode.mockImplementation(() => ({ mode: 'host' as const }))
  })

  it('D: configured_mode implies host but effective role is sandbox and cannot publish → advertised_as_host_ai = false', async () => {
    const { buildHostAiProviderAdvertisementPayload } = await import('../hostAiProviderAdvertisementLog')
    const payload = await buildHostAiProviderAdvertisementPayload({
      ledgerProvesInternalSandboxToHost: true,
      mergeHostInternalInference: true,
      ollamaDiscoveryOk: true,
      ollamaModelCount: 2,
    })
    expect(payload.configured_mode).toBe('host')
    expect(payload.host_ai_ledger.effective_host_ai_role).toBe('sandbox')
    expect(payload.host_ai_ledger.can_publish_host_endpoint).toBe(false)
    expect(payload.advertised_as_host_ai).toBe(false)
  })

  it('E: effective host + can publish + policy allows → advertised_as_host_ai = true', async () => {
    hasHostSidePair.mockResolvedValue(true)
    getHostAiLedgerRoleSummaryFromDb.mockImplementation(() => ({
      can_publish_host_endpoint: true,
      can_probe_host_endpoint: false,
      any_orchestrator_mismatch: false,
      effective_host_ai_role: 'host' as const,
    }))
    const { buildHostAiProviderAdvertisementPayload } = await import('../hostAiProviderAdvertisementLog')
    const payload = await buildHostAiProviderAdvertisementPayload({
      ledgerProvesInternalSandboxToHost: false,
      mergeHostInternalInference: true,
      ollamaDiscoveryOk: true,
      ollamaModelCount: 2,
    })
    expect(payload.advertised_as_host_ai).toBe(true)
    expect(payload.endpoint_owner_device_id).toBe(payload.current_device_id)
  })
})
