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
    d.exec('DELETE FROM relay_capsules; DELETE FROM relay_handshake_registry;')
  })

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
})
