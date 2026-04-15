import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockGetInstanceId = vi.hoisted(() => vi.fn(() => 'acceptor-orch-1'))

vi.mock('../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => mockGetInstanceId(),
}))

vi.mock('../device-keys/deviceKeyStore', () => ({
  getDeviceX25519PublicKey: vi.fn(async () => 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='),
  getDeviceX25519KeyPair: vi.fn(),
  DeviceKeyNotFoundError: class extends Error {
    code = 'DEVICE_KEY_NOT_FOUND'
  },
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
    handshake_id: 'hs-int-accept-val',
    relationship_id: 'rel:testinternalaccept',
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
    ...overrides,
  }
}

describe('handshake.accept internal endpoint validation', () => {
  beforeEach(() => {
    mockGetInstanceId.mockReturnValue('acceptor-orch-1')
    _resetSSOSessionProvider()
  })

  test('rejects when local orchestrator id matches initiator coordination id (same device)', async () => {
    mockGetInstanceId.mockReturnValue('dup-device-1')
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
        handshake_id: 'hs-int-accept-val',
        sharing_mode: 'receive-only',
        fromAccountId: 'acct',
        device_role: 'sandbox',
        device_name: 'SandboxComputer',
      },
      db,
    )

    expect((result as any).success).toBe(false)
    expect(String((result as any).error ?? '')).toContain('INTERNAL_ENDPOINT_ID_COLLISION')
  })

  test('rejects when acceptor role matches initiator role', async () => {
    const db = createHandshakeTestDb()
    migrateIngestionTables(db)
    const session = buildTestSession({
      wrdesk_user_id: 'user-int',
      email: 'user-int@test.com',
      sub: 'user-int',
    })
    setSSOSessionProvider(() => session)

    insertHandshakeRecord(db, internalPendingRecord({ initiator_device_role: 'host' }))

    const result = await handleHandshakeRPC(
      'handshake.accept',
      {
        handshake_id: 'hs-int-accept-val',
        sharing_mode: 'receive-only',
        fromAccountId: 'acct',
        device_role: 'host',
        device_name: 'OtherHostName',
      },
      db,
    )

    expect((result as any).success).toBe(false)
    expect(String((result as any).error ?? '')).toContain('INTERNAL_ENDPOINT_ROLE_COLLISION')
  })

  test('rejects when normalized computer names collide', async () => {
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
        initiator_device_name: 'SHARED-NAME',
      }),
    )

    const result = await handleHandshakeRPC(
      'handshake.accept',
      {
        handshake_id: 'hs-int-accept-val',
        sharing_mode: 'receive-only',
        fromAccountId: 'acct',
        device_role: 'sandbox',
        device_name: 'shared-name',
      },
      db,
    )

    expect((result as any).success).toBe(false)
    expect(String((result as any).error ?? '')).toContain('INTERNAL_COMPUTER_NAME_COLLISION')
  })
})
