/**
 * Relay Pull — Host fetches capsules from remote relay and processes them.
 *
 * Runs on interval. Only active when relay_mode === 'remote'.
 * Feeds pulled capsules through full local ingestion pipeline (double validation).
 */

import { getP2PConfig } from './p2pConfig'
import { processIncomingInput } from '../ingestion/ingestionPipeline'
import { processHandshakeCapsule } from '../handshake/enforcement'
import { canonicalRebuild } from '../handshake/canonicalRebuild'
import { buildDefaultReceiverPolicy } from '../handshake/types'
import { migrateHandshakeTables, insertPendingP2PBeap } from '../handshake/db'
import {
  insertIngestionAuditRecord,
  insertQuarantineRecord,
} from '../ingestion/persistenceDb'
import { enqueueOutboundCapsule } from '../handshake/outboundQueue'
import { getContextStoreByHandshake } from '../handshake/db'
import { buildContextSyncCapsuleWithContent } from '../handshake/capsuleBuilder'
import { internalRelayCapsuleWireOptsFromRecord } from '../handshake/internalCoordinationWire'
import type { ContextBlockForCommitment } from '../handshake/contextCommitment'
import type { SSOSession } from '../handshake/types'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { notifyBeapRecipientPending } from './beapRecipientNotify'
import {
  setP2PHealthRelayPullSuccess,
  setP2PHealthRelayPullFailure,
} from './p2pHealth'

const migratedDbs = new WeakSet<object>()

function ensureHandshakeMigration(db: any): void {
  if (!db || migratedDbs.has(db)) return
  migratedDbs.add(db)
  try {
    migrateHandshakeTables(db)
  } catch (err: any) {
    console.warn('[Relay] Handshake migration warning:', err?.message)
  }
}

export async function pullFromRelay(
  db: any,
  getSsoSession: () => SSOSession | undefined,
): Promise<void> {
  if (!db) return

  const config = getP2PConfig(db)
  if (config.relay_mode === 'disabled' || config.relay_mode === 'local') {
    return
  }

  const pullUrl = config.relay_pull_url?.trim()
  const authSecret = config.relay_auth_secret?.trim()
  if (!pullUrl || !authSecret) {
    return
  }

  const ackUrl = pullUrl.replace(/\/pull\/?$/, '/ack')
  if (ackUrl === pullUrl) {
    console.warn('[Relay] relay_pull_url must end with /pull')
    return
  }

  try {
    const res = await fetch(pullUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authSecret}` },
    })

    if (res.status === 401) {
      setP2PHealthRelayPullFailure('Relay auth failed — check relay_auth_secret')
      console.error('[Relay] Auth failed (401) — check relay_auth_secret')
      return
    }

    if (!res.ok) {
      setP2PHealthRelayPullFailure(`Relay unreachable (${res.status})`)
      console.warn('[Relay] Pull failed:', res.status, res.statusText)
      return
    }

    let data: { capsules?: Array<{ id: string; handshake_id: string; capsule_json: string; received_at?: string }> }
    try {
      data = (await res.json()) as typeof data
    } catch {
      setP2PHealthRelayPullFailure('Relay response parse error')
      console.error('[Relay] Failed to parse pull response')
      return
    }

    const capsules = data?.capsules ?? []
    if (capsules.length === 0) {
      setP2PHealthRelayPullSuccess(0, 0, 0)
      return
    }

    ensureHandshakeMigration(db)
    const ssoSession = getSsoSession()
    if (!ssoSession) {
      console.warn('[Relay] No SSO session — skipping capsule processing')
      await sendAck(ackUrl, authSecret, capsules.map((c) => c.id))
      setP2PHealthRelayPullSuccess(capsules.length, 0, capsules.length)
      return
    }

    const receiverPolicy = buildDefaultReceiverPolicy()
    const idsToAck: string[] = []
    let accepted = 0
    let rejected = 0

    for (const cap of capsules) {
      const rawInput = {
        body: cap.capsule_json,
        mime_type: 'application/vnd.beap+json' as const,
        headers: { 'content-type': 'application/vnd.beap+json' },
      }

      const result = await processIncomingInput(rawInput, 'relay_pull', {
        channel_id: 'relay_pull',
        mime_type: 'application/vnd.beap+json',
      })

      if (db) {
        try {
          insertIngestionAuditRecord(db, result.audit)
        } catch { /* non-fatal */ }
      }

      if (!result.success) {
        if (db) {
          try {
            insertQuarantineRecord(db, {
              raw_input_hash: result.audit.raw_input_hash,
              source_type: result.audit.source_type,
              origin_classification: result.audit.origin_classification,
              input_classification: result.audit.input_classification,
              validation_reason_code: result.validation_reason_code ?? 'INTERNAL_VALIDATION_ERROR',
              validation_details: result.reason,
              provenance_json: JSON.stringify(result.audit),
            })
          } catch { /* dedup */ }
        }
        console.warn('[Relay] Capsule rejected:', result.reason)
        rejected++
        idsToAck.push(cap.id)
        continue
      }

      const { distribution } = result
      if (distribution.target === 'message_relay') {
        const msgCapsule = distribution.validated_capsule!.capsule as Record<string, unknown>
        const handshakeId =
          (msgCapsule?.handshake_id as string)?.trim() ||
          (msgCapsule?.header && typeof msgCapsule.header === 'object'
            ? ((msgCapsule.header as Record<string, unknown>)?.receiver_binding as Record<string, unknown>)?.handshake_id as string
            : undefined)?.trim() ||
          '__relay_message__'
        const capsuleJson = cap.capsule_json
        try {
          insertPendingP2PBeap(db, handshakeId, capsuleJson)
          console.log('[P2P-RECV] BEAP message inserted into pending table (relay pull)', handshakeId)
          notifyBeapRecipientPending(handshakeId)
          accepted++
          idsToAck.push(cap.id)
        } catch {
          rejected++
        }
        continue
      }
      if (distribution.target !== 'handshake_pipeline') {
        idsToAck.push(cap.id)
        rejected++
        continue
      }

      try {
        const rebuildResult = canonicalRebuild(distribution.validated_capsule.capsule)
        if (!rebuildResult.ok) {
          console.warn('[Relay] Canonical rebuild rejected:', rebuildResult.reason)
          rejected++
          idsToAck.push(cap.id)
          continue
        }

        const canonicalValidated = {
          ...distribution.validated_capsule,
          capsule: rebuildResult.capsule as any,
        }

        const handshakeResult = processHandshakeCapsule(
          db,
          canonicalValidated,
          receiverPolicy,
          ssoSession,
        )

        if (handshakeResult.success) {
          accepted++
          const capObj = rebuildResult.capsule as unknown as Record<string, unknown>
          if (capObj?.capsule_type === 'context_sync' && capObj?.seq === 1 && handshakeResult.handshakeRecord) {
            const record = handshakeResult.handshakeRecord
            const targetEndpoint = record.p2p_endpoint
            if (targetEndpoint?.trim()) {
              const pending = getContextStoreByHandshake(db, record.handshake_id, 'pending_delivery')
              if (pending.length > 0) {
                setImmediate(() => {
                  try {
                    const counterpartyUserId = record.local_role === 'initiator'
                      ? record.acceptor!.wrdesk_user_id
                      : record.initiator.wrdesk_user_id
                    const counterpartyEmail = record.local_role === 'initiator'
                      ? record.acceptor!.email
                      : record.initiator.email
                    const localPub = record.local_public_key ?? ''
                    const localPriv = record.local_private_key ?? ''
                    if (!localPub || !localPriv) {
                      console.warn('[Relay] Skipping reverse context-sync: handshake has no signing keys')
                      return
                    }
                    const contextBlocks: ContextBlockForCommitment[] = pending.map((b) => ({
                      block_id: b.block_id,
                      block_hash: b.block_hash,
                      scope_id: b.scope_id ?? undefined,
                      type: b.type,
                      content: b.content ?? '',
                    }))
                    let localRelayDev = ''
                    try {
                      localRelayDev = getInstanceId()?.trim() ?? ''
                    } catch {
                      localRelayDev = ''
                    }
                    const reverseInternalWire = internalRelayCapsuleWireOptsFromRecord(record, localRelayDev)
                    if (record.handshake_type === 'internal' && !reverseInternalWire) {
                      console.warn(
                        '[Relay] Skipping reverse context_sync — internal relay identity incomplete, handshake:',
                        record.handshake_id,
                      )
                      return
                    }
                    const contextSyncCapsule = buildContextSyncCapsuleWithContent(ssoSession, {
                      handshake_id: record.handshake_id,
                      counterpartyUserId,
                      counterpartyEmail,
                      last_seq_received: 1,
                      last_capsule_hash_received: capObj.capsule_hash as string,
                      context_blocks: contextBlocks,
                      local_public_key: localPub,
                      local_private_key: localPriv,
                      ...(reverseInternalWire ?? {}),
                    })
                    const enqRev = enqueueOutboundCapsule(db, record.handshake_id, targetEndpoint.trim(), contextSyncCapsule)
                    if (!enqRev.enqueued) {
                      console.warn('[Relay] Reverse context_sync enqueue blocked:', enqRev.message)
                      return
                    }
                  } catch (err: any) {
                    console.warn('[Relay] Reverse context-sync enqueue failed:', err?.message)
                  }
                })
              }
            }
          }
        } else {
          console.warn('[Relay] Handshake rejected:', handshakeResult.reason)
          rejected++
        }
      } catch (err: any) {
        console.warn('[Relay] Processing error:', err?.message)
        rejected++
      }
      idsToAck.push(cap.id)
    }

    if (idsToAck.length > 0) {
      await sendAck(ackUrl, authSecret, idsToAck)
    }

    setP2PHealthRelayPullSuccess(capsules.length, accepted, rejected)
    console.log('[Relay] Pulled', capsules.length, 'capsules, accepted', accepted, ', rejected', rejected)
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    setP2PHealthRelayPullFailure(msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')
      ? 'Relay unreachable — check your relay server.'
      : msg)
    console.warn('[Relay] Pull error:', msg)
  }
}

async function sendAck(ackUrl: string, authSecret: string, ids: string[]): Promise<void> {
  try {
    await fetch(ackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authSecret}`,
      },
      body: JSON.stringify({ ids }),
    })
  } catch (err: any) {
    console.warn('[Relay] Ack failed:', err?.message)
  }
}
