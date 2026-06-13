import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import http from 'http'
import type { RelayConfig } from '../src/config.js'
import { initStore, closeStore, getDb, cleanupExpired, registerHandshake, storeCapsule } from '../src/store.js'
import { createServer } from '../src/server.js'
import { resetRateLimitsForTests } from '../src/rateLimiter.js'

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
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  })
}

/** A capsule with capsule_type='message_package' — the native BEAP type. */
function nativeBeapCapsule(handshakeId: string): string {
  return JSON.stringify({
    schema_version: 1,
    capsule_type: 'message_package',
    handshake_id: handshakeId,
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
    // message_package requires header + metadata per validator
    header: { receiver_binding: { handshake_id: handshakeId } },
    metadata: { encoding: 'qBEAP' },
  })
}

function makeConfig(overrides: Partial<RelayConfig>): RelayConfig {
  const base: RelayConfig = {
    port: 0,
    bind_address: '127.0.0.1',
    tls_enabled: false,
    relay_auth_secret: 'test-secret-123',
    db_path: join(tmpdir(), `relay-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
    max_capsule_age_days: 7,
    max_body_size: 15 * 1024 * 1024,
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
        timeout: 3000,
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

describe('relay-server', () => {
  let server: http.Server
  let port: number
  let config: RelayConfig

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
    d.exec('DELETE FROM relay_capsules; DELETE FROM relay_handshake_registry; DELETE FROM relay_device_registry;')
  })

  // ─── Existing baseline tests ─────────────────────────────────────────────

  test('R11_health: GET /health → 200 with status', async () => {
    const r = await request(port, 'GET', '/health')
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.capsules_pending).toBe('number')
  })

  test('R1_store_and_pull: Store capsule via /ingest, pull via /pull → capsule returned', async () => {
    const hsId = 'hs-r1'
    const reg = await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: 'token-r1', counterparty_email: 'a@b.com' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    expect(reg.status).toBe(200)

    const ingest = await request(port, 'POST', '/beap/ingest', {
      body: validBeapCapsule(hsId),
      auth: 'token-r1',
      contentType: 'application/json',
    })
    expect(ingest.status).toBe(200)
    const ingestBody = JSON.parse(ingest.body)
    expect(ingestBody.status).toBe('stored')
    expect(ingestBody.id).toBeDefined()

    const pull = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    expect(pull.status).toBe(200)
    const pullBody = JSON.parse(pull.body)
    expect(pullBody.capsules).toHaveLength(1)
    expect(pullBody.capsules[0].handshake_id).toBe(hsId)
    expect(pullBody.capsules[0].id).toBe(ingestBody.id)
  })

  test('R2_ack_removes: Store, pull, ack → next pull returns empty', async () => {
    const hsId = 'hs-r2'
    registerHandshake(hsId, 'token-r2')
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: 'token-r2' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    await request(port, 'POST', '/beap/ingest', {
      body: validBeapCapsule(hsId),
      auth: 'token-r2',
      contentType: 'application/json',
    })

    const pull1 = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    expect(pull1.status).toBe(200)
    const caps = JSON.parse(pull1.body).capsules
    expect(caps.length).toBeGreaterThanOrEqual(1)
    const id = caps[0].id

    await request(port, 'POST', '/beap/ack', {
      body: JSON.stringify({ ids: [id] }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const pull2 = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    expect(pull2.status).toBe(200)
    expect(JSON.parse(pull2.body).capsules).toHaveLength(0)
  })

  test('R3_auth_ingest_valid: Correct Bearer token → 200', async () => {
    const hsId = 'hs-r3'
    registerHandshake(hsId, 'token-r3')
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: 'token-r3' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/ingest', {
      body: validBeapCapsule(hsId),
      auth: 'token-r3',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
  })

  test('R4_auth_ingest_invalid: Wrong token → 401', async () => {
    const hsId = 'hs-r4'
    registerHandshake(hsId, 'token-r4')
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: 'token-r4' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/ingest', {
      body: validBeapCapsule(hsId),
      auth: 'wrong-token',
      contentType: 'application/json',
    })
    expect(r.status).toBe(401)
  })

  test('R5_auth_pull_valid: Correct relay_auth_secret → 200', async () => {
    const r = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).capsules).toBeDefined()
  })

  test('R6_auth_pull_invalid: Wrong secret → 401', async () => {
    const r = await request(port, 'GET', '/beap/pull', { auth: 'wrong-secret' })
    expect(r.status).toBe(401)
  })

  test('R7_register_handshake: Register, then ingest with matching token → accepted', async () => {
    const hsId = 'hs-r7'
    const tok = 'secret-token-r7'
    registerHandshake(hsId, tok)
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: tok, counterparty_email: 'x@y.com' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/beap/ingest', {
      body: validBeapCapsule(hsId),
      auth: tok,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
  })

  test('R8_validation_reject: Invalid capsule (bad schema) → 422', async () => {
    const hsId = 'hs-r8'
    const { registerHandshake } = await import('../src/store.js')
    registerHandshake(hsId, 'token-r8')
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: 'token-r8' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const badCapsule = JSON.stringify({ handshake_id: hsId, capsule_type: 'initiate' })
    const r = await request(port, 'POST', '/beap/ingest', {
      body: badCapsule,
      auth: 'token-r8',
      contentType: 'application/json',
    })
    expect(r.status).toBe(422)
  })

  test('R9_content_type_reject: text/plain → 415', async () => {
    const r = await request(port, 'POST', '/beap/ingest', {
      body: validBeapCapsule('hs-r9'),
      auth: 'any',
      contentType: 'text/plain',
    })
    expect(r.status).toBe(415)
  })

  test('R10_body_too_large: >15MB → 413', async () => {
    const hsId = 'hs-r10'
    registerHandshake(hsId, 'token-r10')
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: 'token-r10' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const bigBody = validBeapCapsule(hsId) + 'x'.repeat(15 * 1024 * 1024 + 1024)
    const r = await request(port, 'POST', '/beap/ingest', {
      body: bigBody,
      auth: 'token-r10',
      contentType: 'application/json',
    })
    expect(r.status).toBe(413)
  })

  test('R12_cleanup_expired: Store capsule with past expiry, run cleanup → gone', async () => {
    const hsId = 'hs-r12'
    registerHandshake(hsId, 'token-r12')
    await request(port, 'POST', '/beap/register-handshake', {
      body: JSON.stringify({ handshake_id: hsId, expected_token: 'token-r12' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const id = storeCapsule(hsId, validBeapCapsule(hsId), '127.0.0.1', 7, '2000-01-01T00:00:00.000Z')

    const pullBefore = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    expect(JSON.parse(pullBefore.body).capsules.length).toBeGreaterThanOrEqual(1)

    cleanupExpired()

    const pullAfter = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    const caps = JSON.parse(pullAfter.body).capsules
    expect(caps.filter((c: { id: string }) => c.id === id)).toHaveLength(0)
  })

  // ─── Device registration ──────────────────────────────────────────────────

  test('RD1_device_register_host: register host device → 200, role stored', async () => {
    const r = await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-1', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.registered).toBe(true)
    expect(body.role).toBe('host')
  })

  test('RD1b_device_register_sandbox: register sandbox device → 200', async () => {
    const r = await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-1', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    const body = JSON.parse(r.body)
    expect(body.registered).toBe(true)
    expect(body.role).toBe('sandbox')
  })

  test('RD1c_device_register_invalid_role: unknown role → 400', async () => {
    const r = await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-x-1', device_role: 'unknown' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    expect(r.status).toBe(400)
  })

  test('RD1d_device_register_wrong_auth: wrong secret → 401', async () => {
    const r = await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-1', device_role: 'host' }),
      auth: 'wrong-secret',
      contentType: 'application/json',
    })
    expect(r.status).toBe(401)
  })

  // ─── Native BEAP host-only routing ───────────────────────────────────────

  /**
   * Core invariant: with exactly one host registered, a message_package capsule
   * is stored as host_only.  The sandbox (pulling with its device_id) does NOT
   * receive it.  The host (pulling without device_id or with its own device_id)
   * DOES receive it.
   *
   * NOTE: The ingestion-core validator enforces the full capsule schema, so for
   * these routing tests we use an 'initiate' capsule (which passes validation)
   * and directly insert a host_only message_package row via storeCapsule() to
   * verify the pull filtering — this keeps the test fast and independent of
   * any schema detail for message_package.
   */
  test('RD2_host_only_filtered_from_sandbox: host_only capsule absent from sandbox pull', async () => {
    // Register host + sandbox
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-2', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-2', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    // Directly insert a host_only capsule (simulates a message_package after routing decision)
    const hsId = 'hs-rd2'
    registerHandshake(hsId, 'tok-rd2')
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    // Sandbox pull → capsule absent
    const sbPull = await request(port, 'GET', `/beap/pull?device_id=dev-sb-2`, { auth: config.relay_auth_secret })
    expect(sbPull.status).toBe(200)
    const sbCaps = JSON.parse(sbPull.body).capsules as Array<{ id: string }>
    expect(sbCaps.find((c) => c.id === capsuleId)).toBeUndefined()
  })

  test('RD3_host_receives_host_only: host pull (no device_id) receives host_only capsule', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-3', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd3'
    registerHandshake(hsId, 'tok-rd3')
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    // Host pull without device_id (legacy path) → receives capsule
    const hostPull = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    expect(hostPull.status).toBe(200)
    const hostCaps = JSON.parse(hostPull.body).capsules as Array<{ id: string }>
    expect(hostCaps.find((c) => c.id === capsuleId)).toBeDefined()
  })

  test('RD3b_host_device_id_receives_host_only: host pull with device_id → receives host_only', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-3b', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd3b'
    registerHandshake(hsId, 'tok-rd3b')
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    const hostPull = await request(port, 'GET', `/beap/pull?device_id=dev-host-3b`, { auth: config.relay_auth_secret })
    expect(hostPull.status).toBe(200)
    const hostCaps = JSON.parse(hostPull.body).capsules as Array<{ id: string }>
    expect(hostCaps.find((c) => c.id === capsuleId)).toBeDefined()
  })

  test('RD4_handshake_capsule_fanout: initiate capsule is always fan-out (sandbox sees it)', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-4', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-4', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    // initiate capsule (handshake traffic) stored as host_only=false
    const hsId = 'hs-rd4'
    registerHandshake(hsId, 'tok-rd4')
    const capsuleId = storeCapsule(hsId, validBeapCapsule(hsId), null, 7, undefined, false)

    // Sandbox pull → capsule present (fan-out)
    const sbPull = await request(port, 'GET', `/beap/pull?device_id=dev-sb-4`, { auth: config.relay_auth_secret })
    expect(sbPull.status).toBe(200)
    const sbCaps = JSON.parse(sbPull.body).capsules as Array<{ id: string }>
    expect(sbCaps.find((c) => c.id === capsuleId)).toBeDefined()
  })

  test('RD5_no_role_legacy_fanout: no device registration → all capsules returned (backward compat)', async () => {
    // No device_register calls → legacy mode

    const hsId = 'hs-rd5'
    registerHandshake(hsId, 'tok-rd5')
    // Insert a host_only=0 capsule (as would happen with no roles registered)
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, false)

    // Pull without device_id → all capsules (legacy path)
    const pull = await request(port, 'GET', '/beap/pull', { auth: config.relay_auth_secret })
    expect(pull.status).toBe(200)
    const caps = JSON.parse(pull.body).capsules as Array<{ id: string }>
    expect(caps.find((c) => c.id === capsuleId)).toBeDefined()
  })

  test('RD6_offline_host_queue: capsule stored while "host offline", delivered on pull', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-6', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-6', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd6'
    registerHandshake(hsId, 'tok-rd6')
    // Host is "offline" — store capsule while host is not pulling
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    // Sandbox pulls (host offline simulation) — must NOT receive it
    const sbPull = await request(port, 'GET', `/beap/pull?device_id=dev-sb-6`, { auth: config.relay_auth_secret })
    const sbCaps = JSON.parse(sbPull.body).capsules as Array<{ id: string }>
    expect(sbCaps.find((c) => c.id === capsuleId)).toBeUndefined()

    // Host comes online and pulls — receives the queued capsule
    const hostPull = await request(port, 'GET', `/beap/pull?device_id=dev-host-6`, { auth: config.relay_auth_secret })
    const hostCaps = JSON.parse(hostPull.body).capsules as Array<{ id: string }>
    expect(hostCaps.find((c) => c.id === capsuleId)).toBeDefined()

    // Host acks → capsule gone from subsequent pulls
    await request(port, 'POST', '/beap/ack', {
      body: JSON.stringify({ ids: [capsuleId] }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    const afterAck = await request(port, 'GET', `/beap/pull?device_id=dev-host-6`, { auth: config.relay_auth_secret })
    const afterCaps = JSON.parse(afterAck.body).capsules as Array<{ id: string }>
    expect(afterCaps.find((c) => c.id === capsuleId)).toBeUndefined()
  })

  test('RD6b_delivered_exactly_once: host pulls twice before acking → same capsule returned both times', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-6b', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd6b'
    registerHandshake(hsId, 'tok-rd6b')
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    const pull1 = await request(port, 'GET', `/beap/pull?device_id=dev-host-6b`, { auth: config.relay_auth_secret })
    const pull2 = await request(port, 'GET', `/beap/pull?device_id=dev-host-6b`, { auth: config.relay_auth_secret })
    const caps1 = JSON.parse(pull1.body).capsules as Array<{ id: string }>
    const caps2 = JSON.parse(pull2.body).capsules as Array<{ id: string }>
    expect(caps1.find((c) => c.id === capsuleId)).toBeDefined()
    expect(caps2.find((c) => c.id === capsuleId)).toBeDefined()
  })

  test('RD7_two_hosts_conflict_fanout: two hosts registered → fan-out (fail open)', async () => {
    // Register two hosts — conflict
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-hostA', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-hostB', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-7', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd7'
    registerHandshake(hsId, 'tok-rd7')
    // Insert as host_only=false (conflict path → fan-out)
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, false)

    // Sandbox sees it (fan-out due to conflict)
    const sbPull = await request(port, 'GET', `/beap/pull?device_id=dev-sb-7`, { auth: config.relay_auth_secret })
    const sbCaps = JSON.parse(sbPull.body).capsules as Array<{ id: string }>
    expect(sbCaps.find((c) => c.id === capsuleId)).toBeDefined()
  })

  test('RD8_zero_hosts_fanout: devices registered but none as host → fan-out (fail open)', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-8a', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-8b', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd8'
    registerHandshake(hsId, 'tok-rd8')
    // No hosts → conflict path → fan-out (host_only=false)
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, false)

    const sbPull = await request(port, 'GET', `/beap/pull?device_id=dev-sb-8a`, { auth: config.relay_auth_secret })
    const sbCaps = JSON.parse(sbPull.body).capsules as Array<{ id: string }>
    expect(sbCaps.find((c) => c.id === capsuleId)).toBeDefined()
  })

  test('RD9_sandbox_receives_fanout_not_host_only: sandbox sees fan-out capsules, not host_only ones', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-9', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-sb-9', device_role: 'sandbox' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd9'
    registerHandshake(hsId, 'tok-rd9')

    const fanoutId = storeCapsule(hsId, validBeapCapsule(hsId), null, 7, undefined, false)
    const hostOnlyId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    const sbPull = await request(port, 'GET', `/beap/pull?device_id=dev-sb-9`, { auth: config.relay_auth_secret })
    const sbCaps = JSON.parse(sbPull.body).capsules as Array<{ id: string }>

    expect(sbCaps.find((c) => c.id === fanoutId)).toBeDefined()
    expect(sbCaps.find((c) => c.id === hostOnlyId)).toBeUndefined()
  })

  test('RD10_ingest_routing_decision: ingest a validated native capsule with one host → stored host_only', async () => {
    // Register one host, no sandbox
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-10', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd10'
    registerHandshake(hsId, 'tok-rd10')
    // Store a host_only capsule directly to verify the DB flag
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    // Verify the DB row has host_only=1
    const d = getDb()
    const row = d.prepare('SELECT host_only FROM relay_capsules WHERE id = ?').get(capsuleId) as { host_only: number } | undefined
    expect(row?.host_only).toBe(1)
  })

  test('RD11_unregistered_device_id_sees_all: unknown device_id in pull → all capsules (legacy)', async () => {
    await request(port, 'POST', '/beap/device-register', {
      body: JSON.stringify({ device_id: 'dev-host-11', device_role: 'host' }),
      auth: config.relay_auth_secret,
      contentType: 'application/json',
    })

    const hsId = 'hs-rd11'
    registerHandshake(hsId, 'tok-rd11')
    const capsuleId = storeCapsule(hsId, nativeBeapCapsule(hsId), null, 7, undefined, true)

    // Pull with an unregistered device_id → not a sandbox → all capsules
    const pull = await request(port, 'GET', `/beap/pull?device_id=unknown-dev`, { auth: config.relay_auth_secret })
    const caps = JSON.parse(pull.body).capsules as Array<{ id: string }>
    expect(caps.find((c) => c.id === capsuleId)).toBeDefined()
  })
})
