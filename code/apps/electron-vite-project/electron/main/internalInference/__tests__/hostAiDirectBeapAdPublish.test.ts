/**
 * Host AI: relay `p2p_host_ai_direct_beap_ad` publish must not arm cooldown before MVP direct URL exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { resetHostAiDirectBeapAdPublishStateForTests } from '../hostAiDirectBeapAdPublish'

const getHostUrl = vi.hoisted(() => vi.fn<(_db: unknown) => string | null>())

vi.mock('../p2pEndpointRepair', () => ({
  getHostPublishedMvpDirectP2pIngestUrl: (db: unknown) => getHostUrl(db),
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
  afterEach(() => {
    vi.clearAllMocks()
    getHostUrl.mockReset()
    postBeapAd.mockImplementation(async () => ({ ok: true, status: 200 }))
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
    expect(postBeapAd).toHaveBeenCalledTimes(1)
  })
})
