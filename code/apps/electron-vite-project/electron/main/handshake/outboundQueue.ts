/**
 * Outbound Capsule Queue — P2P context-sync delivery with retry.
 *
 * All outbound sends go through this queue. Never send directly from accept handler.
 * Table: outbound_capsule_queue (created by handshake migration v6).
 *
 * When use_coordination: target = coordination_url/beap/capsule, auth = OIDC token.
 * When !use_coordination: target = relay URL from queue, auth = handshake Bearer token.
 */

import { sendCapsuleViaHttp, sendCapsuleViaCoordination } from './p2pTransport'
import { getHandshakeRecord } from './db'
import { getP2PConfig } from '../p2p/p2pConfig'
import {
  setP2PHealthOutboundSuccess,
  setP2PHealthOutboundFailure,
  setP2PHealthQueueCounts,
  formatP2PErrorForUser,
} from '../p2p/p2pHealth'

const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes

function backoffDelay(retryCount: number): number {
  const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS)
  return delay
}

/** Stable codes for IPC/diagnostics (additive; optional on each path). */
export type OutboundQueueCode =
  | 'BACKOFF_WAIT'
  | 'DELIVERED'
  | 'PREFLIGHT_FAILED'
  | 'TRANSPORT_FAILED'
  | 'AUTH_REQUIRED'
  | 'FAILED_MAX_RETRIES'

/** Result of attempting to process one pending outbound capsule (oldest first). */
export interface ProcessOutboundQueueResult {
  delivered: boolean
  error?: string
  /** False when the row is marked failed (max retries); true when still pending / may retry */
  queued?: boolean
  code?: OutboundQueueCode
  /** Last persisted failure on the queue row (`outbound_capsule_queue.error`). */
  last_queue_error?: string | null
  retry_count?: number
  max_retries?: number
  /** ms until this row is eligible for the next attempt (backoff path only). */
  remaining_ms?: number
}

export function enqueueOutboundCapsule(
  db: any,
  handshakeId: string,
  targetEndpoint: string,
  capsule: object,
): void {
  if (!db) return
  const now = new Date().toISOString()
  try {
    db.prepare(
      `INSERT INTO outbound_capsule_queue
       (handshake_id, target_endpoint, capsule_json, status, retry_count, max_retries, created_at)
       VALUES (?, ?, ?, 'pending', 0, 10, ?)`,
    ).run(handshakeId, targetEndpoint, JSON.stringify(capsule), now)
  } catch (err: any) {
    console.warn('[P2P] enqueueOutboundCapsule failed:', err?.message)
  }
}

function getQueueCountsInternal(db: any): { pending: number; failed: number } {
  if (!db) return { pending: 0, failed: 0 }
  try {
    const rows = db.prepare(
      `SELECT status, COUNT(*) as cnt FROM outbound_capsule_queue GROUP BY status`,
    ).all() as Array<{ status: string; cnt: number }>
    let pending = 0
    let failed = 0
    for (const r of rows) {
      if (r.status === 'pending') pending = r.cnt
      else if (r.status === 'failed') failed = r.cnt
    }
    return { pending, failed }
  } catch {
    return { pending: 0, failed: 0 }
  }
}

/** Coordination path blocked before HTTP (no OIDC / no URL) — record attempt so rows are not stuck silent. */
function recordCoordinationPreflightFailure(
  db: any,
  row: { id: number; retry_count: number; max_retries: number },
  now: string,
  errorMsg: string,
): ProcessOutboundQueueResult {
  setP2PHealthOutboundFailure(errorMsg)
  const newRetry = row.retry_count + 1
  db.prepare(
    `UPDATE outbound_capsule_queue SET error = ?, last_attempt_at = ?, retry_count = ? WHERE id = ?`,
  ).run(errorMsg, now, newRetry, row.id)
  if (newRetry >= row.max_retries) {
    db.prepare(`UPDATE outbound_capsule_queue SET status = 'failed' WHERE id = ?`).run(row.id)
  }
  const counts = getQueueCountsInternal(db)
  setP2PHealthQueueCounts(counts.pending, counts.failed)
  const failedMax = newRetry >= row.max_retries
  return {
    delivered: false,
    error: errorMsg,
    queued: !failedMax,
    code: failedMax ? 'FAILED_MAX_RETRIES' : 'PREFLIGHT_FAILED',
    last_queue_error: errorMsg,
    retry_count: newRetry,
    max_retries: row.max_retries,
  }
}

export async function processOutboundQueue(
  db: any,
  getOidcToken?: () => Promise<string | null>,
): Promise<ProcessOutboundQueueResult> {
  if (!db) return { delivered: false, error: 'Database unavailable', queued: false }
  try {
    const row = db.prepare(
      `SELECT id, handshake_id, target_endpoint, capsule_json, retry_count, max_retries, error
       FROM outbound_capsule_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    ).get() as {
      id: number
      handshake_id: string
      target_endpoint: string
      capsule_json: string
      retry_count: number
      max_retries: number
      error: string | null
    } | undefined

    if (!row) return { delivered: false, error: 'No pending capsule to process', queued: false }

    const now = new Date().toISOString()

    // Exponential backoff: skip if not enough time since last attempt
    const lastAttempt = db.prepare('SELECT last_attempt_at FROM outbound_capsule_queue WHERE id = ?').get(row.id) as { last_attempt_at: string | null } | undefined
    if (lastAttempt?.last_attempt_at && row.retry_count > 0) {
      const elapsed = Date.now() - Date.parse(lastAttempt.last_attempt_at)
      const required = backoffDelay(row.retry_count - 1)
      if (elapsed < required) {
        const remaining_ms = Math.max(0, required - elapsed)
        const last_queue_error = row.error ?? null
        const p2pCfg = getP2PConfig(db)
        const preview =
          last_queue_error && last_queue_error.length > 0
            ? last_queue_error.slice(0, 120)
            : null
        console.info(
          '[P2P-QUEUE]',
          JSON.stringify({
            event: 'outbound_backoff',
            code: 'BACKOFF_WAIT',
            queue_row_id: row.id,
            handshake_id: row.handshake_id,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            required_ms: required,
            elapsed_ms: elapsed,
            remaining_ms,
            last_error_preview: preview,
            last_error_len: last_queue_error?.length ?? 0,
            use_coordination: p2pCfg.use_coordination,
          }),
        )
        return {
          delivered: false,
          error: 'Delivery is waiting before retry — try again shortly',
          queued: true,
          code: 'BACKOFF_WAIT',
          last_queue_error,
          retry_count: row.retry_count,
          max_retries: row.max_retries,
          remaining_ms,
        }
      }
    }

    const capsule = JSON.parse(row.capsule_json) as object
    const config = getP2PConfig(db)
    console.log(
      `[P2P-QUEUE] Processing row ${row.id}, handshake ${row.handshake_id}, attempt ${row.retry_count + 1}`,
    )
    console.log(
      `[P2P-QUEUE] Config: use_coordination=${config.use_coordination}, coordination_url=${config.coordination_url}`,
    )
    let result: { success: boolean; error?: string; statusCode?: number }

    if (config.use_coordination && getOidcToken) {
      const token = await getOidcToken()
      const targetUrl = config.coordination_url?.trim()
      if (!token?.trim()) {
        console.warn(`[P2P-QUEUE] Early return: No OIDC token for row ${row.id}`)
        return recordCoordinationPreflightFailure(db, row, now, 'No OIDC token — please log in')
      }
      if (!targetUrl) {
        console.warn(`[P2P-QUEUE] Early return: No coordination URL for row ${row.id}`)
        return recordCoordinationPreflightFailure(db, row, now, 'Coordination URL not configured')
      }
      result = await sendCapsuleViaCoordination(capsule, targetUrl, token)
    } else {
      const record = getHandshakeRecord(db, row.handshake_id)
      const bearerToken = record?.counterparty_p2p_token ?? null
      result = await sendCapsuleViaHttp(capsule, row.target_endpoint, row.handshake_id, bearerToken)
    }

    console.log(`[P2P-QUEUE] Transport result for row ${row.id}: ${JSON.stringify(result)}`)

    if (result.success) {
      setP2PHealthOutboundSuccess()
      db.prepare(
        `UPDATE outbound_capsule_queue SET status = 'sent', last_attempt_at = ? WHERE id = ?`,
      ).run(now, row.id)
      const counts = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(counts.pending, counts.failed)
      return { delivered: true, code: 'DELIVERED' }
    }

    const is401 = result.statusCode === 401
    const userError = is401
      ? 'Authentication failed — please log in again'
      : formatP2PErrorForUser(result.error ?? 'Unknown', row.target_endpoint)
    setP2PHealthOutboundFailure(userError)
    let queued = true
    // 401 = auth issue — do not increment retry; leave pending for retry after re-auth
    if (is401) {
      db.prepare(
        `UPDATE outbound_capsule_queue SET last_attempt_at = ?, error = ? WHERE id = ?`,
      ).run(now, userError, row.id)
      const counts401 = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(counts401.pending, counts401.failed)
      return {
        delivered: false,
        error: userError,
        queued: true,
        code: 'AUTH_REQUIRED',
        last_queue_error: userError,
        retry_count: row.retry_count,
        max_retries: row.max_retries,
      }
    } else {
      const newRetry = row.retry_count + 1
      const isFailed = newRetry >= row.max_retries
      if (isFailed) {
        queued = false
        console.warn('[P2P] Outbound capsule failed after max retries', {
          handshake_id: row.handshake_id,
          retries: newRetry,
          error: result.error,
        })
        db.prepare(
          `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ? WHERE id = ?`,
        ).run(newRetry, now, userError, row.id)
      } else {
        db.prepare(
          `UPDATE outbound_capsule_queue SET retry_count = ?, last_attempt_at = ?, error = ? WHERE id = ?`,
        ).run(newRetry, now, userError, row.id)
      }
    }

    const counts = getQueueCountsInternal(db)
    setP2PHealthQueueCounts(counts.pending, counts.failed)
    const failedMax = !queued
    const updatedRetryCount = row.retry_count + 1
    return {
      delivered: false,
      error: userError,
      queued,
      code: failedMax ? 'FAILED_MAX_RETRIES' : 'TRANSPORT_FAILED',
      last_queue_error: userError,
      retry_count: updatedRetryCount,
      max_retries: row.max_retries,
    }
  } catch (err: any) {
    console.warn('[P2P] processOutboundQueue error:', err?.message)
    setP2PHealthOutboundFailure(err?.message ?? 'Unknown error')
    const msg = err?.message ?? 'Unknown error'
    return {
      delivered: false,
      error: msg,
      queued: true,
      code: 'TRANSPORT_FAILED',
      last_queue_error: msg,
    }
  }
}

export function getQueueStatus(db: any, handshakeId: string): { pending: number; sent: number; failed: number } {
  if (!db) return { pending: 0, sent: 0, failed: 0 }
  try {
    const rows = db.prepare(
      `SELECT status, COUNT(*) as cnt FROM outbound_capsule_queue WHERE handshake_id = ? GROUP BY status`,
    ).all(handshakeId) as Array<{ status: string; cnt: number }>
    const out = { pending: 0, sent: 0, failed: 0 }
    for (const r of rows) {
      if (r.status === 'pending') out.pending = r.cnt
      else if (r.status === 'sent') out.sent = r.cnt
      else if (r.status === 'failed') out.failed = r.cnt
    }
    return out
  } catch {
    return { pending: 0, sent: 0, failed: 0 }
  }
}

export interface QueueEntry {
  id: number
  handshake_id: string
  status: 'pending' | 'sent' | 'failed'
  retry_count: number
  error: string | null
  last_attempt_at: string | null
}

export function getQueueEntries(db: any, handshakeId: string): QueueEntry[] {
  if (!db) return []
  try {
    const rows = db.prepare(
      `SELECT id, handshake_id, status, retry_count, error, last_attempt_at
       FROM outbound_capsule_queue WHERE handshake_id = ?
       ORDER BY created_at DESC`,
    ).all(handshakeId) as Array<{ id: number; handshake_id: string; status: string; retry_count: number; error: string | null; last_attempt_at: string | null }>
    return rows.map((r) => ({
      id: r.id,
      handshake_id: r.handshake_id,
      status: r.status as 'pending' | 'sent' | 'failed',
      retry_count: r.retry_count,
      error: r.error,
      last_attempt_at: r.last_attempt_at,
    }))
  } catch {
    return []
  }
}
