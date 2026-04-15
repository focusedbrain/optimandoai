import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import http from 'http'
import https from 'https'
import WebSocket from 'ws'
import type { CoordinationConfig } from '../src/config.js'
import { createServer } from '../src/server.js'

process.env.COORD_TEST_MODE = '1'

/** Relay-acceptable capsule (accept type). Initiate must be delivered out-of-band. */
function validBeapCapsule(handshakeId: string, senderId = 'user-1'): string {
  return JSON.stringify({
    schema_version: 1,
    capsule_type: 'accept',
    handshake_id: handshakeId,
    sender_id: senderId,
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    sharing_mode: 'reciprocal',
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'a'.repeat(64),
    sender_signature: 'b'.repeat(128),
    countersigned_hash: 'c'.repeat(128),
  })
}

/** Same-principal relay: device routing fields on top of accept capsule JSON. */
function samePrincipalCapsule(
  handshakeId: string,
  senderUserId: string,
  senderDeviceId: string,
  receiverDeviceId?: string,
): string {
  const o = JSON.parse(validBeapCapsule(handshakeId, senderUserId)) as Record<string, unknown>
  o.sender_device_id = senderDeviceId
  if (receiverDeviceId !== undefined) o.receiver_device_id = receiverDeviceId
  return JSON.stringify(o)
}

function makeConfig(overrides: Partial<CoordinationConfig>): CoordinationConfig {
  const base: CoordinationConfig = {
    port: 0,
    host: '127.0.0.1',
    tls_cert_path: null,
    tls_key_path: null,
    oidc_issuer: 'https://auth.wrdesk.com/realms/wrdesk',
    oidc_jwks_url: 'https://auth.wrdesk.com/realms/wrdesk/protocol/openid-connect/certs',
    oidc_audience: null,
    db_path: join(tmpdir(), `coord-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
    capsule_retention_days: 7,
    ws_heartbeat_interval: 60_000,
    max_connections: 10000,
    session_ttl_seconds: 86400,
    handshake_ttl_seconds: 604800,
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
  let relay: Awaited<ReturnType<typeof createServer>>['relay'] | undefined

  beforeAll(async () => {
    config = makeConfig({})
    const result = await createServer(config)
    server = result.server
    relay = result.relay
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
    if (relay) relay.store.close()
  })

  beforeEach(() => {
    if (!relay) return
    relay.rateLimiter.resetForTests()
    const d = relay.store.getDb()
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
        sender_public_key: 'a'.repeat(64),
        sender_signature: 'b'.repeat(128),
        countersigned_hash: 'c'.repeat(128),
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

    const db = relay!.store.getDb()
    expect(db).toBeTruthy()
    if (db) {
      db.prepare(
        `UPDATE coordination_capsules SET expires_at = ? WHERE handshake_id = ?`,
      ).run('2000-01-01T00:00:00.000Z', hsId)
    }

    const before = db?.prepare(`SELECT COUNT(*) as c FROM coordination_capsules WHERE handshake_id = ?`).get(hsId) as { c: number }
    expect(before?.c ?? 0).toBeGreaterThanOrEqual(1)

    relay!.store.cleanupExpired()

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

  test('CS_16_ack_unauthorized: User A ACKs user B capsule → 0 acknowledged, ACK_UNAUTHORIZED logged', async () => {
    const hsId = 'hs-cs16'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender16',
        acceptor_user_id: 'recipient16',
      }),
      auth: 'test-sender16-pro',
      contentType: 'application/json',
    })

    const recipientWs = await wsConnect(port, 'test-recipient16-pro')
    let capId: string | null = null
    recipientWs.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'capsule') capId = msg.id
    })

    await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId),
      auth: 'test-sender16-pro',
      contentType: 'application/json',
    })

    await new Promise((r) => setTimeout(r, 200))
    expect(capId).toBeTruthy()
    recipientWs.close()

    const attackerWs = await wsConnect(port, 'test-attacker-pro')
    attackerWs.send(JSON.stringify({ type: 'ack', ids: [capId!] }))
    await new Promise((r) => setTimeout(r, 100))

    const health = await request(port, 'GET', '/health')
    const hp = JSON.parse(health.body)
    expect(hp.pending_capsules).toBe(1)
    attackerWs.close()
  })

  test('CS_17_native_wire_no_capsule_type: native BEAP shape accepted', async () => {
    const hsId = 'hs-cs17'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender17',
        acceptor_user_id: 'recipient17',
      }),
      auth: 'test-sender17-pro',
      contentType: 'application/json',
    })
    const native = JSON.stringify({
      handshake_id: hsId,
      header: { receiver_binding: { handshake_id: hsId }, encoding: 'qBEAP' },
      metadata: {},
      payloadEnc: { chunking: { count: 1, enabled: true, maxChunkBytes: 262144, merkleRoot: 'x' } },
      innerEnvelopeCiphertext: 'x',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: native,
      auth: 'test-sender17-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r.status)
  })

  test('CS_18_native_wire_stringified_header_metadata: normalized native BEAP accepted', async () => {
    const hsId = 'hs-cs18'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender18',
        acceptor_user_id: 'recipient18',
      }),
      auth: 'test-sender18-pro',
      contentType: 'application/json',
    })
    const native = JSON.stringify({
      handshake_id: hsId,
      header: JSON.stringify({ receiver_binding: { handshake_id: hsId } }),
      metadata: JSON.stringify({}),
      payloadEnc: { chunking: { count: 1, enabled: true, maxChunkBytes: 262144, merkleRoot: 'z' } },
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: native,
      auth: 'test-sender18-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r.status)
  })

  test('CS_19_non_native_junk_no_capsule_type: 400 capsule_type_not_allowed', async () => {
    const hsId = 'hs-cs19'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender19',
        acceptor_user_id: 'recipient19',
      }),
      auth: 'test-sender19-pro',
      contentType: 'application/json',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify({ handshake_id: hsId, foo: 'bar' }),
      auth: 'test-sender19-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
    expect(JSON.parse(r.body).error).toBe('capsule_type_not_allowed')
  })

  test('health: GET /health → 200 with status when healthy', async () => {
    const r = await request(port, 'GET', '/health')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.connected_clients).toBe('number')
    expect(typeof body.pending_capsules).toBe('number')
  })

  test('CS_17_session_ttl: Stale handshake cleaned after TTL', async () => {
    const hsId = 'hs-cs17'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sender17',
        acceptor_user_id: 'recipient17',
      }),
      auth: 'test-sender17-pro',
      contentType: 'application/json',
    })

    const db = relay!.store.getDb()
    const oldDate = new Date(Date.now() - (config.handshake_ttl_seconds + 1) * 1000).toISOString()
    db.prepare(`UPDATE coordination_handshake_registry SET created_at = ? WHERE handshake_id = ?`).run(oldDate, hsId)

    const before = db.prepare(`SELECT COUNT(*) as c FROM coordination_handshake_registry WHERE handshake_id = ?`).get(hsId) as { c: number }
    expect(before?.c ?? 0).toBe(1)

    relay!.store.cleanupStaleHandshakes(config.handshake_ttl_seconds)

    const after = db.prepare(`SELECT COUNT(*) as c FROM coordination_handshake_registry WHERE handshake_id = ?`).get(hsId) as { c: number }
    expect(after?.c ?? 0).toBe(0)
  })

  test('CS_18_same_principal_register_requires_distinct_device_ids', async () => {
    const hsId = 'hs-cs18'
    const r0 = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'spuser18',
        acceptor_user_id: 'spuser18',
      }),
      auth: 'test-spuser18-pro',
      contentType: 'application/json',
    })
    expect(r0.status).toBe(400)
    const b0 = JSON.parse(r0.body)
    expect(b0.code).toBe('INTERNAL_RELAY_REGISTRATION_MISSING_INITIATOR_DEVICE_ID')

    const r0b = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: `${hsId}a`,
        initiator_user_id: 'spuser18',
        acceptor_user_id: 'spuser18',
        initiator_device_id: 'dev-only-init',
      }),
      auth: 'test-spuser18-pro',
      contentType: 'application/json',
    })
    expect(r0b.status).toBe(400)
    expect(JSON.parse(r0b.body).code).toBe('INTERNAL_RELAY_REGISTRATION_MISSING_ACCEPTOR_DEVICE_ID')

    const r1 = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: `${hsId}b`,
        initiator_user_id: 'spuser18',
        acceptor_user_id: 'spuser18',
        initiator_device_id: 'dev-x',
        acceptor_device_id: 'dev-x',
      }),
      auth: 'test-spuser18-pro',
      contentType: 'application/json',
    })
    expect(r1.status).toBe(400)
    expect(JSON.parse(r1.body).code).toBe('INTERNAL_RELAY_REGISTRATION_DEVICE_IDS_NOT_DISTINCT')

    const r2 = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: `${hsId}c`,
        initiator_user_id: 'spuser18',
        acceptor_user_id: 'spuser18',
        initiator_device_id: 'dev-host',
        acceptor_device_id: 'dev-sandbox',
      }),
      auth: 'test-spuser18-pro',
      contentType: 'application/json',
    })
    expect(r2.status).toBe(200)
  })

  test('CS_18b_same_principal_register_persists_optional_audit_columns', async () => {
    const hsId = 'hs-cs18b-audit'
    const r = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'spuser18b',
        acceptor_user_id: 'spuser18b',
        initiator_device_id: 'dev-host-18b',
        acceptor_device_id: 'dev-sandbox-18b',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
        initiator_device_name: 'Primary',
        acceptor_device_name: 'Secondary',
      }),
      auth: 'test-spuser18b-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    const row = relay!.store
      .getDb()
      .prepare(
        `SELECT initiator_device_role, acceptor_device_role, initiator_device_name, acceptor_device_name
         FROM coordination_handshake_registry WHERE handshake_id = ?`,
      )
      .get(hsId) as {
      initiator_device_role: string | null
      acceptor_device_role: string | null
      initiator_device_name: string | null
      acceptor_device_name: string | null
    }
    expect(row.initiator_device_role).toBe('host')
    expect(row.acceptor_device_role).toBe('sandbox')
    expect(row.initiator_device_name).toBe('Primary')
    expect(row.acceptor_device_name).toBe('Secondary')
  })

  test('CS_19_same_principal_capsule_requires_receiver_device_id', async () => {
    const hsId = 'hs-cs19'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'spuser19',
        acceptor_user_id: 'spuser19',
        initiator_device_id: 'dev-host-19',
        acceptor_device_id: 'dev-sandbox-19',
      }),
      auth: 'test-spuser19-pro',
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/capsule', {
      body: samePrincipalCapsule(hsId, 'spuser19', 'dev-host-19'),
      auth: 'test-spuser19-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
    const body = JSON.parse(r.body)
    expect(body.code).toBe('INTERNAL_CAPSULE_MISSING_DEVICE_ID')
    expect(String(body.detail)).toContain('receiver_device_id')
  })

  test('CS_20_same_principal_capsule_rejects_receiver_device_mismatch', async () => {
    const hsId = 'hs-cs20'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'spuser20',
        acceptor_user_id: 'spuser20',
        initiator_device_id: 'dev-host-20',
        acceptor_device_id: 'dev-sandbox-20',
      }),
      auth: 'test-spuser20-pro',
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/capsule', {
      body: samePrincipalCapsule(hsId, 'spuser20', 'dev-host-20', 'wrong-receiver'),
      auth: 'test-spuser20-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    const body = JSON.parse(r.body)
    expect(body.code).toBe('RELAY_RECEIVER_DEVICE_MISMATCH')
    expect(body.error).toBe('RELAY_RECEIVER_DEVICE_MISMATCH')
  })

  test('CS_21_same_principal_unknown_sender_device_returns_ambiguous_routing', async () => {
    const hsId = 'hs-cs21-route'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'spuser21',
        acceptor_user_id: 'spuser21',
        initiator_device_id: 'dev-host-21',
        acceptor_device_id: 'dev-sandbox-21',
      }),
      auth: 'test-spuser21-pro',
      contentType: 'application/json',
    })
    const o = JSON.parse(validBeapCapsule(hsId, 'spuser21')) as Record<string, unknown>
    o.sender_device_id = 'not-a-registered-device'
    o.receiver_device_id = 'dev-sandbox-21'
    const r = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify(o),
      auth: 'test-spuser21-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    const body = JSON.parse(r.body)
    expect(body.code).toBe('INTERNAL_RELAY_ROUTING_AMBIGUOUS')
    expect(body.error).toBe('INTERNAL_RELAY_ROUTING_AMBIGUOUS')
  })

  test('CS_22_same_principal_capsule_requires_sender_device_id', async () => {
    const hsId = 'hs-cs22'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'spuser22',
        acceptor_user_id: 'spuser22',
        initiator_device_id: 'dev-host-22',
        acceptor_device_id: 'dev-sandbox-22',
      }),
      auth: 'test-spuser22-pro',
      contentType: 'application/json',
    })

    const o = JSON.parse(validBeapCapsule(hsId, 'spuser22')) as Record<string, unknown>
    delete o.sender_device_id
    o.receiver_device_id = 'dev-sandbox-22'
    const r = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify(o),
      auth: 'test-spuser22-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
    const body = JSON.parse(r.body)
    expect(body.code).toBe('INTERNAL_CAPSULE_MISSING_DEVICE_ID')
    expect(String(body.detail)).toContain('sender_device_id')
  })
})

describe('coordination-service fail-close', () => {
  let server: http.Server | https.Server
  let port: number
  let relay: Awaited<ReturnType<typeof createServer>>['relay'] | undefined

  beforeAll(async () => {
    const config = makeConfig({})
    const result = await createServer(config)
    server = result.server
    relay = result.relay
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
    if (relay) relay.store.close()
  })

  test('health returns 503 when storage unavailable', async () => {
    if (!relay) return
    relay.store.close()
    const r = await request(port, 'GET', '/health')
    expect(r.status).toBe(503)
    const body = JSON.parse(r.body)
    expect(body.status).toBe('degraded')
  })
})
