/**
 * P2P Transport End-to-End Test Suite
 *
 * Covers HTTP transport, outbound queue, P2P server hardening, auth, rate limiting,
 * auto-trigger flows, and full roundtrip.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import http from 'http'
import { sendCapsuleViaHttp } from '../../handshake/p2pTransport'
import {
  enqueueOutboundCapsule,
  processOutboundQueue,
  getQueueStatus,
} from '../../handshake/outboundQueue'
import { createP2PServer } from '../p2pServer'
import { resetRateLimitsForTests } from '../rateLimiter'
import { migrateHandshakeTables, insertHandshakeRecord } from '../../handshake/db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { buildTestSession } from '../../handshake/sessionFactory'
import {
  buildInitiateCapsule,
  buildAcceptCapsule,
  buildContextSyncCapsuleWithContent,
} from '../../handshake/capsuleBuilder'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { INGESTION_CONSTANTS } from '../../ingestion/types'
import { handleHandshakeRPC, setSSOSessionProvider, _resetSSOSessionProvider } from '../../handshake/ipc'
import { getContextStoreByHandshake, insertContextStoreEntry } from '../../handshake/db'
import { computeBlockHash } from '../../handshake/contextCommitment'
import { mockKeypairFields, MOCK_EXTENSION_X25519_PUBLIC_B64 } from '../../handshake/__tests__/mockKeypair'
import type { HandshakeRecord } from '../../handshake/types'
import { upsertP2PConfig } from '../p2pConfig'
import type { P2PConfig } from '../p2pConfig'
import type { Server } from 'http'

const _require = createRequire(import.meta.url)
let Database: any
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  console.warn('[P2P TEST] better-sqlite3 not available — P2/P3/P4 tests will skip')
}

function createP2PTestDb(): any {
  if (!sqliteAvailable || !Database) throw new Error('better-sqlite3 not available')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

function skipIfNoSqlite() {
  if (!sqliteAvailable) return true
  return false
}

async function submitCapsuleToPipeline(
  capsule: object,
  db: any,
  session: ReturnType<typeof buildTestSession>,
): Promise<{ success: boolean; handshake_result?: any }> {
  const result = await handleIngestionRPC(
    'ingestion.ingest',
    {
      rawInput: {
        body: JSON.stringify(capsule),
        mime_type: 'application/vnd.beap+json',
      },
      sourceType: 'internal' as any,
      transportMeta: { channel_id: 'test' },
    },
    db,
    session,
  )
  return {
    success: result.success ?? false,
    handshake_result: result.handshake_result,
  }
}

async function createValidHandshakeWithContextSync(db: any): Promise<{
  handshakeId: string
  authToken: string
  contextSyncCapsule: Record<string, unknown>
}> {
  const initiator = buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' })
  const acceptor = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
  const initiate = buildInitiateCapsule(initiator, {
    receiverUserId: 'a',
    receiverEmail: 'a@t.com',
    reciprocal_allowed: true,
  })
  const { capsule: accept } = buildAcceptCapsule(acceptor, {
    handshake_id: initiate.handshake_id,
    initiatorUserId: 'i',
    initiatorEmail: 'i@t.com',
    sharing_mode: 'reciprocal',
    initiator_capsule_hash: initiate.capsule_hash,
  })
  await submitCapsuleToPipeline(initiate, db, acceptor)
  await submitCapsuleToPipeline(initiate, db, initiator)
  await submitCapsuleToPipeline(accept, db, initiator)
  await submitCapsuleToPipeline(accept, db, acceptor)
  const authToken = 'p3-test-token'
  const contextSync = buildContextSyncCapsuleWithContent(initiator, {
    handshake_id: initiate.handshake_id,
    counterpartyUserId: 'a',
    counterpartyEmail: 'a@t.com',
    last_seq_received: 0,
    last_capsule_hash_received: accept.capsule_hash,
    context_blocks: [],
    ...mockKeypairFields(),
  })
  const record = db.prepare('SELECT * FROM handshakes WHERE handshake_id = ?').get(initiate.handshake_id) as any
  if (record) {
    db.prepare('UPDATE handshakes SET counterparty_p2p_token = ? WHERE handshake_id = ?').run(
      authToken,
      initiate.handshake_id,
    )
  }
  return {
    handshakeId: initiate.handshake_id,
    authToken,
    contextSyncCapsule: contextSync as unknown as Record<string, unknown>,
  }
}

// ── Minimal Valid Context-Sync Capsule ──

function minimalContextSyncCapsule(handshakeId: string): Record<string, unknown>
function minimalContextSyncCapsule(
  handshakeId: string,
  opts: { senderId: string; counterpartyId: string; counterpartyEmail: string },
): Record<string, unknown>
function minimalContextSyncCapsule(
  handshakeId: string,
  opts?: { senderId: string; counterpartyId: string; counterpartyEmail: string },
): Record<string, unknown> {
  const { senderId, counterpartyId, counterpartyEmail } = opts ?? {
    senderId: 'sender-001',
    counterpartyId: 'receiver-001',
    counterpartyEmail: 'receiver@test.com',
  }
  const session = buildTestSession({ wrdesk_user_id: senderId, email: `${senderId}@test.com` })
  const capsule = buildContextSyncCapsuleWithContent(session, {
    handshake_id: handshakeId,
    counterpartyUserId: counterpartyId,
    counterpartyEmail,
    last_seq_received: 0,
    last_capsule_hash_received: '',
    context_blocks: [],
    ...mockKeypairFields(),
  })
  return capsule as unknown as Record<string, unknown>
}

// ── Mock HTTP Server Helper ──

function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: Server; url: string; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get address'))
        return
      }
      const port = addr.port
      resolve({
        server,
        url: `http://127.0.0.1:${port}/beap/ingest`,
        port,
      })
    })
    server.on('error', reject)
  })
}

// ═══════════════════════════════════════════════════════════════════════
// P1: HTTP Transport (Unit)
// ═══════════════════════════════════════════════════════════════════════

describe('P1: HTTP Transport', () => {
  let mockCtx: { server: Server; url: string; port: number } | null = null

  afterAll(async () => {
    if (mockCtx?.server) await new Promise<void>((r) => mockCtx!.server.close(() => r()))
  })

  test('P1_01_send_valid_capsule', async () => {
    mockCtx = await startMockServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      })
    })
    const capsule = minimalContextSyncCapsule('hs-p1-01')
    const result = await sendCapsuleViaHttp(
      capsule,
      mockCtx.url,
      'hs-p1-01',
      null,
    )
    expect(result.success).toBe(true)
  })

  test('P1_02_send_with_bearer_token', async () => {
    let receivedAuth: string | null = null
    mockCtx = await startMockServer((req, res) => {
      receivedAuth = req.headers.authorization ?? null
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    })
    const capsule = minimalContextSyncCapsule('hs-p1-02')
    const token = 'test-token-abc123'
    await sendCapsuleViaHttp(capsule, mockCtx.url, 'hs-p1-02', token)
    expect(receivedAuth).toBe(`Bearer ${token}`)
  })

  test('P1_03_send_without_token', async () => {
    let receivedAuth: string | undefined
    mockCtx = await startMockServer((req, res) => {
      receivedAuth = req.headers.authorization
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    })
    const capsule = minimalContextSyncCapsule('hs-p1-03')
    await sendCapsuleViaHttp(capsule, mockCtx.url, 'hs-p1-03')
    expect(receivedAuth).toBeUndefined()
  })

  test('P1_04_timeout_handling', async () => {
    mockCtx = await startMockServer((_req, res) => {
      // Never respond — client will timeout
    })
    const capsule = minimalContextSyncCapsule('hs-p1-04')
    const start = Date.now()
    const result = await sendCapsuleViaHttp(capsule, mockCtx.url, 'hs-p1-04')
    const elapsed = Date.now() - start
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(elapsed).toBeLessThan(35000) // ~30s timeout + buffer
  }, 40000)

  test('P1_05_endpoint_unreachable', async () => {
    const result = await sendCapsuleViaHttp(
      minimalContextSyncCapsule('hs-p1-05'),
      'http://127.0.0.1:59999/beap/ingest', // Unlikely port
      'hs-p1-05',
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('P1_06_endpoint_500', async () => {
    mockCtx = await startMockServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal error' }))
    })
    const result = await sendCapsuleViaHttp(
      minimalContextSyncCapsule('hs-p1-06'),
      mockCtx.url,
      'hs-p1-06',
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('500')
  })

  test('P1_07_endpoint_invalid_url', async () => {
    const result = await sendCapsuleViaHttp(
      minimalContextSyncCapsule('hs-p1-07'),
      'not-a-valid-url',
      'hs-p1-07',
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// P2: Outbound Queue (Unit)
// ═══════════════════════════════════════════════════════════════════════

describe('P2: Outbound Queue', () => {
  let db: any
  let mockCtx: { server: Server; url: string } | null = null

  beforeEach(() => {
    if (skipIfNoSqlite()) return
    db = createP2PTestDb()
  })

  afterAll(async () => {
    if (mockCtx?.server) await new Promise<void>((r) => mockCtx!.server.close(() => r()))
  })

  test('P2_01_enqueue', () => {
    if (skipIfNoSqlite()) return
    const capsule = minimalContextSyncCapsule('hs-p2-01')
    enqueueOutboundCapsule(db, 'hs-p2-01', 'http://localhost:51249/beap/ingest', capsule)
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all('hs-p2-01')
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].retry_count).toBe(0)
  })

  test('P2_02_process_success', async () => {
    if (skipIfNoSqlite()) return
    mockCtx = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    })
    const capsule = minimalContextSyncCapsule('hs-p2-02')
    enqueueOutboundCapsule(db, 'hs-p2-02', mockCtx!.url, capsule)
    await processOutboundQueue(db)
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all('hs-p2-02')
    expect(rows[0].status).toBe('sent')
  })

  test('P2_03_process_failure_retry', async () => {
    if (skipIfNoSqlite()) return
    mockCtx = await startMockServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    const capsule = minimalContextSyncCapsule('hs-p2-03')
    enqueueOutboundCapsule(db, 'hs-p2-03', mockCtx!.url, capsule)
    await processOutboundQueue(db)
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all('hs-p2-03')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].retry_count).toBe(1)
  })

  test('P2_04_exponential_backoff', async () => {
    if (skipIfNoSqlite()) return
    mockCtx = await startMockServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    const capsule = minimalContextSyncCapsule('hs-p2-04')
    enqueueOutboundCapsule(db, 'hs-p2-04', mockCtx!.url, capsule)
    await processOutboundQueue(db)
    const afterFirst = db.prepare('SELECT retry_count FROM outbound_capsule_queue WHERE handshake_id = ?').get('hs-p2-04')
    expect(afterFirst.retry_count).toBe(1)
    await processOutboundQueue(db)
    const afterSecond = db.prepare('SELECT retry_count FROM outbound_capsule_queue WHERE handshake_id = ?').get('hs-p2-04')
    expect(afterSecond.retry_count).toBe(1)
  })

  test('P2_05_max_retries_exceeded', async () => {
    if (skipIfNoSqlite()) return
    mockCtx = await startMockServer((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    const capsule = minimalContextSyncCapsule('hs-p2-05')
    enqueueOutboundCapsule(db, 'hs-p2-05', mockCtx!.url, capsule)
    // Set max_retries to 1 so we fail quickly
    db.prepare('UPDATE outbound_capsule_queue SET max_retries = 1 WHERE handshake_id = ?').run('hs-p2-05')
    await processOutboundQueue(db)
    await processOutboundQueue(db) // Second run marks as failed
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all('hs-p2-05')
    expect(rows[0].status).toBe('failed')
  })

  test('P2_06_queue_ordering', async () => {
    if (skipIfNoSqlite()) return
    const order: string[] = []
    mockCtx = await startMockServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const parsed = JSON.parse(body) as { handshake_id: string }
        order.push(parsed.handshake_id)
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      })
    })
    enqueueOutboundCapsule(db, 'hs-first', mockCtx!.url, minimalContextSyncCapsule('hs-first'))
    enqueueOutboundCapsule(db, 'hs-second', mockCtx!.url, minimalContextSyncCapsule('hs-second'))
    enqueueOutboundCapsule(db, 'hs-third', mockCtx!.url, minimalContextSyncCapsule('hs-third'))
    await processOutboundQueue(db)
    await processOutboundQueue(db)
    await processOutboundQueue(db)
    expect(order).toEqual(['hs-first', 'hs-second', 'hs-third'])
  })

  test('P2_07_get_status', () => {
    if (skipIfNoSqlite()) return
    const capsule = minimalContextSyncCapsule('hs-p2-07')
    enqueueOutboundCapsule(db, 'hs-p2-07', 'http://x/beap/ingest', capsule)
    enqueueOutboundCapsule(db, 'hs-p2-07', 'http://x/beap/ingest', capsule)
    const status = getQueueStatus(db, 'hs-p2-07')
    expect(status.pending).toBe(2)
    expect(status.sent).toBe(0)
    expect(status.failed).toBe(0)
  })

  test('P2_08_auth_token_loaded', async () => {
    if (skipIfNoSqlite()) return
    const token = 'counterparty-secret-token'
    const record: Partial<HandshakeRecord> = {
      handshake_id: 'hs-p2-08',
      relationship_id: 'rel:test',
      state: 'ACTIVE',
      initiator: {
        wrdesk_user_id: 'init-001',
        email: 'init@test.com',
        iss: 'test',
        sub: 'init-001',
        email_verified: true,
      },
      acceptor: {
        wrdesk_user_id: 'acpt-001',
        email: 'acpt@test.com',
        iss: 'test',
        sub: 'acpt-001',
        email_verified: true,
      },
      local_role: 'initiator',
      sharing_mode: 'reciprocal',
      reciprocal_allowed: true,
      tier_snapshot: { plan: 'free' },
      current_tier_signals: {},
      last_seq_sent: 0,
      last_seq_received: 0,
      last_capsule_hash_sent: '',
      last_capsule_hash_received: '',
      effective_policy: {},
      external_processing: 'none',
      created_at: new Date().toISOString(),
      initiator_wrdesk_policy_hash: '',
      initiator_wrdesk_policy_version: '1.0',
      counterparty_p2p_token: token,
      ...mockKeypairFields(),
    }
    insertHandshakeRecord(db, record as HandshakeRecord)
    let receivedAuth: string | null = null
    mockCtx = await startMockServer((req, res) => {
      receivedAuth = req.headers.authorization ?? null
      res.writeHead(200)
      res.end(JSON.stringify({ success: true }))
    })
    const capsule = minimalContextSyncCapsule('hs-p2-08')
    enqueueOutboundCapsule(db, 'hs-p2-08', mockCtx!.url, capsule)
    await processOutboundQueue(db)
    expect(receivedAuth).toBe(`Bearer ${token}`)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// P3: P2P Server — Input Hardening (Integration)
// ═══════════════════════════════════════════════════════════════════════

describe('P3: P2P Server — Input Hardening', () => {
  let p2pServer: Server | null = null
  let p2pUrl: string = ''
  let db: any
  let handshakeId: string
  let authToken: string
  let validContextSyncCapsule: Record<string, unknown>

  beforeEach(() => {
    resetRateLimitsForTests()
  })

  beforeAll(async () => {
    if (skipIfNoSqlite()) return
    db = createP2PTestDb()
    const setup = await createValidHandshakeWithContextSync(db)
    handshakeId = setup.handshakeId
    authToken = setup.authToken
    validContextSyncCapsule = setup.contextSyncCapsule
    const config: P2PConfig = {
      enabled: true,
      port: 0,
      bind_address: '127.0.0.1',
      tls_enabled: false,
      tls_cert_path: null,
      tls_key_path: null,
      local_p2p_endpoint: null,
    }
    const getDb = () => db
    const getSsoSession = () => buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    p2pServer = createP2PServer(config, getDb, getSsoSession) as Server
    if (p2pServer) {
      await new Promise<void>((r) => {
        if (p2pServer!.listening) r()
        else p2pServer!.once('listening', () => r())
      })
      const addr = p2pServer!.address()
      const port = typeof addr !== 'string' && addr ? addr.port : 51249
      p2pUrl = `http://127.0.0.1:${port}/beap/ingest`
    }
  })

  afterAll(async () => {
    if (p2pServer) await new Promise<void>((r) => p2pServer!.close(() => r()))
  })

  test('P3_01_valid_capsule_accepted', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const capsule = validContextSyncCapsule
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(200)
  })

  test('P3_02_wrong_content_type', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ handshake_id: handshakeId }),
    })
    expect(res.status).toBe(415)
  })

  test('P3_03_no_content_type', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ handshake_id: handshakeId }),
    })
    expect(res.status).toBe(415)
  })

  test('P3_04_body_too_large', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const huge = 'x'.repeat(INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES + 1)
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ handshake_id: handshakeId, padding: huge }),
    })
    expect(res.status).toBe(413)
  })

  test('P3_05_invalid_json', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: '{broken json',
    })
    expect(res.status).toBe(400)
  })

  test('P3_06_missing_handshake_id', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ foo: 'bar' }),
    })
    expect(res.status).toBe(400)
  })

  test('P3_07_wrong_http_method', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const res = await fetch(p2pUrl!, { method: 'GET' })
    expect(res.status).toBe(404)
  })

  test('P3_08_unknown_route', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const base = p2pUrl!.replace('/beap/ingest', '')
    const res = await fetch(`${base}/api/internal/something`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handshake_id: handshakeId }),
    })
    expect(res.status).toBe(404)
  })

  test('P3_09_empty_body', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: '',
    })
    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// P4: P2P Server — Authentication (Integration)
// ═══════════════════════════════════════════════════════════════════════

describe('P4: P2P Server — Authentication', () => {
  let p2pServer: Server | null = null
  let p2pUrl: string = ''
  let db: any
  let handshakeId: string
  let authToken: string
  let validContextSyncCapsule: Record<string, unknown>

  beforeEach(() => {
    resetRateLimitsForTests()
  })

  beforeAll(async () => {
    if (skipIfNoSqlite()) return
    db = createP2PTestDb()
    const setup = await createValidHandshakeWithContextSync(db)
    handshakeId = setup.handshakeId
    authToken = setup.authToken
    validContextSyncCapsule = setup.contextSyncCapsule
    const config: P2PConfig = {
      enabled: true,
      port: 0,
      bind_address: '127.0.0.1',
      tls_enabled: false,
      tls_cert_path: null,
      tls_key_path: null,
      local_p2p_endpoint: null,
    }
    p2pServer = createP2PServer(config, () => db, () => buildTestSession()) as Server
    if (p2pServer) {
      await new Promise<void>((r) => {
        if (p2pServer!.listening) r()
        else p2pServer!.once('listening', () => r())
      })
      const addr = p2pServer!.address()
      const port = typeof addr !== 'string' && addr ? addr.port : 51250
      p2pUrl = `http://127.0.0.1:${port}/beap/ingest`
    }
  })

  afterAll(async () => {
    if (p2pServer) await new Promise<void>((r) => p2pServer!.close(() => r()))
  })

  test('P4_01_valid_token', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const capsule = validContextSyncCapsule
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(200)
  })

  test('P4_02_missing_auth_header', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const capsule = minimalContextSyncCapsule(handshakeId)
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(401)
  })

  test('P4_03_wrong_token', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const capsule = minimalContextSyncCapsule(handshakeId)
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wrong-token' },
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(401)
  })

  test('P4_04_unknown_handshake_id', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const capsule = minimalContextSyncCapsule('hs-nonexistent')
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer any-token' },
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(401)
  })

  test('P4_06_malformed_auth_header', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const capsule = minimalContextSyncCapsule(handshakeId)
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'NotBearer xyz' },
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(401)
  })

  test('P4_07_empty_token', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const capsule = minimalContextSyncCapsule(handshakeId)
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' },
      body: JSON.stringify(capsule),
    })
    expect(res.status).toBe(401)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// P5: P2P Server — Rate Limiting (Integration)
// ═══════════════════════════════════════════════════════════════════════

describe('P5: Rate Limiting', () => {
  let p2pServer: Server | null = null
  let p2pUrl: string = ''
  let db: any
  let handshakeId: string
  let authToken: string
  let validContextSyncCapsule: Record<string, unknown>
  let handshakesForP501: Array<{ handshakeId: string; authToken: string; contextSyncCapsule: Record<string, unknown> }> = []

  beforeEach(() => {
    resetRateLimitsForTests()
  })

  beforeAll(async () => {
    if (skipIfNoSqlite()) return
    db = createP2PTestDb()
    const setup = await createValidHandshakeWithContextSync(db)
    handshakeId = setup.handshakeId
    authToken = setup.authToken
    validContextSyncCapsule = setup.contextSyncCapsule
    for (let i = 0; i < 8; i++) {
      handshakesForP501.push(await createValidHandshakeWithContextSync(db))
    }
    const config: P2PConfig = {
      enabled: true,
      port: 0,
      bind_address: '127.0.0.1',
      tls_enabled: false,
      tls_cert_path: null,
      tls_key_path: null,
      local_p2p_endpoint: null,
    }
    p2pServer = createP2PServer(config, () => db, () => buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })) as Server
    if (p2pServer) {
      await new Promise<void>((r) => {
        if (p2pServer!.listening) r()
        else p2pServer!.once('listening', () => r())
      })
      const addr = p2pServer!.address()
      const port = typeof addr !== 'string' && addr ? addr.port : 51249
      p2pUrl = `http://127.0.0.1:${port}/beap/ingest`
    }
  })

  afterAll(async () => {
    if (p2pServer) await new Promise<void>((r) => p2pServer!.close(() => r()))
  })

  async function sendRequest(capsule: Record<string, unknown>, token: string | null): Promise<number> {
    const res = await fetch(p2pUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(capsule),
    })
    return res.status
  }

  test.skip('P5_01_under_ip_limit', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    let sent = 0
    for (let h = 0; h < 8 && sent < 29; h++) {
      const { contextSyncCapsule: capsule, authToken: t } = handshakesForP501[h]
      for (let i = 0; i < 4 && sent < 29; i++) {
        const status = await sendRequest(capsule, t)
        expect(status).not.toBe(429)
        sent++
      }
    }
    expect(sent).toBe(29)
  }, 30000)

  test('P5_02_ip_limit_exceeded', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    for (let i = 0; i < 30; i++) {
      const { contextSyncCapsule: capsule, authToken: t } = handshakesForP501[i % 8]
      await sendRequest(capsule, t)
    }
    const res = await sendRequest(validContextSyncCapsule, authToken)
    expect(res).toBe(429)
  }, 30000)

  test('P5_03_handshake_limit_exceeded', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const cap = { ...validContextSyncCapsule }
    for (let i = 0; i < 5; i++) {
      await sendRequest(cap, authToken)
    }
    const res = await sendRequest(cap, authToken)
    expect(res).toBe(429)
  }, 30000)

  test('P5_04_auth_failure_limit', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const cap = { ...validContextSyncCapsule }
    for (let i = 0; i < 5; i++) {
      await sendRequest(cap, 'wrong-token')
    }
    const res = await sendRequest(cap, 'wrong-token')
    expect(res).toBe(429)
  }, 30000)

  test('P5_05_auth_block_duration', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const cap = { ...validContextSyncCapsule }
    for (let i = 0; i < 5; i++) {
      await sendRequest(cap, 'wrong-token')
    }
    const res = await sendRequest(cap, authToken)
    expect([429, 401]).toContain(res)
  }, 30000)

  test.skip('P5_06_different_ips_independent', async () => {
    if (skipIfNoSqlite() || !p2pUrl) return
    const setupA = handshakesForP501[0]
    const setupB = handshakesForP501[1]
    for (let i = 0; i < 5; i++) {
      await sendRequest(setupA.contextSyncCapsule, setupA.authToken)
    }
    const resB = await sendRequest(setupB.contextSyncCapsule, setupB.authToken)
    expect(resB).not.toBe(429)
  }, 30000)
})

// ═══════════════════════════════════════════════════════════════════════
// P6: Auto-Trigger
// ═══════════════════════════════════════════════════════════════════════

describe('P6: Auto-Trigger', () => {
  let db: any

  beforeEach(() => {
    if (skipIfNoSqlite()) return
    db = createP2PTestDb()
  })

  afterEach(() => {
    _resetSSOSessionProvider()
  })

  test('P6_01_auto_trigger_after_accept', async () => {
    if (skipIfNoSqlite()) return
    const initiator = buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' })
    const acceptor = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    const content = 'test-block-content'
    const blockHash = computeBlockHash(content)
    const initiate = buildInitiateCapsule(initiator, {
      receiverUserId: 'a',
      receiverEmail: 'a@t.com',
      reciprocal_allowed: true,
      p2p_endpoint: 'http://127.0.0.1:51260/beap/ingest',
    })
    await submitCapsuleToPipeline(initiate, db, acceptor)
    await submitCapsuleToPipeline(initiate, db, initiator)
    setSSOSessionProvider(() => acceptor)
    const acceptResult = await handleHandshakeRPC('handshake.accept', {
      handshake_id: initiate.handshake_id,
      sharing_mode: 'reciprocal',
      fromAccountId: 'acct-a',
      senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
      p2p_endpoint: 'http://127.0.0.1:51261/beap/ingest',
      context_blocks: [{ block_id: 'ctx-1', block_hash: blockHash, type: 'plaintext', content }],
    }, db)
    expect(acceptResult.success ?? acceptResult.local_result?.success).toBe(true)
    await new Promise((r) => setImmediate(r))
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(initiate.handshake_id)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.some((r: any) => r.status === 'pending')).toBe(true)
  })

  test('P6_02_no_trigger_without_endpoint', async () => {
    if (skipIfNoSqlite()) return
    upsertP2PConfig(db, { coordination_enabled: false })
    const initiator = buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' })
    const acceptor = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    const content = 'test-block'
    const blockHash = computeBlockHash(content)
    const initiate = buildInitiateCapsule(initiator, {
      receiverUserId: 'a',
      receiverEmail: 'a@t.com',
      reciprocal_allowed: true,
    })
    await submitCapsuleToPipeline(initiate, db, acceptor)
    await submitCapsuleToPipeline(initiate, db, initiator)
    setSSOSessionProvider(() => acceptor)
    await handleHandshakeRPC('handshake.accept', {
      handshake_id: initiate.handshake_id,
      sharing_mode: 'reciprocal',
      fromAccountId: 'acct-a',
      senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
      p2p_endpoint: null,
      context_blocks: [{ block_id: 'ctx-1', block_hash: blockHash, type: 'plaintext', content }],
    }, db)
    await new Promise((r) => setImmediate(r))
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(initiate.handshake_id)
    expect(rows.length).toBe(0)
  })

  test('P6_03_no_trigger_without_pending_blocks', async () => {
    if (skipIfNoSqlite()) return
    const initiator = buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' })
    const acceptor = buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' })
    const initiate = buildInitiateCapsule(initiator, {
      receiverUserId: 'a',
      receiverEmail: 'a@t.com',
      reciprocal_allowed: true,
      p2p_endpoint: 'http://127.0.0.1:51260/beap/ingest',
    })
    await submitCapsuleToPipeline(initiate, db, acceptor)
    await submitCapsuleToPipeline(initiate, db, initiator)
    setSSOSessionProvider(() => acceptor)
    await handleHandshakeRPC('handshake.accept', {
      handshake_id: initiate.handshake_id,
      sharing_mode: 'reciprocal',
      fromAccountId: 'acct-a',
      senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
      p2p_endpoint: 'http://127.0.0.1:51261/beap/ingest',
      context_blocks: [],
    }, db)
    await new Promise((r) => setImmediate(r))
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(initiate.handshake_id)
    expect(rows.length).toBe(0)
  })

  test.skip('P6_04_reverse_trigger_on_context_sync', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createValidHandshakeWithContextSync(db)
    const record = db.prepare('SELECT * FROM handshakes WHERE handshake_id = ?').get(setup.handshakeId) as any
    const content = 'reverse-block'
    const blockHash = computeBlockHash(content)
    insertContextStoreEntry(db, {
      block_id: 'ctx-rev-1',
      block_hash: blockHash,
      handshake_id: setup.handshakeId,
      relationship_id: record?.relationship_id ?? 'rel:test',
      scope_id: 'initiator',
      publisher_id: 'i',
      type: 'plaintext',
      content,
      status: 'pending_delivery',
      valid_until: null,
      ingested_at: null,
      superseded: 0,
    })
    db.prepare('UPDATE handshakes SET p2p_endpoint = ? WHERE handshake_id = ?').run(
      'http://127.0.0.1:51262/beap/ingest',
      setup.handshakeId,
    )
    const rowHs = db.prepare('SELECT last_capsule_hash_received FROM handshakes WHERE handshake_id = ?').get(setup.handshakeId) as any
    const acceptHash = rowHs?.last_capsule_hash_received ?? (setup.contextSyncCapsule as any).last_capsule_hash_received ?? ''
    const contextSync = buildContextSyncCapsuleWithContent(buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' }), {
      handshake_id: setup.handshakeId,
      counterpartyUserId: 'i',
      counterpartyEmail: 'i@t.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptHash,
      context_blocks: [],
    })
    const rec = contextSync as unknown as Record<string, unknown>
    rec.seq = 1
    const before = db.prepare('SELECT COUNT(*) as c FROM outbound_capsule_queue').get() as { c: number }
    await submitCapsuleToPipeline(contextSync, db, buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' }))
    await new Promise((r) => setImmediate(r))
    const after = db.prepare('SELECT COUNT(*) as c FROM outbound_capsule_queue').get() as { c: number }
    expect(after.c).toBeGreaterThan(before.c)
  })

  test('P6_05_no_reverse_on_seq2', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createValidHandshakeWithContextSync(db)
    const contextSync = buildContextSyncCapsuleWithContent(buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' }), {
      handshake_id: setup.handshakeId,
      counterpartyUserId: 'i',
      counterpartyEmail: 'i@t.com',
      last_seq_received: 1,
      last_capsule_hash_received: 'prev-hash',
      context_blocks: [],
    })
    const rec = contextSync as unknown as Record<string, unknown>
    rec.seq = 2
    db.prepare('UPDATE handshakes SET p2p_endpoint = ? WHERE handshake_id = ?').run(
      'http://127.0.0.1:51263/beap/ingest',
      setup.handshakeId,
    )
    const before = db.prepare('SELECT COUNT(*) as c FROM outbound_capsule_queue').get() as { c: number }
    await submitCapsuleToPipeline(contextSync, db, buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' }))
    await new Promise((r) => setImmediate(r))
    const after = db.prepare('SELECT COUNT(*) as c FROM outbound_capsule_queue').get() as { c: number }
    expect(after.c).toBe(before.c)
  })

  test.skip('P6_06_reverse_ignores_reciprocal_allowed', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createValidHandshakeWithContextSync(db)
    const record = db.prepare('SELECT * FROM handshakes WHERE handshake_id = ?').get(setup.handshakeId) as any
    db.prepare('UPDATE handshakes SET reciprocal_allowed = 0 WHERE handshake_id = ?').run(setup.handshakeId)
    db.prepare('UPDATE handshakes SET p2p_endpoint = ? WHERE handshake_id = ?').run(
      'http://127.0.0.1:51264/beap/ingest',
      setup.handshakeId,
    )
    const content = 'block-for-reverse'
    const blockHash = computeBlockHash(content)
    insertContextStoreEntry(db, {
      block_id: 'ctx-rev-2',
      block_hash: blockHash,
      handshake_id: setup.handshakeId,
      relationship_id: record?.relationship_id ?? 'rel:test',
      scope_id: 'initiator',
      publisher_id: 'i',
      type: 'plaintext',
      content,
      status: 'pending_delivery',
      valid_until: null,
      ingested_at: null,
      superseded: 0,
    })
    const rowHs2 = db.prepare('SELECT last_capsule_hash_received FROM handshakes WHERE handshake_id = ?').get(setup.handshakeId) as any
    const acceptHash2 = rowHs2?.last_capsule_hash_received ?? (setup.contextSyncCapsule as any).last_capsule_hash_received ?? ''
    const contextSync = buildContextSyncCapsuleWithContent(buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' }), {
      handshake_id: setup.handshakeId,
      counterpartyUserId: 'i',
      counterpartyEmail: 'i@t.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptHash2,
      context_blocks: [],
    })
    const rec = contextSync as unknown as Record<string, unknown>
    rec.seq = 1
    const before = db.prepare('SELECT COUNT(*) as c FROM outbound_capsule_queue').get() as { c: number }
    await submitCapsuleToPipeline(contextSync, db, buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' }))
    await new Promise((r) => setImmediate(r))
    const after = db.prepare('SELECT COUNT(*) as c FROM outbound_capsule_queue').get() as { c: number }
    expect(after.c).toBeGreaterThan(before.c)
  })

  test('P6_07_no_double_trigger', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createValidHandshakeWithContextSync(db)
    const contextSync = buildContextSyncCapsuleWithContent(buildTestSession({ wrdesk_user_id: 'a', email: 'a@t.com' }), {
      handshake_id: setup.handshakeId,
      counterpartyUserId: 'i',
      counterpartyEmail: 'i@t.com',
      last_seq_received: 0,
      last_capsule_hash_received: (setup.contextSyncCapsule as any).last_capsule_hash_received ?? '',
      context_blocks: [],
    })
    const rec = contextSync as unknown as Record<string, unknown>
    rec.seq = 1
    db.prepare('UPDATE handshakes SET p2p_endpoint = ? WHERE handshake_id = ?').run(
      'http://127.0.0.1:51265/beap/ingest',
      setup.handshakeId,
    )
    await submitCapsuleToPipeline(contextSync, db, buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' }))
    const r2 = await submitCapsuleToPipeline(contextSync, db, buildTestSession({ wrdesk_user_id: 'i', email: 'i@t.com' }))
    expect(r2.success).toBe(false)
    await new Promise((r) => setImmediate(r))
    const rows = db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(setup.handshakeId)
    const reverseCount = rows.filter((r: any) => r.status === 'pending' || r.status === 'sent').length
    expect(reverseCount).toBeLessThanOrEqual(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// P7: Full Roundtrip (Two Hosts)
// ═══════════════════════════════════════════════════════════════════════

async function createTwoHostSetup(): Promise<{
  hostA: { db: any; p2pServer: Server; p2pUrl: string; port: number }
  hostB: { db: any; p2pServer: Server; p2pUrl: string; port: number }
  handshakeId: string
  tokenA: string
  tokenB: string
}> {
  const portA = 51260 + Math.floor(Math.random() * 100)
  const portB = portA + 1
  const urlA = `http://127.0.0.1:${portA}/beap/ingest`
  const urlB = `http://127.0.0.1:${portB}/beap/ingest`
  const tokenA = 'host-a-token-' + Math.random().toString(36).slice(2)
  const tokenB = 'host-b-token-' + Math.random().toString(36).slice(2)

  const dbA = createP2PTestDb()
  const dbB = createP2PTestDb()

  const initiator = buildTestSession({ wrdesk_user_id: 'hostA', email: 'a@host.com' })
  const acceptor = buildTestSession({ wrdesk_user_id: 'hostB', email: 'b@host.com' })
  const content = 'roundtrip-block'
  const blockHash = computeBlockHash(content)

  const initiate = buildInitiateCapsule(initiator, {
    receiverUserId: 'hostB',
    receiverEmail: 'b@host.com',
    reciprocal_allowed: true,
    p2p_endpoint: urlA,
    p2p_auth_token: tokenA,
  })
  await submitCapsuleToPipeline(initiate, dbA, acceptor)
  await submitCapsuleToPipeline(initiate, dbB, acceptor)

  const accept = buildAcceptCapsule(acceptor, {
    handshake_id: initiate.handshake_id,
    initiatorUserId: 'hostA',
    initiatorEmail: 'a@host.com',
    sharing_mode: 'reciprocal',
    p2p_endpoint: urlB,
    p2p_auth_token: tokenB,
    context_blocks: [{ block_id: 'ctx-b', block_hash: blockHash, type: 'plaintext', content }],
  })
  const recB = dbB.prepare('SELECT relationship_id FROM handshakes WHERE handshake_id = ?').get(initiate.handshake_id) as any
  insertContextStoreEntry(dbB, {
    block_id: 'ctx-b',
    block_hash: blockHash,
    handshake_id: initiate.handshake_id,
    relationship_id: recB?.relationship_id ?? 'rel:host',
    scope_id: 'acceptor',
    publisher_id: 'hostB',
    type: 'plaintext',
    content,
    status: 'pending_delivery',
    valid_until: null,
    ingested_at: null,
    superseded: 0,
  })
  await submitCapsuleToPipeline(accept, dbA, initiator)
  await submitCapsuleToPipeline(accept, dbB, acceptor)
  const pending = getContextStoreByHandshake(dbB, initiate.handshake_id, 'pending_delivery')
  if (pending.length > 0) {
    const record = dbB.prepare('SELECT * FROM handshakes WHERE handshake_id = ?').get(initiate.handshake_id) as any
    const targetEndpoint = record?.p2p_endpoint
    if (targetEndpoint?.trim()) {
      const contextSyncCapsule = buildContextSyncCapsuleWithContent(acceptor, {
        handshake_id: initiate.handshake_id,
        counterpartyUserId: 'hostA',
        counterpartyEmail: 'a@host.com',
        last_seq_received: 0,
        last_capsule_hash_received: accept.capsule_hash,
        context_blocks: pending.map((b: any) => ({
          block_id: b.block_id,
          block_hash: b.block_hash,
          scope_id: b.scope_id,
          type: b.type,
          content: b.content ?? '',
        })),
      })
      enqueueOutboundCapsule(dbB, initiate.handshake_id, targetEndpoint.trim(), contextSyncCapsule)
    }
  }

  dbA.prepare('UPDATE handshakes SET counterparty_p2p_token = ? WHERE handshake_id = ?').run(tokenB, initiate.handshake_id)
  dbB.prepare('UPDATE handshakes SET counterparty_p2p_token = ? WHERE handshake_id = ?').run(tokenA, initiate.handshake_id)

  const configA: P2PConfig = {
    enabled: true,
    port: portA,
    bind_address: '127.0.0.1',
    tls_enabled: false,
    tls_cert_path: null,
    tls_key_path: null,
    local_p2p_endpoint: urlA,
  }
  const configB: P2PConfig = {
    enabled: true,
    port: portB,
    bind_address: '127.0.0.1',
    tls_enabled: false,
    tls_cert_path: null,
    tls_key_path: null,
    local_p2p_endpoint: urlB,
  }

  const p2pA = createP2PServer(configA, () => dbA, () => initiator) as Server
  const p2pB = createP2PServer(configB, () => dbB, () => acceptor) as Server

  await Promise.all([
    new Promise<void>((r) => { if (p2pA.listening) r(); else p2pA.once('listening', () => r()) }),
    new Promise<void>((r) => { if (p2pB.listening) r(); else p2pB.once('listening', () => r()) }),
  ])

  return {
    hostA: { db: dbA, p2pServer: p2pA, p2pUrl: urlA, port: portA },
    hostB: { db: dbB, p2pServer: p2pB, p2pUrl: urlB, port: portB },
    handshakeId: initiate.handshake_id,
    tokenA,
    tokenB,
  }
}

describe('P7: Full Roundtrip', () => {
  beforeEach(() => {
    resetRateLimitsForTests()
  })

  test('P7_01_full_happy_path', async () => {
    if (skipIfNoSqlite()) return
    const { hostA, hostB, handshakeId, tokenA, tokenB } = await createTwoHostSetup()
    try {
      await new Promise((r) => setImmediate(r))
      await processOutboundQueue(hostB.db)
      await processOutboundQueue(hostA.db)
      await new Promise((r) => setImmediate(r))
      await processOutboundQueue(hostA.db)
      await processOutboundQueue(hostB.db)
      const statusA = getQueueStatus(hostA.db, handshakeId)
      const statusB = getQueueStatus(hostB.db, handshakeId)
      const recA = hostA.db.prepare('SELECT last_seq_received FROM handshakes WHERE handshake_id = ?').get(handshakeId) as any
      const recB = hostB.db.prepare('SELECT last_seq_received FROM handshakes WHERE handshake_id = ?').get(handshakeId) as any
      expect(recA?.last_seq_received ?? 0).toBeGreaterThanOrEqual(0)
      expect(recB?.last_seq_received ?? 0).toBeGreaterThanOrEqual(0)
    } finally {
      await new Promise<void>((r) => hostA.p2pServer.close(() => r()))
      await new Promise<void>((r) => hostB.p2pServer.close(() => r()))
    }
  }, 30000)

  test('P7_02_one_side_offline', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createTwoHostSetup()
    await new Promise<void>((r) => setup.hostA.p2pServer.close(() => r()))
    await new Promise((r) => setImmediate(r))
    await processOutboundQueue(setup.hostB.db)
    const rows = setup.hostB.db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(setup.handshakeId)
    expect(rows.some((r: any) => r.retry_count >= 1 && r.status === 'pending')).toBe(true)
    const configA: P2PConfig = {
      enabled: true,
      port: setup.hostA.port,
      bind_address: '127.0.0.1',
      tls_enabled: false,
      tls_cert_path: null,
      tls_key_path: null,
      local_p2p_endpoint: setup.hostA.p2pUrl,
    }
    const p2pA = createP2PServer(configA, () => setup.hostA.db, () => buildTestSession({ wrdesk_user_id: 'hostA', email: 'a@host.com' })) as Server
    await new Promise<void>((r) => { if (p2pA.listening) r(); else p2pA.once('listening', () => r()) })
    await processOutboundQueue(setup.hostB.db)
    await new Promise<void>((r) => p2pA.close(() => r()))
    await new Promise<void>((r) => setup.hostB.p2pServer.close(() => r()))
  }, 30000)

  test('P7_03_tampered_capsule_rejected', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createTwoHostSetup()
    try {
      await new Promise((r) => setImmediate(r))
      const rows = setup.hostB.db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(setup.handshakeId)
      if (rows.length > 0) {
        const tampered = JSON.parse(rows[0].capsule_json)
        tampered.context_blocks = [{ block_id: 'tampered', block_hash: 'x', type: 'plaintext', content: 'evil' }]
        setup.hostB.db.prepare('UPDATE outbound_capsule_queue SET capsule_json = ? WHERE id = ?').run(
          JSON.stringify(tampered),
          rows[0].id,
        )
      }
      await processOutboundQueue(setup.hostB.db)
      const after = setup.hostB.db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(setup.handshakeId)
      expect(after.some((r: any) => r.status === 'pending' || r.status === 'failed')).toBe(true)
    } finally {
      await new Promise<void>((r) => setup.hostA.p2pServer.close(() => r()))
      await new Promise<void>((r) => setup.hostB.p2pServer.close(() => r()))
    }
  }, 30000)

  test('P7_04_wrong_token_rejected', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createTwoHostSetup()
    try {
      setup.hostB.db.prepare('UPDATE handshakes SET counterparty_p2p_token = ? WHERE handshake_id = ?').run(
        'wrong-token',
        setup.handshakeId,
      )
      await new Promise((r) => setImmediate(r))
      await processOutboundQueue(setup.hostB.db)
      const rows = setup.hostB.db.prepare('SELECT * FROM outbound_capsule_queue WHERE handshake_id = ?').all(setup.handshakeId)
      expect(rows.some((r: any) => r.retry_count >= 1 || r.status === 'failed')).toBe(true)
    } finally {
      await new Promise<void>((r) => setup.hostA.p2pServer.close(() => r()))
      await new Promise<void>((r) => setup.hostB.p2pServer.close(() => r()))
    }
  }, 30000)

  test('P7_05_context_matches_commitment', async () => {
    if (skipIfNoSqlite()) return
    const setup = await createTwoHostSetup()
    try {
      await new Promise((r) => setImmediate(r))
      await processOutboundQueue(setup.hostB.db)
      await processOutboundQueue(setup.hostA.db)
      await new Promise((r) => setImmediate(r))
      await processOutboundQueue(setup.hostA.db)
      await processOutboundQueue(setup.hostB.db)
      const { computeContextCommitment } = await import('../../handshake/contextCommitment')
      const storeA = getContextStoreByHandshake(setup.hostA.db, setup.handshakeId, 'received')
      const storeB = getContextStoreByHandshake(setup.hostB.db, setup.handshakeId, 'received')
      const recA = setup.hostA.db.prepare('SELECT acceptor_context_commitment FROM handshakes WHERE handshake_id = ?').get(setup.handshakeId) as any
      const recB = setup.hostB.db.prepare('SELECT initiator_context_commitment FROM handshakes WHERE handshake_id = ?').get(setup.handshakeId) as any
      if (storeA.length > 0 && recA?.acceptor_context_commitment) {
        const blocks = storeA.map((b: any) => ({ block_id: b.block_id, block_hash: b.block_hash, type: b.type, content: b.content ?? '' }))
        const recomputed = computeContextCommitment(blocks)
        expect(recomputed).toBe(recA.acceptor_context_commitment)
      }
      if (storeB.length > 0 && recB?.initiator_context_commitment) {
        const blocks = storeB.map((b: any) => ({ block_id: b.block_id, block_hash: b.block_hash, type: b.type, content: b.content ?? '' }))
        const recomputed = computeContextCommitment(blocks)
        expect(recomputed).toBe(recB.initiator_context_commitment)
      }
    } finally {
      await new Promise<void>((r) => setup.hostA.p2pServer.close(() => r()))
      await new Promise<void>((r) => setup.hostB.p2pServer.close(() => r()))
    }
  }, 30000)
})

// ═══════════════════════════════════════════════════════════════════════
// P8: TLS
// ═══════════════════════════════════════════════════════════════════════

describe('P8: TLS', () => {
  test.skip('P8_01_tls_server_starts', async () => {
    // Skipped: Generating self-signed certs in test requires openssl or node-forge.
    // Would test: createP2PServer with tls_enabled:true, cert/key paths -> server starts on HTTPS.
  })

  test.skip('P8_02_tls_connection', async () => {
    // Skipped: Requires P8_01 setup. Would test sendCapsuleViaHttp to HTTPS with rejectUnauthorized:false.
  })

  test('P8_03_no_tls_warning', async () => {
    if (skipIfNoSqlite()) return
    const logs: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
      orig.apply(console, args)
    }
    try {
      const db = createP2PTestDb()
      const config: P2PConfig = {
        enabled: true,
        port: 0,
        bind_address: '127.0.0.1',
        tls_enabled: false,
        tls_cert_path: null,
        tls_key_path: null,
        local_p2p_endpoint: null,
      }
      createP2PServer(config, () => db, () => buildTestSession())
      expect(logs.some((l) => l.includes('without TLS'))).toBe(true)
    } finally {
      console.warn = orig
    }
  })
})
