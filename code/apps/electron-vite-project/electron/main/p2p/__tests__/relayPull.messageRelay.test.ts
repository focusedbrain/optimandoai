/**
 * Relay pull — message_relay capsules are processed via processBeapPackageInline
 * (Phase B change: previously inserted directly into p2p_pending_beap).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { pullFromRelay } from '../relayPull'
import * as ingestionPipeline from '../../ingestion/ingestionPipeline'
import * as beapEmailIngestion from '../../email/beapEmailIngestion'
import * as coordinationWs from '../coordinationWs'
import * as peerDeliveryAck from '../peerDeliveryAck'
import { upsertP2PConfig } from '../p2pConfig'
import { migrateHandshakeTables } from '../../handshake/db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { buildTestSession } from '../../handshake/sessionFactory'
import type { IngestionAuditRecord } from '../../ingestion/types'

const _require = createRequire(import.meta.url)
let Database: any
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  /* optional native module in CI */
}

function createTestDb(): any {
  if (!sqliteAvailable || !Database) throw new Error('better-sqlite3 not available')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

function skipIfNoSqlite(): boolean {
  return !sqliteAvailable
}

function auditBase(overrides: Partial<IngestionAuditRecord> = {}): IngestionAuditRecord {
  return {
    timestamp: new Date().toISOString(),
    raw_input_hash: 'relayhash1',
    source_type: 'relay_pull',
    origin_classification: 'external',
    input_classification: 'beap_capsule_present',
    validation_result: 'validated',
    processing_duration_ms: 2,
    pipeline_version: '1.0.0',
    distribution_target: 'message_relay' as any,
    ...overrides,
  }
}

describe('pullFromRelay message_relay', () => {
  let processSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let beapSpy: ReturnType<typeof vi.spyOn>
  let ingestAckSpy: ReturnType<typeof vi.spyOn>
  let peerAckSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    processSpy = vi.spyOn(ingestionPipeline, 'processIncomingInput')
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    // Phase B: message_relay path calls processBeapPackageInline; mock to avoid real pipeline.
    beapSpy = vi.spyOn(beapEmailIngestion, 'processBeapPackageInline').mockResolvedValue({
      outcome: 'inbox',
      rowId: 'inbox-row-1',
    } as any)
    ingestAckSpy = vi.spyOn(coordinationWs, 'publishBeapIngestAckOverCoordinationRelay').mockImplementation(() => {})
    peerAckSpy = vi.spyOn(peerDeliveryAck, 'postPeerDeliveryAckToSender').mockImplementation(() => {})
  })

  afterEach(() => {
    processSpy.mockRestore()
    fetchSpy.mockRestore()
    beapSpy.mockRestore()
    ingestAckSpy.mockRestore()
    peerAckSpy.mockRestore()
  })

  test('validated message_relay calls processBeapPackageInline and ACKs', async () => {
    if (skipIfNoSqlite()) return

    const db = createTestDb()
    upsertP2PConfig(db, {
      relay_mode: 'remote',
      relay_pull_url: 'http://relay.test/pull',
      relay_auth_secret: 'secret',
    })

    const capsuleJson = '{"relay_pkg":true}'
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/pull')) {
        return new Response(
          JSON.stringify({
            capsules: [{ id: 'cap-ack-1', handshake_id: 'ignored-on-wire', capsule_json: capsuleJson }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/ack') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })

    processSpy.mockResolvedValue({
      success: true,
      audit: auditBase(),
      distribution: {
        target: 'message_relay' as any,
        reason: '',
        validated_capsule: {
          capsule: { handshake_id: 'hs-from-validated' },
        } as any,
      },
    })

    await pullFromRelay(db, () => buildTestSession())

    // Phase B change: message_relay capsules are processed via processBeapPackageInline
    // (sealed inbox pipeline) rather than inserted directly into p2p_pending_beap.
    expect(beapSpy).toHaveBeenCalledWith(
      db,
      capsuleJson,
      'hs-from-validated',
      expect.objectContaining({ sourceType: 'p2p_relay' }),
    )

    const ackCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/ack'))
    expect(ackCalls.length).toBe(1)
    const ackBody = JSON.parse((ackCalls[0][1] as RequestInit)?.body as string)
    expect(ackBody.ids).toEqual(['cap-ack-1'])

    expect(ingestAckSpy).toHaveBeenCalledWith({
      relayId: 'cap-ack-1',
      handshakeId: 'hs-from-validated',
      rowId: 'inbox-row-1',
      status: 'ok',
    })
    expect(peerAckSpy).toHaveBeenCalledWith(db, 'hs-from-validated', 'inbox-row-1')
  })
})
