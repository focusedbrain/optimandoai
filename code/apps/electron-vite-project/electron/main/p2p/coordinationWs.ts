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
import { processOutboundQueue } from '../handshake/outboundQueue'
import {
  setP2PHealthCoordinationConnected,
  setP2PHealthCoordinationDisconnected,
  setP2PHealthCoordinationError,
  setP2PHealthCoordinationLastPush,
  setP2PHealthCoordinationReconnectAttempts,
} from './p2pHealth'

/**
 * In-memory buffer for context_sync capsules that arrived before the accept was processed.
 * Key = handshake_id, value = { capsule, id, ssoSession } to replay after accept.
 * Used by both the WS path (incoming accept) and the IPC accept path (acceptor machine).
 */
const pendingContextSyncBuffer = new Map<string, { capsule: unknown; id: string; ssoSession: SSOSession }>()

/**
 * Called after a handshake transitions to ACCEPTED (either by receiving an incoming accept
 * capsule OR by the local accept IPC handler). Replays any buffered early context_sync.
 */
export function replayBufferedContextSync(
  handshakeId: string,
  db: any,
  ssoSession: SSOSession,
  getOidcToken: () => Promise<string | null>,
): void {
  const buffered = pendingContextSyncBuffer.get(handshakeId)
  if (!buffered) return
  console.log('[Coordination] Replaying buffered context_sync for handshake=', handshakeId)
  pendingContextSyncBuffer.delete(handshakeId)
  // sendAckFn is a no-op here — the capsule was already buffered without ACKing.
  // If the replay succeeds the relay will eventually retry and get ACKed then, or
  // the poller will handle it. The important thing is we process it locally.
  const noopAck = (_ids: string[]) => {}
  setImmediate(() => {
    processCapsuleInternal(buffered.id, buffered.capsule, db, buffered.ssoSession, noopAck, getOidcToken, undefined)
  })
}

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
  getOidcToken: () => Promise<string | null>,
  onHandshakeUpdated?: () => void,
): Promise<void> {
  const capObj = typeof capsule === 'object' && capsule !== null ? capsule as Record<string, unknown> : {}
  const capsuleType = (capObj?.capsule_type as string) ?? 'unknown'
  const handshakeId = (capObj?.handshake_id as string) ?? 'unknown'
  const capsuleSenderId = (capObj?.sender_wrdesk_user_id as string) ?? ''
  console.log('[Coordination] Processing capsule:', id, 'type=', capsuleType, 'handshake=', handshakeId)

  // Skip capsules we sent ourselves (relay echoes them back).
  // For revoke/refresh/context_sync the sender is us — processing our own capsule would
  // fail verify_handshake_ownership on the receiving side.
  if (capsuleSenderId && ssoSession.wrdesk_user_id && capsuleSenderId === ssoSession.wrdesk_user_id) {
    console.log('[Coordination] Skipping own capsule (sender=local user):', id, 'type=', capsuleType)
    sendAckFn([id])
    return
  }

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

    console.log('[Coordination] Calling processIncomingInput for:', id, 'capsuleType=', capsuleType)
    const result = await processIncomingInput(rawInput, 'coordination_ws', {
      channel_id: 'coordination_ws',
      mime_type: 'application/vnd.beap+json',
    })
    console.log('[Coordination] processIncomingInput returned: success=', result.success, 'reason=', (result as any).reason ?? 'n/a', 'target=', (result as any).distribution?.target ?? 'n/a')

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

    console.log('[Coordination] Calling processHandshakeCapsule for:', id, 'capsuleType=', capsuleType)
    let handshakeResult: ReturnType<typeof processHandshakeCapsule>
    try {
      handshakeResult = processHandshakeCapsule(
        db,
        canonicalValidated,
        buildDefaultReceiverPolicy(),
        ssoSession,
      )
    } catch (phcErr: any) {
      console.error('[Coordination] processHandshakeCapsule THREW:', phcErr?.message ?? phcErr, 'stack=', phcErr?.stack?.slice(0, 300))
      sendAckFn([id])
      return
    }
    console.log('[Coordination] processHandshakeCapsule returned: success=', handshakeResult.success, 'reason=', (handshakeResult as any).reason ?? 'n/a')

    if (handshakeResult.success) {
      const newState = handshakeResult.handshakeRecord?.state ?? 'unknown'
      console.log('[Coordination] processHandshakeCapsule result: success, newState=', newState, 'capsuleType=', capsuleType, 'seq=', (rebuildResult.capsule as any)?.seq)
      if (capsuleType === 'revoke') {
        console.log('[Coordination] REVOKE processed successfully — handshake', handshakeId, 'is now REVOKED locally')
      }
      setP2PHealthCoordinationLastPush()
      onHandshakeUpdated?.()

      const record = handshakeResult.handshakeRecord!

      // After ACCEPT: send initial context_sync (or defer if vault locked).
      // No targetEndpoint guard — coordination mode delivers via coordination_url, not p2p_endpoint.
      if (newState === 'ACCEPTED') {
        const lastHash = (rebuildResult.capsule as unknown as Record<string, unknown>)?.capsule_hash as string ?? ''
        console.log('[Coordination] Triggering initial context_sync, lastHash=', lastHash?.slice(0,16))
        const contextResult = tryEnqueueContextSync(db, record.handshake_id, ssoSession, {
          lastCapsuleHash: lastHash,
          lastSeqReceived: 0,
        })
        if (contextResult.success) {
          console.log('[Coordination] Initial context_sync enqueued for handshake=', record.handshake_id)
          // Flush immediately with real token — don't wait for 10s poller
          setImmediate(() => { processOutboundQueue(db, getOidcToken).catch(() => {}) })
        } else if (contextResult.reason === 'VAULT_LOCKED') {
          console.log('[Coordination] Context sync deferred for initiator — vault locked')
        } else {
          console.warn('[Coordination] Initial context_sync skipped, reason=', contextResult.reason)
        }

        // After accept succeeds: replay any context_sync that arrived early (before accept).
        const buffered = pendingContextSyncBuffer.get(record.handshake_id)
        if (buffered) {
          console.log('[Coordination] Replaying buffered context_sync for handshake=', record.handshake_id)
          pendingContextSyncBuffer.delete(record.handshake_id)
          setImmediate(() => {
            processCapsuleInternal(buffered.id, buffered.capsule, db, buffered.ssoSession, sendAckFn, getOidcToken, onHandshakeUpdated)
          })
        }      }

      // Each side independently sends exactly one context_sync (seq=1) after accept.
      // Both sides reach ACTIVE when they receive the other's seq=1. No reverse is needed.
      const capObjRebuilt = rebuildResult.capsule as unknown as Record<string, unknown>
      console.log('[Coordination] Capsule processed: type=', capObjRebuilt?.capsule_type, 'seq=', capObjRebuilt?.seq, 'newState=', newState)
    } else {
      console.warn('[Coordination] Handshake rejected:', handshakeResult.reason, 'failedStep=', handshakeResult.failedStep)
      if (capsuleType === 'revoke') {
        console.error('[Coordination] REVOKE capsule REJECTED — handshake', handshakeId, 'remains ACTIVE! reason=', handshakeResult.reason, 'failedStep=', handshakeResult.failedStep)
      }
      // For context_sync capsules rejected due to ordering issues (arrived before the accept
      // was processed — acceptor not yet in the record), buffer them locally and replay after
      // the accept capsule succeeds. Also keep NOT ACKing so the relay retries as a fallback.
      const isTransientContextSyncRejection =
        capsuleType === 'context_sync' &&
        (handshakeResult.reason === 'HANDSHAKE_OWNERSHIP_VIOLATION' ||
         handshakeResult.reason === 'CHAIN_INTEGRITY_VIOLATION' ||
         handshakeResult.reason === 'INVALID_CHAIN' ||
         handshakeResult.reason === 'SIGNATURE_INVALID')
      if (isTransientContextSyncRejection) {
        console.warn('[Coordination] Buffering early context_sync for handshake=', handshakeId, '— will replay after accept')
        // Store the latest version — if relay sends multiple retries before accept, keep only the freshest
        pendingContextSyncBuffer.set(handshakeId, { capsule, id, ssoSession })
        return // Do not sendAckFn — let relay retry too as a fallback
      }
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
  let lastActivityAt = 0
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // Watchdog: if WS appears open but no traffic for >90s, force-close and reconnect.
  // This catches the case where the socket silently dies (no 'close' event fired).
  const startHeartbeat = (): void => {
    if (heartbeatTimer) return
    lastActivityAt = Date.now()
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const staleSec = (Date.now() - lastActivityAt) / 1000
      if (staleSec > 90) {
        console.warn('[Coordination] WS stale for', Math.round(staleSec), 's — forcing reconnect')
        ws.terminate?.()
        ws = null
        setP2PHealthCoordinationDisconnected()
        scheduleReconnect()
      }
    }, 30_000)
  }

  const stopHeartbeat = (): void => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  }

  const bumpActivity = (): void => { lastActivityAt = Date.now() }

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
      scheduleReconnect()
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
        startHeartbeat()
        console.log('[Coordination] Connected to relay WebSocket — ready to receive capsules')
        resolve()
      })

      ws.on('message', (data: Buffer | string) => {
        bumpActivity()
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
              processCapsuleInternal(msg.id, msg.capsule ?? msg, db, ssoSession, sendAck, getOidcToken, onHandshakeUpdated)
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
        stopHeartbeat()
        setP2PHealthCoordinationDisconnected()
        if (!config.use_coordination || !config.coordination_enabled) return
        scheduleReconnect()
      })

      ws.on('error', (err: Error) => {
        setP2PHealthCoordinationError(err?.message ?? 'WebSocket error')
      })

      ws.on('ping', () => {
        bumpActivity()
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
    stopHeartbeat()
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
