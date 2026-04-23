import { describe, test, expect } from 'vitest'
import { HandshakeState } from '../types'
import type { HandshakeRecord } from '../types'
import {
  collectSenderKeysForCapsuleType,
  isValidEd25519Hex64,
  planCounterpartyRepair,
  tryResolveRemoteFromP2pPackages,
} from '../counterpartyRepair'

const I = '0'.repeat(64)
const A = '1'.repeat(64)
const B = '2'.repeat(64)

function base(over: Partial<HandshakeRecord>): HandshakeRecord {
  return {
    handshake_id: 'hs-test',
    relationship_id: 'r1',
    state: HandshakeState.ACCEPTED,
    initiator: { email: 'a@x', wrdesk_user_id: 'a', iss: 'i', sub: 'a' },
    acceptor: { email: 'b@x', wrdesk_user_id: 'b', iss: 'i', sub: 'b' },
    local_role: 'acceptor',
    sharing_mode: 'reciprocal',
    reciprocal_allowed: true,
    tier_snapshot: { claimedTier: 'free', computedTier: 'free', effectiveTier: 'free', signals: { plan: 'free' } as any, downgraded: false },
    current_tier_signals: { plan: 'free' } as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: 'x',
    effective_policy: {
      allowedScopes: ['*'],
      effectiveTier: 'free',
      allowsCloudEscalation: false,
      allowsExport: false,
      onRevocationDeleteBlocks: false,
      effectiveExternalProcessing: 'none',
      reciprocalAllowed: true,
      effectiveSharingModes: ['reciprocal'],
    } as any,
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: null,
    counterparty_p2p_token: null,
    ...over,
  } as unknown as HandshakeRecord
}

describe('counterpartyRepair', () => {
  test('isValidEd25519Hex64', () => {
    expect(isValidEd25519Hex64(I)).toBe(true)
    expect(isValidEd25519Hex64('g'.repeat(64))).toBe(false)
  })

  test('collectSenderKeysForCapsuleType finds nested sender_public_key', () => {
    const pj = JSON.stringify({
      outer: { capsule_type: 'handshake-initiate', sender_public_key: I, junk: 1 },
    })
    const k = collectSenderKeysForCapsuleType(pj, 'handshake-initiate')
    expect(k).toEqual([I.toLowerCase()])
  })

  test('tryResolveRemoteFromP2pPackages: acceptor + single initiate key', () => {
    const pj = JSON.stringify({ capsule_type: 'handshake-initiate', sender_public_key: I })
    const r = tryResolveRemoteFromP2pPackages('acceptor', B, [pj])
    expect(r).toEqual({ status: 'ok', remote_ed25519: I.toLowerCase(), capsule_type: 'handshake-initiate' })
  })

  test('tryResolveRemoteFromP2pPackages: ambiguous on two keys', () => {
    const r = tryResolveRemoteFromP2pPackages('acceptor', B, [
      JSON.stringify({ capsule_type: 'handshake-initiate', sender_public_key: I }),
      JSON.stringify({ capsule_type: 'handshake-initiate', sender_public_key: A }),
    ])
    expect(r.status).toBe('ambiguous')
  })

  test('plan: acceptor self-poison + p2p initiate recovers', () => {
    const rec = base({
      local_role: 'acceptor',
      local_public_key: B,
      counterparty_public_key: B,
    })
    const pj = JSON.stringify({ capsule_type: 'handshake-initiate', sender_public_key: I })
    const p = planCounterpartyRepair(rec, [pj])
    expect(p.kind).toBe('apply')
    if (p.kind === 'apply') expect(p.remote_ed25519).toBe(I)
  })

  test('plan: refuse when counterparty and local differ (no override)', () => {
    const rec = base({
      local_role: 'acceptor',
      local_public_key: B,
      counterparty_public_key: I,
    })
    const p = planCounterpartyRepair(rec, [])
    expect(p.kind).toBe('refuse')
  })

  test('plan: explicit --remote-hex always wins', () => {
    const rec = base({
      local_role: 'acceptor',
      local_public_key: B,
      counterparty_public_key: I,
    })
    const p = planCounterpartyRepair(rec, [], { remoteEd25519Override: A })
    expect(p.kind).toBe('apply')
    if (p.kind === 'apply') expect(p.remote_ed25519).toBe(A)
  })
})
