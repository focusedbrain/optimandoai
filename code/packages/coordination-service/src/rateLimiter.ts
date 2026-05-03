/**
 * Coordination Service — Tier-based rate limiting
 */

import type { ValidatedIdentity } from './auth.js'

export interface TierLimits {
  capsulesPerMonth: number
  capsulesPerMinute: number
  maxStored: number
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: { capsulesPerMonth: 100, capsulesPerMinute: 5, maxStored: 50 },
  pro: { capsulesPerMonth: 10_000, capsulesPerMinute: 50, maxStored: 1_000 },
  publisher: { capsulesPerMonth: 50_000, capsulesPerMinute: 100, maxStored: 5_000 },
  enterprise: { capsulesPerMonth: 999_999_999, capsulesPerMinute: 200, maxStored: 50_000 },
}

export interface RateLimiterAdapter {
  checkRateLimit(
    userId: string,
    identity: ValidatedIdentity,
    recipientPendingCount: number,
  ): { ok: boolean; limit?: string; tier?: string }
  recordCapsuleSent(userId: string): void
  resetForTests(): void
}

export function createRateLimiter(): RateLimiterAdapter {
  const minuteCounts = new Map<string, { count: number; resetAt: number }>()
  const monthCounts = new Map<string, { count: number; monthKey: string }>()

  function getMonthKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  function getLimits(tier: string): TierLimits {
    return TIER_LIMITS[tier.toLowerCase()] ?? TIER_LIMITS.free
  }

  return {
    checkRateLimit(
      userId: string,
      identity: ValidatedIdentity,
      recipientPendingCount: number,
    ): { ok: boolean; limit?: string; tier?: string } {
      const limits = getLimits(identity.tier)

      if (recipientPendingCount >= limits.maxStored) {
        return { ok: false, limit: `${limits.maxStored} stored`, tier: identity.tier }
      }

      const now = Date.now()
      const minKey = `${userId}:min`
      let minEntry = minuteCounts.get(minKey)
      if (!minEntry || now > minEntry.resetAt) {
        minEntry = { count: 0, resetAt: now + 60_000 }
        minuteCounts.set(minKey, minEntry)
      }
      if (minEntry.count >= limits.capsulesPerMinute) {
        return { ok: false, limit: `${limits.capsulesPerMinute}/minute`, tier: identity.tier }
      }

      const monthKey = getMonthKey()
      const monthEntry = monthCounts.get(userId)
      if (!monthEntry || monthEntry.monthKey !== monthKey) {
        monthCounts.set(userId, { count: 0, monthKey })
      }
      const monthEntry2 = monthCounts.get(userId)!
      if (monthEntry2.count >= limits.capsulesPerMonth) {
        return { ok: false, limit: `${limits.capsulesPerMonth}/month`, tier: identity.tier }
      }

      return { ok: true }
    },

    recordCapsuleSent(userId: string): void {
      const minKey = `${userId}:min`
      const entry = minuteCounts.get(minKey)
      if (entry) entry.count++

      const monthKey = getMonthKey()
      const monthEntry = monthCounts.get(userId)
      if (!monthEntry || monthEntry.monthKey !== monthKey) {
        monthCounts.set(userId, { count: 1, monthKey })
      } else {
        monthEntry.count++
      }
    },

    resetForTests(): void {
      minuteCounts.clear()
      monthCounts.clear()
    },
  }
}
