/**
 * Phase-1 item 9 — failure modes, proven with the harness owning the relay
 * lifecycle (start → kill → restart). No mocks; no relay.wrdesk.com.
 *
 *   A. The harness can KILL the relay (POSTs then fail) and RESTART it on the
 *      same port + same sqlite file, with pre-outage state (registry + stored
 *      capsules) surviving the restart and delivery recovering.
 *   B. The real outbound capsule queue HOLDS a capsule across a relay outage
 *      (the row is not lost) and DRAINS on recovery, delivering exactly once
 *      (idempotent — no double insert at the relay).
 *
 * Note on (B): a failed attempt parks the row under the production heal/autodrain
 * state machine (5s+ backoff). To keep the assertion deterministic and decoupled
 * from backoff timing, the test resets the row to 'pending' after restart to stand
 * in for the heal tick, then drains. The drain itself is the real production path.
 *
 * Run under Electron's Node ABI: `pnpm test:native-db <thisFile>`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import { startRelayHarness, type RelayHarness } from './rig/coordinationRelayHarness'
import { migrateHandshakeTables } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { upsertP2PConfig } from '../../p2p/p2pConfig'
import { enqueueOutboundCapsule, processOutboundQueue } from '../outboundQueue'
import { buildInitiateCapsuleWithKeypair, buildContextSyncCapsule } from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'
import type { SSOSession } from '../types'

const ALICE = 'failalice'
const BOB = 'failbob'
const ALICE_TOKEN = `test-${ALICE}-pro`

function session(user: string): SSOSession {
  return buildTestSession({ wrdesk_user_id: user, sub: user, email: `${user}@dev.test` })
}

async function registerHs(relay: RelayHarness, hsId: string, aliceEmail: string, bobEmail: string) {
  return relay.request('POST', '/beap/register-handshake', {
    auth: ALICE_TOKEN,
    contentType: 'application/json',
    body: JSON.stringify({
      handshake_id: hsId,
      initiator_user_id: ALICE,
      acceptor_user_id: BOB,
      initiator_email: aliceEmail,
      acceptor_email: bobEmail,
    }),
  })
}

describe('relay failure modes (harness-owned lifecycle)', () => {
  let relay: RelayHarness

  beforeAll(async () => {
    relay = await startRelayHarness()
  })

  afterAll(async () => {
    if (relay) await relay.dispose()
  })

  beforeEach(() => {
    // No-op if the relay is currently stopped (resetState guards on !current).
    relay.resetState()
  })

  it('A: kill → restart preserves registry + stored capsules and recovers delivery', async () => {
    const alice = session(ALICE)
    const bob = session(BOB)
    const { capsule: initiate, keypair: aliceKeys } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: bob.wrdesk_user_id,
      receiverEmail: bob.email,
      reciprocal_allowed: true,
    })
    const hsId = initiate.handshake_id
    expect((await registerHs(relay, hsId, alice.email, bob.email)).status).toBe(200)

    const cs1 = buildContextSyncCapsule(alice, {
      handshake_id: hsId,
      counterpartyUserId: bob.wrdesk_user_id,
      counterpartyEmail: bob.email,
      last_seq_received: 0,
      last_capsule_hash_received: 'a'.repeat(64),
      context_blocks: [],
      local_public_key: aliceKeys.publicKey,
      local_private_key: aliceKeys.privateKey,
    })
    const before = await relay.request('POST', '/beap/capsule', { auth: ALICE_TOKEN, contentType: 'application/json', body: JSON.stringify(cs1) })
    expect([200, 202]).toContain(before.status)

    // Kill the relay.
    await relay.stop()
    let threw = false
    try {
      await relay.request('POST', '/beap/capsule', { auth: ALICE_TOKEN, contentType: 'application/json', body: JSON.stringify(cs1) })
    } catch {
      threw = true // ECONNREFUSED — relay is genuinely down
    }
    expect(threw).toBe(true)

    // Restart on the same port + same sqlite.
    await relay.restart()

    // Pre-outage state survived: registry row + the stored capsule are still there.
    const reg = relay.db().prepare('SELECT handshake_id FROM coordination_handshake_registry WHERE handshake_id=?').get(hsId)
    expect(reg?.handshake_id).toBe(hsId)
    const storedCount = relay.db().prepare('SELECT COUNT(*) AS c FROM coordination_capsules WHERE handshake_id=?').get(hsId) as { c: number }
    expect(storedCount.c).toBeGreaterThanOrEqual(1)

    // Delivery recovers post-restart.
    const after = await relay.request('POST', '/beap/capsule', { auth: ALICE_TOKEN, contentType: 'application/json', body: JSON.stringify(cs1) })
    expect([200, 202]).toContain(after.status)
  })

  it('B: outbound queue holds across an outage and drains exactly once on recovery', async () => {
    const alice = session(ALICE)
    const bob = session(BOB)
    const clientDb = new Database(':memory:')
    clientDb.pragma('foreign_keys = ON')
    migrateHandshakeTables(clientDb)
    migrateIngestionTables(clientDb)
    upsertP2PConfig(clientDb, {
      enabled: true,
      coordination_enabled: true,
      relay_mode: 'local',
      coordination_url: relay.baseUrl(),
      coordination_ws_url: relay.wsUrl(),
    })

    const { capsule: initiate, keypair: aliceKeys } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: bob.wrdesk_user_id,
      receiverEmail: bob.email,
      reciprocal_allowed: true,
    })
    const hsId = initiate.handshake_id
    expect((await registerHs(relay, hsId, alice.email, bob.email)).status).toBe(200)

    const cs = buildContextSyncCapsule(alice, {
      handshake_id: hsId,
      counterpartyUserId: bob.wrdesk_user_id,
      counterpartyEmail: bob.email,
      last_seq_received: 0,
      last_capsule_hash_received: 'b'.repeat(64),
      context_blocks: [],
      local_public_key: aliceKeys.publicKey,
      local_private_key: aliceKeys.privateKey,
    })
    const target = `${relay.baseUrl()}/beap/capsule`
    expect(enqueueOutboundCapsule(clientDb, hsId, target, cs).enqueued).toBe(true)

    // Outage: relay down → drain attempt fails, but the row is HELD (not lost).
    await relay.stop()
    const downResult = await processOutboundQueue(clientDb, async () => ALICE_TOKEN)
    expect(downResult.delivered).toBe(false)
    const heldRows = clientDb.prepare('SELECT COUNT(*) AS c FROM outbound_capsule_queue WHERE handshake_id=?').get(hsId) as { c: number }
    expect(heldRows.c).toBeGreaterThanOrEqual(1) // still in the queue table

    // Recovery: relay back on the same port + db; the heal tick re-arms the row.
    await relay.restart()
    clientDb
      .prepare("UPDATE outbound_capsule_queue SET status='pending', retry_count=0, last_attempt_at=NULL, error=NULL, failure_class=NULL WHERE handshake_id=?")
      .run(hsId)

    const drain = await processOutboundQueue(clientDb, async () => ALICE_TOKEN)
    // 200 (live) or 202 (recipient offline) are both transport success → delivered/queued.
    expect(drain.delivered || drain.queued).toBe(true)

    // Exactly once at the relay: a redundant drain must not produce a second row.
    const afterFirst = relay.db().prepare('SELECT COUNT(*) AS c FROM coordination_capsules WHERE handshake_id=?').get(hsId) as { c: number }
    expect(afterFirst.c).toBe(1)
    await processOutboundQueue(clientDb, async () => ALICE_TOKEN)
    const afterSecond = relay.db().prepare('SELECT COUNT(*) AS c FROM coordination_capsules WHERE handshake_id=?').get(hsId) as { c: number }
    expect(afterSecond.c).toBe(1)

    clientDb.close()
  })
})
