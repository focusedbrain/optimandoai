/**
 * In-Memory Decrypt Cache with TTL and Zeroization
 * ==================================================
 *
 * Holds the decrypted fields JSON string for a small number of recently
 * accessed vault records.  Each entry expires after `ttlMs` and the
 * backing string reference is released (the JS GC handles the rest;
 * Node Buffers are zeroized explicitly where used in crypto code).
 *
 * This cache exists to avoid repeated unwrap+decrypt when the UI
 * fetches the same record multiple times in quick succession (e.g.
 * open detail → close → reopen).
 *
 * Security trade-off:
 *   – Plaintext IS in memory for up to `ttlMs` (default 60 s).
 *   – At most `maxEntries` records are cached.
 *   – `flush()` wipes everything immediately (called on vault lock).
 */

export interface DecryptCacheOptions {
  /** Time-to-live per entry in milliseconds (default 60 000). */
  ttlMs?: number
  /** Maximum number of cached entries (default 16). */
  maxEntries?: number
}

interface CacheEntry {
  value: string        // decrypted fields JSON
  expiresAt: number    // Date.now() + ttlMs
  timer: ReturnType<typeof setTimeout>
}

export class DecryptCache {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly map = new Map<string, CacheEntry>()

  constructor(opts?: DecryptCacheOptions) {
    this.ttlMs = opts?.ttlMs ?? 60_000
    this.maxEntries = opts?.maxEntries ?? 16
  }

  /** Retrieve a cached decrypted value, or `undefined` if expired / absent. */
  get(itemId: string): string | undefined {
    const entry = this.map.get(itemId)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) {
      this.evict(itemId)
      return undefined
    }
    return entry.value
  }

  /** Store a decrypted value with TTL. */
  set(itemId: string, decryptedJson: string): void {
    // Evict existing entry for this ID (resets timer)
    if (this.map.has(itemId)) {
      this.evict(itemId)
    }

    // Evict oldest entry if at capacity
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey !== undefined) this.evict(oldestKey)
    }

    const expiresAt = Date.now() + this.ttlMs
    const timer = setTimeout(() => this.evict(itemId), this.ttlMs)
    // Prevent timer from keeping the process alive
    if (timer.unref) timer.unref()

    this.map.set(itemId, { value: decryptedJson, expiresAt, timer })
  }

  /** Remove one entry and clear its timer. */
  evict(itemId: string): void {
    const entry = this.map.get(itemId)
    if (entry) {
      clearTimeout(entry.timer)
      // Release reference (JS strings are immutable so we can't overwrite)
      ;(entry as any).value = ''
      this.map.delete(itemId)
    }
  }

  /** Flush the entire cache (call on vault lock). */
  flush(): void {
    for (const [id] of this.map) {
      this.evict(id)
    }
  }

  /** Number of currently cached entries. */
  get size(): number {
    return this.map.size
  }
}
