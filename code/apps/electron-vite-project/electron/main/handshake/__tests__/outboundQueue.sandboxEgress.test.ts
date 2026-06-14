/**
 * enqueueOutboundCapsule — sandbox outbound data-egress choke point (P1).
 *
 *   INV-NO-DATA-EGRESS: a sandbox node cannot enqueue a content-bearing
 *     capsule (native BEAP message_package) — even via a forged direct call.
 *   INV-HANDSHAKE: a sandbox node CAN still enqueue handshake lifecycle
 *     capsules (context_sync, …) so pairing keeps working.
 *   Host / single-machine nodes are unaffected (no sandbox role → no guard).
 *
 * The effective-sandbox decision is mocked so the test is deterministic; the
 * allowlist logic itself (assertSandboxDataEgressAllowed / deriveOutboundCapsuleType)
 * runs for real. Uses the in-memory handshake test db (no native better-sqlite3).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

const isEffectiveSandbox = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../sandbox/sandboxOutboundPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sandbox/sandboxOutboundPolicy')>()
  return { ...actual, isEffectiveSandboxNode: () => isEffectiveSandbox() }
})

import { enqueueOutboundCapsule, clearOutboundAutoDrainTimer } from '../outboundQueue'
import { insertHandshakeRecord } from '../db'
import { createHandshakeTestDb } from './handshakeTestDb'
import { mockKeypairFields } from './mockKeypair'
import { SANDBOX_DATA_EGRESS_FORBIDDEN } from '../../sandbox/sandboxOutboundPolicy'
import type { HandshakeRecord } from '../types'

function activeHandshake(handshakeId: string): HandshakeRecord {
  return {
    handshake_id: handshakeId,
    relationship_id: 'rel-sb',
    state: 'ACTIVE',
    initiator: { wrdesk_user_id: 'i', email: 'i@t.com', iss: 'test', sub: 'i', email_verified: true },
    acceptor: { wrdesk_user_id: 'a', email: 'a@t.com', iss: 'test', sub: 'a', email_verified: true },
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

const contextSyncCapsule = (handshakeId: string) => ({
  schema_version: 1,
  capsule_type: 'context_sync',
  handshake_id: handshakeId,
  seq: 1,
})

const nativeBeapPackage = (handshakeId: string) => ({
  // No top-level capsule_type → structurally a native BEAP message package.
  header: { receiver_binding: { handshake_id: handshakeId }, encoding: 'json' },
  metadata: {},
  payloadEnc: 'ciphertext',
})

describe('enqueueOutboundCapsule — sandbox egress lockdown', () => {
  let db: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    db = createHandshakeTestDb()
    isEffectiveSandbox.mockReturnValue(false)
  })

  afterEach(() => {
    clearOutboundAutoDrainTimer()
    vi.restoreAllMocks()
  })

  test('SANDBOX denies a native BEAP message_package (INV-NO-DATA-EGRESS, forged direct call)', () => {
    isEffectiveSandbox.mockReturnValue(true)
    insertHandshakeRecord(db, activeHandshake('hs-sb-1'))
    const r = enqueueOutboundCapsule(db, 'hs-sb-1', 'https://peer.example/beap/ingest', nativeBeapPackage('hs-sb-1'))
    expect(r.enqueued).toBe(false)
    if (!r.enqueued) expect(r.invariant).toBe(SANDBOX_DATA_EGRESS_FORBIDDEN)
  })

  test('SANDBOX denies an unknown / future capsule type (deny-by-default)', () => {
    isEffectiveSandbox.mockReturnValue(true)
    insertHandshakeRecord(db, activeHandshake('hs-sb-x'))
    const r = enqueueOutboundCapsule(db, 'hs-sb-x', 'https://peer.example/beap/ingest', {
      capsule_type: 'some_future_unknown_type',
      handshake_id: 'hs-sb-x',
    })
    expect(r.enqueued).toBe(false)
    if (!r.enqueued) expect(r.invariant).toBe(SANDBOX_DATA_EGRESS_FORBIDDEN)
  })

  test('SANDBOX permits a context_sync lifecycle capsule (INV-HANDSHAKE)', () => {
    isEffectiveSandbox.mockReturnValue(true)
    insertHandshakeRecord(db, activeHandshake('hs-sb-2'))
    const r = enqueueOutboundCapsule(db, 'hs-sb-2', 'https://peer.example/beap/ingest', contextSyncCapsule('hs-sb-2'))
    expect(r.enqueued).toBe(true)
  })

  test('HOST node enqueues a native BEAP message_package unaffected', () => {
    isEffectiveSandbox.mockReturnValue(false)
    insertHandshakeRecord(db, activeHandshake('hs-host-1'))
    const r = enqueueOutboundCapsule(db, 'hs-host-1', 'https://peer.example/beap/ingest', nativeBeapPackage('hs-host-1'))
    expect(r.enqueued).toBe(true)
  })
})
