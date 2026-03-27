/**
 * Outbound queue: transport failures, retry/backoff, coordination preflight, HTTP codes.
 * Uses global fetch spy + fake timers (deterministic; no real network).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import {
  processOutboundQueue,
  enqueueOutboundCapsule,
  setOutboundQueueAuthRefresh,
  clearOutboundAutoDrainTimer,
} from '../outboundQueue'
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
    clearOutboundAutoDrainTimer()
    setOutboundQueueAuthRefresh(undefined)
    fetchSpy?.mockRestore?.()
    vi.useRealTimers()
    vi.restoreAllMocks()
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

  test('QB_09_post_failure_autodrain_retries_without_second_user_call', async () => {
    vi.useFakeTimers({ now: new Date('2025-06-01T12:00:00.000Z') })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-09'))
    fetchSpy.mockResolvedValue(new Response('fail', { status: 500 }))
    enqueueOutboundCapsule(db, 'hs-qb-09', 'https://peer.example/beap/ingest', minimalCapsule('hs-qb-09'))

    const r1 = await processOutboundQueue(db)
    expect(r1.code).toBe('TRANSPORT_FAILED')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_500)
    await vi.runAllTimersAsync()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('QB_10_parallel_processOutboundQueue_calls_fetch_once_per_row', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-10'))
    let resolveFetch!: (v: Response) => void
    const deferred = new Promise<Response>((res) => {
      resolveFetch = res
    })
    fetchSpy.mockReturnValueOnce(deferred as Promise<Response>)
    enqueueOutboundCapsule(db, 'hs-qb-10', 'https://peer.example/beap/ingest', minimalCapsule('hs-qb-10'))

    const a = processOutboundQueue(db)
    const b = processOutboundQueue(db)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    resolveFetch(new Response('fail', { status: 500 }))
    await Promise.all([a, b])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('QB_15_coordination_missing_token_then_token_after_refresh_sends', async () => {
    setOutboundQueueAuthRefresh(async () => {})
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(new Response('', { status: 200 }))
    enqueueOutboundCapsule(db, 'hs-qb-15', 'https://coordination.wrdesk.com/beap/capsule', minimalCapsule('hs-qb-15'))

    let calls = 0
    await processOutboundQueue(db, async () => {
      calls += 1
      if (calls === 1) return null
      return 'oidc-after-refresh'
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
  })

  test('QB_11_coordination_401_with_refresh_retries_http_once', async () => {
    setOutboundQueueAuthRefresh(async () => {})
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(new Response('unauthorized', { status: 401 }))
    enqueueOutboundCapsule(db, 'hs-qb-11', 'https://coordination.wrdesk.com/beap/capsule', minimalCapsule('hs-qb-11'))

    await processOutboundQueue(db, async () => 'oidc-token')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('QB_12_coordination_429_persists_retry_after_ms', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(
      new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '3' },
      }),
    )
    enqueueOutboundCapsule(db, 'hs-qb-12', 'https://coordination.wrdesk.com/beap/capsule', minimalCapsule('hs-qb-12'))

    await processOutboundQueue(db, async () => 'oidc-token')

    const row = db.prepare('SELECT retry_after_ms, failure_class FROM outbound_capsule_queue WHERE handshake_id = ?').get(
      'hs-qb-12',
    ) as { retry_after_ms: number | null; failure_class: string | null }
    expect(row.retry_after_ms).toBe(3000)
    expect(row.failure_class).toBe('THROTTLED')
  })

  test('QB_13_stale_direct_endpoint_refreshes_and_retries', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    const h = relayDirectHandshake('hs-qb-13')
    h.p2p_endpoint = 'https://fresh.peer/beap/ingest'
    insertHandshakeRecord(db, h)
    fetchSpy
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    enqueueOutboundCapsule(db, 'hs-qb-13', 'https://stale.peer/beap/ingest', minimalCapsule('hs-qb-13'))

    const r = await processOutboundQueue(db)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(r.delivered).toBe(true)
    const row = db.prepare('SELECT target_endpoint FROM outbound_capsule_queue WHERE handshake_id = ?').get('hs-qb-13') as {
      target_endpoint: string
    }
    expect(row.target_endpoint).toBe('https://fresh.peer/beap/ingest')
  })

  test('QB_16_http_400_terminal_request_invalid_no_autodrain', async () => {
    vi.useFakeTimers({ now: new Date('2025-06-01T12:00:00.000Z') })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-16'))
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid capsule schema' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    enqueueOutboundCapsule(db, 'hs-qb-16', 'https://peer.example/beap/ingest', minimalCapsule('hs-qb-16'))

    const r = await processOutboundQueue(db)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.code).toBe('REQUEST_INVALID')
    expect(r.queued).toBe(false)
    expect(r.failure_class).toBe('PAYLOAD_PERMANENT')
    expect(r.healing_status).toBe('STOPPED_REQUIRES_FIX')
    expect(r.http_status).toBe(400)
    expect(r.response_body_snippet).toContain('invalid capsule')
    expect(r.outbound_debug).toBeDefined()
    expect(r.outbound_debug?.url).toContain('peer.example')
    expect(r.outbound_debug?.method).toBe('POST')
    expect(r.outbound_debug?.http_status).toBe(400)
    expect(r.remaining_ms).toBeUndefined()
    expect(r.next_retry_at).toBeUndefined()

    const row = db.prepare(
      `SELECT status, error, failure_class FROM outbound_capsule_queue WHERE handshake_id = ?`,
    ).get('hs-qb-16') as { status: string; error: string; failure_class: string | null }
    expect(row.status).toBe('failed')
    expect(row.failure_class).toBe('PAYLOAD_PERMANENT')
    expect(row.error).toContain('HTTP 400')

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.runAllTimersAsync()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('QB_19_coordination_initiate_reaches_server_terminal_400', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'capsule_type_not_allowed',
          detail: "Type 'initiate' must be delivered out-of-band",
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    enqueueOutboundCapsule(db, 'hs-qb-19', 'https://coordination.wrdesk.com/beap/capsule', {
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_id: 'hs-qb-19',
    })

    const r = await processOutboundQueue(db, async () => 'oidc-token')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(r.code).toBe('RELAY_TYPE_NOT_ALLOWED')
    expect(r.queued).toBe(false)
    expect(r.http_status).toBe(400)
  })

  test('QB_17_coordination_http_400_terminal_single_fetch', async () => {
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(new Response('bad request body', { status: 400 }))
    enqueueOutboundCapsule(db, 'hs-qb-17', 'https://coordination.wrdesk.com/beap/capsule', minimalCapsule('hs-qb-17'))

    const r = await processOutboundQueue(db, async () => 'oidc-token')

    expect(r.code).toBe('REQUEST_INVALID')
    expect(r.queued).toBe(false)
    expect(r.failure_class).toBe('PAYLOAD_PERMANENT')
    expect(r.healing_status).toBe('STOPPED_REQUIRES_FIX')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('QB_18_http_400_emits_request_diagnostics_logs', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example/beap/ingest',
    })
    insertHandshakeRecord(db, relayDirectHandshake('hs-qb-18'))
    fetchSpy.mockResolvedValue(new Response('{"error":"Bad request"}', { status: 400, headers: { 'Content-Type': 'application/json' } }))
    enqueueOutboundCapsule(db, 'hs-qb-18', 'https://peer.example/beap/ingest', minimalCapsule('hs-qb-18'))

    await processOutboundQueue(db)

    const allInfo = infoSpy.mock.calls.map((c) => String(c[1] ?? c[0])).join('\n')
    expect(allInfo).toContain('outbound_request_diagnostics')
    expect(allInfo).toContain('terminal_http_400')
    expect(allInfo).toContain('request_shape')
    infoSpy.mockRestore()
  })

  test('QB_14_preflight_config_permanent_does_not_schedule_autodrain', async () => {
    vi.useFakeTimers({ now: new Date('2025-06-01T12:00:00.000Z') })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: '',
    })
    enqueueOutboundCapsule(db, 'hs-qb-14', 'https://ignored/beap/capsule', minimalCapsule('hs-qb-14'))

    await processOutboundQueue(db, async () => 'oidc-token')

    const row1 = db.prepare('SELECT retry_count FROM outbound_capsule_queue WHERE handshake_id = ?').get('hs-qb-14') as {
      retry_count: number
    }
    expect(row1.retry_count).toBe(1)

    await vi.advanceTimersByTimeAsync(120_000)
    await vi.runAllTimersAsync()

    const row2 = db.prepare('SELECT retry_count FROM outbound_capsule_queue WHERE handshake_id = ?').get('hs-qb-14') as {
      retry_count: number
    }
    expect(row2.retry_count).toBe(1)
  })
})
