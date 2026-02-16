/**
 * Tests: ChallengeStore — one-time-use, TTL-bounded challenge verification.
 *
 * Acceptance criteria:
 *   1. Freshly issued challenge can be consumed exactly once.
 *   2. Second consume of same challenge returns false (replay blocked).
 *   3. Expired challenge returns false.
 *   4. Unknown/fabricated challenge returns false.
 *   5. Empty/null challenge returns false.
 *   6. maxPending is respected (oldest evicted).
 *   7. clear() invalidates all outstanding challenges.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChallengeStore } from './challengeStore'

describe('ChallengeStore', () => {
  let store: ChallengeStore

  beforeEach(() => {
    store = new ChallengeStore({ ttlMs: 5000, maxPending: 4 })
  })

  // -------------------------------------------------------------------------
  // 1. Normal issue + consume
  // -------------------------------------------------------------------------
  it('freshly issued challenge can be consumed', () => {
    const c = store.issue('abc123')
    expect(c).toBe('abc123')
    expect(store.consume('abc123')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 2. Replay: second consume MUST fail
  // -------------------------------------------------------------------------
  it('replaying the same challenge fails', () => {
    store.issue('abc123')
    expect(store.consume('abc123')).toBe(true)
    expect(store.consume('abc123')).toBe(false)
  })

  it('replaying after two separate issues of different challenges both work once', () => {
    store.issue('c1')
    store.issue('c2')
    expect(store.consume('c1')).toBe(true)
    expect(store.consume('c1')).toBe(false)
    expect(store.consume('c2')).toBe(true)
    expect(store.consume('c2')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 3. Expired challenge
  // -------------------------------------------------------------------------
  it('expired challenge returns false', () => {
    const shortStore = new ChallengeStore({ ttlMs: 50 })
    shortStore.issue('expiring')

    // Advance time past TTL
    vi.useFakeTimers()
    vi.advanceTimersByTime(100)

    expect(shortStore.consume('expiring')).toBe(false)
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // 4. Unknown / fabricated challenge
  // -------------------------------------------------------------------------
  it('unknown challenge returns false', () => {
    store.issue('real')
    expect(store.consume('fabricated')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 5. Empty / null-ish challenge
  // -------------------------------------------------------------------------
  it('empty string returns false', () => {
    expect(store.consume('')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 6. maxPending eviction
  // -------------------------------------------------------------------------
  it('evicts oldest when maxPending is exceeded', () => {
    store.issue('a')
    store.issue('b')
    store.issue('c')
    store.issue('d')
    // Store is now full (maxPending = 4)
    store.issue('e') // should evict 'a'

    expect(store.consume('a')).toBe(false) // evicted
    expect(store.consume('e')).toBe(true)
    expect(store.consume('b')).toBe(true) // still present
  })

  // -------------------------------------------------------------------------
  // 7. clear() invalidates everything
  // -------------------------------------------------------------------------
  it('clear() invalidates all outstanding challenges', () => {
    store.issue('x')
    store.issue('y')
    store.clear()
    expect(store.consume('x')).toBe(false)
    expect(store.consume('y')).toBe(false)
    expect(store.size).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 8. has() without consuming
  // -------------------------------------------------------------------------
  it('has() returns true for outstanding, false after consume', () => {
    store.issue('h')
    expect(store.has('h')).toBe(true)
    store.consume('h')
    expect(store.has('h')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 9. size tracks only non-expired entries
  // -------------------------------------------------------------------------
  it('size reflects outstanding challenges', () => {
    expect(store.size).toBe(0)
    store.issue('a')
    store.issue('b')
    expect(store.size).toBe(2)
    store.consume('a')
    expect(store.size).toBe(1)
  })
})
