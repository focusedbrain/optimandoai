/**
 * Host: inbound `p2p_host_ai_direct_beap_ad_request` must validate sandbox sender and trigger republish.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'

const publishMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../hostAiDirectBeapAdPublish', () => ({
  publishHostAiDirectBeapAdvertisementsForEligibleHost: (...a: unknown[]) => publishMock(...a),
}))

const handshakeRows: HandshakeRecord[] = []

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: unknown, hid: string) => handshakeRows.find((r) => r.handshake_id === hid) ?? null,
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-host-1',
}))

vi.mock('../p2pSessionManagerStub', () => ({
  maybeHandleP2pInferenceRelaySignal: vi.fn(),
}))

import { tryHandleCoordinationP2pSignal } from '../relayP2pSignalHandler'

function hostSideRow(hid: string): HandshakeRecord {
  return {
    handshake_id: hid,
    relationship_id: 'r',
    state: HandshakeState.ACTIVE,
    local_role: 'acceptor',
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
    p2p_endpoint: 'https://relay.example/beap/capsule',
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
}

import { tryHandleCoordinationP2pSignal } from '../relayP2pSignalHandler'

describe('relayP2pSignalHandler — Host AI BEAP ad republish request', () => {
  afterEach(() => {
    handshakeRows.length = 0
    publishMock.mockClear()
  })

  test('Host invokes publish when requester is paired sandbox', async () => {
    handshakeRows.push(hostSideRow('hs-rep'))
    const now = Date.now()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    tryHandleCoordinationP2pSignal(
      {
        type: 'p2p_signal',
        id: 'm-rep',
        payload: {
          schema_version: 1,
          signal_type: 'p2p_host_ai_direct_beap_ad_request',
          handshake_id: 'hs-rep',
          correlation_id: 'c1',
          session_id: 's1',
          sender_device_id: 'dev-sand-1',
          receiver_device_id: 'dev-host-1',
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + 60_000).toISOString(),
          owner_role: 'sandbox',
        },
      } as any,
      'rid-1',
      () => ({}),
    )
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalled())
    expect(publishMock.mock.calls[0][1]).toMatchObject({ context: 'sandbox_peer_republish_request_ws' })
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('[HOST_AI_ENDPOINT_REPUBLISH_RECEIVED]')
    expect(out).toContain('"validPairing":true')
    expect(out).toContain('"willPublish":true')
    log.mockRestore()
  })

  test('Host rejects wrong sandbox sender', async () => {
    handshakeRows.push(hostSideRow('hs-wr'))
    const now = Date.now()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    tryHandleCoordinationP2pSignal(
      {
        type: 'p2p_signal',
        id: 'm-w',
        payload: {
          schema_version: 1,
          signal_type: 'p2p_host_ai_direct_beap_ad_request',
          handshake_id: 'hs-wr',
          correlation_id: 'c1',
          session_id: 's1',
          sender_device_id: 'wrong-sandbox',
          receiver_device_id: 'dev-host-1',
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + 60_000).toISOString(),
          owner_role: 'sandbox',
        },
      } as any,
      'rid-2',
      () => ({}),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(publishMock).not.toHaveBeenCalled()
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('not_host_for_sandbox_peer')
    log.mockRestore()
  })
})
