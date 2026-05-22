/**
 * Native BEAP outbound prefers direct /beap/ingest when peer endpoint is set.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import { randomUUID } from 'node:crypto'

vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP ?? process.env.TMPDIR ?? '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  BrowserWindow: class {
    webContents = { send: () => undefined }
    static getAllWindows() {
      return []
    }
  },
}))

vi.mock('../../p2p/relaySync', () => ({
  registerHandshakeWithRelay: vi.fn(),
}))

vi.mock('../p2pTransport', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../p2pTransport')>()
  return {
    ...mod,
    sendCapsuleViaHttp: vi.fn(),
    sendCapsuleViaCoordination: vi.fn(),
  }
})

import {
  processOutboundQueue,
  enqueueOutboundCapsule,
  clearOutboundAutoDrainTimer,
} from '../outboundQueue'
import { migrateHandshakeTables, insertHandshakeRecord } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { upsertP2PConfig } from '../../p2p/p2pConfig'
import type { HandshakeRecord } from '../types'
import { mockKeypairFields } from './mockKeypair'
import * as p2pTransport from '../p2pTransport'

const _require = createRequire(import.meta.url)
let Database: any
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  console.warn('[outboundQueue.directBeapIngest] better-sqlite3 not available — tests skipped')
}

const hasSqlite = sqliteAvailable

function createTestDb(): any {
  if (!sqliteAvailable || !Database) throw new Error('better-sqlite3 not available')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

describe.skipIf(!hasSqlite)('processOutboundQueue — direct BEAP ingest first', () => {
  let db: any

  beforeEach(() => {
    db = createTestDb()
    vi.mocked(p2pTransport.sendCapsuleViaHttp).mockReset()
    vi.mocked(p2pTransport.sendCapsuleViaCoordination).mockReset()
    upsertP2PConfig(db, {
      coordination_enabled: true,
      coordination_url: 'https://coord.test',
      relay_mode: 'local',
    })
    const hsId = randomUUID()
    const rec: HandshakeRecord = {
      handshake_id: hsId,
      relationship_id: 'rel-direct',
      state: 'ACTIVE',
      initiator: { wrdesk_user_id: 'i', email: 'i@t.com', iss: 'test', sub: 'i', email_verified: true },
      acceptor: { wrdesk_user_id: 'a', email: 'a@t.com', iss: 'test', sub: 'a', email_verified: true },
      local_role: 'initiator',
      sharing_mode: 'reciprocal',
      reciprocal_allowed: true,
      tier_snapshot: { plan: 'free' },
      current_tier_signals: {},
      last_seq_sent: 0,
      last_seq_received: 0,
      handshake_type: 'internal',
      initiator_device_role: 'host',
      acceptor_device_role: 'sandbox',
      internal_coordination_identity_complete: true,
      p2p_endpoint: 'http://127.0.0.1:51249/beap/ingest',
      local_p2p_auth_token: 'bearer-test',
      ...mockKeypairFields(),
    }
    insertHandshakeRecord(db, rec)
  })

  afterEach(() => {
    clearOutboundAutoDrainTimer()
    db?.close()
  })

  test('uses direct ingest and sets recipient_ingest_confirmed without calling coordination', async () => {
    const hs = db.prepare('SELECT handshake_id FROM handshakes LIMIT 1').get() as { handshake_id: string }
    const pkg = {
      header: { encoding: 'qBEAP', crypto: { senderX25519PublicKeyB64: mockKeypairFields().local_x25519_public_key_b64 } },
      metadata: {},
      envelope: { ciphertext_b64: 'YQ==' },
    }
    enqueueOutboundCapsule(db, hs.handshake_id, 'http://127.0.0.1:51249/beap/ingest', pkg)

    vi.mocked(p2pTransport.sendCapsuleViaHttp).mockResolvedValue({
      success: true,
      statusCode: 200,
      recipientIngestConfirmed: true,
      ingestRowId: 'row-direct-1',
    })

    const r = await processOutboundQueue(db, async () => 'oidc-token')

    expect(r.recipient_ingest_confirmed).toBe(true)
    expect(r.ingest_row_id).toBe('row-direct-1')
    expect(p2pTransport.sendCapsuleViaHttp).toHaveBeenCalled()
    expect(p2pTransport.sendCapsuleViaCoordination).not.toHaveBeenCalled()
  })
})
