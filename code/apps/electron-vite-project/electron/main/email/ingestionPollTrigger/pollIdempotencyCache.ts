/**
 * Idempotency cache for sandbox ingestion poll runs (A4).
 * Keyed by request_id — TTL ≥ poll timeout so relay retries never double-fetch the provider.
 */

import type { IngestionPollErrorWire, IngestionPollResultWire } from './wire'

export type CachedPollOutcome = IngestionPollResultWire | IngestionPollErrorWire

export const DEFAULT_POLL_IDEMPOTENCY_TTL_MS = (() => {
  const raw = Number(process.env.WRDESK_INGESTION_POLL_TRIGGER_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120_000
})()

interface CacheEntry {
  outcome: CachedPollOutcome
  expiresAt: number
}

const cacheByRequestId = new Map<string, CacheEntry>()
const timersByRequestId = new Map<string, ReturnType<typeof setTimeout>>()

export function getPollOutcomeFromIdempotencyCache(requestId: string): CachedPollOutcome | undefined {
  const id = typeof requestId === 'string' ? requestId.trim() : ''
  if (!id) return undefined
  const entry = cacheByRequestId.get(id)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    evictPollOutcomeFromIdempotencyCache(id)
    return undefined
  }
  return entry.outcome
}

function evictPollOutcomeFromIdempotencyCache(requestId: string): void {
  const timer = timersByRequestId.get(requestId)
  if (timer) {
    clearTimeout(timer)
    timersByRequestId.delete(requestId)
  }
  cacheByRequestId.delete(requestId)
}

export function storePollOutcomeInIdempotencyCache(
  requestId: string,
  outcome: CachedPollOutcome,
  ttlMs: number = DEFAULT_POLL_IDEMPOTENCY_TTL_MS,
): void {
  const id = typeof requestId === 'string' ? requestId.trim() : ''
  if (!id) return
  const ttl = Math.max(1, ttlMs)
  const expiresAt = Date.now() + ttl
  cacheByRequestId.set(id, { outcome, expiresAt })

  const existing = timersByRequestId.get(id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    evictPollOutcomeFromIdempotencyCache(id)
  }, ttl)
  timersByRequestId.set(id, timer)
}

export function _resetPollIdempotencyCacheForTests(): void {
  for (const timer of timersByRequestId.values()) {
    clearTimeout(timer)
  }
  timersByRequestId.clear()
  cacheByRequestId.clear()
}
