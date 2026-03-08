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
import { tryEnqueueContextSync } from '../handshake/contextSyncEnqueue'
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

async function processCapsuleInternal(
  id: string,
  capsule: unknown,
  db: any,
  ssoSession: SSOSession,
  sendAckFn: (ids: string[]) => void,
  onHandshakeUpdated?: () => void,
): Promise<void> {
  const capObj = typeof capsule === 'object' && capsule !== null ? capsule as Record<string, unknown> : {}
  const capsuleType = (capObj?.capsule_type as string) ?? 'unknown'
  const handshakeId = (capObj?.handshake_id as string) ?? 'unknown'
  console.log('[Coordination] Processing capsule:', id, 'type=', capsuleType, 'handshake=', handshakeId)

  if (!db) {
    console.error('[Coordination] DB check: FAILED — getHandshakeDb() returned null')
    console.error('[Coordination] NOT acknowledging — capsule will be retried by relay')
    return
  }
  console.log('[Coordination] DB check: OK')

  try {
    const capsuleJson = typeof capsule === 'string' ? capsule : JSON.stringify(capsule)
    const rawInput = {
      body: capsuleJson,
      mime_type: 'application/vnd.beap+json' as const,
      headers: { 'content-type': 'application/vnd.beap+json' },
    }

    const result = await processIncomingInput(rawInput, 'coordination_ws', {
      channel_id: 'coordination_ws',
      mime_type: 'application/vnd.beap+json',
    })

    if (db) {
      try {
        insertIngestionAuditRecord(db, result.audit)
      } catch { /* non-fatal */ }
    }

    if (!result.success) {
      console.warn('[Coordination] Capsule rejected:', result.reason)
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
      sendAckFn([id])
      return
    }

    const { distribution } = result
    if (distribution.target !== 'handshake_pipeline') {
      console.log('[Coordination] Capsule routed to', distribution.target, '— ACKing (not handshake_pipeline)')
      sendAckFn([id])
      return
    }

    const rebuildResult = canonicalRebuild(distribution.validated_capsule!.capsule)
    if (!rebuildResult.ok) {
      console.warn('[Coordination] Canonical rebuild rejected:', rebuildResult.reason)
      sendAckFn([id])
      return
    }

    const canonicalValidated = {
      ...distribution.validated_capsule!,
      capsule: rebuildResult.capsule as any,
    }

    const handshakeResult = processHandshakeCapsule(
      db,
      canonicalValidated,
      buildDefaultReceiverPolicy(),
      ssoSession,
    )

    if (handshakeResult.success) {
      const newState = handshakeResult.handshakeRecord?.state ?? 'unknown'
      console.log('[Coordination] processHandshakeCapsule result: success, newState=', newState)
      setP2PHealthCoordinationLastPush()
      onHandshakeUpdated?.()

      const record = handshakeResult.handshakeRecord!
      const targetEndpoint = record.p2p_endpoint?.trim()

      // After ACCEPT: send initial context_sync (or defer if vault locked)
      if (newState === 'ACCEPTED' && targetEndpoint) {
        const lastHash = (rebuildResult.capsule as unknown as Record<string, unknown>)?.capsule_hash as string ?? ''
        const contextResult = tryEnqueueContextSync(db, record.handshake_id, ssoSession, {
          lastCapsuleHash: lastHash,
          lastSeqReceived: 0,
        })
        if (contextResult.success) {
          console.log('[Coordination] Initial context_sync enqueued for handshake=', record.handshake_id)
        } else if (contextResult.reason === 'VAULT_LOCKED') {
          console.log('[Coordination] Context sync deferred for initiator — vault locked')
        }
      }

      // After context_sync (seq 1): send reverse context_sync (or defer if vault locked)
      const capObjRebuilt = rebuildResult.capsule as unknown as Record<string, unknown>
      if (capObjRebuilt?.capsule_type === 'context_sync' && capObjRebuilt?.seq === 1 && targetEndpoint) {
        setImmediate(() => {
          const contextResult = tryEnqueueContextSync(db, record.handshake_id, ssoSession, {
            lastCapsuleHash: capObjRebuilt.capsule_hash as string,
            lastSeqReceived: 1,
          })
          if (contextResult.success) {
            console.log('[Coordination] Reverse context_sync enqueued for handshake=', record.handshake_id)
          } else if (contextResult.reason === 'VAULT_LOCKED') {
            console.log('[Coordination] Reverse context sync deferred — vault locked')
          }
        })
      }
    } else {
      console.warn('[Coordination] Handshake rejected:', handshakeResult.reason)
    }

    sendAckFn([id])
    console.log('[Coordination] ACK sent for:', id)
  } catch (err: any) {
    console.error('[Coordination] Capsule processing failed:', err?.message ?? err, err)
    console.error('[Coordination] NOT acknowledging — capsule will be retried')
    // Do NOT sendAckFn — let relay retry
  }
}

export function createCoordinationWsClient(
  config: P2PConfig,
  getDb: () => any,
  getSsoSession: () => SSOSession | undefined,
  getOidcToken: () => Promise<string | null>,
  opts?: { onHandshakeUpdated?: () => void },
): CoordinationWsClient {
  const onHandshakeUpdated = opts?.onHandshakeUpdated
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
    if (!config.use_coordination || !config.coordination_enabled) {
      console.log('[Coordination] Skipping connect: use_coordination=', config.use_coordination, 'coordination_enabled=', config.coordination_enabled)
      return
    }
    const wsUrl = config.coordination_ws_url?.trim()
    if (!wsUrl) {
      console.log('[Coordination] Skipping connect: no coordination_ws_url')
      return
    }

    const token = await getOidcToken()
    if (!token?.trim()) {
      setP2PHealthCoordinationError('No OIDC token — please log in')
      return
    }

    const url = wsUrl.includes('?') ? `${wsUrl}&token=${encodeURIComponent(token)}` : `${wsUrl}?token=${encodeURIComponent(token)}`
    console.log('[Coordination] Connecting to relay WebSocket:', wsUrl.replace(/\?.*/, ''))

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
        console.log('[Coordination] Connected to relay WebSocket — ready to receive capsules')
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
            console.log('[Coordination] Capsule received:', msg.id, msg.handshake_id ? `handshake=${msg.handshake_id}` : '')
            const capPayload = msg.capsule ?? msg
            const cap = typeof capPayload === 'object' && capPayload !== null ? capPayload as Record<string, unknown> : {}
            console.log('[Coordination] Capsule payload:', JSON.stringify({
              type: msg.type,
              id: msg.id,
              capsule_type: cap?.capsule_type,
              handshake_id: cap?.handshake_id ?? msg.handshake_id,
            }))
            if (capsuleHandler) {
              capsuleHandler(capsuleMsg).catch((err) => {
                console.error('[Coordination] Custom handler failed:', err?.message)
                sendAck([msg.id])
              })
            } else {
              processCapsuleInternal(msg.id, msg.capsule ?? msg, db, ssoSession, sendAck, onHandshakeUpdated)
                .catch((err) => {
                  console.error('[Coordination] processCapsuleInternal threw:', err?.message ?? err)
                })
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

  const disconnect = (): void => {
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
