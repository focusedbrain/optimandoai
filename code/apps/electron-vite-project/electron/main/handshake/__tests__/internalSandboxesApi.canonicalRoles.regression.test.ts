/**
 * Regression: internalSandboxesApi Host/Sandbox decisions must use
 * deriveInternalHostAiPeerRoles + assertRecordForServiceRpc, not local_role.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandshakeState, type HandshakeRecord, type SSOSession } from '../types'
import {
  computeAuthoritativeDeviceInternalRole,
  isEligibleActiveInternalHostSandboxRecord,
} from '../internalSandboxesApi'
import { localDeviceRole } from '../../internalInference/policy'
import { createHandshakeTestDb } from './handshakeTestDb'
import { insertHandshakeRecord } from '../db'
import { mockKeypairFields } from './mockKeypair'

const getInstanceIdMock = vi.hoisted(() => vi.fn(() => 'dev-host-1'))
vi.mock('../../orchestrator/orchestratorModeStore', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../orchestrator/orchestratorModeStore')>()
  return { ...a, getInstanceId: () => getInstanceIdMock() }
})

const session: SSOSession = {
  wrdesk_user_id: 'user-a',
  email: 'a@example.com',
  iss: 'https://id.example',
  sub: 'sub-a',
  email_verified: true,
  plan: 'free',
  currentHardwareAttestation: null,
  currentDnsVerification: null,
  currentWrStampStatus: null,
  session_expires_at: new Date(Date.now() + 3600_000).toISOString(),
}

function hostSandboxRow(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-canon-1',
    relationship_id: 'rel-1',
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
    same_principal: true,
    // Misleading local_role view: claims initiator/host while this machine may be sandbox.
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: 'dev-host-1',
    acceptor_coordination_device_id: 'dev-sand-1',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'https://coord.example/beap',
    local_x25519_public_key_b64: 'dGVzdC1sb2NhbC14MjU1MTktcHViLWtleQ==',
    peer_x25519_public_key_b64: 'cGVlci14MjU1MTk=',
    peer_mlkem768_public_key_b64: 'cGVlci1tbGtlbQ==',
    initiator: {
      email: 'a@example.com',
      wrdesk_user_id: 'user-a',
      iss: 'https://id.example',
      sub: 'sub-a',
    },
    acceptor: {
      email: 'a@example.com',
      wrdesk_user_id: 'user-a',
      iss: 'https://id.example',
      sub: 'sub-a',
    },
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as any,
    external_processing: 'none',
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '1',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    ...mockKeypairFields(),
    ...overrides,
  } as HandshakeRecord
}

describe('internalSandboxesApi canonical Host-AI roles', () => {
  let db: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    db = createHandshakeTestDb()
    getInstanceIdMock.mockReturnValue('dev-host-1')
  })

  afterEach(() => {
    getInstanceIdMock.mockReturnValue('dev-host-1')
  })

  it('local_role host view must not make sandbox instance clone-eligible', () => {
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    const rec = hostSandboxRow()
    // Precondition: weaker local_role helper would still say "host".
    expect(localDeviceRole(rec)).toBe('host')
    expect(isEligibleActiveInternalHostSandboxRecord(rec, session)).toBe(false)
  })

  it('authoritative role uses coordination ids — sandbox instance is sandbox despite local_role', () => {
    getInstanceIdMock.mockReturnValue('dev-sand-1')
    insertHandshakeRecord(db, hostSandboxRow({ local_role: 'initiator' }))
    expect(computeAuthoritativeDeviceInternalRole(db, session)).toBe('sandbox')
  })

  it('isEligible true for host instance even if local_role claims acceptor', () => {
    getInstanceIdMock.mockReturnValue('dev-host-1')
    const rec = hostSandboxRow({
      // Wrong per-device view: acceptor would map local_role helper to sandbox.
      local_role: 'acceptor',
    })
    expect(localDeviceRole(rec)).toBe('sandbox')
    expect(isEligibleActiveInternalHostSandboxRecord(rec, session)).toBe(true)
  })

  it('authoritative role is host when coordination id matches host device', () => {
    getInstanceIdMock.mockReturnValue('dev-host-1')
    insertHandshakeRecord(db, hostSandboxRow({ local_role: 'acceptor' }))
    expect(computeAuthoritativeDeviceInternalRole(db, session)).toBe('host')
  })

  it('service-RPC ineligible (identity incomplete) fails even when roles derive as host', () => {
    getInstanceIdMock.mockReturnValue('dev-host-1')
    const rec = hostSandboxRow({ internal_coordination_identity_complete: false })
    expect(isEligibleActiveInternalHostSandboxRecord(rec, session)).toBe(false)
  })
})
