import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
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

function wsConnectWithDevice(
  port: number,
  token: string,
  deviceId: string,
  onMessage?: (data: Buffer | string) => void,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ token, device_id: deviceId })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/beap/ws?${q.toString()}`)
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
      d.exec(
        'DELETE FROM coordination_capsules; DELETE FROM coordination_handshake_registry; DELETE FROM coordination_handshake_health_reports; DELETE FROM coordination_token_cache;',
      )
    }
  })

  test('handshake-health-report: POST snapshot + GET peer (same-principal)', async () => {
    const hsId = 'hs-health-peer'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sameuser',
        acceptor_user_id: 'sameuser',
        initiator_device_id: 'dev-a',
        acceptor_device_id: 'dev-b',
      }),
      auth: 'test-sameuser-pro',
      contentType: 'application/json',
    })

    const postA = await request(port, 'POST', '/beap/handshake-health-report', {
      body: JSON.stringify({
        handshake_id: hsId,
        device_id: 'dev-a',
        health_tier: 'OK',
        endpoint_kind: 'direct',
      }),
      auth: 'test-sameuser-pro',
      contentType: 'application/json',
    })
    expect(postA.status).toBe(200)

    const getB = await request(
      port,
      'GET',
      `/beap/handshake-health-peer?handshake_id=${encodeURIComponent(hsId)}&device_id=dev-b`,
      { auth: 'test-sameuser-pro' },
    )
    expect(getB.status).toBe(200)
    const peer = JSON.parse(getB.body).peer as { health_tier: string; endpoint_kind: string | null }
    expect(peer).toBeTruthy()
    expect(peer.health_tier).toBe('OK')
    expect(peer.endpoint_kind).toBe('direct')

    const getNoPeer = await request(
      port,
      'GET',
      `/beap/handshake-health-peer?handshake_id=${encodeURIComponent(hsId)}&device_id=dev-a`,
      { auth: 'test-sameuser-pro' },
    )
    expect(JSON.parse(getNoPeer.body).peer).toBeNull()
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

    // capsule_type is `accept` here so the request reaches `validateInput`
    // (server.ts:486) and exercises the schema-validation path. Using
    // `'initiate'` would be intercepted earlier by the initiate-specific
    // guard (server.ts:380-440) which returns 400 for missing routing
    // fields — not the 422 schema rejection this test pins. The original
    // `'initiate'` value was unreachable for 422 even before that guard
    // existed (the whitelist rejected it with 400 capsule_type_not_allowed
    // before validateInput ran).
    const badCapsule = JSON.stringify({
      schema_version: 1,
      capsule_type: 'accept',
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

  // ───────────────────────────────────────────────────────────────────────
  // Initiate-specific guard — internal handshakes only, with same-principal
  // routing. Server source: packages/coordination-service/src/server.ts,
  // initiate guard immediately after RELAY_ALLOWED_TYPES check.
  //
  // The four cases below pin the contract surfaced to the Electron client's
  // outbound queue so PAYLOAD_PERMANENT classification (outboundQueue.ts:183)
  // routes each error correctly to terminal-no-retry.
  // ───────────────────────────────────────────────────────────────────────

  /** Build a minimally-routable internal initiate capsule. Schema validation
   *  (validateInput at server.ts:486) runs AFTER the new guards, so for the
   *  guard tests we only need the fields the guards inspect: capsule_type,
   *  handshake_type, sender_device_id, receiver_device_id, handshake_id. The
   *  success-path test (CS_20) accepts 422 because validateInput then rejects
   *  the under-specified initiate body — what matters is the new guards have
   *  passed (no 400 initiate_*, no 404 no_route_for_internal_initiate). */
  function internalInitiateCapsule(
    handshakeId: string,
    senderDeviceId: string,
    receiverDeviceId: string,
    overrides: Record<string, unknown> = {},
  ): string {
    return JSON.stringify({
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_type: 'internal',
      handshake_id: handshakeId,
      sender_device_id: senderDeviceId,
      receiver_device_id: receiverDeviceId,
      ...overrides,
    })
  }

  test('CS_20_initiate_internal_routed: same-principal route resolves → guards pass (no 400/404)', async () => {
    const hsId = 'hs-cs20'
    const userId = 'sameuser20'
    const devA = 'dev-a-20'
    const devB = 'dev-b-20'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: userId,
        acceptor_user_id: userId,
        initiator_device_id: devA,
        acceptor_device_id: devB,
      }),
      auth: `test-${userId}-pro`,
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/capsule', {
      body: internalInitiateCapsule(hsId, devA, devB),
      auth: `test-${userId}-pro`,
      contentType: 'application/json',
    })
    // Guards passed. Either:
    //   - 200/202 if the body somehow satisfied validateInput's coordination_service schema, or
    //   - 422 because the minimal initiate body fails schema validation downstream.
    // Both prove the new initiate guard did NOT reject the request.
    expect([200, 202, 422]).toContain(r.status)
    if (r.status === 400 || r.status === 404) {
      const body = JSON.parse(r.body)
      throw new Error(
        `initiate guard rejected a valid same-principal route: status=${r.status} error=${body?.error}`,
      )
    }
  })

  test('CS_21_initiate_internal_no_route: sender device not registered → 404 no_route_for_internal_initiate', async () => {
    // Category 2 fix (PR 4): the original test registered only the initiator device,
    // which the same-principal registration guard (added alongside PR 1) now rejects with
    // 400 (INTERNAL_RELAY_REGISTRATION_MISSING_ACCEPTOR_DEVICE_ID). That meant the row
    // was never written, so isSenderAuthorized returned false → 403, not the expected 404.
    //
    // The 404 path is still reachable: register a valid same-principal handshake (both
    // device IDs), then send an initiate from an unregistered sender device ID. The routing
    // lookup returns null → 404 no_route_for_internal_initiate, which is the contract the
    // test is verifying.
    const hsId = 'hs-cs21'
    const userId = 'sameuser21'
    const devA = 'dev-a-21'
    const devB = 'dev-b-21'
    const devUnknown = 'dev-unknown-21'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: userId,
        acceptor_user_id: userId,
        initiator_device_id: devA,
        acceptor_device_id: devB,
      }),
      auth: `test-${userId}-pro`,
      contentType: 'application/json',
    })

    // Send initiate from a device ID that is not registered on the handshake.
    // getRecipientForSender returns null → initRoute null → 404.
    const r = await request(port, 'POST', '/beap/capsule', {
      body: internalInitiateCapsule(hsId, devUnknown, devB),
      auth: `test-${userId}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(404)
    const body = JSON.parse(r.body)
    expect(body.error).toBe('no_route_for_internal_initiate')
    expect(body.detail).not.toMatch(/acceptor|initiator/i)
    expect(body.detail).not.toContain(devUnknown)
    expect(body.detail).not.toContain(devB)
  })

  test('CS_22_initiate_missing_sender_device_id: 400 initiate_missing_routing_fields', async () => {
    const hsId = 'hs-cs22'
    const userId = 'sameuser22'
    const devB = 'dev-b-22'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: userId,
        acceptor_user_id: userId,
        initiator_device_id: 'dev-a-22',
        acceptor_device_id: devB,
      }),
      auth: `test-${userId}-pro`,
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify({
        schema_version: 1,
        capsule_type: 'initiate',
        handshake_type: 'internal',
        handshake_id: hsId,
        // sender_device_id intentionally omitted
        receiver_device_id: devB,
      }),
      auth: `test-${userId}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
    const body = JSON.parse(r.body)
    expect(body.error).toBe('initiate_missing_routing_fields')
    expect(Array.isArray(body.detail)).toBe(true)
    expect(body.detail).toContain('sender_device_id')
  })

  test('CS_23_initiate_external_rejected: handshake_type missing or non-internal → 400 initiate_external_not_allowed', async () => {
    // Cross-user registration — this is exactly the path the guard exists to
    // protect (an external handshake whose initiate must NOT relay).
    const hsId = 'hs-cs23'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'extinit23',
        acceptor_user_id: 'extacc23',
        initiator_device_id: 'dev-init-23',
        acceptor_device_id: 'dev-acc-23',
      }),
      auth: 'test-extinit23-pro',
      contentType: 'application/json',
    })

    // Case 1: handshake_type omitted entirely (the legacy/standard wire shape).
    const r1 = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify({
        schema_version: 1,
        capsule_type: 'initiate',
        handshake_id: hsId,
        sender_device_id: 'dev-init-23',
        receiver_device_id: 'dev-acc-23',
      }),
      auth: 'test-extinit23-pro',
      contentType: 'application/json',
    })
    expect(r1.status).toBe(400)
    expect(JSON.parse(r1.body).error).toBe('initiate_external_not_allowed')

    // Case 2: handshake_type explicitly set to 'standard' — same rejection.
    const r2 = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify({
        schema_version: 1,
        capsule_type: 'initiate',
        handshake_type: 'standard',
        handshake_id: hsId,
        sender_device_id: 'dev-init-23',
        receiver_device_id: 'dev-acc-23',
      }),
      auth: 'test-extinit23-pro',
      contentType: 'application/json',
    })
    expect(r2.status).toBe(400)
    expect(JSON.parse(r2.body).error).toBe('initiate_external_not_allowed')
  })

  // ── Register-handshake JWT principal binding (PR 1/5 security fix) ─────────
  //
  // The authenticated JWT sub must equal at least one of initiator_user_id or
  // acceptor_user_id. Without this check a third party could write arbitrary
  // user IDs into the registry and exploit downstream trust (e.g. the
  // same-principal unmetered predicate added in PR 3/5).

  test('CS_REG_01: initiator is caller → 200 registered', async () => {
    const hsId = 'hs-reg-01'
    // Token sub = 'reg01init'; matches initiator_user_id.
    const r = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'reg01init',
        acceptor_user_id: 'reg01acc',
      }),
      auth: 'test-reg01init-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).registered).toBe(true)
    const row = relay!.store
      .getDb()
      .prepare(`SELECT initiator_user_id FROM coordination_handshake_registry WHERE handshake_id = ?`)
      .get(hsId) as { initiator_user_id: string } | undefined
    expect(row?.initiator_user_id).toBe('reg01init')
  })

  test('CS_REG_02: acceptor is caller → 200 registered', async () => {
    const hsId = 'hs-reg-02'
    // Token sub = 'reg02acc'; matches acceptor_user_id only.
    const r = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'reg02init',
        acceptor_user_id: 'reg02acc',
      }),
      auth: 'test-reg02acc-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).registered).toBe(true)
    const row = relay!.store
      .getDb()
      .prepare(`SELECT acceptor_user_id FROM coordination_handshake_registry WHERE handshake_id = ?`)
      .get(hsId) as { acceptor_user_id: string } | undefined
    expect(row?.acceptor_user_id).toBe('reg02acc')
  })

  test('CS_REG_03: third-party caller → 403 handshake_principal_mismatch, no row written', async () => {
    const hsId = 'hs-reg-03'
    // Token sub = 'reg03attacker'; matches neither principal.
    const r = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'reg03victim-a',
        acceptor_user_id: 'reg03victim-b',
      }),
      auth: 'test-reg03attacker-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    expect(JSON.parse(r.body).error).toBe('handshake_principal_mismatch')
    // Registry must have no row for this handshake.
    const count = relay!.store
      .getDb()
      .prepare(`SELECT COUNT(*) as c FROM coordination_handshake_registry WHERE handshake_id = ?`)
      .get(hsId) as { c: number }
    expect(count.c).toBe(0)
  })

  test('CS_REG_04: spoofed self-pair (attacker asserts victim IDs for both slots) → 403, no row', async () => {
    const hsId = 'hs-reg-04'
    // The attack PR 3/5 must block: caller is 'reg04attacker', but both body
    // user IDs are 'reg04victim', which would have produced a same-principal
    // registry row granting unmetered access on the victim's behalf.
    const r = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'reg04victim',
        acceptor_user_id: 'reg04victim',
        initiator_device_id: 'dev-a',
        acceptor_device_id: 'dev-b',
      }),
      auth: 'test-reg04attacker-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    expect(JSON.parse(r.body).error).toBe('handshake_principal_mismatch')
    const count = relay!.store
      .getDb()
      .prepare(`SELECT COUNT(*) as c FROM coordination_handshake_registry WHERE handshake_id = ?`)
      .get(hsId) as { c: number }
    expect(count.c).toBe(0)
  })

  test('CS_REG_05: missing acceptor_user_id → 400', async () => {
    const r = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: 'hs-reg-05',
        initiator_user_id: 'reg05user',
        // acceptor_user_id intentionally omitted
      }),
      auth: 'test-reg05user-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
  })

  test('health: GET /health → 200 with status when healthy', async () => {
    const r = await request(port, 'GET', '/health')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.connected_clients).toBe('number')
    expect(typeof body.pending_capsules).toBe('number')
    expect(body.host_ai_p2p_signaling).toEqual({
      supported: true,
      schema_version: 1,
      ws_path: '/beap/ws',
      signal_path: '/beap/p2p-signal',
    })
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

  // ── Internal same-principal BEAP relay + device id (orchestrator ↔ sandbox) ──

  test('CS_SP_01: same-principal host → sandbox, both online, correct device ids → 200', async () => {
    const hsId = 'hs-sp-01'
    const user = 'spuserA01'
    const devHost = 'dev-host-sp01'
    const devSbx = 'dev-sbx-sp01'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
        handshake_type: 'internal',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const received: Array<{ type?: string }> = []
    const sbxWs = await wsConnectWithDevice(port, `test-${user}-pro`, devSbx, (data) => {
      const msg = JSON.parse(data.toString()) as { type?: string }
      if (msg.type === 'capsule') received.push(msg)
    })
    await new Promise((r) => setTimeout(r, 100))
    const r = await request(port, 'POST', '/beap/capsule', {
      body: samePrincipalCapsule(hsId, user, devHost, devSbx),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    await new Promise((res) => setTimeout(res, 200))
    expect(received.length).toBeGreaterThanOrEqual(1)
    sbxWs.close()
  })

  test('CS_SP_02: sandbox offline → 202 queued', async () => {
    const hsId = 'hs-sp-02'
    const user = 'spuserA02'
    const devHost = 'dev-host-sp02'
    const devSbx = 'dev-sbx-sp02'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: samePrincipalCapsule(hsId, user, devHost, devSbx),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(202)
    const body = JSON.parse(r.body) as { status?: string }
    expect(body.status).toMatch(/offline|stored/i)
  })

  test('CS_SP_03: 202 then sandbox connects with correct device id → queue drains', async () => {
    const hsId = 'hs-sp-03'
    const user = 'spuserA03'
    const devHost = 'dev-host-sp03'
    const devSbx = 'dev-sbx-sp03'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const r1 = await request(port, 'POST', '/beap/capsule', {
      body: samePrincipalCapsule(hsId, user, devHost, devSbx),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r1.status).toBe(202)
    const received: string[] = []
    const sbxWs = await wsConnectWithDevice(port, `test-${user}-pro`, devSbx, (data) => {
      const msg = JSON.parse(data.toString()) as { type?: string; id?: string }
      if (msg.type === 'capsule' && msg.id) received.push(msg.id)
    })
    await new Promise((res) => setTimeout(res, 400))
    expect(received.length).toBeGreaterThanOrEqual(1)
    sbxWs.close()
  })

  test('CS_SP_04: connect as default device with queued row for UUID device → not delivered, mismatch log', async () => {
    const hsId = 'hs-sp-04'
    const user = 'spuserA04'
    const devHost = 'dev-host-sp04'
    const devSbx = '6f3b8a20-0c4d-4b2e-9a7f-111111111111' // fixed UUID shape for pending row
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const r0 = await request(port, 'POST', '/beap/capsule', {
      body: samePrincipalCapsule(hsId, user, devHost, devSbx),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r0.status).toBe(202)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const received: string[] = []
    const ws = await wsConnect(port, `test-${user}-pro`, (data) => {
      const msg = JSON.parse(data.toString()) as { type?: string; id?: string }
      if (msg.type === 'capsule' && msg.id) received.push(msg.id)
    })
    await new Promise((res) => setTimeout(res, 300))
    const logCalls = [...spy.mock.calls]
    spy.mockRestore()
    expect(received).toHaveLength(0)
    const foundMismatch = logCalls.some(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].includes('pending_cannot_drain_device_mismatch') &&
        String(args[1] ?? '').includes('pending_recipient_device_id'),
    )
    expect(foundMismatch).toBe(true)
    const pending = relay?.store
      .getDb()
      .prepare(
        `SELECT COUNT(*) as c FROM coordination_capsules
         WHERE recipient_user_id = ? AND acknowledged_at IS NULL AND trim(coalesce(recipient_device_id,'')) = ?`,
      )
      .get(user, devSbx) as { c: number }
    expect(pending.c).toBeGreaterThan(0)
    ws.close()
  })

  test('CS_SP_05: wrong sender_device_id → 403, not queued (no new pending row for failed POST)', async () => {
    const hsId = 'hs-sp-05'
    const user = 'spuserA05'
    const devHost = 'dev-host-sp05'
    const devSbx = 'dev-sbx-sp05'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const before = relay?.store
      .getDb()
      .prepare(`SELECT COUNT(*) as c FROM coordination_capsules WHERE handshake_id = ?`)
      .get(hsId) as { c: number }
    const o = JSON.parse(samePrincipalCapsule(hsId, user, devHost, devSbx)) as Record<string, unknown>
    o.sender_device_id = 'wrong-sender-sp05'
    const r = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify(o),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    const after = relay?.store
      .getDb()
      .prepare(`SELECT COUNT(*) as c FROM coordination_capsules WHERE handshake_id = ?`)
      .get(hsId) as { c: number }
    expect(after.c).toBe(before.c)
  })

  test('CS_SP_06: cross-principal online recipient → 200 (unchanged)', async () => {
    const hsId = 'hs-sp-06'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'sendersp06',
        acceptor_user_id: 'recipsp06',
        initiator_email: 'a@test.com',
        acceptor_email: 'b@test.com',
      }),
      auth: 'test-sendersp06-pro',
      contentType: 'application/json',
    })
    const recipientWs = await wsConnect(port, 'test-recipsp06-pro')
    await new Promise((r) => setTimeout(r, 100))
    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId, 'sendersp06'),
      auth: 'test-sendersp06-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    recipientWs.close()
  })

  test('CS_28_flush_queued_401: POST /beap/flush-queued without auth → 401', async () => {
    const r = await request(port, 'POST', '/beap/flush-queued')
    expect(r.status).toBe(401)
  })

  test('CS_29_flush_queued_200: POST /beap/flush-queued returns ok, user_id, delivered', async () => {
    const r = await request(port, 'POST', '/beap/flush-queued', {
      auth: 'test-zflush-pro',
    })
    expect(r.status).toBe(200)
    const j = JSON.parse(r.body) as { ok?: boolean; user_id?: string; delivered?: number }
    expect(j.ok).toBe(true)
    expect(j.user_id).toBe('zflush')
    expect(typeof j.delivered).toBe('number')
  })

  test('CS_30_flush_queued_after_202: recipient offline 202, then connect; flush-queued is safe (0 left)', async () => {
    // Category 1 + 2 fix (PR 4):
    //   - handleConnection already drains pending capsules on WS connect via
    //     deliverPendingToWs (inside wsManager). The server-side flush was always there;
    //     the test was failing because the 'message' listener was attached AFTER wsConnect
    //     resolved, racing with the flush that fired during the WS handshake.
    //   - Fix: pass the onMessage callback to wsConnect so the listener is registered
    //     before the 'open' event, guaranteeing the flush message is captured.
    //   - After receiving the capsule the WS client sends an explicit ack (protocol-correct),
    //     which sets acknowledged_at so flush-queued correctly returns delivered = 0.
    const hsId = 'hs-flush-after'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'senderF',
        acceptor_user_id: 'recipientF',
      }),
      auth: 'test-senderF-pro',
      contentType: 'application/json',
    })
    const r1 = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId, 'senderF'),
      auth: 'test-senderF-pro',
      contentType: 'application/json',
    })
    expect(r1.status).toBe(202)
    let got = 0
    const receivedIds: string[] = []
    const recipientWs = await wsConnect(port, 'test-recipientF-pro', (data) => {
      const msg = JSON.parse(data.toString()) as { type?: string; id?: string }
      if (msg.type === 'capsule') {
        got++
        if (msg.id) receivedIds.push(msg.id)
      }
    })
    await new Promise((r) => setTimeout(r, 250))
    expect(got).toBeGreaterThanOrEqual(1)
    // Ack received capsules so flush-queued sees acknowledged_at IS NOT NULL.
    if (receivedIds.length > 0) {
      recipientWs.send(JSON.stringify({ type: 'ack', ids: receivedIds }))
      await new Promise((r) => setTimeout(r, 100))
    }
    const rFlush = await request(port, 'POST', '/beap/flush-queued', {
      auth: 'test-recipientF-pro',
    })
    expect(rFlush.status).toBe(200)
    const j = JSON.parse(rFlush.body) as { delivered: number }
    expect(j.delivered).toBe(0)
    recipientWs.close()
  })

  test('CS_P2P_01: p2p-signal delivers p2p_signal frame to recipient WS (not capsule)', async () => {
    const hsId = 'hs-p2p-01'
    const user = 'p2puser01'
    const devHost = 'dev-host-p2p01'
    const devSbx = 'dev-sbx-p2p01'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
        handshake_type: 'internal',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const received: Array<{ type?: string; id?: string; payload?: unknown }> = []
    const sbxWs = await wsConnectWithDevice(port, `test-${user}-pro`, devSbx, (data) => {
      const msg = JSON.parse(data.toString()) as { type?: string; id?: string; payload?: unknown }
      received.push(msg)
    })
    await new Promise((r) => setTimeout(r, 100))
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 15_000)
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_inference_offer',
        correlation_id: 'c1',
        session_id: 'sess-p2p-01',
        handshake_id: hsId,
        sender_device_id: devHost,
        receiver_device_id: devSbx,
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
        sdp: 'v=0',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    await new Promise((r2) => setTimeout(r2, 200))
    const signalFrames = received.filter((m) => m.type === 'p2p_signal')
    expect(signalFrames).toHaveLength(1)
    expect(signalFrames[0].id).toBeDefined()
    expect((signalFrames[0].payload as { signal_type?: string })?.signal_type).toBe('p2p_inference_offer')
    expect(received.filter((m) => m.type === 'capsule')).toHaveLength(0)
    sbxWs.close()
  })

  test('CS_P2P_10: bidirectional p2p-signal (offer + answer + ICE) between two connected WS peers', async () => {
    const hsId = 'hs-p2p-bi'
    const user = 'p2puserbi'
    const devHost = 'dev-host-bi'
    const devSbx = 'dev-sbx-bi'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
        handshake_type: 'internal',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const hostRx: Array<{ type?: string; payload?: { signal_type?: string } }> = []
    const sbxRx: Array<{ type?: string; payload?: { signal_type?: string } }> = []
    const hostWs = await wsConnectWithDevice(port, `test-${user}-pro`, devHost, (data) => {
      hostRx.push(JSON.parse(data.toString()) as { type?: string; payload?: { signal_type?: string } })
    })
    const sbxWs = await wsConnectWithDevice(port, `test-${user}-pro`, devSbx, (data) => {
      sbxRx.push(JSON.parse(data.toString()) as { type?: string; payload?: { signal_type?: string } })
    })
    await new Promise((r) => setTimeout(r, 100))

    const mkBody = (
      signalType: string,
      sender: string,
      receiver: string,
      extra: Record<string, unknown> = {},
    ) => {
      const t0 = new Date()
      const t1 = new Date(t0.getTime() + (signalType === 'p2p_inference_ice' ? 20_000 : 15_000))
      return JSON.stringify({
        schema_version: 1,
        signal_type: signalType,
        correlation_id: `c-${signalType}-${sender}`,
        session_id: 'sess-bi',
        handshake_id: hsId,
        sender_device_id: sender,
        receiver_device_id: receiver,
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
        ...extra,
      })
    }

    let r = await request(port, 'POST', '/beap/p2p-signal', {
      body: mkBody('p2p_inference_offer', devHost, devSbx, { sdp: 'offer-sdp' }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    await new Promise((x) => setTimeout(x, 150))
    expect(sbxRx.filter((m) => m.type === 'p2p_signal' && m.payload?.signal_type === 'p2p_inference_offer')).toHaveLength(1)

    r = await request(port, 'POST', '/beap/p2p-signal', {
      body: mkBody('p2p_inference_answer', devSbx, devHost, { sdp: 'answer-sdp' }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    await new Promise((x) => setTimeout(x, 150))
    expect(hostRx.filter((m) => m.type === 'p2p_signal' && m.payload?.signal_type === 'p2p_inference_answer')).toHaveLength(1)

    r = await request(port, 'POST', '/beap/p2p-signal', {
      body: mkBody('p2p_inference_ice', devHost, devSbx, { candidate: '{"c":"host"}' }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    r = await request(port, 'POST', '/beap/p2p-signal', {
      body: mkBody('p2p_inference_ice', devSbx, devHost, { candidate: '{"c":"sbx"}' }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    await new Promise((x) => setTimeout(x, 150))
    expect(sbxRx.filter((m) => m.type === 'p2p_signal' && m.payload?.signal_type === 'p2p_inference_ice')).toHaveLength(1)
    expect(hostRx.filter((m) => m.type === 'p2p_signal' && m.payload?.signal_type === 'p2p_inference_ice')).toHaveLength(1)

    hostWs.close()
    sbxWs.close()
  })

  test('CS_P2P_02: p2p-signal rejects top-level messages key', async () => {
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 10_000)
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_inference_offer',
        correlation_id: 'c1',
        session_id: 's1',
        handshake_id: 'hs-x',
        sender_device_id: 'a',
        receiver_device_id: 'b',
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
        messages: ['no'],
      }),
      auth: 'test-anyuser-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
  })

  test('CS_P2P_03: p2p-signal when recipient offline → 202', async () => {
    const hsId = 'hs-p2p-off'
    const user = 'p2puseroff'
    const devHost = 'dev-host-p2poff'
    const devSbx = 'dev-sbx-p2poff'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 15_000)
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_inference_ice',
        correlation_id: 'c-ice',
        session_id: 'sess-off',
        handshake_id: hsId,
        sender_device_id: devHost,
        receiver_device_id: devSbx,
        created_at: t0.toISOString(),
        expires_at: new Date(t0.getTime() + 20_000).toISOString(),
        candidate: 'candidate:1',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(202)
  })

  test('CS_P2P_04: invalid signal_type → 400', async () => {
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 10_000)
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_not_a_real_type',
        correlation_id: 'c1',
        session_id: 's1',
        handshake_id: 'hs-x',
        sender_device_id: 'a',
        receiver_device_id: 'b',
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
      }),
      auth: 'test-zanyuser-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
    const j = JSON.parse(r.body) as { reason?: string }
    expect(j.reason).toBe('signal_type')
  })

  test('CS_P2P_05: expired signal (expires_at in the past) → 400', async () => {
    // Category 2 fix (PR 4): the original test used expires_at = Date.now() - 60_000,
    // which sits exactly on the P2P_SIGNAL_EXPIRY_PARSE_GRACE_MS (60 s) boundary.
    // The expiry check is `expires_at < now - grace`, so when expires_at === now - grace
    // the condition is false (not expired), parsed.ok = true, and isSenderAuthorized
    // fires first → 403 instead of 400.  Use 10 minutes in the past; no grace period
    // covers that, making the test deterministic regardless of clock skew or CPU load.
    const t0 = new Date(Date.now() - 660_000) // created_at  10m ago
    const t1 = new Date(Date.now() - 600_000) // expires_at  10m ago
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_inference_offer',
        correlation_id: 'c1',
        session_id: 's1',
        handshake_id: 'hs-x',
        sender_device_id: 'a',
        receiver_device_id: 'b',
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
        sdp: 'v=0',
      }),
      auth: 'test-zanyuser-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
    const j = JSON.parse(r.body) as { reason?: string }
    expect(j.reason).toBe('expired')
  })

  test('CS_P2P_06: top-level prompt key → 400 (forbidden_field)', async () => {
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 10_000)
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_inference_offer',
        correlation_id: 'c1',
        session_id: 's1',
        handshake_id: 'hs-x',
        sender_device_id: 'a',
        receiver_device_id: 'b',
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
        prompt: 'no-user-content',
      }),
      auth: 'test-zanyuser-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
    const j = JSON.parse(r.body) as { reason?: string }
    expect(j.reason).toBe('forbidden_field')
  })

  test('CS_P2P_07: receiver_device_id mismatch (same-principal) → 403', async () => {
    const hsId = 'hs-p2p-recv-bad'
    const user = 'p2puserrecv'
    const devHost = 'dev-host-recv'
    const devSbx = 'dev-sbx-recv'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
        handshake_type: 'internal',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 15_000)
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_inference_offer',
        correlation_id: 'c1',
        session_id: 's1',
        handshake_id: hsId,
        sender_device_id: devHost,
        receiver_device_id: 'not-the-expected-recipient',
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
        sdp: 'v=0',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
  })

  // ─── PR 4 — Sandbox entitlement gate ─────────────────────────────────────────
  //
  // The entitlement gate lives on /beap/capsule and fires when
  // metadata.inbox_response_path.sandbox_clone === true.
  // All test packages are synthetic (no real BEAP signatures).

  /** Build a capsule body that carries sandbox_clone = true (or false/absent). */
  function sandboxCapsule(handshakeId: string, senderId: string, sandboxClone?: boolean): string {
    const base = JSON.parse(validBeapCapsule(handshakeId, senderId)) as Record<string, unknown>
    if (sandboxClone !== undefined) {
      base.metadata = { inbox_response_path: { sandbox_clone: sandboxClone } }
    }
    return JSON.stringify(base)
  }

  test('CS_SBX_01: free-tier sandbox clone → 403 sandbox_entitlement_required, no row stored', async () => {
    if (!relay) return
    const hsId = 'hs-sbx-01'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: 'sbxinit01', acceptor_user_id: 'sbxacc01' }),
      auth: 'test-sbxinit01-free',
      contentType: 'application/json',
    })
    const before = (relay.store.getDb().prepare('SELECT COUNT(*) as c FROM coordination_capsules').get() as { c: number }).c
    const r = await request(port, 'POST', '/beap/capsule', {
      body: sandboxCapsule(hsId, 'sbxinit01', true),
      auth: 'test-sbxinit01-free',
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    const j = JSON.parse(r.body) as { error?: string; upgrade_url?: string }
    expect(j.error).toBe('sandbox_entitlement_required')
    expect(j.upgrade_url).toBe('https://wrdesk.com/pricing')
    const after = (relay.store.getDb().prepare('SELECT COUNT(*) as c FROM coordination_capsules').get() as { c: number }).c
    expect(after).toBe(before)
  })

  test('CS_SBX_02: pro-tier sandbox clone → accepted (200/202)', async () => {
    const hsId = 'hs-sbx-02'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: 'sbxinit02', acceptor_user_id: 'sbxacc02' }),
      auth: 'test-sbxinit02-pro',
      contentType: 'application/json',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: sandboxCapsule(hsId, 'sbxinit02', true),
      auth: 'test-sbxinit02-pro',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r.status)
  })

  test('CS_SBX_03: publisher-tier sandbox clone → accepted (200/202)', async () => {
    const hsId = 'hs-sbx-03'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: 'sbxinit03', acceptor_user_id: 'sbxacc03' }),
      auth: 'test-sbxinit03-publisher',
      contentType: 'application/json',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: sandboxCapsule(hsId, 'sbxinit03', true),
      auth: 'test-sbxinit03-publisher',
      contentType: 'application/json',
    })
    expect([200, 202]).toContain(r.status)
  })

  test('CS_SBX_04: free-tier non-sandbox capsule → entitlement gate does not fire', async () => {
    const hsId = 'hs-sbx-04'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: 'sbxinit04', acceptor_user_id: 'sbxacc04' }),
      auth: 'test-sbxinit04-free',
      contentType: 'application/json',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: sandboxCapsule(hsId, 'sbxinit04', false),
      auth: 'test-sbxinit04-free',
      contentType: 'application/json',
    })
    expect(r.status).not.toBe(403)
  })

  test(
    'CS_SBX_05: free-tier same-principal sandbox clone → 403 (unmetered path does not waive entitlement)',
    async () => {
      // This is the architecturally important test: PR 3's same-principal skip removes
      // the transport charge but must not also remove the feature entitlement check.
      // The gate runs after the same-principal predicate, so samePrincipalRelay = true
      // does NOT bypass the 403.
      if (!relay) return
      const hsId = 'hs-sbx-05'
      const user = 'sbxsp05'
      await request(port, 'POST', '/beap/register-handshake', {
        body: JSON.stringify({
          handshake_id: hsId,
          initiator_user_id: user,
          acceptor_user_id: user,
          initiator_device_id: 'dev-host-sbx05',
          acceptor_device_id: 'dev-sbx-sbx05',
        }),
        auth: `test-${user}-free`,
        contentType: 'application/json',
      })
      const before = (relay.store.getDb().prepare('SELECT COUNT(*) as c FROM coordination_capsules').get() as { c: number }).c
      const body = JSON.parse(sandboxCapsule(hsId, user, true)) as Record<string, unknown>
      body.sender_device_id = 'dev-host-sbx05'
      body.receiver_device_id = 'dev-sbx-sbx05'
      const r = await request(port, 'POST', '/beap/capsule', {
        body: JSON.stringify(body),
        auth: `test-${user}-free`,
        contentType: 'application/json',
      })
      expect(r.status).toBe(403)
      const j = JSON.parse(r.body) as { error?: string }
      expect(j.error).toBe('sandbox_entitlement_required')
      const after = (relay.store.getDb().prepare('SELECT COUNT(*) as c FROM coordination_capsules').get() as { c: number }).c
      expect(after).toBe(before)
    },
  )

  test('CS_SBX_06: missing metadata → entitlement gate does not fire', async () => {
    const hsId = 'hs-sbx-06'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: 'sbxinit06', acceptor_user_id: 'sbxacc06' }),
      auth: 'test-sbxinit06-free',
      contentType: 'application/json',
    })
    // No metadata field at all.
    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId, 'sbxinit06'),
      auth: 'test-sbxinit06-free',
      contentType: 'application/json',
    })
    expect(r.status).not.toBe(403)
  })

  test('CS_SBX_07: entitlement check fires before storeCapsule — 403 leaves store unchanged', async () => {
    if (!relay) return
    const hsId = 'hs-sbx-07'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: 'sbxinit07', acceptor_user_id: 'sbxacc07' }),
      auth: 'test-sbxinit07-free',
      contentType: 'application/json',
    })
    const before = (relay.store.getDb().prepare('SELECT COUNT(*) as c FROM coordination_capsules').get() as { c: number }).c
    await request(port, 'POST', '/beap/capsule', {
      body: sandboxCapsule(hsId, 'sbxinit07', true),
      auth: 'test-sbxinit07-free',
      contentType: 'application/json',
    })
    const after = (relay.store.getDb().prepare('SELECT COUNT(*) as c FROM coordination_capsules').get() as { c: number }).c
    expect(after).toBe(before)
  })

  // ─── PR 3 — Same-principal unmetered BEAP transport ─────────────────────────
  //
  // Unit tests: isSamePrincipalHandshake predicate (direct registry calls)

  test('REG_PRED_01: isSamePrincipalHandshake: same-user row → true', async () => {
    if (!relay) return
    const hsId = 'hs-pred-01'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'preduser01',
        acceptor_user_id: 'preduser01',
        initiator_device_id: 'dev-a-pred01',
        acceptor_device_id: 'dev-b-pred01',
      }),
      auth: 'test-preduser01-pro',
      contentType: 'application/json',
    })
    expect(relay.handshakeRegistry.isSamePrincipalHandshake(hsId)).toBe(true)
  })

  test('REG_PRED_02: isSamePrincipalHandshake: cross-user row → false', async () => {
    if (!relay) return
    const hsId = 'hs-pred-02'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: 'predinit02',
        acceptor_user_id: 'predacc02',
      }),
      auth: 'test-predinit02-pro',
      contentType: 'application/json',
    })
    expect(relay.handshakeRegistry.isSamePrincipalHandshake(hsId)).toBe(false)
  })

  test('REG_PRED_03: isSamePrincipalHandshake: no row for handshake ID → false', () => {
    if (!relay) return
    expect(relay.handshakeRegistry.isSamePrincipalHandshake('hs-does-not-exist-pred03')).toBe(false)
  })

  // Integration tests: /beap/capsule — same-principal unmetered

  test(
    'CS_SP3_01: same-principal capsule: sends past free-tier monthly limit → no 429 (regression for original bug)',
    async () => {
      if (!relay) return
      const hsId = 'hs-sp3-01'
      const user = 'sp3user01'
      const devHost = 'dev-host-sp301'
      const devSbx = 'dev-sbx-sp301'
      await request(port, 'POST', '/beap/register-handshake', {
        body: JSON.stringify({
          handshake_id: hsId,
          initiator_user_id: user,
          acceptor_user_id: user,
          initiator_device_id: devHost,
          acceptor_device_id: devSbx,
        }),
        auth: `test-${user}-free`,
        contentType: 'application/json',
      })

      // Pre-fill the monthly counter to exactly the free-tier monthly limit (100).
      // Without the same-principal skip, every subsequent send would return 429.
      for (let i = 0; i < 100; i++) {
        relay.rateLimiter.recordCapsuleSent(user)
      }

      const sbxWs = await wsConnectWithDevice(port, `test-${user}-free`, devSbx)
      await new Promise((r) => setTimeout(r, 80))

      // Send 10 more capsules — all must succeed despite the exhausted monthly budget.
      for (let i = 0; i < 10; i++) {
        const r = await request(port, 'POST', '/beap/capsule', {
          body: samePrincipalCapsule(hsId, user, devHost, devSbx),
          auth: `test-${user}-free`,
          contentType: 'application/json',
        })
        expect(r.status, `capsule #${i + 1} returned ${r.status}: ${r.body}`).not.toBe(429)
      }
      sbxWs.close()
    },
  )

  test('CS_SP3_02: cross-user capsule: sends past free-tier per-minute limit → 429 still fires', async () => {
    const hsId = 'hs-sp3-02'
    const initUser = 'sp3init02'
    const accUser = 'sp3acc02'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: initUser,
        acceptor_user_id: accUser,
      }),
      auth: `test-${initUser}-free`,
      contentType: 'application/json',
    })
    // Free tier: capsulesPerMinute = 5. The 6th send within the same minute must 429.
    const statuses: number[] = []
    for (let i = 0; i < 10; i++) {
      const r = await request(port, 'POST', '/beap/capsule', {
        body: validBeapCapsule(hsId, initUser),
        auth: `test-${initUser}-free`,
        contentType: 'application/json',
      })
      statuses.push(r.status)
    }
    expect(statuses.some((s) => s === 429)).toBe(true)
  })

  test('CS_SP3_03: caller not a principal on same-principal handshake → 403, unmetered path not taken', async () => {
    const hsId = 'hs-sp3-03'
    const owner = 'sp3owner03'
    const intruder = 'sp3intruder03'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: owner,
        acceptor_user_id: owner,
        initiator_device_id: 'dev-host-sp303',
        acceptor_device_id: 'dev-sbx-sp303',
      }),
      auth: `test-${owner}-pro`,
      contentType: 'application/json',
    })
    const r = await request(port, 'POST', '/beap/capsule', {
      body: validBeapCapsule(hsId, intruder),
      auth: `test-${intruder}-pro`,
      contentType: 'application/json',
    })
    // isSenderAuthorized fires before the same-principal check; intruder gets 403.
    expect(r.status).toBe(403)
  })

  // Integration tests: /beap/p2p-signal — same-principal unmetered

  test(
    'CS_SP3_04: same-principal p2p-signal (non-ICE): sends past free-tier monthly limit → no 429',
    async () => {
      if (!relay) return
      const hsId = 'hs-sp3-04'
      const user = 'sp3user04'
      const devHost = 'dev-host-sp304'
      const devSbx = 'dev-sbx-sp304'
      await request(port, 'POST', '/beap/register-handshake', {
        body: JSON.stringify({
          handshake_id: hsId,
          initiator_user_id: user,
          acceptor_user_id: user,
          initiator_device_id: devHost,
          acceptor_device_id: devSbx,
        }),
        auth: `test-${user}-free`,
        contentType: 'application/json',
      })

      // Pre-fill monthly counter past the free-tier limit.
      for (let i = 0; i < 100; i++) {
        relay.rateLimiter.recordCapsuleSent(user)
      }

      const sbxWs = await wsConnectWithDevice(port, `test-${user}-free`, devSbx)
      await new Promise((r) => setTimeout(r, 80))

      const t0 = new Date()
      for (let i = 0; i < 10; i++) {
        const r = await request(port, 'POST', '/beap/p2p-signal', {
          body: JSON.stringify({
            schema_version: 1,
            signal_type: 'p2p_inference_offer',
            correlation_id: `c-sp304-${i}`,
            session_id: `sess-sp304-${i}`,
            handshake_id: hsId,
            sender_device_id: devHost,
            receiver_device_id: devSbx,
            created_at: t0.toISOString(),
            expires_at: new Date(t0.getTime() + 30_000).toISOString(),
            sdp: 'v=0',
          }),
          auth: `test-${user}-free`,
          contentType: 'application/json',
        })
        expect(r.status, `signal #${i + 1} returned ${r.status}: ${r.body}`).not.toBe(429)
      }
      sbxWs.close()
    },
  )

  test('CS_SP3_05: ICE skip still bypasses rate limit on cross-user p2p-signal (regression guard)', async () => {
    const hsId = 'hs-sp3-05'
    const initUser = 'sp3ice05init'
    const accUser = 'sp3ice05acc'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: initUser,
        acceptor_user_id: accUser,
        initiator_device_id: 'dev-init-sp305',
        acceptor_device_id: 'dev-acc-sp305',
      }),
      auth: `test-${initUser}-free`,
      contentType: 'application/json',
    })
    // Send 6 ICE candidates (above the 5/minute free limit).
    // All must succeed — skipCapsuleRateLimitForIce must still work independently
    // of the same-principal skip path added in this PR.
    const t0 = new Date()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await request(port, 'POST', '/beap/p2p-signal', {
        body: JSON.stringify({
          schema_version: 1,
          signal_type: 'p2p_inference_ice',
          correlation_id: `c-ice-sp305-${i}`,
          session_id: 'sess-sp305',
          handshake_id: hsId,
          sender_device_id: 'dev-init-sp305',
          receiver_device_id: 'dev-acc-sp305',
          created_at: t0.toISOString(),
          expires_at: new Date(t0.getTime() + 30_000).toISOString(),
          candidate: `candidate:${i}`,
        }),
        auth: `test-${initUser}-free`,
        contentType: 'application/json',
      })
      statuses.push(r.status)
    }
    expect(statuses.every((s) => s !== 429)).toBe(true)
  })

  test('CS_P2P_08: successful p2p-signal does not insert coordination_capsules', async () => {
    const hsId = 'hs-p2p-no-capsule-row'
    const user = 'p2pnocapuser'
    const devHost = 'dev-host-nocap'
    const devSbx = 'dev-sbx-nocap'
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({
        handshake_id: hsId,
        initiator_user_id: user,
        acceptor_user_id: user,
        initiator_device_id: devHost,
        acceptor_device_id: devSbx,
        handshake_type: 'internal',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    const before = relay?.store
      .getDb()
      .prepare('SELECT COUNT(*) as c FROM coordination_capsules')
      .get() as { c: number }
    const sbxWs = await wsConnectWithDevice(port, `test-${user}-pro`, devSbx)
    await new Promise((r) => setTimeout(r, 100))
    const t0 = new Date()
    const t1 = new Date(t0.getTime() + 15_000)
    const r = await request(port, 'POST', '/beap/p2p-signal', {
      body: JSON.stringify({
        schema_version: 1,
        signal_type: 'p2p_inference_answer',
        correlation_id: 'c-ans',
        session_id: 'sess-nocap',
        handshake_id: hsId,
        sender_device_id: devHost,
        receiver_device_id: devSbx,
        created_at: t0.toISOString(),
        expires_at: t1.toISOString(),
        sdp: 'v=0',
      }),
      auth: `test-${user}-pro`,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    const after = relay?.store
      .getDb()
      .prepare('SELECT COUNT(*) as c FROM coordination_capsules')
      .get() as { c: number }
    expect(after.c).toBe(before.c)
    sbxWs.close()
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

  test('REG_PRED_04: isSamePrincipalHandshake: storage closed → false, no exception propagates', () => {
    // relay.store is already closed by the preceding test in this suite.
    if (!relay) return
    expect(() => relay!.handshakeRegistry.isSamePrincipalHandshake('any-handshake-id')).not.toThrow()
    expect(relay.handshakeRegistry.isSamePrincipalHandshake('any-handshake-id')).toBe(false)
  })
})
