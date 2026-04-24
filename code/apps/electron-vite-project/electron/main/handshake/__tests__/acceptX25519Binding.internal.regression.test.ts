/**
 * Internal handshake.accept: X25519 preflight must not apply (unchanged vs normal).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockGetInstanceId = vi.hoisted(() => vi.fn(() => 'acceptor-orch-1'))

vi.mock('../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => mockGetInstanceId(),
}))

import { handleHandshakeRPC, setSSOSessionProvider, _resetSSOSessionProvider } from '../ipc'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { insertHandshakeRecord } from '../db'
import { HandshakeState } from '../types'
import type { HandshakeRecord } from '../types'
import type { TierDecision } from '../types'

function minimalTier(): TierDecision {
  return {
    claimedTier: null,
    computedTier: 'pro',
    effectiveTier: 'pro',
    signals: { plan: 'pro', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
    downgraded: false,
  }
}

function internalPendingRecord(overrides: Partial<HandshakeRecord>): HandshakeRecord {
  return {
    handshake_id: 'hs-int-x25519-reg',
    relationship_id: 'rel:testinternalx25519',
    state: HandshakeState.PENDING_REVIEW,
    initiator: {
      email: 'user-int@test.com',
      wrdesk_user_id: 'user-int',
      iss: 'https://auth',
      sub: 'user-int',
    },
    acceptor: null,
    local_role: 'acceptor',
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: minimalTier(),
    current_tier_signals: { plan: 'pro', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: 'a'.repeat(64),
    effective_policy: {
      allowedScopes: ['*'],
      effectiveTier: 'pro',
      allowsCloudEscalation: false,
      allowsExport: false,
      onRevocationDeleteBlocks: false,
      effectiveExternalProcessing: 'none',
      reciprocalAllowed: true,
      effectiveSharingModes: ['receive-only', 'reciprocal'],
    },
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: 'p',
    initiator_wrdesk_policy_version: '1',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: null,
    counterparty_p2p_token: null,
    counterparty_public_key: 'a'.repeat(64),
    receiver_email: 'user-int@test.com',
    handshake_type: 'internal',
    initiator_coordination_device_id: 'initiator-orch-1',
    initiator_device_role: 'host',
    initiator_device_name: 'HostComputer',
    internal_peer_device_id: 'acceptor-orch-1',
    internal_peer_device_role: 'sandbox',
    internal_peer_computer_name: 'SandboxComputer',
    internal_peer_pairing_code: '123456',
    ...overrides,
  }
}

describe('acceptX25519Binding — internal', () => {
  beforeEach(() => {
    mockGetInstanceId.mockReturnValue('acceptor-orch-1')
    _resetSSOSessionProvider()
  })

  test('R4_internal_handshake_accept_without_senderX25519PublicKeyB64_does_not_fail_ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED', async () => {
    const db = createHandshakeTestDb()
    migrateIngestionTables(db)
    const session = buildTestSession({
      wrdesk_user_id: 'user-int',
      email: 'user-int@test.com',
      sub: 'user-int',
    })
    setSSOSessionProvider(() => session)

    insertHandshakeRecord(
      db,
      internalPendingRecord({
        initiator_coordination_device_id: 'dup-device-1',
        internal_peer_device_id: 'dup-device-1',
      }),
    )

    const result = await handleHandshakeRPC(
      'handshake.accept',
      {
        handshake_id: 'hs-int-x25519-reg',
        sharing_mode: 'receive-only',
        fromAccountId: 'acct',
        device_role: 'sandbox',
        device_name: 'SandboxComputer',
        local_pairing_code_typed: '123456',
      },
      db,
    )

    expect((result as { code?: string }).code).not.toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
    expect((result as { success?: boolean }).success).toBe(false)
    expect(String((result as { error?: string }).error ?? '')).toContain('INTERNAL_ENDPOINT_ID_COLLISION')
  })
})
