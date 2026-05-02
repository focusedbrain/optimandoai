/**
 * Explicit user policy deny must not schedule republish retries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../handshake/ledger', () => ({
  getLedgerDb: () => null,
}))

vi.mock('../dbAccess', () => ({
  getCanonHandshakeDbForHostAiPolicy: vi.fn(async (fb: unknown) => fb ?? null),
}))

vi.mock('../hostAiRemoteInferencePolicyResolve', () => ({
  resolveHostAiRemoteInferencePolicy: vi.fn(() => ({
    allowRemoteInference: false,
    explicitUserDisabled: true,
    denialReason: 'explicit_user_disabled',
    policySource: 'explicit_user_deny' as const,
    remoteChoice: 'deny' as const,
  })),
  logHostAiRemotePolicyDecision: vi.fn(),
  hostAiBeapAdPublishShouldRetryAfterPolicyDenial: vi.fn(() => false),
}))

vi.mock('../p2pEndpointRepair', () => ({
  getHostPublishedMvpDirectP2pIngestUrl: () => 'http://192.168.1.2:51249/beap/ingest',
  P2P_DIRECT_P2P_ENDPOINT_HEADER: 'X-BEAP-Direct-P2P-Endpoint',
  hostDirectP2pAdvertisementHeaders: () => ({
    'X-BEAP-Direct-P2P-Endpoint': 'http://192.168.1.2:51249/beap/ingest',
  }),
}))

vi.mock('../p2pSignalRelayPost', () => ({
  postHostAiDirectBeapAdToCoordination: vi.fn(async () => ({ ok: true, status: 200 })),
}))

vi.mock('../hostAiBeapAdOllamaModelCount', () => ({
  hostAiBeapAdLocalOllamaModelCount: vi.fn(async () => ({ ollama_ok: true, models_count: 1 })),
  hostAiBeapAdLocalOllamaModelRoster: vi.fn(async () => ({
    ollama_ok: true,
    models_count: 1,
    models: [],
    active_model_id: 'm',
    active_model_name: 'm',
    model_source: 't',
  })),
}))

vi.mock('../handshake/db', () => ({
  listHandshakeRecords: () => [],
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    use_coordination: true,
    coordination_url: 'https://coord.example',
  }),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-host-1',
  getOrchestratorMode: () => ({ mode: 'host' as const }),
}))

vi.mock('../hostAiEffectiveRole', () => ({
  getHostAiLedgerRoleSummaryFromDb: () => ({
    can_publish_host_endpoint: true,
    can_probe_host_endpoint: false,
    any_orchestrator_mismatch: false,
    effective_host_ai_role: 'host' as const,
  }),
}))

vi.mock('../hostAiPairingStateStore', () => ({
  isHostAiLedgerAsymmetricTerminal: () => false,
}))

describe('publishHostAi explicit policy deny', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not arm republish timer when explicitUserDisabled', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'setTimeout')
    const { publishHostAiDirectBeapAdvertisementsForEligibleHost, resetHostAiDirectBeapAdPublishStateForTests } =
      await import('../hostAiDirectBeapAdPublish')
    resetHostAiDirectBeapAdPublishStateForTests()
    await publishHostAiDirectBeapAdvertisementsForEligibleHost({} as any, { context: 'explicit_deny_test' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
