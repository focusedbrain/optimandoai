/**
 * Host AI: relay `p2p_host_ai_direct_beap_ad` publish must not arm cooldown before MVP direct URL exists.
 * Republish retries when Ollama or MVP URL gate clears after startup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'

vi.mock('../../handshake/ledger', () => ({
  getLedgerDb: () => null,
}))

vi.mock('../dbAccess', () => ({
  getCanonHandshakeDbForHostAiPolicy: vi.fn(async (fb: unknown) => fb ?? null),
}))

const getHostUrl = vi.hoisted(() => vi.fn<(_db: unknown) => string | null>())
const hostAiBeapAdLocalOllamaModelRosterMock = vi.hoisted(() =>
  vi.fn(async () => ({
    ollama_ok: true as const,
    models_count: 1,
    models: [{ id: 'm', name: 'm', provider: 'ollama' as const, available: true, active: true }],
    active_model_id: 'm',
    active_model_name: 'm',
    model_source: 'test',
  })),
)

vi.mock('../hostAiBeapAdOllamaModelCount', () => ({
  hostAiBeapAdLocalOllamaModelRoster: (...a: unknown[]) => hostAiBeapAdLocalOllamaModelRosterMock(...a),
  hostAiBeapAdLocalOllamaModelCount: async () => {
    const r = await hostAiBeapAdLocalOllamaModelRosterMock()
    return { ollama_ok: r.ollama_ok, models_count: r.models_count }
  },
}))

vi.mock('../p2pEndpointRepair', () => ({
  getHostPublishedMvpDirectP2pIngestUrl: (db: unknown) => getHostUrl(db),
  P2P_DIRECT_P2P_ENDPOINT_HEADER: 'X-BEAP-Direct-P2P-Endpoint',
  hostDirectP2pAdvertisementHeaders: () => ({
    'X-BEAP-Direct-P2P-Endpoint': 'http://192.168.1.2:51249/beap/ingest',
  }),
}))

const postBeapAd = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 200 })))
vi.mock('../p2pSignalRelayPost', () => ({
  postHostAiDirectBeapAdToCoordination: (...a: unknown[]) => postBeapAd(...a),
}))

const hostRow: HandshakeRecord = {
  handshake_id: 'hs-pub-1',
  relationship_id: 'r',
  state: HandshakeState.ACTIVE,
  local_role: 'initiator',
  sharing_mode: null,
  reciprocal_allowed: false,
  initiator: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
  acceptor: { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' },
  tier_snapshot: {} as any,
  current_tier_signals: {} as any,
  last_seq_sent: 0,
  last_seq_received: 0,
  last_capsule_hash_sent: '',
  last_capsule_hash_received: '',
  effective_policy: {} as any,
  external_processing: {} as any,
  created_at: '2020-01-01',
  activated_at: '2020-01-01',
  expires_at: null,
  revoked_at: null,
  revocation_source: null,
  initiator_wrdesk_policy_hash: '',
  initiator_wrdesk_policy_version: '',
  acceptor_wrdesk_policy_hash: null,
  acceptor_wrdesk_policy_version: null,
  initiator_context_commitment: null,
  acceptor_context_commitment: null,
  p2p_endpoint: 'http://10.0.0.1:1/beap/ingest',
  local_p2p_auth_token: 't',
  counterparty_p2p_token: 'pt',
  handshake_type: 'internal',
  internal_coordination_repair_needed: false,
  internal_coordination_identity_complete: true,
  initiator_device_name: 'S',
  acceptor_device_name: 'H',
  initiator_device_role: 'sandbox',
  acceptor_device_role: 'host',
  initiator_coordination_device_id: 'dev-sand-1',
  acceptor_coordination_device_id: 'dev-host-1',
} as HandshakeRecord

vi.mock('../../handshake/db', () => ({
  listHandshakeRecords: () => [hostRow],
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

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => ({ allowSandboxInference: true, timeoutMs: 12_000 }),
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

describe('publishHostAiDirectBeapAdvertisementsForEligibleHost', () => {
  beforeEach(async () => {
    getHostUrl.mockReset()
    postBeapAd.mockReset()
    postBeapAd.mockImplementation(async () => ({ ok: true, status: 200 }))
    hostAiBeapAdLocalOllamaModelRosterMock.mockReset()
    hostAiBeapAdLocalOllamaModelRosterMock.mockImplementation(async () => ({
      ollama_ok: true,
      models_count: 1,
      models: [{ id: 'm', name: 'm', provider: 'ollama' as const, available: true, active: true }],
      active_model_id: 'm',
      active_model_name: 'm',
      model_source: 'test',
    }))
    const { resetHostAiDirectBeapAdPublishStateForTests } = await import('../hostAiDirectBeapAdPublish')
    resetHostAiDirectBeapAdPublishStateForTests()
  })

  it('publishes after MVP URL appears even when an earlier call had no URL (no premature cooldown)', async () => {
    getHostUrl
      .mockReturnValueOnce(null)
      .mockReturnValue('http://192.168.1.2:51249/beap/ingest')
    const { publishHostAiDirectBeapAdvertisementsForEligibleHost } = await import('../hostAiDirectBeapAdPublish')
    await publishHostAiDirectBeapAdvertisementsForEligibleHost({} as any, { context: 'test_early_no_url' })
    expect(postBeapAd).not.toHaveBeenCalled()
    await publishHostAiDirectBeapAdvertisementsForEligibleHost({} as any, { context: 'test_later_url' })
    expect(postBeapAd).toHaveBeenCalledWith(
      expect.objectContaining({
        ollamaCapabilities: expect.objectContaining({
          active_model_id: 'm',
          max_concurrent_local_models: 1,
        }),
      }),
    )
    expect(postBeapAd).toHaveBeenCalledTimes(1)
  })

  it('early ollama_models_gate schedules retry and publishes when models appear', async () => {
    vi.useFakeTimers()
    hostAiBeapAdLocalOllamaModelRosterMock
      .mockResolvedValueOnce({
        ollama_ok: true,
        models_count: 0,
        models: [],
        active_model_id: null,
        active_model_name: null,
        model_source: 't',
      })
      .mockResolvedValue({
        ollama_ok: true,
        models_count: 1,
        models: [{ id: 'm', name: 'm', provider: 'ollama' as const, available: true, active: true }],
        active_model_id: 'm',
        active_model_name: 'm',
        model_source: 't',
      })
    getHostUrl.mockReturnValue('http://192.168.1.2:51249/beap/ingest')
    const { publishHostAiDirectBeapAdvertisementsForEligibleHost } = await import('../hostAiDirectBeapAdPublish')
    await publishHostAiDirectBeapAdvertisementsForEligibleHost({} as any, { context: 't_ollama_retry' })
    expect(postBeapAd).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(postBeapAd).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('early no_mvp_direct_endpoint schedules retry and publishes when URL appears on retry path', async () => {
    vi.useFakeTimers()
    getHostUrl
      .mockReturnValueOnce(null)
      .mockReturnValue('http://192.168.1.2:51249/beap/ingest')
    const { publishHostAiDirectBeapAdvertisementsForEligibleHost } = await import('../hostAiDirectBeapAdPublish')
    await publishHostAiDirectBeapAdvertisementsForEligibleHost({} as any, { context: 't_url_first' })
    expect(postBeapAd).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(postBeapAd).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
