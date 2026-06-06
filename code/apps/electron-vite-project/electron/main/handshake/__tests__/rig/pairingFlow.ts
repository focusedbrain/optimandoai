/**
 * TEST-ONLY rig helper: drive a NORMAL cross-principal handshake to ACTIVE on two
 * separate sqlite DBs (two simulated instances) by carrying accept + bilateral
 * context_sync over a REAL local coordination relay. Extracted from
 * `pairingActivation.rig.test.ts` so revoke / re-pair / transport suites can reuse
 * the exact proven sequence instead of duplicating it.
 *
 * Not reachable from the production bundle — lives under __tests__/.
 */

import type { RelayHarness } from './coordinationRelayHarness'
import {
  updateHandshakeSigningKeys,
  updateHandshakeCounterpartyKey,
  updateHandshakeContextSyncEnqueued,
} from '../../db'
import { handleIngestionRPC } from '../../../ingestion/ipc'
import {
  buildInitiateCapsuleWithKeypair,
  buildAcceptCapsule,
  buildContextSyncCapsule,
} from '../../capsuleBuilder'
import { HandshakeState } from '../../types'
import type { SSOSession } from '../../types'

export interface RigKeypair {
  publicKey: string
  privateKey: string
}

export interface PairToActiveArgs {
  relay: RelayHarness
  alice: SSOSession
  bob: SSOSession
  aliceToken: string
  bobToken: string
  aliceDb: any
  bobDb: any
}

export interface PairToActiveResult {
  hsId: string
  aliceKeys: RigKeypair
  bobKeys: RigKeypair
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

async function relayPost(relay: RelayHarness, capsule: any, senderToken: string): Promise<number> {
  const res = await relay.request('POST', '/beap/capsule', {
    auth: senderToken,
    contentType: 'application/json',
    body: JSON.stringify(capsule),
  })
  if (res.status >= 400) console.log('[RIG] relayPost', capsule.capsule_type, res.status, res.body.slice(0, 400))
  return res.status
}

function pullFromRelayStore(relay: RelayHarness, handshakeId: string): string | undefined {
  const row = relay
    .db()
    .prepare('SELECT capsule_json FROM coordination_capsules WHERE handshake_id = ? ORDER BY received_at DESC LIMIT 1')
    .get(handshakeId) as { capsule_json: string } | undefined
  return row?.capsule_json
}

/**
 * Run initiate → accept → bilateral context_sync, carrying post-initiate capsules
 * over the real relay, until BOTH DBs hold an ACTIVE record. Throws if either side
 * fails to reach ACTIVE. Caller must have mocked the email transport (the ingest
 * pipeline may attempt out-of-band sends).
 */
export async function driveCrossPrincipalToActive(args: PairToActiveArgs): Promise<PairToActiveResult> {
  const { relay, alice, bob, aliceToken, bobToken, aliceDb, bobDb } = args

  const { capsule: initiate, keypair: aliceKeys } = buildInitiateCapsuleWithKeypair(alice, {
    receiverUserId: bob.wrdesk_user_id,
    receiverEmail: bob.email,
    reciprocal_allowed: true,
  })
  const hsId = initiate.handshake_id

  const reg = await relay.request('POST', '/beap/register-handshake', {
    auth: aliceToken,
    contentType: 'application/json',
    body: JSON.stringify({
      handshake_id: hsId,
      initiator_user_id: alice.wrdesk_user_id,
      acceptor_user_id: bob.wrdesk_user_id,
      initiator_email: alice.email,
      acceptor_email: bob.email,
    }),
  })
  if (reg.status !== 200) throw new Error(`register-handshake failed: ${reg.status} ${reg.body}`)

  await ingest(JSON.stringify(initiate), bobDb, bob)
  await ingest(JSON.stringify(initiate), aliceDb, bob)

  const { capsule: accept, keypair: bobKeys } = buildAcceptCapsule(bob, {
    handshake_id: hsId,
    initiatorUserId: alice.wrdesk_user_id,
    initiatorEmail: alice.email,
    sharing_mode: 'reciprocal',
    initiator_capsule_hash: initiate.capsule_hash,
  })
  await relayPost(relay, accept, bobToken)
  const acceptFromRelay = pullFromRelayStore(relay, hsId)
  if (!acceptFromRelay) throw new Error('accept not carried by relay')
  await ingest(acceptFromRelay, aliceDb, alice)
  await ingest(JSON.stringify(accept), bobDb, alice)

  updateHandshakeSigningKeys(aliceDb, hsId, { local_public_key: aliceKeys.publicKey, local_private_key: aliceKeys.privateKey })
  updateHandshakeSigningKeys(bobDb, hsId, { local_public_key: bobKeys.publicKey, local_private_key: bobKeys.privateKey })
  updateHandshakeCounterpartyKey(aliceDb, hsId, bobKeys.publicKey)
  updateHandshakeCounterpartyKey(bobDb, hsId, aliceKeys.publicKey)

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

  updateHandshakeContextSyncEnqueued(bobDb, hsId, 1, bobCs.capsule_hash)
  await relayPost(relay, aliceCs, aliceToken)
  await ingest(pullFromRelayStore(relay, hsId)!, bobDb, bob)

  updateHandshakeContextSyncEnqueued(aliceDb, hsId, 1, aliceCs.capsule_hash)
  await relayPost(relay, bobCs, bobToken)
  await ingest(pullFromRelayStore(relay, hsId)!, aliceDb, alice)

  const aliceState = aliceDb.prepare('SELECT state FROM handshakes WHERE handshake_id=?').get(hsId)?.state
  const bobState = bobDb.prepare('SELECT state FROM handshakes WHERE handshake_id=?').get(hsId)?.state
  if (aliceState !== HandshakeState.ACTIVE || bobState !== HandshakeState.ACTIVE) {
    throw new Error(`did not reach ACTIVE on both sides: alice=${aliceState} bob=${bobState}`)
  }

  return { hsId, aliceKeys, bobKeys }
}
