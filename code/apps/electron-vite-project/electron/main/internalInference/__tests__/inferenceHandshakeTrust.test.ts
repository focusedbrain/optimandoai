/**
 * Unit: `inferenceDirectHttpTrust` — handshake-bound trust (state/type/principal/roles/identity/bearer).
 * Integration: decider sealed_relay wiring (`inference_sealed_relay` vs BEAP-ad path).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InternalInferenceErrorCode } from '../errors'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wrdesk-inference-handshake-trust-test' } }))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: vi.fn(),
  listHandshakeRecords: vi.fn(() => []),
  updateHandshakeRecord: vi.fn(),
}))

vi.mock('../hostAiPairingStateStore', () => ({
  isHostAiLedgerAsymmetricTerminal: () => false,
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-sand-coord-1',
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    enabled: true,
    coordination_url: 'https://coord.example/beap/ingest',
  }),
  computeLocalP2PEndpoint: () => 'http://192.168.178.55:51249/beap/ingest',
}))

vi.mock('../p2pSession/p2pInferenceSessionManager', () => ({
  P2pSessionPhase: {
    idle: 'idle',
    starting: 'starting',
    signaling: 'signaling',
    connecting: 'connecting',
    datachannel_open: 'datachannel_open',
    ready: 'ready',
    failed: 'failed',
    closed: 'closed',
  },
  getSessionState: () => null,
}))

vi.mock('../p2pSession/p2pSessionWait', () => ({
  isP2pDataChannelUpForHandshake: () => false,
}))

import { HandshakeState, type HandshakeRecord, type PartyIdentity } from '../../handshake/types'
import type { DeriveInternalHostAiPeerRolesResult } from '../policy'
import { normalizeP2pIngestUrl } from '../p2pEndpointRepair'
import { inferenceDirectHttpTrust } from '../transport/inferenceDirectHttpTrust'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import {
  buildHostAiTransportDeciderInput,
  decideInternalInferenceTransport,
} from '../transport/decideInternalInferenceTransport'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import {
  resetHostAdvertisedMvpDirectForTests,
  setHostAdvertisedMvpDirectForTests,
} from '../p2pEndpointRepair'

function party(wrdeskUserId = 'u1'): PartyIdentity {
  return { email: 'a@a', wrdesk_user_id: wrdeskUserId, iss: 'i', sub: 's' }
}

const LAN_PEER = 'http://192.168.178.29:51249/beap/ingest'
const LOCAL_BEAP_OTHER = 'http://192.168.178.55:51249/beap/ingest'

function happyHandshakeRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-happy',
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    initiator: party(),
    acceptor: party(),
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: 'a',
    last_capsule_hash_received: 'b',
    effective_policy: {} as any,
    external_processing: 'none',
    created_at: '2020-01-01',
    activated_at: '2020-01-01',
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: 'h',
    initiator_wrdesk_policy_version: '1',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_device_name: 'S',
    acceptor_device_name: 'H',
    initiator_coordination_device_id: 'dev-sand-coord-1',
    acceptor_coordination_device_id: 'dev-host-coord-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    p2p_endpoint: LAN_PEER,
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'test-bearer-abc123',
    ...over,
  } as HandshakeRecord
}

const happyRoles: DeriveInternalHostAiPeerRolesResult = {
  ok: true,
  localRole: 'sandbox',
  peerRole: 'host',
  localCoordinationDeviceId: 'dev-sand-coord-1',
  peerCoordinationDeviceId: 'dev-host-coord-1',
  roleSource: 'handshake',
}

describe('inferenceDirectHttpTrust', () => {
  it('happy path: trusted, handshake_bound, normalized URL', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord(),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBe(normalizeP2pIngestUrl(LAN_PEER))
  })

  it('state_not_active', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('state_not_active')
    expect(r.normalizedUrl).toBeNull()
  })

  it('handshake_type_not_internal', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({
        handshake_type: 'standard',
      }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('handshake_type_not_internal')
    expect(r.normalizedUrl).toBeNull()
  })

  it('not_same_principal', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({
        acceptor: party('u2'),
      }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('not_same_principal')
    expect(r.normalizedUrl).toBeNull()
  })

  it('not_sandbox_to_host — host local role', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord(),
      roles: {
        ok: true,
        localRole: 'host',
        peerRole: 'sandbox',
        localCoordinationDeviceId: 'dev-host-coord-1',
        peerCoordinationDeviceId: 'dev-sand-coord-1',
        roleSource: 'handshake',
      },
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('not_sandbox_to_host')
    expect(r.normalizedUrl).toBeNull()
  })

  it('not_sandbox_to_host — roles.ok false', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord(),
      roles: { ok: false, code: 'x', reason: 'device_id_not_in_handshake' },
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('not_sandbox_to_host')
    expect(r.normalizedUrl).toBeNull()
  })

  it('identity_not_complete', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ internal_coordination_identity_complete: false }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('identity_not_complete')
    expect(r.normalizedUrl).toBeNull()
  })

  /** sealed_relay: endpoint null/empty is a fully trusted transport (handshake-bound trust). */
  it('sealed_relay — empty p2p_endpoint is trusted, normalizedUrl null', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ p2p_endpoint: '' }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBeNull()
  })

  it('sealed_relay — relay URL is trusted, normalizedUrl null (LAN deprecated, see Teil B)', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ p2p_endpoint: 'https://relay.wrdesk.com/beap/capsule' }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBeNull()
  })

  it('sealed_relay — sentinel wrdesk.invalid is trusted, normalizedUrl null', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({
        p2p_endpoint: 'https://wrdesk.invalid/host-ai/sealed-relay',
      }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBeNull()
  })

  it('non-LAN endpoint no longer denies trust — public IP trusted, normalizedUrl null', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ p2p_endpoint: 'http://8.8.8.8/beap/ingest' }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBeNull()
  })

  it('malformed URL no longer denies trust — trusted, normalizedUrl null', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ p2p_endpoint: 'not-a-url' }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBeNull()
  })

  it('missing_bearer_token — null', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord(),
      roles: happyRoles,
      counterpartyP2pToken: null,
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('missing_bearer_token')
    expect(r.normalizedUrl).toBeNull()
  })

  it('missing_bearer_token — whitespace only', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord(),
      roles: happyRoles,
      counterpartyP2pToken: '   ',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('missing_bearer_token')
    expect(r.normalizedUrl).toBeNull()
  })

  it('self_loop_detected', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord(),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LAN_PEER,
    })
    expect(r.trusted).toBe(false)
    expect(r.reason).toBe('self_loop_detected')
    expect(r.normalizedUrl).toBeNull()
  })

  it('sandboxPeerLanEndpoint overrides handshake row — avoids self-loop when ledger wrongly equals local BEAP', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ p2p_endpoint: LOCAL_BEAP_OTHER }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
      sandboxPeerLanEndpoint: LAN_PEER,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBe(normalizeP2pIngestUrl(LAN_PEER))
  })

  it('localBeapEndpoint null — still trusted when no self-loop to check', () => {
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord(),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: null,
    })
    expect(r.trusted).toBe(true)
    expect(r.reason).toBe('handshake_bound')
    expect(r.normalizedUrl).toBe(normalizeP2pIngestUrl(LAN_PEER))
  })

  it('URL normalization — trailing slash on p2p_endpoint', () => {
    const withSlash = 'http://192.168.178.29:51249/beap/ingest/'
    const r = inferenceDirectHttpTrust({
      handshakeRecord: happyHandshakeRecord({ p2p_endpoint: withSlash }),
      roles: happyRoles,
      counterpartyP2pToken: 'test-bearer-abc123',
      localBeapEndpoint: LOCAL_BEAP_OTHER,
    })
    expect(r.trusted).toBe(true)
    expect(r.normalizedUrl).toBe(normalizeP2pIngestUrl(withSlash))
    expect(r.normalizedUrl).toBe(normalizeP2pIngestUrl(LAN_PEER))
  })
})

describe('decideInternalInferenceTransport — inference trust wiring', () => {
  const HID = 'hs-wiring-1'

  beforeEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    resetHostAdvertisedMvpDirectForTests()
    vi.stubEnv('WRDESK_P2P_INFERENCE_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', '1')
    vi.stubEnv('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', '1')
    resetP2pInferenceFlagsForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetP2pInferenceFlagsForTests()
    resetHostAdvertisedMvpDirectForTests()
  })

  function wiringRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
    return happyHandshakeRecord({
      handshake_id: HID,
      p2p_endpoint: 'http://192.168.50.10:51249/beap/ingest',
      counterparty_p2p_token: 'bearer-wiring',
      ...over,
    })
  }

  it('A. handshake-bound trust (no BEAP ad, verifiedDirect false) — sealed_relay preferred', () => {
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: wiringRecord(),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(dec.inferenceHandshakeTrusted).toBe(true)
    expect(dec.inferenceHandshakeTrustReason).toBe('handshake_bound')
    expect(dec.preferredTransport).toBe('sealed_relay')
    expect(dec.selectorPhase).toBe('legacy_http_available')
    expect(dec.reason).toBe('inference_sealed_relay')
  })

  it('B. BEAP attestation path when only ad present (no bearer)', () => {
    const adUrl = 'http://192.168.50.20:51249/beap/ingest'
    setHostAdvertisedMvpDirectForTests(HID, adUrl, {
      ownerDeviceId: 'dev-host-coord-1',
      adSource: 'http_header',
    })
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: wiringRecord({ counterparty_p2p_token: null }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(dec.inferenceHandshakeTrusted).toBe(false)
    expect(dec.inferenceHandshakeTrustReason).toBe('missing_bearer_token')
    expect(dec.preferredTransport).toBe('sealed_relay')
    expect(dec.selectorPhase).toBe('legacy_http_available')
    expect(dec.reason).toBe('internal_sealed_relay_preferred')
  })

  it('C. both satisfied — handshake-bound sealed_relay branch wins first', () => {
    const adUrl = 'http://192.168.50.20:51249/beap/ingest'
    setHostAdvertisedMvpDirectForTests(HID, adUrl, {
      ownerDeviceId: 'dev-host-coord-1',
      adSource: 'relay',
    })
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: wiringRecord({ counterparty_p2p_token: 'bearer-both' }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(dec.reason).toBe('inference_sealed_relay')
    expect(dec.preferredTransport).toBe('sealed_relay')
  })

  it('D. untrusted (no bearer), hostname endpoint — WebRTC connecting (current default)', () => {
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: wiringRecord({
          counterparty_p2p_token: null,
          p2p_endpoint: 'http://peer-host.test:51249/beap/ingest',
        }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(dec.inferenceHandshakeTrusted).toBe(false)
    expect(dec.reason).not.toBe('inference_sealed_relay')
    expect(dec.preferredTransport).toBe('webrtc_p2p')
    expect(dec.selectorPhase).toBe('connecting')
    expect(dec.reason).toBeUndefined()
  })

  it('E. non-internal handshake — not handshake-bound sealed_relay', () => {
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: wiringRecord({
          handshake_type: 'standard',
          counterparty_p2p_token: 'bearer-std',
        }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(dec.reason).not.toBe('inference_sealed_relay')
  })

  /** Ledger stores this sandbox’s MVP BEAP URL; peer Host advertises a different LAN ingest via header map — trust stays handshake-bound; sealed relay preferred. */
  it('F. poisoned ledger URL equals local BEAP but peer advertisement present — sealed_relay wins', () => {
    const peerLan = 'http://192.168.178.88:51249/beap/ingest'
    setHostAdvertisedMvpDirectForTests(HID, peerLan, {
      ownerDeviceId: 'dev-host-coord-1',
      adSource: 'http_header',
    })
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: wiringRecord({
          /** Same URL as mocked computeLocalP2PEndpoint — wrong row until repaired */
          p2p_endpoint: LOCAL_BEAP_OTHER,
        }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(dec.reason).toBe('inference_sealed_relay')
    expect(dec.preferredTransport).toBe('sealed_relay')
    expect(dec.selectorPhase).toBe('legacy_http_available')
  })

  /**
   * Ledger holds this sandbox’s MVP BEAP and no peer Host advertisement. Trust is handshake-bound
   * (ACTIVE + internal + identity + bearer + roles), so the row is trusted and rides the sealed
   * relay — the poisoned URL is irrelevant because the sealed path addresses the peer device id,
   * never the ledger URL. LAN deprecated, see Teil B.
   */
  it('G. poisoned ledger equals local BEAP, no peer ad — still handshake_bound + sealed_relay', () => {
    const dec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: wiringRecord({
          p2p_endpoint: LOCAL_BEAP_OTHER,
          counterparty_p2p_token: 'bearer-g',
        }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(dec.inferenceHandshakeTrusted).toBe(true)
    expect(dec.inferenceHandshakeTrustReason).toBe('handshake_bound')
    expect(dec.selectorPhase).toBe('legacy_http_available')
    expect(dec.preferredTransport).toBe('sealed_relay')
    expect(dec.failureCode).toBeNull()
  })
})
