/**
 * Smart Sync — effective window and batch caps from persisted account.sync.
 * Same defaults for **IMAP** as API providers (30 days / 500 on first pull) to avoid huge mailbox pulls.
 */

import type { EmailAccountConfig } from '../types'
import { emailDebugLog } from '../emailDebug'

/** 7 / 30 / 90 / 0 (all mail). Default 30 when unset. */
export function getEffectiveSyncWindowDays(sync: EmailAccountConfig['sync'] | undefined): number {
  let out: number
  if (!sync) out = 30
  else if (typeof sync.syncWindowDays === 'number' && sync.syncWindowDays >= 0) out = sync.syncWindowDays
  else if (sync.maxAgeDays > 0) out = sync.maxAgeDays
  else out = 30
  emailDebugLog('[SYNC-DEBUG] getEffectiveSyncWindowDays', {
    rawSync: sync ?? null,
    effectiveDays: out,
    note: 'UI “90d” only applies if sync.syncWindowDays (or legacy maxAgeDays) is persisted on the account',
  })
  return out
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
