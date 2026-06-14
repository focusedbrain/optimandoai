import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import http from 'http'
import type { RelayConfig } from '../src/config.js'
import { initStore, closeStore, getDb } from '../src/store.js'
import { createServer } from '../src/server.js'
import { resetRateLimitsForTests } from '../src/rateLimiter.js'

/**
 * P2 — relay ingress backstop (POST /beap/ingest).
 *
 * If the sender device (top-level sender_device_id) maps to a registered sandbox
 * role, data-plane capsules (native BEAP message_package / non-allowlisted type)
 * are refused 422. The allowlist (handshake lifecycle, context_sync [capped],
 * inference, sandbox_email_delivery, p2p_signal) is permitted. Host / unknown
 * senders are unaffected (legacy fan-out + host routing preserved).
 */

function makeConfig(): RelayConfig {
  return {
    port: 0,
    bind_address: '127.0.0.1',
    tls_enabled: false,
    relay_auth_secret: 'test-secret-123',
    db_path: join(tmpdir(), `relay-sbx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
    max_capsule_age_days: 7,
    max_body_size: 15 * 1024 * 1024,
  }
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

let port = 0
let config: RelayConfig

async function registerHandshakeToken(handshakeId: string, token: string): Promise<void> {
  await request(port, 'POST', '/beap/register-handshake', {
    body: JSON.stringify({ handshake_id: handshakeId, expected_token: token }),
    auth: config.relay_auth_secret,
    contentType: 'application/json',
  })
}

async function registerDeviceRole(deviceId: string, role: 'host' | 'sandbox'): Promise<void> {
  await request(port, 'POST', '/beap/device-register', {
    body: JSON.stringify({ device_id: deviceId, device_role: role }),
    auth: config.relay_auth_secret,
    contentType: 'application/json',
  })
}

/** Native BEAP message package (data-plane): header + metadata + encrypted body, no relay capsule_type. */
function nativeBeapPackage(handshakeId: string, senderDeviceId: string): string {
  return JSON.stringify({
    handshake_id: handshakeId,
    sender_device_id: senderDeviceId,
    header: { encoding: 'qBEAP', receiver_binding: { handshake_id: handshakeId } },
    metadata: { created_at: new Date().toISOString() },
    payloadEnc: 'ciphertext-bytes-representing-an-encrypted-message',
  })
}

function lifecycleCapsule(
  handshakeId: string,
  capsuleType: string,
  senderDeviceId: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schema_version: 1,
    capsule_type: capsuleType,
    handshake_id: handshakeId,
    sender_id: 'user-1',
    sender_device_id: senderDeviceId,
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
    ...extra,
  })
}

describe('relay /beap/ingest — sandbox egress backstop (P2)', () => {
  let server: http.Server

  beforeAll(async () => {
    config = makeConfig()
    initStore(config)
    server = createServer(config) as http.Server
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

  test('sandbox device posting native BEAP message_package → 422 sandbox_data_egress_forbidden', async () => {
    const hs = 'hs-r-sbx-pkg'
    await registerHandshakeToken(hs, 'tok-pkg')
    await registerDeviceRole('dev-sand-pkg', 'sandbox')
    const r = await request(port, 'POST', '/beap/ingest', {
      body: nativeBeapPackage(hs, 'dev-sand-pkg'),
      auth: 'tok-pkg',
      contentType: 'application/json',
    })
    expect(r.status).toBe(422)
    expect(JSON.parse(r.body).code).toBe('sandbox_data_egress_forbidden')
  })

  test('INV-HANDSHAKE: initiate (lifecycle) from sandbox device is accepted (stored)', async () => {
    const hs = 'hs-r-sbx-initiate'
    await registerHandshakeToken(hs, 'tok-init')
    await registerDeviceRole('dev-sand-init', 'sandbox')
    const r = await request(port, 'POST', '/beap/ingest', {
      body: lifecycleCapsule(hs, 'initiate', 'dev-sand-init'),
      auth: 'tok-init',
      contentType: 'application/json',
    })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).status).toBe('stored')
  })

  test('inference + sandbox_email_delivery from sandbox are permitted by the guard', async () => {
    for (const [type, dev, tok, hs] of [
      ['internal_inference_request', 'dev-sand-infer', 'tok-infer', 'hs-r-infer'],
      ['sandbox_email_delivery', 'dev-sand-deliver', 'tok-deliver', 'hs-r-deliver'],
    ] as const) {
      await registerHandshakeToken(hs, tok)
      await registerDeviceRole(dev, 'sandbox')
      const r = await request(port, 'POST', '/beap/ingest', {
        body: JSON.stringify({ type, handshake_id: hs, sender_device_id: dev }),
        auth: tok,
        contentType: 'application/json',
      })
      // The guard must not reject these; validation may still 422, but never with the egress code.
      expect(r.body).not.toContain('sandbox_data_egress_forbidden')
    }
  })

  test('context_sync over the byte cap from sandbox → 413 sandbox_context_sync_over_cap', async () => {
    const hs = 'hs-r-ctx-big'
    await registerHandshakeToken(hs, 'tok-ctx-big')
    await registerDeviceRole('dev-sand-ctx-big', 'sandbox')
    const r = await request(port, 'POST', '/beap/ingest', {
      body: lifecycleCapsule(hs, 'context_sync', 'dev-sand-ctx-big', { filler: 'x'.repeat(8192) }),
      auth: 'tok-ctx-big',
      contentType: 'application/json',
    })
    expect(r.status).toBe(413)
    expect(JSON.parse(r.body).code).toBe('sandbox_context_sync_over_cap')
  })

  test('context_sync rate limit from sandbox → throttled (429) past quota', async () => {
    const hs = 'hs-r-ctx-rate'
    await registerHandshakeToken(hs, 'tok-ctx-rate')
    await registerDeviceRole('dev-sand-ctx-rate', 'sandbox')
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = await request(port, 'POST', '/beap/ingest', {
        body: lifecycleCapsule(hs, 'context_sync', 'dev-sand-ctx-rate', { seq: i }),
        auth: 'tok-ctx-rate',
        contentType: 'application/json',
      })
      statuses.push(r.status)
    }
    expect(statuses.slice(0, 4).every((s) => s !== 429)).toBe(true)
    expect(statuses[4]).toBe(429)
  })

  test('host device posting native BEAP is NOT blocked by the sandbox guard', async () => {
    const hs = 'hs-r-host-pkg'
    await registerHandshakeToken(hs, 'tok-host')
    await registerDeviceRole('dev-host-pkg', 'host')
    const r = await request(port, 'POST', '/beap/ingest', {
      body: nativeBeapPackage(hs, 'dev-host-pkg'),
      auth: 'tok-host',
      contentType: 'application/json',
    })
    expect(r.body).not.toContain('sandbox_data_egress_forbidden')
  })

  test('unknown sender (no registered role) is unaffected — legacy fan-out preserved', async () => {
    const hs = 'hs-r-unknown'
    await registerHandshakeToken(hs, 'tok-unknown')
    // No device-register for this sender id.
    const r = await request(port, 'POST', '/beap/ingest', {
      body: nativeBeapPackage(hs, 'dev-never-registered'),
      auth: 'tok-unknown',
      contentType: 'application/json',
    })
    expect(r.body).not.toContain('sandbox_data_egress_forbidden')
  })
})
