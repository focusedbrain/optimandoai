/**
 * Periodic retention job.
 *
 * Runs on startup and every 60 minutes:
 * 1. Soft-delete expired context blocks (valid_until past).
 * 2. Log counts.
 *
 * Handshake rows are not bulk-expired by calendar time; trust ends on explicit revoke only
 * (see `expirePendingHandshakes` / `expireActiveHandshakes` no-ops in `db.ts`).
 */

import { INPUT_LIMITS } from './types'
import {
  expirePendingHandshakes,
  expireActiveHandshakes,
  softDeleteExpiredBlocks,
  insertAuditLogEntry,
} from './db'

let retentionTimer: ReturnType<typeof setInterval> | null = null

/** Schedules {@link runRetentionCycle} on startup and on {@link INPUT_LIMITS.RETENTION_JOB_INTERVAL_MS}. Expiry scope is documented in `db.ts`. */
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
    expirePendingHandshakes(db, now)
    expireActiveHandshakes(db, now)
    const deletedBlocks = softDeleteExpiredBlocks(db, now)

    if (deletedBlocks > 0) {
      insertAuditLogEntry(db, {
        timestamp: now.toISOString(),
        action: 'retention_cycle',
        reason_code: 'OK',
        metadata: {
          deleted_blocks: deletedBlocks,
        },
      })
      console.log(`[HANDSHAKE RETENTION] Deleted ${deletedBlocks} expired context blocks (valid_until).`)
    }
  } catch (err) {
    console.error('[HANDSHAKE RETENTION] Cycle failed:', err)
  }
}
