/**
 * Phase-1 item 8 — revoke → delivery refused → re-pair restores, proven with TWO
 * real handshake instances (separate sqlite DBs) over a REAL local coordination
 * relay (no mocks, no relay.wrdesk.com).
 *
 * What this proves end-to-end:
 *   1. A NORMAL cross-principal handshake reaches ACTIVE on both DBs → the live
 *      send gate (`diagnoseHandshakeInactive`) reports ACTIVE (delivery allowed).
 *   2. The acceptor revokes (real `revokeHandshake`) → his record is REVOKED; a
 *      signed revoke capsule carried over the relay flips the initiator to REVOKED.
 *   3. The send gate now REFUSES on both sides (state REVOKED, not ACTIVE).
 *   4. After deleting the terminal REVOKED record and re-pairing, a NEW handshake
 *      reaches ACTIVE and the send gate allows delivery again.
 *
 * Run under Electron's Node ABI: `pnpm test:native-db <thisFile>`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

import { startRelayHarness, type RelayHarness } from './rig/coordinationRelayHarness'
import { driveCrossPrincipalToActive } from './rig/pairingFlow'
import { migrateHandshakeTables, deleteHandshakeRecord } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildRevokeCapsule } from '../capsuleBuilder'
import { revokeHandshake } from '../revocation'
import { diagnoseHandshakeInactive } from '../enforcement'
import { buildTestSession } from '../sessionFactory'
import { HandshakeState } from '../types'
import type { SSOSession } from '../types'

const ALICE = 'revalice'
const BOB = 'revbob'
const ALICE_TOKEN = `test-${ALICE}-pro`
const BOB_TOKEN = `test-${BOB}-pro`

function session(user: string): SSOSession {
  return buildTestSession({ wrdesk_user_id: user, sub: user, email: `${user}@dev.test` })
}

function makeDb(): any {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

describe('revoke → refused → re-pair (two real instances, real relay)', () => {
  let relay: RelayHarness

  beforeAll(async () => {
    relay = await startRelayHarness()
  })

  afterAll(async () => {
    if (relay) await relay.dispose()
  })

  beforeEach(() => {
    relay.resetState()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'm1' }))
  })

  function ingest(capsuleJson: string, db: any, asSession: SSOSession) {
    return handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: capsuleJson, mime_type: 'application/vnd.beap+json' },
        sourceType: 'email',
        transportMeta: { channel_id: 'relay:test', mime_type: 'application/vnd.beap+json' },
      },
      db,
      asSession,
    )
  }

  async function relayPost(capsule: any, senderToken: string): Promise<number> {
    const res = await relay.request('POST', '/beap/capsule', { auth: senderToken, contentType: 'application/json', body: JSON.stringify(capsule) })
    if (res.status >= 400) console.log('[RIG] relayPost', capsule.capsule_type, res.status, res.body.slice(0, 300))
    return res.status
  }

  function pullFromRelayStore(handshakeId: string): string | undefined {
    const row = relay
      .db()
      .prepare('SELECT capsule_json FROM coordination_capsules WHERE handshake_id = ? ORDER BY received_at DESC LIMIT 1')
      .get(handshakeId) as { capsule_json: string } | undefined
    return row?.capsule_json
  }

  it('refuses delivery after revoke and restores it after re-pair', async () => {
    const alice = session(ALICE)
    const bob = session(BOB)
    const aliceDb = makeDb()
    const bobDb = makeDb()
    const now = new Date()

    // 1. Pair to ACTIVE → send gate allows on both sides.
    const { hsId, bobKeys } = await driveCrossPrincipalToActive({
      relay, alice, bob, aliceToken: ALICE_TOKEN, bobToken: BOB_TOKEN, aliceDb, bobDb,
    })
    expect(diagnoseHandshakeInactive(aliceDb, hsId, now).active).toBe(true)
    expect(diagnoseHandshakeInactive(bobDb, hsId, now).active).toBe(true)

    // 2a. Build Bob's signed revoke capsule from his current chain position, then
    //     carry it over the real relay to Alice, who ingests it → REVOKED.
    const bobRow = bobDb
      .prepare('SELECT last_seq_sent, last_seq_received, last_capsule_hash_received FROM handshakes WHERE handshake_id=?')
      .get(hsId) as { last_seq_sent: number; last_seq_received: number; last_capsule_hash_received: string }
    const revokeCap = buildRevokeCapsule(bob, {
      handshake_id: hsId,
      counterpartyUserId: alice.wrdesk_user_id,
      counterpartyEmail: alice.email,
      last_seq_sent: bobRow.last_seq_sent ?? 1,
      last_seq_received: bobRow.last_seq_received ?? 1,
      last_capsule_hash_received: bobRow.last_capsule_hash_received,
      local_public_key: bobKeys.publicKey,
      local_private_key: bobKeys.privateKey,
    })

    // 2b. Bob revokes locally via the real production path.
    await revokeHandshake(bobDb, hsId, 'local-user', bob.wrdesk_user_id, bob)
    const bobDiag = diagnoseHandshakeInactive(bobDb, hsId, now)
    expect(bobDiag.active).toBe(false)
    expect((bobDiag as { reason: string }).reason).toContain('REVOKED')

    expect([200, 202]).toContain(await relayPost(revokeCap, BOB_TOKEN))
    const aliceRevoke = await ingest(pullFromRelayStore(hsId)!, aliceDb, alice)
    expect(aliceRevoke.success).toBe(true)
    expect(aliceDb.prepare('SELECT state FROM handshakes WHERE handshake_id=?').get(hsId)?.state).toBe(HandshakeState.REVOKED)

    // 3. Delivery refused on both sides.
    const aliceDiag = diagnoseHandshakeInactive(aliceDb, hsId, now)
    expect(aliceDiag.active).toBe(false)
    expect((aliceDiag as { reason: string }).reason).toContain('REVOKED')

    // 4. Re-pair: delete the terminal REVOKED record on both sides, then run a fresh
    //    pairing for the SAME two parties → a NEW handshake reaches ACTIVE → allowed.
    expect(deleteHandshakeRecord(aliceDb, hsId).success).toBe(true)
    expect(deleteHandshakeRecord(bobDb, hsId).success).toBe(true)

    const repair = await driveCrossPrincipalToActive({
      relay, alice, bob, aliceToken: ALICE_TOKEN, bobToken: BOB_TOKEN, aliceDb, bobDb,
    })
    expect(repair.hsId).not.toBe(hsId)
    expect(diagnoseHandshakeInactive(aliceDb, repair.hsId, now).active).toBe(true)
    expect(diagnoseHandshakeInactive(bobDb, repair.hsId, now).active).toBe(true)
  })
})
