/**
 * Coordination Client Tests — Outbound routing, handshake registration, health.
 *
 * CC_05–CC_12: Outbound, registration, health, mode switch (8 tests).
 * CC_01–CC_04: WebSocket connect, receive capsule, reconnect, pending — skipped:
 *   Vitest/Vite fails to load ws when coordinationWs is imported. Run manually
 *   with Node or add ws to test.server.deps.external when supported.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import { processOutboundQueue, enqueueOutboundCapsule } from '../../handshake/outboundQueue'
import { registerHandshakeWithRelay } from '../relaySync'
import { migrateHandshakeTables, insertHandshakeRecord } from '../../handshake/db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { upsertP2PConfig, getP2PConfig } from '../p2pConfig'
import { buildTestSession } from '../../handshake/sessionFactory'
import type { HandshakeRecord } from '../../handshake/types'
import {
  getP2PHealth,
  setP2PHealthCoordinationConnected,
  setP2PHealthCoordinationDisconnected,
  setP2PHealthCoordinationReconnectAttempts,
} from '../p2pHealth'

const _require = createRequire(import.meta.url)
let Database: any
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  console.warn('[Coordination TEST] better-sqlite3 not available')
}

function createTestDb(): any {
  if (!sqliteAvailable || !Database) throw new Error('better-sqlite3 not available')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

function skipIfNoSqlite(): boolean {
  return !sqliteAvailable
}

describe('Coordination Client', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy?.restore?.()
  })

  test('CC_05_outbound_via_coordination: use_coordination=true → outbound goes to coordination URL with OIDC token', async () => {
    if (skipIfNoSqlite()) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    enqueueOutboundCapsule(db, 'hs-cc05', 'https://coordination.wrdesk.com/beap/capsule', {
      schema_version: 1,
      capsule_type: 'context_sync',
      handshake_id: 'hs-cc05',
      seq: 1,
    })

    await processOutboundQueue(db, async () => 'oidc-token-xyz')
    expect(fetchSpy).toHaveBeenCalled()
    const call = (fetchSpy as any).mock.calls.find((c: any) => String(c[0]).includes('/beap/capsule'))
    expect(call).toBeDefined()
    expect(call[1]?.headers?.Authorization).toBe('Bearer oidc-token-xyz')
  })

  test('CC_06_outbound_via_relay: use_coordination=false → outbound goes to relay URL with Bearer token', async () => {
    if (skipIfNoSqlite()) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'https://relay.example.com/beap/ingest',
    })
    const record: Partial<HandshakeRecord> = {
      handshake_id: 'hs-cc06',
      relationship_id: 'rel-1',
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
      counterparty_p2p_token: 'bearer-token-abc',
      p2p_endpoint: 'https://relay.example.com/beap/ingest',
    }
    insertHandshakeRecord(db, record as HandshakeRecord)
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    enqueueOutboundCapsule(db, 'hs-cc06', 'https://relay.example.com/beap/ingest', {
      schema_version: 1,
      capsule_type: 'context_sync',
      handshake_id: 'hs-cc06',
      seq: 1,
    })

    await processOutboundQueue(db)
    expect(fetchSpy).toHaveBeenCalled()
    const call = (fetchSpy as any).mock.calls[0]
    expect(call[1]?.headers?.Authorization).toBe('Bearer bearer-token-abc')
  })

  test('CC_07_register_handshake_coordination: use_coordination=true → registration goes to coordination service', async () => {
    if (skipIfNoSqlite()) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ registered: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    const result = await registerHandshakeWithRelay(
      db,
      'hs-cc07',
      'token-ignored',
      'acceptor@t.com',
      async () => 'oidc-token',
      {
        initiator_user_id: 'i1',
        acceptor_user_id: 'a1',
        initiator_email: 'init@t.com',
        acceptor_email: 'acceptor@t.com',
      },
    )
    expect(result.success).toBe(true)
    const call = (fetchSpy as any).mock.calls.find((c: any) => String(c[0]).includes('/beap/register-handshake'))
    expect(call).toBeDefined()
    expect(call[1]?.headers?.Authorization).toBe('Bearer oidc-token')
    const body = JSON.parse(call[1].body)
    expect(body.handshake_id).toBe('hs-cc07')
    expect(body.initiator_user_id).toBe('i1')
    expect(body.acceptor_user_id).toBe('a1')
  })

  test('CC_08_register_handshake_relay: use_coordination=false → registration goes to own relay', async () => {
    if (skipIfNoSqlite()) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      use_coordination: false,
      relay_url: 'http://127.0.0.1:9999/beap/ingest',
      relay_auth_secret: 'secret-123',
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ registered: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    const result = await registerHandshakeWithRelay(db, 'hs-cc08', 'expected-token', 'other@t.com')
    expect(result.success).toBe(true)
    const call = (fetchSpy as any).mock.calls.find((c: any) => String(c[0]).includes('/register-handshake'))
    expect(call).toBeDefined()
    expect(call[1]?.headers?.Authorization).toBe('Bearer secret-123')
    const body = JSON.parse(call[1].body)
    expect(body.expected_token).toBe('expected-token')
    expect(body.counterparty_email).toBe('other@t.com')
  })

  test('CC_09_health_connected: WS connected → health shows coordination_connected=true', async () => {
    if (skipIfNoSqlite()) return
    setP2PHealthCoordinationDisconnected()
    setP2PHealthCoordinationConnected()
    const health = getP2PHealth()
    expect(health.coordination_connected).toBe(true)
  })

  test('CC_10_health_disconnected: WS disconnected → health shows reconnecting', async () => {
    if (skipIfNoSqlite()) return
    setP2PHealthCoordinationConnected()
    setP2PHealthCoordinationDisconnected()
    setP2PHealthCoordinationReconnectAttempts(3)
    const health = getP2PHealth()
    expect(health.coordination_connected).toBe(false)
    expect(health.coordination_reconnect_attempts).toBe(3)
  })

  test('CC_11_token_refresh: processOutboundQueue calls getOidcToken when use_coordination', async () => {
    if (skipIfNoSqlite()) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'local',
      use_coordination: true,
      coordination_url: 'https://coordination.wrdesk.com',
    })
    let tokenCalls = 0
    const getOidcToken = async () => {
      tokenCalls++
      return 'oidc-token'
    }
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    enqueueOutboundCapsule(db, 'hs-cc11', 'https://coordination.wrdesk.com/beap/capsule', {
      schema_version: 1,
      capsule_type: 'context_sync',
      handshake_id: 'hs-cc11',
      seq: 1,
    })
    await processOutboundQueue(db, getOidcToken)
    expect(tokenCalls).toBeGreaterThanOrEqual(1)
  })

  test('CC_12_mode_switch: Switch from coordination to relay mode → use_coordination false', async () => {
    if (skipIfNoSqlite()) return
    const db = createTestDb()
    upsertP2PConfig(db, { relay_mode: 'local' })
    let cfg = getP2PConfig(db)
    expect(cfg.use_coordination).toBe(true)

    upsertP2PConfig(db, { relay_mode: 'remote' })
    cfg = getP2PConfig(db)
    expect(cfg.use_coordination).toBe(false)
  })
})
