/**
 * Outbound queue: transport failures, retry/backoff, coordination preflight, HTTP codes.
 * Uses global fetch spy + fake timers (deterministic; no real network).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import { processOutboundQueue, enqueueOutboundCapsule } from '../outboundQueue'
import { migrateHandshakeTables, insertHandshakeRecord } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { upsertP2PConfig } from '../../p2p/p2pConfig'
import type { HandshakeRecord } from '../types'
import { mockKeypairFields } from './mockKeypair'

const _require = createRequire(import.meta.url)
let Database: any
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  console.warn('[outboundQueue.backoff] better-sqlite3 not available — tests skipped')
}

function createTestDb(): any {
  if (!sqliteAvailable || !Database) throw new Error('better-sqlite3 not available')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

/** When false, the whole describe block is skipped (avoids vacuous passes without better-sqlite3). */
const hasSqlite = sqliteAvailable

function relayDirectHandshake(handshakeId: string): HandshakeRecord {
  return {
    handshake_id: handshakeId,
    relationship_id: 'rel-qb',
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
    counterparty_p2p_token: 'bearer-peer',
    p2p_endpoint: 'https://peer.example/beap/ingest',
    ...mockKeypairFields(),
  } as HandshakeRecord
}

const minimalCapsule = (handshakeId: string) => ({
  schema_version: 1,
  capsule_type: 'context_sync',
  handshake_id: handshakeId,
  seq: 1,
})

describe.skipIf(!hasSqlite)('outboundQueue: backoff & transport', () => {
  let db: any
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    db = createTestDb()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy?.mockRestore?.()
    vi.useRealTimers()
  })

  test('QB_01_first_transport_failure_sets_retry_and_last_queue_error', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-01'))
    const target = 'https://peer.example/beap/ingest'
    fetchSpy.mockResolvedValue(new Response('err', { status: 500 }))
    enqueueOutboundCapsule(db, 'hs-qb-01', target, minimalCapsule('hs-qb-01'))

    const r = await processOutboundQueue(db)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.delivered).toBe(false)
    expect(r.code).toBe('TRANSPORT_FAILED')
    expect(r.queued).toBe(true)
    expect(r.error).toBeDefined()
    expect(r.last_queue_error).toBe(r.error)
    expect(r.retry_count).toBe(1)
    expect(r.max_retries).toBe(10)
    const row = db.prepare('SELECT error, retry_count FROM outbound_capsule_queue WHERE handshake_id = ?').get('hs-qb-01') as {
      error: string
      retry_count: number
    }
    expect(row.retry_count).toBe(1)
    expect(row.error).toBe(r.last_queue_error)
  })

  test('QB_02_immediate_second_drain_does_not_call_fetch_BACKOFF_WAIT_preserves_last_queue_error', async () => {
    vi.useFakeTimers({ now: new Date('2025-06-01T12:00:00.000Z') })
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-02'))
    const target = 'https://peer.example/beap/ingest'
    fetchSpy.mockResolvedValue(new Response('fail', { status: 500 }))
    enqueueOutboundCapsule(db, 'hs-qb-02', target, minimalCapsule('hs-qb-02'))

    await processOutboundQueue(db)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const r2 = await processOutboundQueue(db)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r2.code).toBe('BACKOFF_WAIT')
    expect(r2.queued).toBe(true)
    expect(r2.error).toContain('waiting before retry')
    expect(r2.last_queue_error).toBeTruthy()
    expect(r2.retry_count).toBe(1)
    expect(r2.max_retries).toBe(10)
    expect(typeof r2.remaining_ms).toBe('number')
    expect(r2.remaining_ms!).toBeGreaterThan(0)
  })

  test('QB_03_after_backoff_expiry_performs_second_http_attempt', async () => {
    const t0 = new Date('2025-06-01T12:00:00.000Z').getTime()
    vi.useFakeTimers({ now: t0 })
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-03'))
    const target = 'https://peer.example/beap/ingest'
    fetchSpy.mockResolvedValue(new Response('fail', { status: 500 }))
    enqueueOutboundCapsule(db, 'hs-qb-03', target, minimalCapsule('hs-qb-03'))

    await processOutboundQueue(db)
    await processOutboundQueue(db)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    vi.setSystemTime(t0 + 5100)
    await processOutboundQueue(db)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('QB_04_coordination_missing_oidc_no_fetch_preflight', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    enqueueOutboundCapsule(db, 'hs-qb-04', 'https://coordination.wrdesk.com/beap/capsule', minimalCapsule('hs-qb-04'))

    const r = await processOutboundQueue(db, async () => null)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.delivered).toBe(false)
    expect(r.code).toBe('PREFLIGHT_FAILED')
    expect(r.queued).toBe(true)
    expect(r.error).toContain('No OIDC')
    expect(r.last_queue_error).toBe(r.error)
    expect(r.retry_count).toBe(1)
  })

  test('QB_05_coordination_missing_url_no_fetch_preflight', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: '',
    })
    enqueueOutboundCapsule(db, 'hs-qb-05', 'https://ignored/beap/capsule', minimalCapsule('hs-qb-05'))

    const r = await processOutboundQueue(db, async () => 'oidc-token')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.code).toBe('PREFLIGHT_FAILED')
    expect(r.queued).toBe(true)
    expect(r.error).toContain('Coordination URL')
    expect(r.last_queue_error).toBe(r.error)
  })

  test('QB_06_coordination_http_401_AUTH_REQUIRED_no_retry_increment', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(new Response('unauthorized', { status: 401 }))
    enqueueOutboundCapsule(db, 'hs-qb-06', 'https://coordination.wrdesk.com/beap/capsule', minimalCapsule('hs-qb-06'))

    const r = await processOutboundQueue(db, async () => 'oidc-token')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.code).toBe('AUTH_REQUIRED')
    expect(r.queued).toBe(true)
    expect(r.retry_count).toBe(0)
    expect(r.last_queue_error).toBeTruthy()
    const row = db.prepare('SELECT retry_count FROM outbound_capsule_queue WHERE handshake_id = ?').get('hs-qb-06') as {
      retry_count: number
    }
    expect(row.retry_count).toBe(0)
  })

  test('QB_07_coordination_http_429_transport_failure_increments_retry', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }))
    enqueueOutboundCapsule(db, 'hs-qb-07', 'https://coordination.wrdesk.com/beap/capsule', minimalCapsule('hs-qb-07'))

    const r = await processOutboundQueue(db, async () => 'oidc-token')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.code).toBe('TRANSPORT_FAILED')
    expect(r.queued).toBe(true)
    expect(r.retry_count).toBe(1)
    expect(r.last_queue_error).toBeTruthy()
  })

  test('QB_08_direct_peer_fetch_rejected_unreachable_increments_retry', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-08'))
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'))
    enqueueOutboundCapsule(db, 'hs-qb-08', 'https://peer.example/beap/ingest', minimalCapsule('hs-qb-08'))

    const r = await processOutboundQueue(db)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.code).toBe('TRANSPORT_FAILED')
    expect(r.queued).toBe(true)
    expect(r.retry_count).toBe(1)
    expect(r.last_queue_error).toContain('Connection refused')
  })
})
