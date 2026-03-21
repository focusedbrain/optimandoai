/**
 * Smart Sync — effective window and batch caps from persisted account.sync.
 * Same defaults for **IMAP** as API providers (30 days / 500 on first pull) to avoid huge mailbox pulls.
 */

import type { EmailAccountConfig } from '../types'

/** 7 / 30 / 90 / 0 (all mail). Default 30 when unset. */
export function getEffectiveSyncWindowDays(sync: EmailAccountConfig['sync'] | undefined): number {
  if (!sync) return 30
  if (typeof sync.syncWindowDays === 'number' && sync.syncWindowDays >= 0) return sync.syncWindowDays
  if (sync.maxAgeDays > 0) return sync.maxAgeDays
  return 30
}

/** Pull batch size for first sync and Pull More (default 500). */
export function getMaxMessagesPerPull(sync: EmailAccountConfig['sync'] | undefined): number {
  const n = sync?.maxMessagesPerPull
  if (typeof n === 'number' && n > 0) return Math.min(5000, Math.max(1, n))
  return 500
}

/** ISO lower bound for remote full-sync: only rows on/after this date (null = no filter). */
export function getRemoteSyncReceivedAtLowerBoundIso(sync: EmailAccountConfig['sync'] | undefined): string | null {
  const days = getEffectiveSyncWindowDays(sync)
  if (days === 0) return null
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}
