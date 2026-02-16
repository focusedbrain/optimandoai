/**
 * One-time-use challenge store with TTL.
 *
 * Each challenge can be consumed exactly once.  Expired challenges are
 * lazily pruned on every consume/has call and eagerly pruned via
 * periodic sweep.
 *
 * Default TTL = 5 minutes (300 000 ms), max outstanding = 32.
 */

export interface ChallengeStoreOptions {
  /** Time-to-live in milliseconds. Default 300 000 (5 min). */
  ttlMs?: number
  /** Maximum number of outstanding challenges. Default 32. */
  maxPending?: number
}

export class ChallengeStore {
  private readonly ttlMs: number
  private readonly maxPending: number
  /** Map<base64-challenge, expiresAtMs> */
  private readonly pending = new Map<string, number>()

  constructor(opts: ChallengeStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 300_000
    this.maxPending = opts.maxPending ?? 32
  }

  /** Register a newly issued challenge. Returns the challenge string. */
  issue(challengeBase64: string): string {
    this.prune()

    if (this.pending.size >= this.maxPending) {
      // Evict the oldest
      const oldest = this.pending.keys().next().value
      if (oldest !== undefined) this.pending.delete(oldest)
    }

    this.pending.set(challengeBase64, Date.now() + this.ttlMs)
    return challengeBase64
  }

  /**
   * Consume a challenge.  Returns `true` if valid (present + not expired).
   * The challenge is deleted regardless (one-time use).
   */
  consume(challengeBase64: string): boolean {
    const expiresAt = this.pending.get(challengeBase64)
    if (expiresAt === undefined) return false

    this.pending.delete(challengeBase64)
    return Date.now() < expiresAt
  }

  /** Check whether a challenge is still outstanding (without consuming). */
  has(challengeBase64: string): boolean {
    const expiresAt = this.pending.get(challengeBase64)
    if (expiresAt === undefined) return false
    if (Date.now() >= expiresAt) {
      this.pending.delete(challengeBase64)
      return false
    }
    return true
  }

  /** Number of outstanding (non-expired) challenges. */
  get size(): number {
    this.prune()
    return this.pending.size
  }

  /** Remove all challenges. */
  clear(): void {
    this.pending.clear()
  }

  /** Lazy sweep of expired entries. */
  private prune(): void {
    const now = Date.now()
    for (const [k, exp] of this.pending) {
      if (now >= exp) this.pending.delete(k)
    }
  }
}
