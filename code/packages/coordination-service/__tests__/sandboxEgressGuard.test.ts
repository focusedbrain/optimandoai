import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import http from 'http'
import https from 'https'
import type { CoordinationConfig } from '../src/config.js'
import { createServer } from '../src/server.js'

process.env.COORD_TEST_MODE = '1'

/**
 * P2 — coordination ingress backstop (POST /beap/capsule).
 *
 * A sandbox-role device (resolved via sender_device_id -> registry role) is
 * data-plane receive-only: native BEAP / non-allowlisted capsules are refused
 * 403 sandbox_data_egress_forbidden; the allowlist (handshake lifecycle,
 * context_sync [capped], inference, sandbox_email_delivery, p2p_signal,
 * sealed_service_rpc_v1) is
 * permitted. Host devices and unknown senders are unaffected. INV-HANDSHAKE:
 * lifecycle capsules from the sandbox are accepted.
 */

const SAME_USER = 'sameuser'
const AUTH = 'test-sameuser-pro'

function makeConfig(): CoordinationConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    tls_cert_path: null,
    tls_key_path: null,
    oidc_issuer: 'https://auth.wrdesk.com/realms/wrdesk',
    oidc_jwks_url: 'https://auth.wrdesk.com/realms/wrdesk/protocol/openid-connect/certs',
    oidc_audience: null,
    db_path: join(tmpdir(), `coord-sbx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
    capsule_retention_days: 7,
    ws_heartbeat_interval: 60_000,
    max_connections: 10000,
    session_ttl_seconds: 86400,
    handshake_ttl_seconds: 604800,
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

/** Register a same-principal internal handshake: host device + sandbox device. */
async function registerSandboxHandshake(
  port: number,
  handshakeId: string,
  hostDeviceId: string,
  sandboxDeviceId: string,
): Promise<void> {
  await request(port, 'POST', '/beap/register-handshake', {
    body: JSON.stringify({
      handshake_id: handshakeId,
      initiator_user_id: SAME_USER,
      acceptor_user_id: SAME_USER,
      initiator_device_id: hostDeviceId,
      acceptor_device_id: sandboxDeviceId,
      initiator_device_role: 'host',
      acceptor_device_role: 'sandbox',
      handshake_type: 'internal',
    }),
    auth: AUTH,
    contentType: 'application/json',
  })
}

function lifecycleCapsule(
  handshakeId: string,
  capsuleType: string,
  senderDeviceId: string,
  receiverDeviceId?: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schema_version: 1,
    capsule_type: capsuleType,
    handshake_id: handshakeId,
    sender_id: SAME_USER,
    sender_device_id: senderDeviceId,
    ...(receiverDeviceId ? { receiver_device_id: receiverDeviceId } : {}),
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    sharing_mode: 'reciprocal',
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'a'.repeat(64),
    sender_signature: 'b'.repeat(128),
    countersigned_hash: 'c'.repeat(128),
    ...extra,
  })
}

function sealedServiceRpcCapsule(
  handshakeId: string,
  senderDeviceId: string,
  receiverDeviceId: string,
): string {
  return JSON.stringify({
    schema_version: 1,
    capsule_type: 'sealed_service_rpc_v1',
    envelope_type: 'sealed_service_rpc_v1',
    handshake_id: handshakeId,
    sender_device_id: senderDeviceId,
    receiver_device_id: receiverDeviceId,
    sender_ephemeral_x25519_pub_b64: Buffer.alloc(32, 1).toString('base64'),
    salt_b64: Buffer.alloc(16, 2).toString('base64'),
    nonce_b64: Buffer.alloc(12, 3).toString('base64'),
    ciphertext_b64: Buffer.alloc(32, 4).toString('base64'),
  })
}

/** Native BEAP message package (data-plane). handshake_id resolved from header binding. */
function nativeBeapPackage(handshakeId: string, senderDeviceId: string): string {
  return JSON.stringify({
    handshake_id: handshakeId,
    sender_device_id: senderDeviceId,
    header: { encoding: 'qBEAP', receiver_binding: { handshake_id: handshakeId } },
    metadata: { created_at: new Date().toISOString() },
    payloadEnc: 'ciphertext-bytes-representing-an-encrypted-message',
  })
}

describe('coordination /beap/capsule — sandbox egress backstop (P2)', () => {
  let server: http.Server | https.Server
  let port: number
  let relay: Awaited<ReturnType<typeof createServer>>['relay'] | undefined

  beforeAll(async () => {
    const result = await createServer(makeConfig())
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

  test('native BEAP message_package from sandbox device → 403 sandbox_data_egress_forbidden', async () => {
    const hs = 'hs-sbx-pkg'
    await registerSandboxHandshake(port, hs, 'dev-host-1', 'dev-sand-pkg')
    const r = await request(port, 'POST', '/beap/capsule', {
      body: nativeBeapPackage(hs, 'dev-sand-pkg'),
      auth: AUTH,
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    expect(JSON.parse(r.body).code).toBe('sandbox_data_egress_forbidden')
  })

  test('INV-HANDSHAKE: handshake lifecycle (accept) from sandbox device is accepted', async () => {
    const hs = 'hs-sbx-accept'
    await registerSandboxHandshake(port, hs, 'dev-host-2', 'dev-sand-accept')
    const r = await request(port, 'POST', '/beap/capsule', {
      body: lifecycleCapsule(hs, 'accept', 'dev-sand-accept', 'dev-host-2'),
      auth: AUTH,
      contentType: 'application/json',
    })
    expect(r.status).not.toBe(403)
    expect(r.body).not.toContain('sandbox_data_egress_forbidden')
    expect([200, 202]).toContain(r.status)
  })

  test('context_sync from sandbox is permitted (within cap)', async () => {
    const hs = 'hs-sbx-ctx-ok'
    await registerSandboxHandshake(port, hs, 'dev-host-3', 'dev-sand-ctx-ok')
    const r = await request(port, 'POST', '/beap/capsule', {
      body: lifecycleCapsule(hs, 'context_sync', 'dev-sand-ctx-ok', 'dev-host-3'),
      auth: AUTH,
      contentType: 'application/json',
    })
    // The sandbox guard must permit context_sync (no egress/cap/throttle rejection).
    // Downstream capsule validation is out of scope for this guard test.
    expect(r.body).not.toContain('sandbox_data_egress_forbidden')
    expect(r.body).not.toContain('sandbox_context_sync_over_cap')
    expect(r.body).not.toContain('sandbox_context_sync_throttled')
    expect(r.status).not.toBe(403)
  })

  test('sealed_service_rpc_v1 from sandbox passes egress backstop (opaque; inner type not inspected)', async () => {
    const hs = 'hs-sbx-sealed'
    await registerSandboxHandshake(port, hs, 'dev-host-sealed', 'dev-sand-sealed')
    const r = await request(port, 'POST', '/beap/capsule', {
      body: sealedServiceRpcCapsule(hs, 'dev-sand-sealed', 'dev-host-sealed'),
      auth: AUTH,
      contentType: 'application/json',
    })
    expect(r.body).not.toContain('sandbox_data_egress_forbidden')
    expect(r.status).not.toBe(403)
  })

  test('context_sync over the byte cap from sandbox → 413 sandbox_context_sync_over_cap', async () => {
    const hs = 'hs-sbx-ctx-big'
    await registerSandboxHandshake(port, hs, 'dev-host-4', 'dev-sand-ctx-big')
    // Cap is 4096 bytes in test env; pad well past it.
    const r = await request(port, 'POST', '/beap/capsule', {
      body: lifecycleCapsule(hs, 'context_sync', 'dev-sand-ctx-big', 'dev-host-4', {
        filler: 'x'.repeat(8192),
      }),
      auth: AUTH,
      contentType: 'application/json',
    })
    expect(r.status).toBe(413)
    expect(JSON.parse(r.body).code).toBe('sandbox_context_sync_over_cap')
  })

  test('context_sync rate limit from sandbox → throttled (429) past quota', async () => {
    const hs = 'hs-sbx-ctx-rate'
    await registerSandboxHandshake(port, hs, 'dev-host-5', 'dev-sand-ctx-rate')
    // Limit is 4 per window in test env.
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = await request(port, 'POST', '/beap/capsule', {
        body: lifecycleCapsule(hs, 'context_sync', 'dev-sand-ctx-rate', 'dev-host-5', { seq: i }),
        auth: AUTH,
        contentType: 'application/json',
      })
      statuses.push(r.status)
    }
    expect(statuses.slice(0, 4).every((s) => s !== 429)).toBe(true)
    expect(statuses[4]).toBe(429)
  })

  test('inference service message (type) from sandbox is permitted', async () => {
    const hs = 'hs-sbx-infer'
    await registerSandboxHandshake(port, hs, 'dev-host-6', 'dev-sand-infer')
    const r = await request(port, 'POST', '/beap/capsule', {
      body: JSON.stringify({
        type: 'internal_inference_request',
        handshake_id: hs,
        sender_device_id: 'dev-sand-infer',
        receiver_device_id: 'dev-host-6',
      }),
      auth: AUTH,
      contentType: 'application/json',
    })
    expect(r.body).not.toContain('sandbox_data_egress_forbidden')
  })

  test('host device sending native BEAP is NOT blocked by the sandbox guard', async () => {
    const hs = 'hs-host-pkg'
    await registerSandboxHandshake(port, hs, 'dev-host-7', 'dev-sand-7')
    const r = await request(port, 'POST', '/beap/capsule', {
      // sender_device_id is the HOST device → guard must not fire.
      body: nativeBeapPackage(hs, 'dev-host-7'),
      auth: AUTH,
      contentType: 'application/json',
    })
    expect(r.body).not.toContain('sandbox_data_egress_forbidden')
    expect(r.status).not.toBe(403)
  })

  test('ledger-proven sandbox (file=host) still guarded: role is registry-authoritative', async () => {
    // The coordination registry stores the device role independently of any node's
    // local orchestrator-mode.json. A device registered as 'sandbox' is guarded as
    // sandbox regardless of what its own file claims.
    const hs = 'hs-sbx-ledger'
    await registerSandboxHandshake(port, hs, 'dev-host-8', 'dev-sand-ledger')
    const r = await request(port, 'POST', '/beap/capsule', {
      body: nativeBeapPackage(hs, 'dev-sand-ledger'),
      auth: AUTH,
      contentType: 'application/json',
    })
    expect(r.status).toBe(403)
    expect(JSON.parse(r.body).code).toBe('sandbox_data_egress_forbidden')
  })
})
