/**
 * TEST-ONLY harness: a real, harness-owned coordination-service instance.
 *
 * This is NOT production code and is never imported by the app bundle — it lives
 * under __tests__/ and is only loaded by Vitest suites. It boots the actual
 * `packages/coordination-service` server (no mocks), and owns its full lifecycle:
 * start, stop (for relay-down failure-mode tests), and restart on the SAME port +
 * SAME sqlite file (so queued state survives a relay outage and drains on recovery).
 *
 * Per the Phase-1 rules: automated tests must run against a real local relay and
 * must never touch relay.wrdesk.com.
 */

import http from 'http'
import https from 'https'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CoordinationConfig } from '../../../../../../../packages/coordination-service/src/config'
import { createServer } from '../../../../../../../packages/coordination-service/src/server'

process.env.COORD_TEST_MODE = '1'

type CreateServerResult = Awaited<ReturnType<typeof createServer>>

export interface RelayHarness {
  /** http://127.0.0.1:<port> — feed to p2p_config.coordination_url */
  readonly baseUrl: () => string
  /** ws://127.0.0.1:<port>/beap/ws — feed to p2p_config.coordination_ws_url */
  readonly wsUrl: () => string
  readonly port: () => number
  /** Stop listening + close store handle (simulate relay down). */
  readonly stop: () => Promise<void>
  /** Re-listen on the SAME port reusing the SAME sqlite file (relay recovery). */
  readonly restart: () => Promise<void>
  /** Full teardown: stop + delete nothing (temp file is OS-reaped). */
  readonly dispose: () => Promise<void>
  /** Direct DB access for assertions on coordination_* tables. */
  readonly db: () => any
  /** Reset rate limiter + wipe routing/capsule tables between tests. */
  readonly resetState: () => void
  /** Raw HTTP helper against this relay. */
  readonly request: (
    method: string,
    path: string,
    opts?: { body?: string; auth?: string; contentType?: string },
  ) => Promise<{ status: number; body: string }>
}

function makeConfig(dbPath: string, port: number): CoordinationConfig {
  return {
    port,
    host: '127.0.0.1',
    tls_cert_path: null,
    tls_key_path: null,
    oidc_issuer: 'https://auth.wrdesk.com/realms/wrdesk',
    oidc_jwks_url: 'https://auth.wrdesk.com/realms/wrdesk/protocol/openid-connect/certs',
    oidc_audience: null,
    db_path: dbPath,
    capsule_retention_days: 7,
    ws_heartbeat_interval: 60_000,
    max_connections: 10000,
    session_ttl_seconds: 86400,
    handshake_ttl_seconds: 604800,
  }
}

async function listen(server: http.Server | https.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onErr = (e: Error) => reject(e)
    server.once('error', onErr)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onErr)
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : port)
    })
  })
}

export async function startRelayHarness(): Promise<RelayHarness> {
  const dbPath = join(tmpdir(), `coord-rig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  let current: CreateServerResult | undefined
  let server: http.Server | https.Server | undefined
  let boundPort = 0

  const bootOnPort = async (desiredPort: number): Promise<void> => {
    const result = await createServer(makeConfig(dbPath, desiredPort))
    current = result
    server = result.server
    // Try the desired (stable) port first; if taken right after an outage, fall
    // back to an ephemeral port and surface it via baseUrl()/port().
    try {
      boundPort = await listen(server, desiredPort)
    } catch {
      boundPort = await listen(server, 0)
    }
  }

  await bootOnPort(0)

  const stop = async (): Promise<void> => {
    const s = server
    const c = current
    server = undefined
    current = undefined
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
    if (c) c.relay.store.close()
  }

  return {
    baseUrl: () => `http://127.0.0.1:${boundPort}`,
    wsUrl: () => `ws://127.0.0.1:${boundPort}/beap/ws`,
    port: () => boundPort,
    stop,
    restart: async () => {
      await bootOnPort(boundPort)
    },
    dispose: async () => {
      await stop()
    },
    db: () => current?.relay.store.getDb(),
    resetState: () => {
      if (!current) return
      current.relay.rateLimiter.resetForTests()
      const d = current.relay.store.getDb()
      if (d) {
        d.exec(
          'DELETE FROM coordination_capsules; DELETE FROM coordination_handshake_registry; DELETE FROM coordination_handshake_health_reports; DELETE FROM coordination_token_cache; DELETE FROM coordination_pairing_codes;',
        )
      }
    },
    request: (method, path, opts) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: boundPort,
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
      }),
  }
}
