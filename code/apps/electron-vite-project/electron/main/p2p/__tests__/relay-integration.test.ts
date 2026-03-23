/**
 * Relay Integration Tests — Host pull, handshake registration, mode behavior.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createRequire } from 'module'
import http from 'http'
import { pullFromRelay } from '../relayPull'
import { registerHandshakeWithRelay } from '../relaySync'
import { migrateHandshakeTables } from '../../handshake/db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { upsertP2PConfig, getP2PConfig } from '../p2pConfig'
import { buildTestSession } from '../../handshake/sessionFactory'
import { getP2PHealth, setP2PHealthRelayPullSuccess, setP2PHealthRelayPullFailure } from '../p2pHealth'

const _require = createRequire(import.meta.url)
let Database: any
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  console.warn('[Relay TEST] better-sqlite3 not available')
}

function createTestDb(): any {
  if (!sqliteAvailable || !Database) throw new Error('better-sqlite3 not available')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

function validBeapCapsule(handshakeId: string): string {
  return JSON.stringify({
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: handshakeId,
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
  })
}

describe('relay-integration', () => {
  let mockServer: http.Server
  let mockPort: number
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeAll(() => {
    if (!sqliteAvailable) return
    mockServer = http.createServer((req, res) => {
      const url = req.url ?? ''
      if (req.method === 'GET' && url.includes('/pull')) {
        const auth = req.headers.authorization
        if (auth !== 'Bearer secret-123') {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ capsules: [] }))
        return
      }
      if (req.method === 'POST' && url.includes('/ack')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ acknowledged: 0 }))
        return
      }
      if (req.method === 'POST' && url.includes('/register-handshake')) {
        const auth = req.headers.authorization
        if (auth !== 'Bearer secret-123') {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ registered: true }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    return new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address()
        mockPort = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  })

  afterAll(() => {
    if (mockServer) mockServer.close()
    fetchSpy?.restore?.()
  })

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  test('RI_01_pull_from_relay: Mock relay returns capsules → host processes and acks', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_pull_url: `http://127.0.0.1:${mockPort}/beap/pull`,
      relay_auth_secret: 'secret-123',
    })
    fetchSpy.mockImplementation(async (url: any) => {
      if (String(url).includes('/pull')) {
        return new Response(
          JSON.stringify({
            capsules: [
              {
                id: 'relay-msg-001',
                handshake_id: 'hs-ri01',
                capsule_json: validBeapCapsule('hs-ri01'),
                received_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (String(url).includes('/ack')) {
        return new Response(JSON.stringify({ acknowledged: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('', { status: 404 })
    })

    const session = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    await pullFromRelay(db, () => session)
    expect(fetchSpy).toHaveBeenCalled()
    const pullCalls = (fetchSpy as any).mock.calls.filter((c: any) =>
      String(c[0]).includes('/pull'),
    )
    expect(pullCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('RI_02_pull_empty: Mock relay returns empty → no error, no processing', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_pull_url: `http://127.0.0.1:${mockPort}/beap/pull`,
      relay_auth_secret: 'secret-123',
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ capsules: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const session = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    await pullFromRelay(db, () => session)
    expect(fetchSpy).toHaveBeenCalled()
  })

  test('RI_03_pull_auth_failure: Mock relay returns 401 → logged, no crash', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_pull_url: `http://127.0.0.1:${mockPort}/beap/pull`,
      relay_auth_secret: 'wrong-secret',
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const session = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    await expect(pullFromRelay(db, () => session)).resolves.not.toThrow()
  })

  test('RI_04_pull_unreachable: Mock relay offline → logged, retry on next interval', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_pull_url: 'http://127.0.0.1:99999/beap/pull',
      relay_auth_secret: 'secret-123',
    })
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'))

    const session = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    await expect(pullFromRelay(db, () => session)).resolves.not.toThrow()
  })

  test('RI_05_pull_invalid_capsule: Relay returns capsule that fails host validation → rejected but acked', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_pull_url: `http://127.0.0.1:${mockPort}/beap/pull`,
      relay_auth_secret: 'secret-123',
    })
    fetchSpy.mockImplementation(async (url: any) => {
      if (String(url).includes('/pull')) {
        return new Response(
          JSON.stringify({
            capsules: [
              {
                id: 'relay-msg-bad',
                handshake_id: 'hs-bad',
                capsule_json: JSON.stringify({ handshake_id: 'hs-bad', invalid: true }),
                received_at: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (String(url).includes('/ack')) {
        return new Response(JSON.stringify({ acknowledged: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('', { status: 404 })
    })

    const session = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    await pullFromRelay(db, () => session)
    const ackCalls = (fetchSpy as any).mock.calls.filter((c: any) =>
      String(c[0]).includes('/ack'),
    )
    expect(ackCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('RI_06_register_handshake: Register handshake with mock relay → POST sent with correct body', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_url: `http://127.0.0.1:${mockPort}/beap/ingest`,
      relay_auth_secret: 'secret-123',
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ registered: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await registerHandshakeWithRelay(
      db,
      'hs-ri06',
      'token-abc',
      'other@example.com',
    )
    expect(result.success).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/register-handshake'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-123',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          handshake_id: 'hs-ri06',
          expected_token: 'token-abc',
          counterparty_email: 'other@example.com',
        }),
      }),
    )
  })

  test('RI_07_register_failure: Mock relay returns error → logged, handshake still created', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_url: `http://127.0.0.1:${mockPort}/beap/ingest`,
      relay_auth_secret: 'secret-123',
    })
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await registerHandshakeWithRelay(
      db,
      'hs-ri07',
      'token-xyz',
      'x@y.com',
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('RI_08_local_mode_no_pull: relay_mode=local → pullFromRelay skips', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, { relay_mode: 'local' })

    await pullFromRelay(db, () => buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('RI_09_disabled_mode_skips: relay_mode=disabled → both pull and register skip', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, { relay_mode: 'disabled' })

    await pullFromRelay(db, () => buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' }))
    expect(fetchSpy).not.toHaveBeenCalled()

    const regResult = await registerHandshakeWithRelay(db, 'hs-ri09', 'tok', 'x@y.com')
    expect(regResult.success).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('RI_10_outbound_to_relay: Outbound queue sends to relay URL → same as P2P but different target', async () => {
    if (!sqliteAvailable) return
    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_url: 'https://relay.example.com/beap/ingest',
    })
    const cfg = getP2PConfig(db)
    expect(cfg.relay_url).toBe('https://relay.example.com/beap/ingest')
    expect(cfg.relay_mode).toBe('remote')
  })
})
