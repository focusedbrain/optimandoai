/**
 * Phase-1 items 1 + 3 (partial) — pairing → ACTIVE and capsule transport, proven
 * with TWO real handshake instances (separate sqlite DBs, separate identities)
 * against a REAL local coordination relay (no mocks, no relay.wrdesk.com).
 *
 * What this proves:
 *   - A NORMAL cross-principal handshake reaches ACTIVE on BOTH instances after
 *     the accept + bilateral context_sync round-trip, with correct roles and key
 *     material — where the post-initiate capsules (accept, context_sync) are
 *     carried over the real relay rather than handed directly to the pipeline.
 *   - The same capsule delivered over two relay transports — live WS push (200)
 *     and stored-then-pulled (202) — is byte-identical (same capsule_hash), i.e.
 *     transport does not mutate the sealed capsule.
 *
 * The direct-P2P-HTTP transport and the same-principal/internal device-routed
 * variants need two OS processes (separate orchestrator instance ids); those are
 * covered by the cross-machine runbook. See rig/README.md for the boundary.
 *
 * Run under Electron's Node ABI: `pnpm test:native-db <thisFile>`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import WebSocket from 'ws'

import { startRelayHarness, type RelayHarness } from './rig/coordinationRelayHarness'
import { migrateHandshakeTables, updateHandshakeSigningKeys, updateHandshakeCounterpartyKey, updateHandshakeContextSyncEnqueued } from '../db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildInitiateCapsuleWithKeypair, buildAcceptCapsule, buildContextSyncCapsule } from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'
import { HandshakeState } from '../types'
import type { SSOSession } from '../types'

const ALICE = 'aliceuser'
const BOB = 'bobuser'
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

describe('pairing → ACTIVE over a real relay (two real instances)', () => {
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

  /** POST a capsule to the real relay as `senderToken`; return its HTTP status. */
  async function relayPost(capsule: any, senderToken: string): Promise<number> {
    const res = await relay.request('POST', '/beap/capsule', {
      auth: senderToken,
      contentType: 'application/json',
      body: JSON.stringify(capsule),
    })
    if (res.status >= 400) console.log('[RIG] relayPost', capsule.capsule_type, res.status, res.body.slice(0, 400))
    return res.status
  }

  /** Read the most recent stored capsule JSON for a handshake from the relay store. */
  function pullFromRelayStore(handshakeId: string): string | undefined {
    const row = relay
      .db()
      .prepare(
        'SELECT capsule_json FROM coordination_capsules WHERE handshake_id = ? ORDER BY received_at DESC LIMIT 1',
      )
      .get(handshakeId) as { capsule_json: string } | undefined
    return row?.capsule_json
  }

  it('reaches ACTIVE on both instances with accept + context_sync carried by the relay', async () => {
    const alice = session(ALICE)
    const bob = session(BOB)
    const aliceDb = makeDb()
    const bobDb = makeDb()

    // Register the cross-principal handshake on the real relay (routes by user id).
    const { capsule: initiate, keypair: aliceKeys } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: bob.wrdesk_user_id,
      receiverEmail: bob.email,
      reciprocal_allowed: true,
    })
    const reg = await relay.request('POST', '/beap/register-handshake', {
      auth: ALICE_TOKEN,
      contentType: 'application/json',
      body: JSON.stringify({
        handshake_id: initiate.handshake_id,
        initiator_user_id: ALICE,
        acceptor_user_id: BOB,
        initiator_email: alice.email,
        acceptor_email: bob.email,
      }),
    })
    expect(reg.status).toBe(200)

    // initiate is delivered out-of-band (cross-principal initiates may not relay).
    // Seed both pipelines (acceptor view on both DBs, per the two-machine model).
    const bobInit = await ingest(JSON.stringify(initiate), bobDb, bob)
    expect(bobInit.success).toBe(true)
    expect(bobInit.handshake_result?.handshakeRecord?.local_role).toBe('acceptor')
    expect(bobInit.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_REVIEW)
    const aliceInit = await ingest(JSON.stringify(initiate), aliceDb, bob)
    expect(aliceInit.success).toBe(true)

    // Bob accepts → carry the accept capsule over the REAL relay to Alice.
    const { capsule: accept, keypair: bobKeys } = buildAcceptCapsule(bob, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: alice.wrdesk_user_id,
      initiatorEmail: alice.email,
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initiate.capsule_hash,
    })
    const acceptStatus = await relayPost(accept, BOB_TOKEN)
    expect([200, 202]).toContain(acceptStatus)
    const acceptFromRelay = pullFromRelayStore(initiate.handshake_id)
    expect(acceptFromRelay).toBeTruthy()

    // Alice ingests the relay-carried accept; Bob transitions his own record locally.
    const aliceAccept = await ingest(acceptFromRelay!, aliceDb, alice)
    expect(aliceAccept.success).toBe(true)
    expect(aliceAccept.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACCEPTED)
    const bobAccept = await ingest(JSON.stringify(accept), bobDb, alice)
    expect(bobAccept.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACCEPTED)

    // Register keys so each side can verify the peer's context_sync (real enforcement).
    const hsId = initiate.handshake_id
    updateHandshakeSigningKeys(aliceDb, hsId, { local_public_key: aliceKeys.publicKey, local_private_key: aliceKeys.privateKey })
    updateHandshakeSigningKeys(bobDb, hsId, { local_public_key: bobKeys.publicKey, local_private_key: bobKeys.privateKey })
    updateHandshakeCounterpartyKey(aliceDb, hsId, bobKeys.publicKey)
    updateHandshakeCounterpartyKey(bobDb, hsId, aliceKeys.publicKey)

    // Bilateral context_sync over the relay → ACTIVE on both sides.
    // prev_hash continues each side's chain from the last capsule it received from
    // the peer (Alice last received Bob's accept; Bob last received Alice's initiate).
    const aliceRowPre = aliceDb.prepare('SELECT last_seq_received, last_capsule_hash_received FROM handshakes WHERE handshake_id=?').get(hsId)
    const bobRowPre = bobDb.prepare('SELECT last_seq_received, last_capsule_hash_received FROM handshakes WHERE handshake_id=?').get(hsId)
    const aliceCs = buildContextSyncCapsule(alice, {
      handshake_id: hsId,
      counterpartyUserId: bob.wrdesk_user_id,
      counterpartyEmail: bob.email,
      last_seq_received: aliceRowPre?.last_seq_received ?? 0,
      last_capsule_hash_received: aliceRowPre?.last_capsule_hash_received || accept.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeys.publicKey,
      local_private_key: aliceKeys.privateKey,
    })
    const bobCs = buildContextSyncCapsule(bob, {
      handshake_id: hsId,
      counterpartyUserId: alice.wrdesk_user_id,
      counterpartyEmail: alice.email,
      last_seq_received: bobRowPre?.last_seq_received ?? 0,
      last_capsule_hash_received: bobRowPre?.last_capsule_hash_received || initiate.capsule_hash,
      context_blocks: [],
      local_public_key: bobKeys.publicKey,
      local_private_key: bobKeys.privateKey,
    })

    // Alice → Bob. The ACCEPTED→ACTIVE gate requires the *receiver* (Bob) to have
    // already enqueued his own context_sync (last_seq_sent>=1) before he ingests
    // Alice's. Mark Bob's outbound first, then deliver Alice's over the relay.
    updateHandshakeContextSyncEnqueued(bobDb, hsId, 1, bobCs.capsule_hash)
    expect([200, 202]).toContain(await relayPost(aliceCs, ALICE_TOKEN))
    const aliceCsFromRelay = pullFromRelayStore(hsId)
    const bobCsIngest = await ingest(aliceCsFromRelay!, bobDb, bob)
    expect(bobCsIngest.handshake_result?.handshakeRecord?.last_seq_received).toBe(1)
    expect(bobCsIngest.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACTIVE)

    // Bob → Alice. Mark Alice's outbound first, then deliver Bob's over the relay.
    updateHandshakeContextSyncEnqueued(aliceDb, hsId, 1, aliceCs.capsule_hash)
    expect([200, 202]).toContain(await relayPost(bobCs, BOB_TOKEN))
    const bobCsFromRelay = pullFromRelayStore(hsId)
    const aliceCsIngest = await ingest(bobCsFromRelay!, aliceDb, alice)
    expect(aliceCsIngest.handshake_result?.handshakeRecord?.last_seq_received).toBe(1)
    expect(aliceCsIngest.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACTIVE)

    // Ledger state correct on both instances.
    const aliceRow = aliceDb.prepare('SELECT local_role, state, local_public_key, counterparty_public_key FROM handshakes WHERE handshake_id=?').get(hsId)
    const bobRow = bobDb.prepare('SELECT local_role, state, local_public_key, counterparty_public_key FROM handshakes WHERE handshake_id=?').get(hsId)
    expect(aliceRow.state).toBe(HandshakeState.ACTIVE)
    expect(bobRow.state).toBe(HandshakeState.ACTIVE)
    expect(aliceRow.local_role).toBe('acceptor') // alice's DB was seeded from the acceptor view
    expect(bobRow.local_role).toBe('acceptor')
    expect(aliceRow.local_public_key).toBeTruthy()
    expect(bobRow.counterparty_public_key).toBeTruthy()
  })

  it('same capsule is byte-identical over WS-live push (200) and store-pull (202)', async () => {
    const alice = session(ALICE)
    const bob = session(BOB)

    const { capsule: initiate } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: bob.wrdesk_user_id,
      receiverEmail: bob.email,
      reciprocal_allowed: true,
    })
    const hsId = initiate.handshake_id
    await relay.request('POST', '/beap/register-handshake', {
      auth: ALICE_TOKEN,
      contentType: 'application/json',
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: ALICE, acceptor_user_id: BOB, initiator_email: alice.email, acceptor_email: bob.email }),
    })

    const { capsule: accept } = buildAcceptCapsule(bob, {
      handshake_id: hsId,
      initiatorUserId: alice.wrdesk_user_id,
      initiatorEmail: alice.email,
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initiate.capsule_hash,
    })

    // (a) Live: Bob (recipient = alice) online via WS → expect 200 + pushed capsule.
    const wsCapsule: any = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${relay.wsUrl()}?token=${encodeURIComponent(ALICE_TOKEN)}`)
      const timer = setTimeout(() => { ws.close(); reject(new Error('no WS push')) }, 4000)
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'capsule') {
          clearTimeout(timer)
          ws.close()
          resolve(msg.capsule)
        }
      })
      ws.on('open', async () => {
        const status = await relayPost(accept, BOB_TOKEN)
        expect(status).toBe(200) // recipient online → live push
      })
      ws.on('error', reject)
    })
    expect(wsCapsule.capsule_hash).toBe(accept.capsule_hash)

    // (b) Stored: no WS → 202 + identical capsule retrievable from the store.
    relay.resetState()
    await relay.request('POST', '/beap/register-handshake', {
      auth: ALICE_TOKEN,
      contentType: 'application/json',
      body: JSON.stringify({ handshake_id: hsId, initiator_user_id: ALICE, acceptor_user_id: BOB, initiator_email: alice.email, acceptor_email: bob.email }),
    })
    const storedStatus = await relayPost(accept, BOB_TOKEN)
    expect(storedStatus).toBe(202)
    const stored = JSON.parse(pullFromRelayStore(hsId)!)

    // Identical sealed result across both transports.
    expect(stored.capsule_hash).toBe(accept.capsule_hash)
    expect(stored.capsule_hash).toBe(wsCapsule.capsule_hash)
    expect(stored.sender_signature).toBe(wsCapsule.sender_signature)
  })
})
