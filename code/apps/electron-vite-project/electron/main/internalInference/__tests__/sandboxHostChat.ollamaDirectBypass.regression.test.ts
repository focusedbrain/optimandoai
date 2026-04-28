/**
 * Regression: `execution_transport: 'ollama_direct'` must bypass `decideInternalInferenceTransport` / BEAP gates —
 * LAN chat must not surface `HOST_AI_DIRECT_PEER_BEAP_MISSING` from the chat entry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandshakeRecord } from '../../handshake/types'
import * as transportDecider from '../transport/decideInternalInferenceTransport'
import { _resetPendingForTests } from '../pendingRequests'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/odl-chat-bypass-test', getAppPath: () => '/tmp/odl-chat-bypass-test' },
}))

const { execOdlMock } = vi.hoisted(() => {
  const fn = vi.fn(
    async (): Promise<{ ok: true; output: string; model: string; duration_ms: number }> => ({
      ok: true,
      output: 'sandbox-odl-reply',
      model: 'mistral:latest',
      duration_ms: 2,
    }),
  )
  return { execOdlMock: fn }
})

vi.mock('../sandboxHostAiOllamaDirectChat', () => ({
  executeSandboxHostAiOllamaDirectChat: execOdlMock,
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: async () => ({}),
}))

const getHandshakeRecordMock = vi.fn<(db: unknown, id: string) => HandshakeRecord>()
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (db: unknown, id: string) => getHandshakeRecordMock(db, id),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isSandboxMode: () => true,
  isHostMode: () => false,
  getInstanceId: () => 'dev-sand-coord-1',
  getOrchestratorMode: () => ({
    mode: 'sandbox' as const,
    deviceName: 'S',
    instanceId: 'dev-sand-coord-1',
    pairingCode: '123456',
    connectedPeers: [] as const,
  }),
}))

function internalSandboxHostRecord(): HandshakeRecord {
  return {
    handshake_id: 'hs-odl-bypass-test',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    initiator: { email: 'u@test.dev', wrdesk_user_id: 'u', iss: 'i', sub: 's' },
    acceptor: { email: 'u@test.dev', wrdesk_user_id: 'u', iss: 'i', sub: 's2' },
    local_role: 'initiator',
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_coordination_device_id: 'dev-sand-coord-1',
    acceptor_coordination_device_id: 'dev-host-coord-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    p2p_endpoint: null as unknown as string,
    local_p2p_auth_token: 'tok',
    counterparty_p2p_token: 'bearer',
    acceptor_device_name: 'Host',
    initiator_device_name: 'Sandbox',
    internal_peer_pairing_code: '123456',
    sharing_mode: null,
    reciprocal_allowed: false,
    tier_snapshot: {} as unknown,
    current_tier_signals: {} as unknown,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as unknown,
    external_processing: {} as unknown,
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
  } as HandshakeRecord
}

describe('sandboxHostChat ollama_direct bypass', () => {
  let logSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>

  beforeEach(() => {
    _resetPendingForTests()
    execOdlMock.mockClear()
    getHandshakeRecordMock.mockImplementation(() => internalSandboxHostRecord())
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(transportDecider, 'decideInternalInferenceTransport').mockImplementation(() => {
      throw new Error('decider must not run for ollama_direct chat')
    })
  })

  it('skips decideInternalInferenceTransport and returns ODL success', async () => {
    const { runSandboxHostInferenceChat } = await import('../sandboxHostChat')

    const r = await runSandboxHostInferenceChat({
      handshakeId: 'hs-odl-bypass-test',
      messages: [{ role: 'user', content: 'hi' }],
      model: 'mistral:latest',
      execution_transport: 'ollama_direct',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('sandbox-odl-reply')
    expect(execOdlMock).toHaveBeenCalled()

    const logStr = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logStr).toMatch(/\[HOST_AI_CHAT_ROUTE\].*lane=ollama_direct/)
    expect(logStr).toMatch(/ollamaDirectReady=true/)
    expect(logStr).toMatch(/beapReady=false/)
  })
})
