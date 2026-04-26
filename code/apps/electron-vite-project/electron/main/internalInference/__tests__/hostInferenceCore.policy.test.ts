import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { InternalInferenceErrorCode } from '../errors'
import { INTERNAL_INFERENCE_SCHEMA_VERSION } from '../types'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import type { HostInferenceCoreContext } from '../hostInferenceCore'

const orchestratorOms = vi.hoisted(() => ({ instanceId: 'dev-host' }))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => orchestratorOms.instanceId,
  getOrchestratorMode: () => ({ mode: orchestratorOms.instanceId === 'dev-sand' ? 'sandbox' : 'host' }),
}))

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: vi.fn(),
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({ coordination_url: 'https://coord.test/' }),
}))

vi.mock('../hostInferenceCapabilities', () => ({
  buildInternalInferenceCapabilitiesResult: vi.fn(async () => ({
    type: 'internal_inference_capabilities_result',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: 'r',
    handshake_id: 'hs-x',
    sender_device_id: 'dev-host',
    target_device_id: 'dev-sand',
    created_at: new Date().toISOString(),
    host_computer_name: 'x',
    host_pairing_code: '123456',
    models: [],
    policy_enabled: true,
  })),
}))

vi.mock('../hostAiRoleGateLog', () => ({
  logHostAiRoleGate: vi.fn(),
}))

vi.mock('../hostInferenceExecute', () => ({
  runHostInternalInference: vi.fn(),
  buildHostInferenceErrorWire: vi.fn(),
}))

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => ({
    allowSandboxInference: true,
    maxPromptBytes: 10_000_000,
    maxRequestsPerHandshakePerMinute: 10_000,
  }),
}))

import { getHandshakeRecord } from '../../handshake/db'
import { handleInternalInferenceCapabilitiesRequest } from '../hostInferenceCore'

const uid = 'u1@example.com|sub'

function samePrincipalParties(): { initiator: HandshakeRecord['initiator']; acceptor: HandshakeRecord['acceptor'] } {
  return {
    initiator: { email: 'a@a.com', wrdesk_user_id: uid, iss: 'i', sub: 's' },
    acceptor: { email: 'a@a.com', wrdesk_user_id: uid, iss: 'i', sub: 's' },
  }
}

function baseRecord(over: Partial<HandshakeRecord>): HandshakeRecord {
  const parties = samePrincipalParties()
  return {
    handshake_id: 'hs-x',
    relationship_id: 'rel',
    state: HandshakeState.ACTIVE,
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as any,
    external_processing: 'none' as any,
    created_at: '2020-01-01',
    activated_at: '2020-01-01',
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: 'h',
    initiator_wrdesk_policy_version: 'v',
    acceptor_wrdesk_policy_hash: 'h',
    acceptor_wrdesk_policy_version: 'v',
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: 'http://192.168.1.1:1/beap/ingest',
    local_p2p_auth_token: 't',
    counterparty_p2p_token: 'pt',
    initiator: parties.initiator,
    acceptor: parties.acceptor,
    handshake_type: 'internal',
    internal_coordination_repair_needed: false,
    internal_coordination_identity_complete: true,
    internal_peer_pairing_code: '123456',
    initiator_device_name: 'H',
    acceptor_device_name: 'S',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'dev-host',
    acceptor_coordination_device_id: 'dev-sand',
    ...over,
  } as HandshakeRecord
}

describe('hostInferenceCore policy (non-internal / standard handshakes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    orchestratorOms.instanceId = 'dev-host'
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  const ctx: HostInferenceCoreContext = {
    transport: 'http_direct',
    handshakeId: 'hs-x',
    senderDeviceId: 'dev-sand',
    targetDeviceId: 'dev-host',
    authenticated: true,
    requestId: 'req-1',
    now: Date.now(),
    db: { prepare: () => ({ run: () => {} }) } as any,
  }

  const capEnvelope: Record<string, unknown> = {
    type: 'internal_inference_capabilities_request',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: 'req-1',
    handshake_id: 'hs-x',
    sender_device_id: 'dev-sand',
    target_device_id: 'dev-host',
    created_at: new Date().toISOString(),
  }

  test('rejects standard (non-internal) handshake for capabilities', async () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(
      baseRecord({ handshake_type: 'standard' }) as any,
    )
    const r = await handleInternalInferenceCapabilitiesRequest(capEnvelope, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
  })

  test('rejects when handshake_type is null (not internal service)', async () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(
      baseRecord({ handshake_type: null as any }) as any,
    )
    const r = await handleInternalInferenceCapabilitiesRequest(capEnvelope, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
  })

  test('rejects cross-principal handshake (different wrdesk users)', async () => {
    vi.mocked(getHandshakeRecord).mockReturnValue(
      baseRecord({
        initiator: { email: 'a@a.com', wrdesk_user_id: 'user-a', iss: 'i', sub: 's' },
        acceptor: { email: 'a@a.com', wrdesk_user_id: 'user-b', iss: 'i', sub: 's' },
      } as any) as any,
    )
    const r = await handleInternalInferenceCapabilitiesRequest(capEnvelope, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
  })
})

describe('hostInferenceCore — receiver-side role (not local_role, not isHostMode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    orchestratorOms.instanceId = 'dev-host'
  })

  test('A: allows sandbox→host when local_role is stale but host is acceptor in initiator/acceptor columns', async () => {
    const stale = baseRecord({
      local_role: 'initiator' as any,
      initiator_device_role: 'sandbox' as any,
      acceptor_device_role: 'host' as any,
      initiator_coordination_device_id: 'dev-sand',
      acceptor_coordination_device_id: 'dev-host',
    })
    vi.mocked(getHandshakeRecord).mockReturnValue(stale as any)
    const ctx2: HostInferenceCoreContext = {
      transport: 'http_direct',
      handshakeId: 'hs-x',
      senderDeviceId: 'dev-sand',
      targetDeviceId: 'dev-host',
      authenticated: true,
      requestId: 'req-1',
      now: Date.now(),
      db: { prepare: () => ({ run: () => {} }) } as any,
    }
    const r = await handleInternalInferenceCapabilitiesRequest(
      {
        type: 'internal_inference_capabilities_request',
        schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
        request_id: 'req-1',
        handshake_id: 'hs-x',
        sender_device_id: 'dev-sand',
        target_device_id: 'dev-host',
        created_at: new Date().toISOString(),
      },
      ctx2,
    )
    expect(r.ok).toBe(true)
  })

  test('C: rejects inbound to sandbox instance (host peer → capability request to this BEAP is forbidden_host_role)', async () => {
    orchestratorOms.instanceId = 'dev-sand'
    vi.mocked(getHandshakeRecord).mockReturnValue(baseRecord({}) as any)
    const ctx2: HostInferenceCoreContext = {
      transport: 'http_direct',
      handshakeId: 'hs-x',
      senderDeviceId: 'dev-host',
      targetDeviceId: 'dev-sand',
      authenticated: true,
      requestId: 'req-1',
      now: Date.now(),
      db: { prepare: () => ({ run: () => {} }) } as any,
    }
    const r = await handleInternalInferenceCapabilitiesRequest(
      {
        type: 'internal_inference_capabilities_request',
        schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
        request_id: 'req-1',
        handshake_id: 'hs-x',
        sender_device_id: 'dev-host',
        target_device_id: 'dev-sand',
        created_at: new Date().toISOString(),
      },
      ctx2,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.messageKey).toBe('forbidden_host_role')
      expect(r.code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
  })
})
