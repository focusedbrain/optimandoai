/**
 * Regression: Host AI cross-device inference state machine (Cases 1–4).
 * Case 5 (repeated identical IPC/GAV merges must not churn React state) lives in
 * `src/lib/__tests__/hostAiTargetUiNormalization.test.ts` — "does not re-apply when many consecutive…".
 *
 * Run: from repo root `code/code`: `npx vitest run apps/electron-vite-project/electron/main/internalInference/__tests__/hostAiCrossDeviceStateMachine.regression.test.ts`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InternalInferenceErrorCode } from '../errors'
import {
  finalizeHostInferenceRowForRegressionTest,
  mapHostAiSelectorPhaseToP2pUiPhase,
  type HostInferenceHostTargetDraft,
} from '../listInferenceTargets'
import { isHostAiListTransportProven } from '../hostAiTransportMatrix'
import { resetP2pInferenceFlagsForTests } from '../p2pInferenceFlags'
import {
  resetHostAdvertisedMvpDirectForTests,
  setHostAdvertisedMvpDirectForTests,
} from '../p2pEndpointRepair'
import {
  buildHostAiTransportDeciderInput,
  decideInternalInferenceTransport,
} from '../transport/decideInternalInferenceTransport'
import { getP2pInferenceFlags } from '../p2pInferenceFlags'
import { HandshakeState, type HandshakeRecord, type PartyIdentity } from '../../handshake/types'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-host-ai-cross-device-sm-test',
    getAppPath: () => '/tmp/wrdesk-host-ai-cross-device-sm-test',
  },
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

const LAN_PEER = 'http://192.168.178.29:51249/beap/ingest'
const LOCAL_BEAP_OTHER = 'http://192.168.178.55:51249/beap/ingest'
const HID = 'hs-cross-device-sm'

function party(): PartyIdentity {
  return { email: 'a@a', wrdesk_user_id: 'u1', iss: 'i', sub: 's' }
}

function handshakeBase(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: HID,
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    initiator: party(),
    acceptor: party(),
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as unknown,
    current_tier_signals: {} as unknown,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: 'a',
    last_capsule_hash_received: 'b',
    effective_policy: {} as unknown,
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

function buildHostInternalId(handshakeId: string, tail: string): string {
  const hid = encodeURIComponent(handshakeId.trim())
  return `host-internal:${hid}:${encodeURIComponent(String(tail).trim())}`
}

describe('Host AI cross-device inference regression', () => {
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

  it('Case 1: handshake ACTIVE + Ollama-tags ok but peer Host BEAP missing — transport connecting, BEAP/orchestration gated, OD-only', () => {
    const listDec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: handshakeBase({
          p2p_endpoint: LOCAL_BEAP_OTHER,
          counterparty_p2p_token: 'bearer-peer-missing',
        }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(listDec.inferenceHandshakeTrusted).toBe(false)
    expect(listDec.inferenceHandshakeTrustReason).toBe('peer_host_endpoint_missing')
    expect(listDec.selectorPhase).toBe('connecting')
    expect(listDec.preferredTransport).toBe('webrtc_p2p')
    expect(listDec.failureCode).toBeNull()
    expect(isHostAiListTransportProven(listDec, HID)).toBe(false)

    const secondary = 'Host · sandbox'
    const leK = 'relay' as const
    const models = ['mx', 'my']
    const rows = models.map((dm, idx) => {
      const meta = {
        failureCode: null as string | null,
        transportMode: listDec.preferredTransport,
        legacyEndpointKind: leK,
        selector_phase: 'ready' as const,
      }
      return finalizeHostInferenceRowForRegressionTest({
        kind: 'host_internal',
        id: buildHostInternalId(HID, dm),
        label: `Host AI · ${dm}`,
        display_label: `Host AI · ${dm}`,
        displayTitle: `Host AI · ${dm}`,
        displaySubtitle: secondary,
        model: dm,
        model_id: dm,
        provider: 'host_internal',
        handshake_id: HID,
        host_device_id: 'dev-host-coord-1',
        host_computer_name: 'HostPC',
        host_pairing_code: '123456',
        host_orchestrator_role: 'host',
        host_orchestrator_role_label: 'Host orchestrator',
        internal_identifier_6: '123456',
        secondary_label: secondary,
        direct_reachable: true,
        policy_enabled: true,
        available: idx === 0,
        availability: 'ollama_direct_lane',
        unavailable_reason: null,
        host_role: 'Host',
        ...meta,
        p2pUiPhase: 'ready',
        inference_error_code: undefined,
        beapFailureCode: InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
        ollamaDirectFailureCode: null,
        hostWireOllamaReachable: true,
        execution_transport: 'ollama_direct',
        host_ai_target_status: 'ollama_direct_only',
        beapReady: false,
        ollamaDirectReady: true,
        visibleInModelSelector: true,
        trustedForBeap: false,
        canChat: false,
        canUseTopChatTools: false,
        canUseOllamaDirect: true,
        trusted: false,
      })
    })

    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.host_ai_target_status).toBe('ollama_direct_only')
      expect(r.failureCode).toBeNull()
      expect(r.beapFailureCode).toBe(InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING)
      expect(String(r.ollamaDirectFailureCode ?? '')).toBe('')
      expect(r.beapReady).toBe(false)
      expect(r.ollamaDirectReady).toBe(true)
      expect(r.visibleInModelSelector).toBe(true)
      expect(r.canChat).toBe(false)
      expect(r.canUseTopChatTools).toBe(false)
      expect(r.canUseOllamaDirect).toBe(true)
      expect(r.host_selector_state).toBe('available')
      expect(r.selector_phase).toBe('ready')
      expect(r.p2pUiPhase).toBe('ready')
    }
  })

  it('Case 2: BEAP advertised + trust + reachable Ollama-tags — BEAP-ready row', () => {
    const peerLan = 'http://192.168.178.88:51249/beap/ingest'
    setHostAdvertisedMvpDirectForTests(HID, peerLan, {
      ownerDeviceId: 'dev-host-coord-1',
      adSource: 'http_header',
    })
    const listDec = decideInternalInferenceTransport(
      buildHostAiTransportDeciderInput({
        operationContext: 'capabilities',
        db: {},
        handshakeRecord: handshakeBase({
          p2p_endpoint: LOCAL_BEAP_OTHER,
          counterparty_p2p_token: 'bearer-both',
        }),
        featureFlags: getP2pInferenceFlags(),
        hostPolicyState: { allowSandboxInference: true, hasActiveModel: true },
      }),
    )
    expect(listDec.inferenceHandshakeTrusted).toBe(true)
    expect(listDec.reason).toBe('inference_handshake_trust_lan')
    expect(listDec.selectorPhase).toBe('legacy_http_available')
    expect(isHostAiListTransportProven(listDec, HID)).toBe(true)

    const dm = 'mistral:latest'
    const secondary = 'Host · id'
    const t: HostInferenceHostTargetDraft = {
      kind: 'host_internal',
      id: buildHostInternalId(HID, dm),
      label: `Host AI · ${dm}`,
      display_label: `Host AI · ${dm}`,
      displayTitle: `Host AI · ${dm}`,
      displaySubtitle: secondary,
      model: dm,
      model_id: dm,
      provider: 'host_internal',
      handshake_id: HID,
      host_device_id: 'dev-host-coord-1',
      host_computer_name: 'Pc',
      host_pairing_code: '123456',
      host_orchestrator_role: 'host',
      host_orchestrator_role_label: 'Host orchestrator',
      internal_identifier_6: '123456',
      secondary_label: secondary,
      direct_reachable: true,
      policy_enabled: true,
      available: true,
      availability: 'available',
      unavailable_reason: null,
      host_role: 'Host',
      selector_phase: 'legacy_http_available',
      p2pUiPhase: 'ready',
      failureCode: null,
      transportMode: 'legacy_http',
      legacyEndpointKind: 'relay',
      hostWireOllamaReachable: true,
      execution_transport: 'ollama_direct',
      host_ai_target_status: 'beap_ready',
      canChat: true,
      canUseTopChatTools: true,
      canUseOllamaDirect: true,
      trusted: true,
    }
    const r = finalizeHostInferenceRowForRegressionTest(t)
    expect(r.host_ai_target_status).toBe('beap_ready')
    expect(r.canChat).toBe(true)
    expect(r.canUseTopChatTools).toBe(true)
    expect(r.hostTargetAvailable).toBe(true)
  })

  it('Case 3: Sandbox↔Host role derivation mismatch — untrusted terminal row', () => {
    const r = finalizeHostInferenceRowForRegressionTest({
      kind: 'host_internal',
      id: buildHostInternalId(HID, 'unavailable'),
      label: '…',
      display_label: '…',
      displayTitle: '…',
      displaySubtitle: '—',
      model: null,
      model_id: null,
      provider: 'host_internal',
      handshake_id: HID,
      host_device_id: 'dev-host-coord-1',
      host_computer_name: 'Pc',
      host_pairing_code: '123456',
      host_orchestrator_role: 'host',
      host_orchestrator_role_label: 'Host orchestrator',
      internal_identifier_6: '123456',
      secondary_label: '—',
      direct_reachable: false,
      policy_enabled: false,
      available: false,
      availability: 'not_configured',
      unavailable_reason: 'SANDBOX_HOST_ROLE_METADATA',
      host_role: 'Host',
      inference_error_code: InternalInferenceErrorCode.HOST_AI_ROLE_MISMATCH,
      host_ai_target_status: 'untrusted',
      canChat: false,
      canUseTopChatTools: false,
      canUseOllamaDirect: false,
      trusted: false,
      selector_phase: 'blocked',
      p2pUiPhase: mapHostAiSelectorPhaseToP2pUiPhase('blocked'),
      failureCode: InternalInferenceErrorCode.HOST_AI_ROLE_MISMATCH,
      transportMode: 'none',
      legacyEndpointKind: 'relay',
    })
    expect(r.host_ai_target_status).toBe('untrusted')
    expect(r.failureCode).toBe(InternalInferenceErrorCode.HOST_AI_ROLE_MISMATCH)
    expect(r.canChat).toBe(false)
  })

  it('Case 4: Ollama direct tags unreachable while handshake ACTIVE — never BEAP-ready / no chat activation', () => {
    const tOd: HostInferenceHostTargetDraft = {
      kind: 'host_internal',
      id: buildHostInternalId(HID, 'unavailable'),
      label: 'Host Ollama is not reachable from this device.',
      display_label: 'Host Ollama is not reachable from this device.',
      displayTitle: 'Host Ollama is not reachable from this device.',
      displaySubtitle: 'Pc',
      model: null,
      model_id: null,
      provider: 'host_internal',
      handshake_id: HID,
      host_device_id: 'dev-host-coord-1',
      host_computer_name: 'Pc',
      host_pairing_code: '123456',
      host_orchestrator_role: 'host',
      host_orchestrator_role_label: 'Host orchestrator',
      internal_identifier_6: '123456',
      secondary_label: 'Pc',
      direct_reachable: true,
      policy_enabled: true,
      available: false,
      availability: 'host_offline',
      unavailable_reason: 'CAPABILITY_PROBE_FAILED',
      hostAiStructuredUnavailableReason: 'ollama_direct_tags_unreachable',
      host_role: 'Host',
      inference_error_code: InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE,
      p2pUiPhase: 'host_transport_unavailable',
      failureCode: InternalInferenceErrorCode.PROBE_HOST_UNREACHABLE,
      transportMode: 'none',
      legacyEndpointKind: 'relay',
      selector_phase: 'connecting',
    }
    const r = finalizeHostInferenceRowForRegressionTest(tOd)
    expect(r.host_ai_target_status).toBeUndefined()
    expect(r.host_ai_target_status).not.toBe('beap_ready')
    expect(r.canChat).toBe(false)
    expect(r.hostTargetAvailable).toBe(false)
  })
})
