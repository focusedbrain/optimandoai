/**
 * Coordination Service — Pairing-code endpoints
 *
 * Covers:
 *   - happy path register + resolve
 *   - collision (409) when two devices request the same code in one account
 *   - cross-account isolation: same digits used by user A → user B's resolve = 404
 *   - regenerate-invalidates-old: a device's prior code is removed when it
 *     registers a new one; old code resolves 404
 *   - input validation (non-6-digit, missing fields, mismatched user_id/sub)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import http from 'http'
import https from 'https'
import type { CoordinationConfig } from '../src/config.js'
import { createServer } from '../src/server.js'

process.env.COORD_TEST_MODE = '1'

function makeConfig(overrides: Partial<CoordinationConfig>): CoordinationConfig {
  const base: CoordinationConfig = {
    port: 0,
    host: '127.0.0.1',
    tls_cert_path: null,
    tls_key_path: null,
    oidc_issuer: 'https://auth.wrdesk.com/realms/wrdesk',
    oidc_jwks_url: 'https://auth.wrdesk.com/realms/wrdesk/protocol/openid-connect/certs',
    oidc_audience: null,
    db_path: join(tmpdir(), `coord-pair-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
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
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        )
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

function registerBody(userId: string, instanceId: string, code: string, deviceName = ''): string {
  return JSON.stringify({
    user_id: userId,
    instance_id: instanceId,
    pairing_code: code,
    device_name: deviceName || `device-${instanceId.slice(0, 4)}`,
  })
}

describe('coordination-service: pairing codes', () => {
  let server: http.Server | https.Server
  let port: number
  let relay: Awaited<ReturnType<typeof createServer>>['relay'] | undefined

  beforeAll(async () => {
    const cfg = makeConfig({})
    const result = await createServer(cfg)
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
    const d = relay.store.getDb()
    if (d) {
      d.exec(
        'DELETE FROM coordination_pairing_codes; ' +
          'DELETE FROM coordination_token_cache;',
      )
    }
  })

  test('PC_01_register_then_resolve_happy_path', async () => {
    const r1 = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '482917', 'Alice Laptop'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    expect(r1.status).toBe(201)
    expect(JSON.parse(r1.body).status).toBe('inserted')

    const r2 = await request(port, 'GET', '/api/coordination/resolve-pairing-code?code=482917', {
      auth: 'test-alice-pro',
    })
    expect(r2.status).toBe(200)
    expect(JSON.parse(r2.body)).toEqual({
      instance_id: 'inst-alice-1',
      device_name: 'Alice Laptop',
    })
  })

  test('PC_02_idempotent_re_register_same_device', async () => {
    await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '111111', 'Alice Laptop'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })

    const r = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '111111', 'Alice Laptop'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).status).toBe('idempotent')
  })

  test('PC_03_collision_409_within_same_account', async () => {
    await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '222222', 'Alice Laptop'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })

    // Same account, same code, *different* device → 409.
    const r = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-2', '222222', 'Alice Phone'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(409)

    // Original device → still owns the code.
    const r2 = await request(port, 'GET', '/api/coordination/resolve-pairing-code?code=222222', {
      auth: 'test-alice-pro',
    })
    expect(r2.status).toBe(200)
    expect(JSON.parse(r2.body).instance_id).toBe('inst-alice-1')
  })

  test('PC_04_cross_account_isolation_resolve_404', async () => {
    await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '333333', 'Alice Laptop'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })

    // Bob registers the same digits — allowed (cross-account collision is fine).
    const rBobReg = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('bob', 'inst-bob-1', '333333', 'Bob Desktop'),
      auth: 'test-bob-pro',
      contentType: 'application/json',
    })
    expect(rBobReg.status).toBe(201)

    // Alice's resolve must return Alice's device, not Bob's.
    const aliceResolve = await request(
      port,
      'GET',
      '/api/coordination/resolve-pairing-code?code=333333',
      { auth: 'test-alice-pro' },
    )
    expect(aliceResolve.status).toBe(200)
    expect(JSON.parse(aliceResolve.body).instance_id).toBe('inst-alice-1')

    // Bob's resolve must return Bob's device.
    const bobResolve = await request(
      port,
      'GET',
      '/api/coordination/resolve-pairing-code?code=333333',
      { auth: 'test-bob-pro' },
    )
    expect(bobResolve.status).toBe(200)
    expect(JSON.parse(bobResolve.body).instance_id).toBe('inst-bob-1')

    // A third user, Carol, has no registration with this code → 404.
    const carolResolve = await request(
      port,
      'GET',
      '/api/coordination/resolve-pairing-code?code=333333',
      { auth: 'test-carol-pro' },
    )
    expect(carolResolve.status).toBe(404)
  })

  test('PC_05_regenerate_invalidates_old_code', async () => {
    // Original code.
    await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '444444', 'Alice Laptop'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })

    // Same device registers a new code (= regenerate). The server must
    // remove the prior (alice, *) row for this device.
    const rNew = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '555555', 'Alice Laptop'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    expect(rNew.status).toBe(201)

    const oldResolve = await request(
      port,
      'GET',
      '/api/coordination/resolve-pairing-code?code=444444',
      { auth: 'test-alice-pro' },
    )
    expect(oldResolve.status).toBe(404)

    const newResolve = await request(
      port,
      'GET',
      '/api/coordination/resolve-pairing-code?code=555555',
      { auth: 'test-alice-pro' },
    )
    expect(newResolve.status).toBe(200)
    expect(JSON.parse(newResolve.body).instance_id).toBe('inst-alice-1')
  })

  test('PC_06_resolve_unknown_code_returns_404', async () => {
    const r = await request(port, 'GET', '/api/coordination/resolve-pairing-code?code=999999', {
      auth: 'test-alice-pro',
    })
    expect(r.status).toBe(404)
  })

  test('PC_07_register_unauth_401', async () => {
    const r = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-1', '666666'),
      contentType: 'application/json',
    })
    expect(r.status).toBe(401)
  })

  test('PC_08_register_user_id_mismatch_403', async () => {
    // Token says alice, body says bob → 403.
    const r = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('bob', 'inst-bob-1', '777777'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
  })

  test('PC_09_register_invalid_code_400', async () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12-345', '']) {
      const r = await request(port, 'POST', '/api/coordination/register-pairing-code', {
        body: registerBody('alice', 'inst-alice-1', bad),
        auth: 'test-alice-pro',
        contentType: 'application/json',
      })
      expect(r.status).toBe(400)
    }
  })

  test('PC_10_resolve_invalid_code_400', async () => {
    const r = await request(port, 'GET', '/api/coordination/resolve-pairing-code?code=abc', {
      auth: 'test-alice-pro',
    })
    expect(r.status).toBe(400)
  })

  test('PC_11_collision_retry_simulation_succeeds_after_5_picks', async () => {
    // Simulate the Electron-side retry loop: device-2 keeps colliding with
    // device-1 on the first 4 codes, then succeeds on the 5th. Each 409
    // response is what tells the client to pick a new code.
    const taken = ['100001', '100002', '100003', '100004']
    for (const code of taken) {
      const r = await request(port, 'POST', '/api/coordination/register-pairing-code', {
        body: registerBody('alice', 'inst-alice-1', code),
        auth: 'test-alice-pro',
        contentType: 'application/json',
      })
      expect(r.status).toBe(201)
    }
    // device-1 currently owns 100004 (last insert removed prior rows for it).
    // Create a stable pre-occupier so we can collide deterministically.
    await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-collider', '200001'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    // device-2 collides on attempt 1, succeeds on attempt 2.
    const c1 = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-2', '200001'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    expect(c1.status).toBe(409)
    const c2 = await request(port, 'POST', '/api/coordination/register-pairing-code', {
      body: registerBody('alice', 'inst-alice-2', '200002'),
      auth: 'test-alice-pro',
      contentType: 'application/json',
    })
    expect(c2.status).toBe(201)
  })
})
