/**
 * Periodic retention and expiry job.
 *
 * Runs on startup and every 60 minutes:
 * 1. Expire handshakes past their expires_at (PENDING_ACCEPT and ACTIVE).
 * 2. Soft-delete expired context blocks (valid_until past).
 * 3. Log counts.
 */

import { INPUT_LIMITS } from './types'
import {
  expirePendingHandshakes,
  expireActiveHandshakes,
  softDeleteExpiredBlocks,
  insertAuditLogEntry,
} from './db'

let retentionTimer: ReturnType<typeof setInterval> | null = null

export function startRetentionJob(db: any): void {
  runRetentionCycle(db)

  retentionTimer = setInterval(() => {
    runRetentionCycle(db)
  }, INPUT_LIMITS.RETENTION_JOB_INTERVAL_MS)
}

export function stopRetentionJob(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer)
    retentionTimer = null
  }
}

export function runRetentionCycle(db: any): void {
  const now = new Date()
  try {
    const expiredPending = expirePendingHandshakes(db, now)
    const expiredActive = expireActiveHandshakes(db, now)
    const deletedBlocks = softDeleteExpiredBlocks(db, now)

    if (expiredPending > 0 || expiredActive > 0 || deletedBlocks > 0) {
      insertAuditLogEntry(db, {
        timestamp: now.toISOString(),
        action: 'retention_cycle',
        reason_code: 'OK',
        metadata: {
          expired_pending: expiredPending,
          expired_active: expiredActive,
          deleted_blocks: deletedBlocks,
        },
      })
      console.log(
        `[HANDSHAKE RETENTION] Expired: ${expiredPending} pending, ${expiredActive} active. Deleted ${deletedBlocks} blocks.`
      )
    }
  } catch (err) {
    console.error('[HANDSHAKE RETENTION] Cycle failed:', err)
  }
}
