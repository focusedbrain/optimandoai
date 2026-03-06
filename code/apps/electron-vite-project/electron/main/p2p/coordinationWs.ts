/**
 * Coordination WebSocket Client — Persistent connection to wrdesk.com for instant capsule delivery.
 *
 * When use_coordination is true, maintains a WebSocket to coordination.wrdesk.com.
 * Receives capsules via push, sends ACKs after processing, auto-reconnects on disconnect.
 */

import WebSocket from 'ws'
import type { P2PConfig } from './p2pConfig'
import type { SSOSession } from '../handshake/types'
import { processIncomingInput } from '../ingestion/ingestionPipeline'
import { processHandshakeCapsule } from '../handshake/enforcement'
import { canonicalRebuild } from '../handshake/canonicalRebuild'
import { buildDefaultReceiverPolicy } from '../handshake/types'
import {
  insertIngestionAuditRecord,
  insertQuarantineRecord,
} from '../ingestion/persistenceDb'
import { enqueueOutboundCapsule } from '../handshake/outboundQueue'
import { getContextStoreByHandshake } from '../handshake/db'
import { buildContextSyncCapsuleWithContent } from '../handshake/capsuleBuilder'
import type { ContextBlockForCommitment } from '../handshake/contextCommitment'
import {
  setP2PHealthCoordinationConnected,
  setP2PHealthCoordinationDisconnected,
  setP2PHealthCoordinationError,
  setP2PHealthCoordinationLastPush,
  setP2PHealthCoordinationReconnectAttempts,
} from './p2pHealth'

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]

function getReconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
}

export interface CoordinationCapsuleMessage {
  type: 'capsule'
  id: string
  handshake_id?: string
  capsule: unknown
}

export interface CoordinationWsClient {
  connect(): Promise<void>
  disconnect(): void
  isConnected(): boolean
  onCapsule(handler: (msg: CoordinationCapsuleMessage) => Promise<void>): void
  sendAck(ids: string[]): void
}

function processCapsuleInternal(
  id: string,
  capsule: unknown,
  db: any,
  ssoSession: SSOSession,
  sendAckFn: (ids: string[]) => void,
): void {
  const capsuleJson = typeof capsule === 'string' ? capsule : JSON.stringify(capsule)
  const rawInput = {
    body: capsuleJson,
    mime_type: 'application/vnd.beap+json' as const,
    headers: { 'content-type': 'application/vnd.beap+json' },
  }

  processIncomingInput(rawInput, 'coordination_ws', {
    channel_id: 'coordination_ws',
    mime_type: 'application/vnd.beap+json',
  }).then((result) => {
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
      console.warn('[Coordination] Capsule rejected:', result.reason)
      sendAckFn([id])
      return
    }

    const { distribution } = result
    if (distribution.target !== 'handshake_pipeline') {
      sendAckFn([id])
      return
    }

    try {
      const rebuildResult = canonicalRebuild(distribution.validated_capsule.capsule)
      if (!rebuildResult.ok) {
        console.warn('[Coordination] Canonical rebuild rejected:', rebuildResult.reason)
        sendAckFn([id])
        return
      }

      const canonicalValidated = {
        ...distribution.validated_capsule,
        capsule: rebuildResult.capsule as any,
      }

      const handshakeResult = processHandshakeCapsule(
        db,
        canonicalValidated,
        buildDefaultReceiverPolicy(),
        ssoSession,
      )

      if (handshakeResult.success) {
        setP2PHealthCoordinationLastPush()
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
                  const contextBlocks: ContextBlockForCommitment[] = pending.map((b) => ({
                    block_id: b.block_id,
                    block_hash: b.block_hash,
                    scope_id: b.scope_id ?? undefined,
                    type: b.type,
                    content: b.content ?? '',
                  }))
                  const contextSyncCapsule = buildContextSyncCapsuleWithContent(ssoSession, {
                    handshake_id: record.handshake_id,
                    counterpartyUserId,
                    counterpartyEmail,
                    last_seq_received: 1,
                    last_capsule_hash_received: capObj.capsule_hash as string,
                    context_blocks: contextBlocks,
                  })
                  enqueueOutboundCapsule(db, record.handshake_id, targetEndpoint.trim(), contextSyncCapsule)
                } catch (err: any) {
                  console.warn('[Coordination] Reverse context-sync enqueue failed:', err?.message)
                }
              })
            }
          }
        }
      } else {
        console.warn('[Coordination] Handshake rejected:', handshakeResult.reason)
      }
    } catch (err: any) {
      console.warn('[Coordination] Processing error:', err?.message)
    }
    sendAckFn([id])
  })
}

export function createCoordinationWsClient(
  config: P2PConfig,
  getDb: () => any,
  getSsoSession: () => SSOSession | undefined,
  getOidcToken: () => Promise<string | null>,
): CoordinationWsClient {
  let ws: WebSocket | null = null
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let capsuleHandler: ((msg: CoordinationCapsuleMessage) => Promise<void>) | null = null
  let pendingAcks: string[] = []
  let ackFlushTimer: ReturnType<typeof setTimeout> | null = null

  const flushAcks = (): void => {
    if (pendingAcks.length === 0 || !ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({ type: 'ack', ids: pendingAcks }))
      pendingAcks = []
    } catch (err: any) {
      console.warn('[Coordination] ACK send failed:', err?.message)
    }
    if (ackFlushTimer) {
      clearTimeout(ackFlushTimer)
      ackFlushTimer = null
    }
  }

  const scheduleAckFlush = (): void => {
    if (ackFlushTimer) return
    ackFlushTimer = setTimeout(flushAcks, 50)
  }

  const sendAck = (ids: string[]): void => {
    if (ids.length === 0) return
    pendingAcks.push(...ids)
    scheduleAckFlush()
  }

  const connect = async (): Promise<void> => {
    if (!config.use_coordination || !config.coordination_enabled) return
    const wsUrl = config.coordination_ws_url?.trim()
    if (!wsUrl) return

    const token = await getOidcToken()
    if (!token?.trim()) {
      setP2PHealthCoordinationError('No OIDC token — please log in')
      return
    }

    const url = wsUrl.includes('?') ? `${wsUrl}&token=${encodeURIComponent(token)}` : `${wsUrl}?token=${encodeURIComponent(token)}`

    return new Promise((resolve, reject) => {
      try {
        ws = new WebSocket(url)
      } catch (err: any) {
        setP2PHealthCoordinationError(err?.message ?? 'WebSocket connect failed')
        reject(err)
        return
      }

      ws.on('open', () => {
        reconnectAttempt = 0
        setP2PHealthCoordinationConnected()
        setP2PHealthCoordinationReconnectAttempts(0)
        flushAcks()
        resolve()
      })

      ws.on('message', (data: Buffer | string) => {
        try {
          const text = typeof data === 'string' ? data : data.toString('utf8')
          const msg = JSON.parse(text) as { type?: string; id?: string; handshake_id?: string; capsule?: unknown }
          if (msg?.type === 'capsule' && msg.id) {
            const db = getDb()
            const ssoSession = getSsoSession()
            if (!ssoSession) {
              console.warn('[Coordination] No SSO session — ACKing without processing')
              sendAck([msg.id])
              return
            }
            const capsuleMsg: CoordinationCapsuleMessage = {
              type: 'capsule',
              id: msg.id,
              handshake_id: msg.handshake_id,
              capsule: msg.capsule ?? msg,
            }
            if (capsuleHandler) {
              capsuleHandler(capsuleMsg).catch(() => sendAck([msg.id]))
            } else {
              processCapsuleInternal(msg.id, msg.capsule ?? msg, db, ssoSession, sendAck)
            }
          }
        } catch (err: any) {
          console.warn('[Coordination] Message parse error:', err?.message)
        }
      })

      ws.on('close', () => {
        ws = null
        setP2PHealthCoordinationDisconnected()
        if (!config.use_coordination || !config.coordination_enabled) return
        scheduleReconnect()
      })

      ws.on('error', (err: Error) => {
        setP2PHealthCoordinationError(err?.message ?? 'WebSocket error')
      })

      ws.on('ping', () => {
        ws?.pong()
      })
    })
  }

  const scheduleReconnect = (): void => {
    if (reconnectTimer) return
    if (!config.use_coordination || !config.coordination_enabled) return
    const delay = getReconnectDelay(reconnectAttempt)
    reconnectAttempt++
    setP2PHealthCoordinationReconnectAttempts(reconnectAttempt)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect().catch(() => scheduleReconnect())
    }, delay)
  }

  const disconnect = (): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ackFlushTimer) {
      clearTimeout(ackFlushTimer)
      ackFlushTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    setP2PHealthCoordinationDisconnected()
  }

  return {
    connect,
    disconnect,
    isConnected: () => !!ws && ws.readyState === WebSocket.OPEN,
    onCapsule: (handler) => {
      capsuleHandler = handler
    },
    sendAck,
  }
}
