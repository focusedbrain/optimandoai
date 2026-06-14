/**
 * handshake.sendBeapViaP2P — sandbox outbound lockdown at the IPC layer (P1).
 *
 * Even with a fully-valid forged direct call (correct sendSource, ACTIVE
 * handshake, db present), a sandbox-role node must REFUSE to send a BEAP
 * message package — defense-in-depth independent of the queue choke point.
 * Host nodes are unaffected (the guard only fires when effective-sandbox).
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'

const isEffectiveSandbox = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../sandbox/sandboxOutboundPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sandbox/sandboxOutboundPolicy')>()
  return { ...actual, isEffectiveSandboxNode: () => isEffectiveSandbox() }
})

import { handleHandshakeRPC, setSSOSessionProvider, _resetSSOSessionProvider } from '../ipc'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { insertHandshakeRecord } from '../db'
import { mockKeypairFields } from './mockKeypair'
import { USER_PACKAGE_BUILDER_SEND_SOURCE } from '../../email/mergeExtensionDepackaged'
import { SANDBOX_DATA_EGRESS_FORBIDDEN } from '../../sandbox/sandboxOutboundPolicy'
import type { HandshakeRecord } from '../types'

function activeHandshake(handshakeId: string): HandshakeRecord {
  return {
    handshake_id: handshakeId,
    relationship_id: 'rel-sb',
    state: 'ACTIVE',
    initiator: { wrdesk_user_id: 'sender-001', email: 'sender@test.com', iss: 'test', sub: 'sender-001', email_verified: true },
    acceptor: { wrdesk_user_id: 'receiver-001', email: 'receiver@test.com', iss: 'test', sub: 'receiver-001', email_verified: true },
    local_role: 'initiator',
    sharing_mode: 'reciprocal',
    reciprocal_allowed: true,
    tier_snapshot: { plan: 'free' },
    current_tier_signals: {},
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {},
    external_processing: 'none',
    created_at: new Date().toISOString(),
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '1.0',
    local_p2p_auth_token: 'bearer-peer',
    counterparty_p2p_token: 'peer-token',
    p2p_endpoint: 'https://peer.example/beap/ingest',
    ...mockKeypairFields(),
  } as HandshakeRecord
}

const packageJson = JSON.stringify({
  header: { receiver_binding: { handshake_id: 'hs-1' }, crypto: {} },
  metadata: {},
  payloadEnc: 'ciphertext',
})

describe('handshake.sendBeapViaP2P — sandbox lockdown', () => {
  let db: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetSSOSessionProvider()
    setSSOSessionProvider(() => buildTestSession({ wrdesk_user_id: 'sender-001', email: 'sender@test.com', sub: 'sender-001' }))
    isEffectiveSandbox.mockReturnValue(false)
  })

  test('SANDBOX refuses a forged-valid BEAP send with SANDBOX_DATA_EGRESS_FORBIDDEN', async () => {
    isEffectiveSandbox.mockReturnValue(true)
    insertHandshakeRecord(db, activeHandshake('hs-1'))
    const r = await handleHandshakeRPC(
      'handshake.sendBeapViaP2P',
      { handshakeId: 'hs-1', packageJson, sendSource: USER_PACKAGE_BUILDER_SEND_SOURCE },
      db,
    )
    expect(r.success).toBe(false)
    expect(r.code).toBe(SANDBOX_DATA_EGRESS_FORBIDDEN)
  })

  test('HOST node is not refused by the sandbox guard (fails later, not on egress policy)', async () => {
    isEffectiveSandbox.mockReturnValue(false)
    insertHandshakeRecord(db, activeHandshake('hs-2'))
    const r = await handleHandshakeRPC(
      'handshake.sendBeapViaP2P',
      { handshakeId: 'hs-2', packageJson: JSON.stringify({ header: { receiver_binding: { handshake_id: 'hs-2' } }, payloadEnc: 'x' }), sendSource: USER_PACKAGE_BUILDER_SEND_SOURCE },
      db,
    )
    // Whatever the downstream outcome, it must NOT be the sandbox egress refusal.
    expect(r.code).not.toBe(SANDBOX_DATA_EGRESS_FORBIDDEN)
  })
})
