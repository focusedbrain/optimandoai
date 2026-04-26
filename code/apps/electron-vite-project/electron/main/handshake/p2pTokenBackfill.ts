/**
 * One-time style backfill: ACTIVE handshakes that predate `local_p2p_auth_token` mint a local
 * Bearer and enqueue a refresh capsule so the peer can persist our token as `counterparty_p2p_token`.
 */

import { randomUUID } from 'crypto'
import {
  getHandshakeRecord,
  listHandshakeRecords,
  updateHandshakeRecord,
} from './db'
import { buildRefreshCapsule } from './capsuleBuilder'
import { enqueueOutboundCapsule, processOutboundQueue } from './outboundQueue'
import { internalRelayCapsuleWireOptsFromRecord } from './internalCoordinationWire'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { getP2PConfig, getEffectiveRelayEndpoint } from '../p2p/p2pConfig'
import type { HandshakeRecord, SSOSession } from './types'
import { HandshakeState } from './types'

function counterpartyUserId(record: HandshakeRecord, session: SSOSession): string {
  return record.initiator.wrdesk_user_id === session.wrdesk_user_id
    ? record.acceptor!.wrdesk_user_id
    : record.initiator.wrdesk_user_id
}

function counterpartyEmail(record: HandshakeRecord, session: SSOSession): string {
  if (record.initiator.wrdesk_user_id === session.wrdesk_user_id) {
    return record.acceptor?.email ?? ''
  }
  return record.initiator.email
}

/**
 * Call when the vault DB and SSO session are available (e.g. `tryP2PStartup`). Idempotent per row
 * after `local_p2p_auth_token` is set.
 */
export function runActiveHandshakeLocalP2pTokenBackfill(
  db: any,
  session: SSOSession | null | undefined,
  getOidcToken: () => Promise<string | null>,
): void {
  if (!db || !session) return
  let rows: HandshakeRecord[]
  try {
    rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE })
  } catch {
    return
  }
  for (const row of rows) {
    if (row.local_p2p_auth_token?.trim()) continue
    const hid = row.handshake_id
    let rec = getHandshakeRecord(db, hid)
    if (!rec || rec.state !== HandshakeState.ACTIVE) continue
    if (rec.local_p2p_auth_token?.trim()) continue
    if (!rec.acceptor) continue

    const token = randomUUID()
    rec = { ...rec, local_p2p_auth_token: token }
    try {
      updateHandshakeRecord(db, rec)
    } catch (e: any) {
      console.warn('[HANDSHAKE_TOKEN_BACKFILL] persist_failed', hid, e?.message ?? e)
      continue
    }

    console.log(`[HANDSHAKE_TOKEN_BACKFILL] handshake=${hid} issued_local_token=true`)

    const localPub = rec.local_public_key ?? ''
    const localPriv = rec.local_private_key ?? ''
    if (!localPub || !localPriv) continue

    const counterpartyUser = counterpartyUserId(rec, session)
    const cpEmail = counterpartyEmail(rec, session)
    if (!counterpartyUser || !cpEmail) continue

    let localDev: string | undefined
    try {
      localDev = getInstanceId()?.trim() || undefined
    } catch {
      localDev = undefined
    }
    const internalWire = internalRelayCapsuleWireOptsFromRecord(rec, localDev)
    const p2pCfg = getP2PConfig(db)
    if (rec.handshake_type === 'internal' && p2pCfg.use_coordination && !internalWire) {
      continue
    }

    try {
      const capsule = buildRefreshCapsule(session, {
        handshake_id: hid,
        counterpartyUserId: counterpartyUser,
        counterpartyEmail: cpEmail,
        last_seq_sent: rec.last_seq_sent ?? 0,
        last_seq_received: rec.last_seq_received,
        last_capsule_hash_received: rec.last_capsule_hash_received,
        context_block_proofs: [],
        local_public_key: localPub,
        local_private_key: localPriv,
        p2p_auth_token: token,
        ...(internalWire ?? {}),
      })
      let target = rec.p2p_endpoint?.trim() || ''
      if (!target) {
        target = getEffectiveRelayEndpoint(p2pCfg, null) ?? ''
      }
      if (!target) continue
      const enq = enqueueOutboundCapsule(db, hid, target, capsule)
      if (!enq.enqueued) {
        console.warn('[HANDSHAKE_TOKEN_BACKFILL] enqueue_skipped', hid, enq.message ?? enq.invariant)
      }
    } catch (e: any) {
      console.warn('[HANDSHAKE_TOKEN_BACKFILL] enqueue_failed', hid, e?.message ?? e)
    }
  }

  void processOutboundQueue(db, getOidcToken).catch(() => {})
}
