import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import http from 'http'
import WebSocket from 'ws'
import type { CoordinationConfig } from '../src/config.js'
import { initStore, closeStore, getDb, cleanupExpired } from '../src/store.js'
import { createServer } from '../src/server.js'
import { resetRateLimitsForTests } from '../src/rateLimiter.js'
import { registerHandshake } from '../src/handshakeRegistry.js'

process.env.COORD_TEST_MODE = '1'

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

function makeConfig(overrides: Partial<CoordinationConfig>): CoordinationConfig {
  const base: CoordinationConfig = {
    port: 0,
    host: '127.0.0.1',
    tls_cert_path: null,
    tls_key_path: null,
    oidc_issuer: 'https://auth.wrdesk.com/realms/wrdesk',
    oidc_jwks_url: 'https://auth.wrdesk.com/realms/wrdesk/protocol/openid-connect/certs',
    db_path: join(tmpdir(), `coord-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
    capsule_retention_days: 7,
    ws_heartbeat_interval: 60_000,
    max_connections: 10000,
  }
  return { ...base, ...overrides }
}

async function request(
  port: number,
  method: string,
  path: string,
  opts?: { body?: string; auth?: string; contentType?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        timeout: 5000,
        headers: {
          ...(opts?.body ? { 'Content-Length': Buffer.byteLength(opts.body) } : {}),
          ...(opts?.contentType ? { 'Content-Type': opts.contentType } : {}),
          ...(opts?.auth ? { Authorization: `Bearer ${opts.auth}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    if (opts?.body) req.write(opts.body)
    req.end()
  })
}

function wsConnect(port: number, token: string, onMessage?: (data: Buffer | string) => void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/beap/ws?token=${encodeURIComponent(token)}`)
    if (onMessage) ws.on('message', onMessage)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

describe('coordination-service', () => {
  let server: http.Server | https.Server
  let port: number
  let config: CoordinationConfig

  beforeAll(async () => {
    config = makeConfig({})
    initStore(config)
    server = createServer(config)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        port = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  })

  afterAll(() => {
    if (server) server.close()
    closeStore()
  })

  beforeEach(() => {
    resetRateLimitsForTests()
    const d = getDb()
    if (d) {
      d.exec('DELETE FROM coordination_capsules; DELETE FROM coordination_handshake_registry; DELETE FROM coordination_token_cache;')
    }
  })

  test('CS_01_post_capsule_stored: POST valid capsule → stored, 202', async () => {
    const hsId = 'hs-cs01'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender1',
        acceptor_user_id: 'recipient1',
        initiator_email: 's@test.com',
        acceptor_email: 'r@test.com',
      }),
      auth: 'test-sender1-pro',
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-sender1-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r.status)
    const body = JSON.parse(r.body)
    expect(body.status).toMatch(/Capsule (delivered|stored)/)
  })

  test('CS_02_push_online_recipient: Recipient connected via WS → capsule pushed immediately, 200', async () => {
    const hsId = 'hs-cs02'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender2',
        acceptor_user_id: 'recipient2',
      }),
      auth: 'test-sender2-pro',
      contentType: 'application/json',
    })

    const recipientWs = await wsConnect(port, 'test-recipient2-pro')
    const received: Array<{ id: string; capsule: unknown }> = []
    recipientWs.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'capsule') received.push({ id: msg.id, capsule: msg.capsule })
    })

    await new Promise((r) => setTimeout(r, 100))

    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-sender2-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).status).toBe('Capsule delivered')

    await new Promise((r) => setTimeout(r, 200))
    expect(received).toHaveLength(1)
    expect(received[0].capsule).toBeDefined()
    recipientWs.close()
  })

  test('CS_03_push_on_reconnect: Store capsule while offline → recipient connects → pushed', async () => {
    const hsId = 'hs-cs03'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender3',
        acceptor_user_id: 'recipient3',
      }),
      auth: 'test-sender3-pro',
      contentType: 'application/json',
    })

    const r1 = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-sender3-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r1.status)

    const received: Array<{ id: string }> = []
    const recipientWs = await wsConnect(port, 'test-recipient3-pro', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'capsule') received.push({ id: msg.id })
    })

    await new Promise((r) => setTimeout(r, 300))
    expect(received.length).toBeGreaterThanOrEqual(1)
    recipientWs.close()
  })

  test('CS_04_ack_deletes: Push + ACK → capsule deleted from store', async () => {
    const hsId = 'hs-cs04'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender4',
        acceptor_user_id: 'recipient4',
      }),
      auth: 'test-sender4-pro',
      contentType: 'application/json',
    })

    const recipientWs = await wsConnect(port, 'test-recipient4-pro')
    let capId: string | null = null
    recipientWs.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'capsule') capId = msg.id
    })

    await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-sender4-pro',
      contentType: 'application/json',
    })

    await new Promise((r) => setTimeout(r, 200))
    expect(capId).toBeTruthy()
    recipientWs.send(JSON.stringify({ type: 'ack', ids: [capId!] }))
    await new Promise((r) => setTimeout(r, 100))

    const health = await request(port, 'GET', '/health')
    const hp = JSON.parse(health.body)
    expect(hp.pending_capsules).toBe(0)
    recipientWs.close()
  })

  test('CS_05_auth_valid_oidc: Valid OIDC token → accepted', async () => {
    const hsId = 'hs-cs05'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'user5',
        acceptor_user_id: 'other5',
      }),
      auth: 'test-user5-pro',
      contentType: 'application/json',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-user5-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r.status)
  })

  test('CS_06_auth_invalid_token: Invalid token → 401', async () => {
    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule('hs-x'),
      auth: 'invalid-token-xyz',
      contentType: 'application/json',
    })
    expect(r.status).toBe(401)
  })

  test('CS_07_auth_expired_token: No token → 401', async () => {
    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule('hs-x'),
      contentType: 'application/json',
    })
    expect(r.status).toBe(401)
  })

  test('CS_08_rate_limit_free: Free tier: 101st capsule/month → 429', async () => {
    const hsId = 'hs-cs08'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'freeuser',
        acceptor_user_id: 'recipient8',
      }),
      auth: 'test-freeuser-free',
      contentType: 'application/json',
    })

    for (let i = 0; i < 101; i++) {
      const r = await request(port, 'POST', '/beap/capsule', {
        body: validBeapCapsule(hsId),
        auth: 'test-freeuser-free',
        contentType: 'application/json',
      })
      if (r.status === 429) {
        const body = JSON.parse(r.body)
        expect(body.error).toBe('Rate limit exceeded')
        expect(body.tier).toBe('free')
        return
      }
    }
    expect.fail('Expected 429 before 101 requests')
  })

  test('CS_09_rate_limit_pro: Pro tier: within limits → accepted', async () => {
    const hsId = 'hs-cs09'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'prouser',
        acceptor_user_id: 'recipient9',
      }),
      auth: 'test-prouser-pro',
      contentType: 'application/json',
    })

    for (let i = 0; i < 10; i++) {
      const r = await request(port, 'POST', '/beap/capsule', {
        body: validBeapCapsule(hsId),
        auth: 'test-prouser-pro',
        contentType: 'application/json',
      })
      expect([200, 202]).toContain(r.status)
    }
  })

  test('CS_10_register_handshake: Register → both parties can send', async () => {
    const hsId = 'hs-cs10'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'init10',
        acceptor_user_id: 'acc10',
      }),
      auth: 'test-init10-pro',
      contentType: 'application/json',
    })

    const r1 = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-init10-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r1.status)

    const r2 = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify({
        schema_version: 1,
        capsule_type: 'accept',
        handshake_id: hsId,
        sender_id: 'acc10',
        capsule_hash: 'c'.repeat(64),
        timestamp: new Date().toISOString(),
        sharing_mode: 'reciprocal',
        wrdesk_policy_hash: 'd'.repeat(64),
        seq: 1,
      }),
      auth: 'test-acc10-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r2.status)
  })

  test('CS_11_unauthorized_sender: Sender not party to handshake → 403', async () => {
    const hsId = 'hs-cs11'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'init11',
        acceptor_user_id: 'acc11',
      }),
      auth: 'test-init11-pro',
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-outsider-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
  })

  test('CS_12_validation_reject: Invalid capsule → 422', async () => {
    const hsId = 'hs-cs12'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender12',
        acceptor_user_id: 'recipient12',
      }),
      auth: 'test-sender12-pro',
      contentType: 'application/json',
    })

    const badCapsule = JSON.stringify({
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_id: hsId,
      // missing required: sender_id, capsule_hash, timestamp, wrdesk_policy_hash, seq
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: badCapsule,
      auth: 'test-sender12-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(422)
  })

  test('CS_13_cleanup_expired: Expired capsule → deleted by cleanup job', async () => {
    const hsId = 'hs-cs13'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender13',
        acceptor_user_id: 'recipient13',
      }),
      auth: 'test-sender13-pro',
      contentType: 'application/json',
    })

    await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-sender13-pro',
      contentType: 'application/json',
    })

    const db = getDb()
    expect(db).toBeTruthy()
    if (db) {
      db.prepare(
        `UPDATE coordination_capsules SET expires_at = ? WHERE handshake_id = ?`,
      ).run('2000-01-01T00:00:00.000Z', hsId)
    }

    const before = db?.prepare(`SELECT COUNT(*) as c FROM coordination_capsules WHERE handshake_id = ?`).get(hsId) as { c: number }
    expect(before?.c ?? 0).toBeGreaterThanOrEqual(1)

    cleanupExpired()

    const after = db?.prepare(`SELECT COUNT(*) as c FROM coordination_capsules WHERE handshake_id = ?`).get(hsId) as { c: number }
    expect(after?.c ?? 0).toBe(0)
  })

  test('CS_14_ws_heartbeat: WebSocket accepts connections and heartbeat runs', async () => {
    const ws = await wsConnect(port, 'test-heartbeat-pro')
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  test('CS_15_offline_then_online: Full flow: send while offline, come online, receive, ack', async () => {
    const hsId = 'hs-cs15'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender15',
        acceptor_user_id: 'recipient15',
      }),
      auth: 'test-sender15-pro',
      contentType: 'application/json',
    })

    const r1 = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-sender15-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r1.status)

    const received: Array<{ id: string }> = []
    const recipientWs = await wsConnect(port, 'test-recipient15-pro', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'capsule') received.push({ id: msg.id })
    })

    await new Promise((r) => setTimeout(r, 300))
    expect(received.length).toBeGreaterThanOrEqual(1)
    recipientWs.send(JSON.stringify({ type: 'ack', ids: received.map((x) => x.id) }))
    await new Promise((r) => setTimeout(r, 100))

    const health = await request(port, 'GET', '/health')
    expect(JSON.parse(health.body).pending_capsules).toBe(0)
    recipientWs.close()
  })

  test('health: GET /health → 200 with status', async () => {
    const r = await request(port, 'GET', '/health')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.connected_clients).toBe('number')
    expect(typeof body.pending_capsules).toBe('number')
  })
})
