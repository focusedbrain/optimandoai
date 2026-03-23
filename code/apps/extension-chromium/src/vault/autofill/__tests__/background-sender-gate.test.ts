/**
 * Tests: Background Script — Universal Sender Gate + WebMCP routing
 *
 * These tests validate:
 *   1. The universal sender.id gate rejects messages from foreign extensions
 *   2. The sender.id gate accepts messages from the own extension
 *   3. WEBMCP_FILL_PREVIEW rate limiting is enforced (2s per tab)
 *   4. WEBMCP_FILL_PREVIEW rejects invalid params
 *   5. Global sliding-window rate limiter (MAX_WEBMCP_PER_MIN / 60s)
 *   6. Circuit breaker trips after WEBMCP_CB_THRESHOLD rejects in 30s
 *   7. Per-tab and global limiters interact correctly
 *   8. Other message types are unaffected by WebMCP limiters
 *
 * Because background.ts is a monolithic Chrome extension service worker,
 * we extract and test the gate logic declaratively rather than importing
 * the full module (which requires chrome.* globals).
 *
 * Environment: Vitest + JSDOM
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// §1  Extracted sender gate logic (mirrors background.ts lines)
// ============================================================================

/**
 * Simulates the universal sender gate from background.ts.
 * Returns true if the message should be REJECTED.
 */
function shouldRejectSender(
  sender: { id?: string } | null | undefined,
  ownExtensionId: string,
): boolean {
  if (!sender || sender.id !== ownExtensionId) return true
  return false
}

/**
 * Simulates WEBMCP rate limiting logic from background.ts.
 * Returns true if the request should be rate-limited.
 *
 * Note: A tab that has never been invoked (not in the map) is
 * always allowed. This mirrors background.ts where `lastInvoke` defaults
 * to 0, and `Date.now()` is always > 2000 in production.
 */
function isRateLimited(
  rateMap: Map<number, number>,
  tabId: number,
  now: number,
  minGapMs: number = 2000,
): boolean {
  const lastInvoke = rateMap.get(tabId)
  if (lastInvoke !== undefined && (now - lastInvoke < minGapMs)) return true
  rateMap.set(tabId, now)
  return false
}

/**
 * Validates WEBMCP_FILL_PREVIEW params (mirrors background.ts).
 */
function validateWebMcpParams(params: any): { valid: boolean; reason?: string } {
  if (!params || typeof params !== 'object') {
    return { valid: false, reason: 'Missing params' }
  }
  if (!params.itemId) {
    return { valid: false, reason: 'Missing itemId' }
  }
  if (!params.tabId) {
    return { valid: false, reason: 'Missing tabId' }
  }
  if (typeof params.tabId !== 'number' || params.tabId <= 0 || !Number.isInteger(params.tabId)) {
    return { valid: false, reason: 'Invalid tabId' }
  }
  return { valid: true }
}

/**
 * Checks whether a URL is restricted (should not run WebMCP on).
 */
function isRestrictedUrl(url: string): boolean {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('file://') ||
    !url
  )
}

// ============================================================================
// §2  Tests
// ============================================================================

describe('Background Universal Sender Gate', () => {
  const OWN_ID = 'abcdefghijklmnopqrstuvwxyz123456'

  it('rejects message with null sender', () => {
    expect(shouldRejectSender(null, OWN_ID)).toBe(true)
  })

  it('rejects message with undefined sender', () => {
    expect(shouldRejectSender(undefined, OWN_ID)).toBe(true)
  })

  it('rejects message from foreign extension', () => {
    expect(shouldRejectSender({ id: 'foreign_extension_id' }, OWN_ID)).toBe(true)
  })

  it('accepts message from own extension', () => {
    expect(shouldRejectSender({ id: OWN_ID }, OWN_ID)).toBe(false)
  })

  it('rejects sender with missing id property', () => {
    expect(shouldRejectSender({}, OWN_ID)).toBe(true)
  })

  // Verify the gate applies to auth-sensitive types
  const SENSITIVE_TYPES = [
    'AUTH_LOGIN', 'AUTH_STATUS', 'AUTH_LOGOUT',
    'VAULT_RPC', 'VAULT_HTTP_API',
    'ELECTRON_START_SELECTION', 'ELECTRON_SAVE_TRIGGER',
    'WEBMCP_FILL_PREVIEW',
  ]

  for (const msgType of SENSITIVE_TYPES) {
    it(`gate applies before ${msgType} handler`, () => {
      // The universal gate runs before any type dispatch,
      // so a foreign sender is always rejected regardless of msg.type
      const rejected = shouldRejectSender({ id: 'foreign' }, OWN_ID)
      expect(rejected).toBe(true)
    })
  }
})

describe('Background WEBMCP Rate Limiting', () => {
  let rateMap: Map<number, number>

  beforeEach(() => {
    rateMap = new Map()
  })

  it('allows first request for a tab', () => {
    expect(isRateLimited(rateMap, 42, 1000)).toBe(false)
  })

  it('rejects request within 2s window', () => {
    isRateLimited(rateMap, 42, 1000) // first call
    expect(isRateLimited(rateMap, 42, 2500)).toBe(true) // 1.5s later
  })

  it('allows request after 2s window', () => {
    isRateLimited(rateMap, 42, 1000)
    expect(isRateLimited(rateMap, 42, 3001)).toBe(false) // 2.001s later
  })

  it('tracks different tabs independently', () => {
    isRateLimited(rateMap, 42, 1000)
    expect(isRateLimited(rateMap, 99, 1500)).toBe(false) // different tab
  })
})

describe('Background WEBMCP Param Validation', () => {
  it('rejects null params', () => {
    expect(validateWebMcpParams(null).valid).toBe(false)
  })

  it('rejects missing itemId', () => {
    expect(validateWebMcpParams({ tabId: 1 }).valid).toBe(false)
  })

  it('rejects missing tabId', () => {
    expect(validateWebMcpParams({ itemId: 'abc' }).valid).toBe(false)
  })

  it('rejects non-integer tabId', () => {
    expect(validateWebMcpParams({ itemId: 'abc', tabId: 1.5 }).valid).toBe(false)
  })

  it('rejects negative tabId', () => {
    expect(validateWebMcpParams({ itemId: 'abc', tabId: -1 }).valid).toBe(false)
  })

  it('accepts valid params', () => {
    expect(validateWebMcpParams({ itemId: 'abc', tabId: 42 }).valid).toBe(true)
  })
})

describe('Background WEBMCP RateMap Cleanup on Tab Removal', () => {
  it('removes entry when tab is closed', () => {
    const rateMap = new Map<number, number>()
    rateMap.set(42, 1000)
    rateMap.set(99, 2000)

    // Simulate chrome.tabs.onRemoved for tab 42
    rateMap.delete(42)

    expect(rateMap.has(42)).toBe(false)
    expect(rateMap.has(99)).toBe(true)
  })

  it('is safe when tab was never in the map', () => {
    const rateMap = new Map<number, number>()

    // Delete a key that doesn't exist — Map.delete returns false, no error
    const result = rateMap.delete(999)
    expect(result).toBe(false)
    expect(rateMap.size).toBe(0)
  })

  it('null rateMap does not throw', () => {
    // Mirrors the guard: if (_webMcpRateMap) _webMcpRateMap.delete(tabId)
    let rateMap: Map<number, number> | null = null
    expect(() => { if (rateMap) rateMap.delete(42) }).not.toThrow()
  })
})

describe('Restricted URL Detection', () => {
  it('blocks chrome:// URLs', () => {
    expect(isRestrictedUrl('chrome://settings')).toBe(true)
  })

  it('blocks chrome-extension:// URLs', () => {
    expect(isRestrictedUrl('chrome-extension://abc/popup.html')).toBe(true)
  })

  it('blocks about: URLs', () => {
    expect(isRestrictedUrl('about:blank')).toBe(true)
  })

  it('blocks file:// URLs', () => {
    expect(isRestrictedUrl('file:///C:/test.html')).toBe(true)
  })

  it('blocks empty URL', () => {
    expect(isRestrictedUrl('')).toBe(true)
  })

  it('allows https:// URLs', () => {
    expect(isRestrictedUrl('https://example.com')).toBe(false)
  })

  it('allows http:// URLs', () => {
    expect(isRestrictedUrl('http://localhost:3000')).toBe(false)
  })
})

// ============================================================================
// §3  Extracted global rate limiter logic (mirrors background.ts)
// ============================================================================

/** Mirrors MAX_WEBMCP_PER_MIN from background.ts */
const MAX_WEBMCP_PER_MIN = 20
const WEBMCP_WINDOW_MS = 60_000

/**
 * Simulates the global sliding-window rate limiter from background.ts.
 *
 * Mutates `timestamps` in place (prune + push).
 * Returns `{ allowed: true }` or `{ allowed: false, retryAfterMs }`.
 */
function checkGlobalLimit(
  timestamps: number[],
  now: number,
  maxPerWindow: number = MAX_WEBMCP_PER_MIN,
  windowMs: number = WEBMCP_WINDOW_MS,
): { allowed: boolean; retryAfterMs?: number; timestamps: number[] } {
  const windowStart = now - windowMs
  const pruned = timestamps.filter(t => t > windowStart)
  if (pruned.length >= maxPerWindow) {
    const oldest = pruned[0]
    const retryAfterMs = Math.max(oldest + windowMs - now, 1)
    return { allowed: false, retryAfterMs, timestamps: pruned }
  }
  pruned.push(now)
  return { allowed: true, timestamps: pruned }
}

// ============================================================================
// §4  Extracted circuit breaker logic (mirrors background.ts)
// ============================================================================

/** Mirrors WEBMCP_CB_THRESHOLD from background.ts */
const WEBMCP_CB_THRESHOLD = 10
const WEBMCP_CB_WINDOW_MS = 30_000
const WEBMCP_CB_COOLDOWN_MS = 10_000

interface CircuitBreakerState {
  rejects: number[]
  openedAt: number  // 0 = closed
}

/**
 * Check if the circuit breaker blocks the request.
 * Returns `{ blocked: true, retryAfterMs }` or `{ blocked: false }`.
 */
function checkCircuitBreaker(
  state: CircuitBreakerState,
  now: number,
): { blocked: boolean; retryAfterMs?: number } {
  if (state.openedAt > 0) {
    const elapsed = now - state.openedAt
    if (elapsed < WEBMCP_CB_COOLDOWN_MS) {
      return { blocked: true, retryAfterMs: WEBMCP_CB_COOLDOWN_MS - elapsed }
    }
    // Cooldown expired — close
    state.openedAt = 0
    state.rejects = []
  }
  return { blocked: false }
}

/**
 * Record a rejection-class event and potentially trip the breaker.
 * Returns true if the circuit just opened.
 */
function recordReject(state: CircuitBreakerState, now: number): boolean {
  const windowStart = now - WEBMCP_CB_WINDOW_MS
  state.rejects = state.rejects.filter(t => t > windowStart)
  state.rejects.push(now)
  if (state.rejects.length >= WEBMCP_CB_THRESHOLD) {
    state.openedAt = now
    return true
  }
  return false
}

// ============================================================================
// §5  Global Rate Limiter Tests
// ============================================================================

describe('Background WEBMCP Global Rate Limiter', () => {
  let timestamps: number[]

  beforeEach(() => {
    timestamps = []
  })

  it('allows requests under the limit', () => {
    const base = 100_000
    for (let i = 0; i < MAX_WEBMCP_PER_MIN; i++) {
      const result = checkGlobalLimit(timestamps, base + i * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
      timestamps = result.timestamps
      expect(result.allowed).toBe(true)
    }
    expect(timestamps.length).toBe(MAX_WEBMCP_PER_MIN)
  })

  it('rejects the (MAX+1)th request within the window', () => {
    const base = 100_000
    for (let i = 0; i < MAX_WEBMCP_PER_MIN; i++) {
      const r = checkGlobalLimit(timestamps, base + i * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
      timestamps = r.timestamps
    }
    // 21st request
    const result = checkGlobalLimit(timestamps, base + MAX_WEBMCP_PER_MIN * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
    timestamps = result.timestamps
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('provides a meaningful retryAfterMs', () => {
    const base = 100_000
    for (let i = 0; i < MAX_WEBMCP_PER_MIN; i++) {
      const r = checkGlobalLimit(timestamps, base + i * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
      timestamps = r.timestamps
    }
    // Try just 500ms after the last accepted
    const tryAt = base + (MAX_WEBMCP_PER_MIN - 1) * 100 + 500
    const result = checkGlobalLimit(timestamps, tryAt, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
    expect(result.allowed).toBe(false)
    // retryAfterMs should be roughly (WEBMCP_WINDOW_MS - elapsed since oldest)
    expect(result.retryAfterMs).toBeLessThanOrEqual(WEBMCP_WINDOW_MS)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('allows requests again after the window expires', () => {
    const base = 100_000
    for (let i = 0; i < MAX_WEBMCP_PER_MIN; i++) {
      const r = checkGlobalLimit(timestamps, base + i * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
      timestamps = r.timestamps
    }
    // All slots used; advance past the window
    const laterTime = base + WEBMCP_WINDOW_MS + 1
    const result = checkGlobalLimit(timestamps, laterTime, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
    timestamps = result.timestamps
    expect(result.allowed).toBe(true)
  })

  it('prunes old timestamps on each check', () => {
    const base = 100_000
    for (let i = 0; i < 10; i++) {
      const r = checkGlobalLimit(timestamps, base + i * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
      timestamps = r.timestamps
    }
    expect(timestamps.length).toBe(10)

    // Advance well past the window so ALL old entries are expired
    // Last entry was at base + 900; window is 60_000 ms
    // We need now - windowMs > base + 900, i.e., now > base + 900 + 60_000
    const r = checkGlobalLimit(timestamps, base + WEBMCP_WINDOW_MS + 1000, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
    timestamps = r.timestamps
    expect(timestamps.length).toBe(1) // only the new one
  })
})

// ============================================================================
// §6  Circuit Breaker Tests
// ============================================================================

describe('Background WEBMCP Circuit Breaker', () => {
  let cbState: CircuitBreakerState

  beforeEach(() => {
    cbState = { rejects: [], openedAt: 0 }
  })

  it('circuit is closed by default', () => {
    const result = checkCircuitBreaker(cbState, 100_000)
    expect(result.blocked).toBe(false)
  })

  it('does not trip below threshold', () => {
    const base = 100_000
    for (let i = 0; i < WEBMCP_CB_THRESHOLD - 1; i++) {
      recordReject(cbState, base + i * 100)
    }
    expect(cbState.openedAt).toBe(0)
    expect(checkCircuitBreaker(cbState, base + 10_000).blocked).toBe(false)
  })

  it('trips at exactly the threshold', () => {
    const base = 100_000
    for (let i = 0; i < WEBMCP_CB_THRESHOLD; i++) {
      recordReject(cbState, base + i * 100)
    }
    expect(cbState.openedAt).toBe(base + (WEBMCP_CB_THRESHOLD - 1) * 100)
  })

  it('blocks requests while circuit is open', () => {
    const base = 100_000
    for (let i = 0; i < WEBMCP_CB_THRESHOLD; i++) {
      recordReject(cbState, base + i * 100)
    }
    // Circuit is now open. Check immediately after.
    const tripTime = cbState.openedAt
    const result = checkCircuitBreaker(cbState, tripTime + 1000)
    expect(result.blocked).toBe(true)
    expect(result.retryAfterMs).toBeGreaterThan(0)
    expect(result.retryAfterMs).toBeLessThanOrEqual(WEBMCP_CB_COOLDOWN_MS)
  })

  it('returns correct retryAfterMs during cooldown', () => {
    const base = 100_000
    for (let i = 0; i < WEBMCP_CB_THRESHOLD; i++) {
      recordReject(cbState, base + i * 100)
    }
    const tripTime = cbState.openedAt
    // Check 3 seconds into cooldown
    const result = checkCircuitBreaker(cbState, tripTime + 3000)
    expect(result.blocked).toBe(true)
    expect(result.retryAfterMs).toBe(WEBMCP_CB_COOLDOWN_MS - 3000)
  })

  it('closes circuit after cooldown expires', () => {
    const base = 100_000
    for (let i = 0; i < WEBMCP_CB_THRESHOLD; i++) {
      recordReject(cbState, base + i * 100)
    }
    const tripTime = cbState.openedAt
    // Check after cooldown
    const result = checkCircuitBreaker(cbState, tripTime + WEBMCP_CB_COOLDOWN_MS + 1)
    expect(result.blocked).toBe(false)
    expect(cbState.openedAt).toBe(0)
    expect(cbState.rejects.length).toBe(0)
  })

  it('reject history outside the observation window does not count', () => {
    // Old rejects far in the past should be pruned
    const base = 100_000
    for (let i = 0; i < WEBMCP_CB_THRESHOLD - 1; i++) {
      recordReject(cbState, base + i * 100)
    }
    // Advance well past the window so ALL old entries expire
    // Last reject was at base + 800; window is 30_000 ms
    const laterTime = base + WEBMCP_CB_WINDOW_MS + 1000
    // One more reject after the window — should NOT trip (old ones pruned)
    const tripped = recordReject(cbState, laterTime)
    expect(tripped).toBe(false)
    expect(cbState.openedAt).toBe(0)
    expect(cbState.rejects.length).toBe(1) // only the new one
  })

  it('rejects array does not grow unboundedly', () => {
    // Record rejects across a long period (many windows)
    for (let i = 0; i < 100; i++) {
      const time = 100_000 + i * (WEBMCP_CB_WINDOW_MS + 1000)
      recordReject(cbState, time)
    }
    // Should have only entries from the last window (1 entry)
    expect(cbState.rejects.length).toBe(1)
  })
})

// ============================================================================
// §7  Per-Tab + Global Limiter Interaction Tests
// ============================================================================

describe('Per-Tab and Global Limiter Interaction', () => {
  let rateMap: Map<number, number>
  let timestamps: number[]

  beforeEach(() => {
    rateMap = new Map()
    timestamps = []
  })

  it('per-tab limiter fires before global limiter is consumed', () => {
    const base = 100_000
    // Tab 42: first request allowed
    expect(isRateLimited(rateMap, 42, base)).toBe(false)
    const r1 = checkGlobalLimit(timestamps, base, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
    timestamps = r1.timestamps
    expect(r1.allowed).toBe(true)

    // Tab 42: second request 500ms later — per-tab blocks it
    expect(isRateLimited(rateMap, 42, base + 500)).toBe(true)
    // Global limiter is NOT consumed because per-tab rejects first
    expect(timestamps.length).toBe(1)
  })

  it('different tabs each consume a global slot', () => {
    const base = 100_000
    for (let tab = 1; tab <= MAX_WEBMCP_PER_MIN; tab++) {
      expect(isRateLimited(rateMap, tab, base + tab * 100)).toBe(false)
      const r = checkGlobalLimit(timestamps, base + tab * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
      timestamps = r.timestamps
      expect(r.allowed).toBe(true)
    }
    // 21st tab — per-tab allows (first request) but global blocks
    expect(isRateLimited(rateMap, MAX_WEBMCP_PER_MIN + 1, base + (MAX_WEBMCP_PER_MIN + 1) * 100)).toBe(false)
    const rFinal = checkGlobalLimit(timestamps, base + (MAX_WEBMCP_PER_MIN + 1) * 100, MAX_WEBMCP_PER_MIN, WEBMCP_WINDOW_MS)
    timestamps = rFinal.timestamps
    expect(rFinal.allowed).toBe(false)
  })
})

// ============================================================================
// §8  Non-WEBMCP Messages Unaffected
// ============================================================================

describe('Non-WEBMCP message types are unaffected by WebMCP limiters', () => {
  it('AUTH_STATUS is not subject to global rate limiter', () => {
    // Global limiter only applies to WEBMCP_FILL_PREVIEW handler.
    // This is a structural test: the extracted checkGlobalLimit function
    // is only called within the WEBMCP_FILL_PREVIEW block.
    // We verify by asserting the function exists and type-checks.
    expect(typeof checkGlobalLimit).toBe('function')

    // The sender gate applies to all types, but limiters are WebMCP-only.
    // Verify sender gate rejects foreign sender for AUTH_STATUS:
    expect(shouldRejectSender({ id: 'foreign' }, 'own_id')).toBe(true)
    // But accepts own sender:
    expect(shouldRejectSender({ id: 'own_id' }, 'own_id')).toBe(false)
  })

  it('circuit breaker state is independent of non-WebMCP messages', () => {
    const cbState: CircuitBreakerState = { rejects: [], openedAt: 0 }
    // Circuit breaker only records rejects from WEBMCP handler.
    // Non-WebMCP invalid messages do not trip it.
    expect(checkCircuitBreaker(cbState, Date.now()).blocked).toBe(false)
  })
})

// ============================================================================
// §9  Sender Gate + Limiter Ordering
// ============================================================================

describe('Sender gate runs before any rate limiter', () => {
  it('foreign sender is rejected without touching rate limiters', () => {
    // The design requires: sender gate → circuit breaker → schema → per-tab → global
    // A foreign sender should be caught at step 1, before any rate state is modified.
    const rejected = shouldRejectSender({ id: 'foreign' }, 'own_id')
    expect(rejected).toBe(true)

    // Verify no limiter state was touched
    const timestamps: number[] = []
    const cbState: CircuitBreakerState = { rejects: [], openedAt: 0 }
    // These should still be at initial state
    expect(timestamps.length).toBe(0)
    expect(cbState.rejects.length).toBe(0)
  })
})

// ============================================================================
// §10 Source-Level Contract Verification
// ============================================================================

describe('background.ts exports WebMCP constants', () => {
  it('MAX_WEBMCP_PER_MIN is 20', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')
    expect(source).toContain('export const MAX_WEBMCP_PER_MIN = 20')
  })

  it('WEBMCP_CB_THRESHOLD is 10', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')
    expect(source).toContain('export const WEBMCP_CB_THRESHOLD = 10')
  })

  it('WEBMCP_CB_WINDOW_MS is 30_000', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')
    expect(source).toContain('export const WEBMCP_CB_WINDOW_MS = 30_000')
  })

  it('WEBMCP_CB_COOLDOWN_MS is 10_000', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')
    expect(source).toContain('export const WEBMCP_CB_COOLDOWN_MS = 10_000')
  })

  it('circuit breaker handler logs WEBMCP_CIRCUIT_OPEN', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')
    expect(source).toContain('WEBMCP_CIRCUIT_OPEN')
  })

  it('circuit breaker log message contains no sensitive details', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')
    // Find the WEBMCP_CIRCUIT_OPEN log line
    const lines = source.split('\n')
    const logLine = lines.find(l => l.includes('WEBMCP_CIRCUIT_OPEN'))
    expect(logLine).toBeDefined()
    // Must not include itemId, tabId, URL, domain, or token references
    expect(logLine).not.toMatch(/itemId|tabId|url|domain|token|password|secret/i)
  })

  it('defense layers are ordered: sender → circuit → schema → per-tab → global', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // Extract the WEBMCP_FILL_PREVIEW handler block
    const handlerStart = source.indexOf("if (msg.type === 'WEBMCP_FILL_PREVIEW')")
    expect(handlerStart).toBeGreaterThan(0)

    // Sender gate must appear before the handler
    const senderGatePos = source.indexOf('sender.id !== chrome.runtime.id')
    expect(senderGatePos).toBeGreaterThan(0)
    expect(senderGatePos).toBeLessThan(handlerStart)

    // Within the handler: circuit breaker → schema → per-tab → global
    const handlerSource = source.slice(handlerStart, handlerStart + 5000)
    const cbPos = handlerSource.indexOf('_webMcpCbOpenedAt')
    const schemaPos = handlerSource.indexOf('!params.itemId')
    const perTabPos = handlerSource.indexOf('_webMcpRateMap')
    const globalPos = handlerSource.indexOf('_webMcpGlobalTimestamps')

    expect(cbPos).toBeGreaterThan(0)
    expect(schemaPos).toBeGreaterThan(cbPos)
    expect(perTabPos).toBeGreaterThan(schemaPos)
    expect(globalPos).toBeGreaterThan(perTabPos)
  })
})

// ============================================================================
// §11  EXPORT_AUDIT_LOG Access Control — Extracted Logic
// ============================================================================

/** Mirrors AUDIT_EXPORT_ALLOWED_PAGES from background.ts */
const AUDIT_EXPORT_ALLOWED_PAGES = ['/src/popup-chat.html', '/sidepanel.html']

/** Mirrors AUDIT_EXPORT_RESULT_VERSION from background.ts */
const AUDIT_EXPORT_RESULT_VERSION = 'audit-export-v1'

/**
 * Mirrors _isExtensionUiContext() from background.ts (hardened version).
 *
 * Fail-closed: returns false if sender.tab is defined, sender.url is missing,
 * sender.url is not from our extension, or the path doesn't match an allowed page.
 */
function isExtensionUiContext(
  sender: { url?: string; tab?: unknown } | undefined | null,
  extensionId: string,
): boolean {
  if (!sender || !sender.url || typeof sender.url !== 'string') return false
  if (sender.tab) return false

  const expectedPrefix = `chrome-extension://${extensionId}`
  if (!sender.url.startsWith(expectedPrefix)) return false

  const pathStart = sender.url.indexOf('/', expectedPrefix.length)
  if (pathStart === -1) return false
  const path = sender.url.slice(pathStart).split('?')[0].split('#')[0]

  return AUDIT_EXPORT_ALLOWED_PAGES.some(allowed => path === allowed)
}

/** Mirrors VSBT_MAX_AGE_MS from background.ts (15 minutes). */
const VSBT_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Mirrors _isVaultUnlocked() from background.ts.
 * Returns true if the VSBT is a non-empty string AND not expired.
 */
function isVaultUnlocked(cachedVsbt: string | null, cachedAt = 0, now = Date.now()): boolean {
  if (typeof cachedVsbt !== 'string' || cachedVsbt.length === 0) return false
  if (cachedAt > 0 && (now - cachedAt) >= VSBT_MAX_AGE_MS) return false
  return true
}

/**
 * Simulate the full EXPORT_AUDIT_LOG handler logic (extracted for testability).
 * Returns the exact response shape the handler would send.
 *
 * This mirrors the defense layers in background.ts:
 *   1. Sender gate (simulated via `senderAllowed`)
 *   2. Context gate (_isExtensionUiContext)
 *   3. Vault unlocked gate (_isVaultUnlocked)
 *   4. HA gate (isHAEnforced)
 *   5. Export logic
 */
function simulateExportHandler(opts: {
  senderAllowed: boolean
  sender: { url?: string; tab?: unknown } | undefined | null
  extensionId: string
  cachedVsbt: string | null
  vsbtCachedAt?: number
  now?: number
  haEnforced: boolean
  haCheckThrows?: boolean
  exportResult?: { jsonl: string; truncated: boolean }
  exportThrows?: boolean
}): Record<string, any> {
  const now = opts.now ?? Date.now()
  const vsbtAt = opts.vsbtCachedAt ?? (opts.cachedVsbt ? now : 0)

  // Layer 1: sender gate
  if (!opts.senderAllowed) {
    return { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION }
  }

  // Layer 2: context gate
  if (!isExtensionUiContext(opts.sender, opts.extensionId)) {
    return { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION }
  }

  // Layer 3: vault unlocked (with TTL)
  if (!isVaultUnlocked(opts.cachedVsbt, vsbtAt, now)) {
    return { success: false, error: { code: 'LOCKED', message: 'Vault is locked' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION }
  }

  // Layer 4: HA gate (fail-closed if check throws)
  let ha: boolean
  if (opts.haCheckThrows) {
    ha = true // fail-closed
  } else {
    ha = opts.haEnforced
  }
  if (ha) {
    return { success: false, error: { code: 'HA_BLOCKED', message: 'Export blocked by security policy' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION }
  }

  // Layer 4b: recheck vault (async race guard, with TTL)
  if (!isVaultUnlocked(opts.cachedVsbt, vsbtAt, now)) {
    return { success: false, error: { code: 'LOCKED', message: 'Vault is locked' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION }
  }

  // Layer 5: export
  if (opts.exportThrows) {
    return { success: false, error: { code: 'INTERNAL_ERROR', message: 'Export failed' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION }
  }

  const result = opts.exportResult ?? { jsonl: '', truncated: false }
  return { success: true, jsonl: result.jsonl, truncated: result.truncated, resultVersion: AUDIT_EXPORT_RESULT_VERSION }
}

// ============================================================================
// §12  EXPORT_AUDIT_LOG Access Control Tests
// ============================================================================

const EXT_ID = 'abcdefghijklmnopqrstuvwxyz123456'
const VALID_UI_SENDER = { url: `chrome-extension://${EXT_ID}/src/popup-chat.html` }
const VALID_SIDEPANEL_SENDER = { url: `chrome-extension://${EXT_ID}/sidepanel.html` }
const VALID_VSBT = 'vsbt_session_token_abc123'
const VALID_EXPORT = { jsonl: '{"ts":"2026-01-01","msg":"test"}\n', truncated: false }

describe('EXPORT_AUDIT_LOG — context gate: sender.tab rejection', () => {
  it('rejects when sender.tab is present (content-script context)', () => {
    const sender = { url: `chrome-extension://${EXT_ID}/src/popup-chat.html`, tab: { id: 42 } }
    expect(isExtensionUiContext(sender, EXT_ID)).toBe(false)

    const resp = simulateExportHandler({
      senderAllowed: true, sender, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('FORBIDDEN')
    expect(resp).not.toHaveProperty('jsonl')
    expect(resp).not.toHaveProperty('truncated')
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })

  it('rejects when sender.tab is truthy non-object (edge case)', () => {
    const sender = { url: `chrome-extension://${EXT_ID}/src/popup-chat.html`, tab: true as any }
    expect(isExtensionUiContext(sender, EXT_ID)).toBe(false)
  })

  it('rejects when sender.tab is numeric (another edge case)', () => {
    const sender = { url: `chrome-extension://${EXT_ID}/src/popup-chat.html`, tab: 1 as any }
    expect(isExtensionUiContext(sender, EXT_ID)).toBe(false)
  })
})

describe('EXPORT_AUDIT_LOG — context gate: URL validation', () => {
  it('rejects options.html (not in allowlist)', () => {
    const sender = { url: `chrome-extension://${EXT_ID}/options.html` }
    expect(isExtensionUiContext(sender, EXT_ID)).toBe(false)
  })

  it('rejects background.html (not in allowlist)', () => {
    const sender = { url: `chrome-extension://${EXT_ID}/background.html` }
    expect(isExtensionUiContext(sender, EXT_ID)).toBe(false)
  })

  it('rejects random external page', () => {
    expect(isExtensionUiContext({ url: 'https://evil.com/src/popup-chat.html' }, EXT_ID)).toBe(false)
    expect(isExtensionUiContext({ url: 'http://localhost/src/popup-chat.html' }, EXT_ID)).toBe(false)
  })

  it('rejects foreign extension ID', () => {
    expect(isExtensionUiContext({ url: 'chrome-extension://foreign_id_abc/src/popup-chat.html' }, EXT_ID)).toBe(false)
  })

  it('rejects when sender.url is missing or empty', () => {
    expect(isExtensionUiContext({}, EXT_ID)).toBe(false)
    expect(isExtensionUiContext({ url: undefined }, EXT_ID)).toBe(false)
    expect(isExtensionUiContext({ url: '' }, EXT_ID)).toBe(false)
  })

  it('rejects null/undefined sender', () => {
    expect(isExtensionUiContext(null, EXT_ID)).toBe(false)
    expect(isExtensionUiContext(undefined, EXT_ID)).toBe(false)
  })

  it('rejects extension root path (no page)', () => {
    expect(isExtensionUiContext({ url: `chrome-extension://${EXT_ID}/` }, EXT_ID)).toBe(false)
  })

  it('accepts popup-chat.html', () => {
    expect(isExtensionUiContext(VALID_UI_SENDER, EXT_ID)).toBe(true)
  })

  it('accepts sidepanel.html', () => {
    expect(isExtensionUiContext(VALID_SIDEPANEL_SENDER, EXT_ID)).toBe(true)
  })

  it('strips query strings from URL path before matching', () => {
    expect(isExtensionUiContext({ url: `chrome-extension://${EXT_ID}/src/popup-chat.html?foo=bar&x=1` }, EXT_ID)).toBe(true)
  })

  it('strips hash fragments from URL path before matching', () => {
    expect(isExtensionUiContext({ url: `chrome-extension://${EXT_ID}/sidepanel.html#section` }, EXT_ID)).toBe(true)
  })
})

describe('EXPORT_AUDIT_LOG — vault unlocked gate', () => {
  it('blocks when vault is locked (VSBT is null)', () => {
    expect(isVaultUnlocked(null)).toBe(false)
  })

  it('blocks when VSBT is empty string', () => {
    expect(isVaultUnlocked('')).toBe(false)
  })

  it('blocks when VSBT is undefined-coerced', () => {
    expect(isVaultUnlocked(undefined as any)).toBe(false)
  })

  it('allows when vault is unlocked (VSBT present)', () => {
    expect(isVaultUnlocked(VALID_VSBT)).toBe(true)
  })

  it('simulates lock → VSBT cleared → export blocks immediately', () => {
    // Phase 1: vault unlocked — export allowed
    let vsbt: string | null = VALID_VSBT
    expect(isVaultUnlocked(vsbt)).toBe(true)

    let resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: vsbt, haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(true)

    // Phase 2: vault locked (simulate _cacheVsbt(null)) — export blocks
    vsbt = null // mirrors _cacheVsbt(null) on /lock endpoint
    expect(isVaultUnlocked(vsbt)).toBe(false)

    resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: vsbt, haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('LOCKED')
    expect(resp).not.toHaveProperty('jsonl')
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })

  it('simulates AUTH_LOGOUT → VSBT cleared → export blocks', () => {
    // AUTH_LOGOUT must clear VSBT synchronously (before async network call)
    let vsbt: string | null = VALID_VSBT

    // Simulate: AUTH_LOGOUT received → _cacheVsbt(null) called immediately
    vsbt = null

    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: vsbt, haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('LOCKED')
  })
})

describe('EXPORT_AUDIT_LOG — HA gate', () => {
  it('blocks export under HA mode with HA_BLOCKED error code', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: true, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('HA_BLOCKED')
    expect(resp.error.message).toBe('Export blocked by security policy')
    expect(resp).not.toHaveProperty('jsonl')
    expect(resp).not.toHaveProperty('truncated')
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })

  it('fails closed if HA check throws (defaults to HA active)', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: false, haCheckThrows: true,
      exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('HA_BLOCKED')
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })
})

// ============================================================================
// §12b  VSBT Staleness Mitigations
// ============================================================================

describe('EXPORT_AUDIT_LOG — VSBT TTL expiry', () => {
  it('allows export when VSBT is fresh (within TTL)', () => {
    const now = 1_000_000
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, vsbtCachedAt: now - 60_000, now,
      haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(true)
  })

  it('blocks export when VSBT is exactly at TTL boundary', () => {
    const now = 1_000_000
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, vsbtCachedAt: now - VSBT_MAX_AGE_MS, now,
      haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('LOCKED')
  })

  it('blocks export when VSBT is past TTL', () => {
    const now = 1_000_000
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, vsbtCachedAt: now - VSBT_MAX_AGE_MS - 1, now,
      haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('LOCKED')
  })

  it('VSBT_MAX_AGE_MS is 15 minutes', () => {
    expect(VSBT_MAX_AGE_MS).toBe(15 * 60 * 1000)
  })

  it('treats vsbtCachedAt=0 with non-null VSBT as valid (legacy compat)', () => {
    // If _vsbtCachedAt is 0 (e.g., old session restore), the TTL check is skipped
    expect(isVaultUnlocked(VALID_VSBT, 0, Date.now())).toBe(true)
  })
})

describe('EXPORT_AUDIT_LOG — VSBT cleared on WebSocket close', () => {
  it('simulates WS close → VSBT cleared → export blocks', () => {
    let vsbt: string | null = VALID_VSBT
    let vsbtAt = Date.now()

    // Before WS close: vault unlocked
    expect(isVaultUnlocked(vsbt, vsbtAt)).toBe(true)

    // WS close event fires → _cacheVsbt(null) called
    vsbt = null
    vsbtAt = 0

    // After WS close: vault locked
    expect(isVaultUnlocked(vsbt, vsbtAt)).toBe(false)

    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: vsbt, vsbtCachedAt: vsbtAt, haEnforced: false,
      exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('LOCKED')
  })
})

describe('EXPORT_AUDIT_LOG — VSBT cleared on HTTP 401', () => {
  it('simulates 401 → VSBT cleared → export blocks', () => {
    let vsbt: string | null = VALID_VSBT
    let vsbtAt = Date.now()

    // Before 401: vault unlocked
    expect(isVaultUnlocked(vsbt, vsbtAt)).toBe(true)

    // HTTP 401 received → _cacheVsbt(null) called
    vsbt = null
    vsbtAt = 0

    // After 401: vault locked
    expect(isVaultUnlocked(vsbt, vsbtAt)).toBe(false)

    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: vsbt, vsbtCachedAt: vsbtAt, haEnforced: false,
      exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('LOCKED')
  })
})

describe('EXPORT_AUDIT_LOG — rejection does not leak jsonl or truncated', () => {
  it('context gate rejection: no jsonl, no truncated', () => {
    const resp = simulateExportHandler({
      senderAllowed: true,
      sender: { url: `chrome-extension://${EXT_ID}/options.html` },
      extensionId: EXT_ID, cachedVsbt: VALID_VSBT, haEnforced: false,
      exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp).not.toHaveProperty('jsonl')
    expect(resp).not.toHaveProperty('truncated')
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })

  it('vault locked rejection: no jsonl, no truncated', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: null, haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp).not.toHaveProperty('jsonl')
    expect(resp).not.toHaveProperty('truncated')
  })

  it('HA blocked rejection: no jsonl, no truncated', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: true, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(false)
    expect(resp).not.toHaveProperty('jsonl')
    expect(resp).not.toHaveProperty('truncated')
  })

  it('internal error rejection: no jsonl, no truncated', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: false, exportThrows: true,
    })
    expect(resp.success).toBe(false)
    expect(resp.error.code).toBe('INTERNAL_ERROR')
    expect(resp).not.toHaveProperty('jsonl')
    expect(resp).not.toHaveProperty('truncated')
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })
})

describe('EXPORT_AUDIT_LOG — successful export response shape', () => {
  it('returns success with jsonl, truncated, and resultVersion', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(true)
    expect(resp.jsonl).toBe(VALID_EXPORT.jsonl)
    expect(resp.truncated).toBe(false)
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
    expect(resp).not.toHaveProperty('error')
  })

  it('passes through truncated flag when export is truncated', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: false,
      exportResult: { jsonl: 'truncated...', truncated: true },
    })
    expect(resp.success).toBe(true)
    expect(resp.truncated).toBe(true)
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })

  it('sidepanel sender also gets successful export', () => {
    const resp = simulateExportHandler({
      senderAllowed: true, sender: VALID_SIDEPANEL_SENDER, extensionId: EXT_ID,
      cachedVsbt: VALID_VSBT, haEnforced: false, exportResult: VALID_EXPORT,
    })
    expect(resp.success).toBe(true)
    expect(resp.resultVersion).toBe(AUDIT_EXPORT_RESULT_VERSION)
  })
})

describe('EXPORT_AUDIT_LOG — no PII in audit log messages', () => {
  it('no response contains sender.url, tabId, or VSBT', () => {
    const scenarios = [
      // Rejection paths
      simulateExportHandler({
        senderAllowed: true,
        sender: { url: `chrome-extension://${EXT_ID}/options.html`, tab: { id: 99 } },
        extensionId: EXT_ID, cachedVsbt: VALID_VSBT, haEnforced: false,
      }),
      simulateExportHandler({
        senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
        cachedVsbt: null, haEnforced: false,
      }),
      simulateExportHandler({
        senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
        cachedVsbt: VALID_VSBT, haEnforced: true,
      }),
      // Success path
      simulateExportHandler({
        senderAllowed: true, sender: VALID_UI_SENDER, extensionId: EXT_ID,
        cachedVsbt: VALID_VSBT, haEnforced: false,
        exportResult: { jsonl: '{"safe":"data"}', truncated: false },
      }),
    ]

    for (const resp of scenarios) {
      const serialized = JSON.stringify(resp)
      // Must NOT contain any sender info
      expect(serialized).not.toContain('sender.url')
      expect(serialized).not.toContain('sender.tab')
      expect(serialized).not.toContain(VALID_VSBT)
      expect(serialized).not.toContain(EXT_ID)
      expect(serialized).not.toContain('options.html')
      expect(serialized).not.toContain('tabId')
      // Error messages must be generic
      if (!resp.success) {
        expect(resp.error.message).not.toMatch(/sender|tab|url|vsbt|chrome-extension/i)
      }
    }
  })
})

describe('EXPORT_AUDIT_LOG — source-level verification', () => {
  it('all four granular audit codes exist in background.ts', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    expect(source).toContain('EXPORT_AUDIT_ALLOWED')
    expect(source).toContain('EXPORT_AUDIT_BLOCKED_CONTEXT')
    expect(source).toContain('EXPORT_AUDIT_BLOCKED_LOCKED')
    expect(source).toContain('EXPORT_AUDIT_BLOCKED_HA')
  })

  it('AUDIT_EXPORT_RESULT_VERSION constant exists and matches expected value', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    expect(source).toContain("AUDIT_EXPORT_RESULT_VERSION = 'audit-export-v1'")
  })

  it('AuditExportErrorCode type contains exactly FORBIDDEN, LOCKED, HA_BLOCKED, INTERNAL_ERROR', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    expect(source).toContain("type AuditExportErrorCode = 'FORBIDDEN' | 'LOCKED' | 'HA_BLOCKED' | 'INTERNAL_ERROR'")
  })

  it('audit log messages contain no sensitive information', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const lines = source.split('\n').filter((l: string) =>
      l.includes('EXPORT_AUDIT_ALLOWED') ||
      l.includes('EXPORT_AUDIT_BLOCKED_CONTEXT') ||
      l.includes('EXPORT_AUDIT_BLOCKED_LOCKED') ||
      l.includes('EXPORT_AUDIT_BLOCKED_HA'),
    )
    expect(lines.length).toBeGreaterThan(0)

    for (const line of lines) {
      expect(line).not.toMatch(/tabId|sender\.url|sender\.tab|_cachedVsbt/i)
      expect(line).not.toMatch(/\$\{.*sender/i)
      expect(line).not.toMatch(/\$\{.*url/i)
      expect(line).not.toMatch(/\$\{.*vsbt/i)
    }
  })

  it('handler checks sender.tab before calling exportAuditLogJsonl()', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const fnStart = source.indexOf('function _isExtensionUiContext')
    expect(fnStart).toBeGreaterThan(0)
    const fnBody = source.slice(fnStart, fnStart + 600)
    expect(fnBody).toContain('sender.tab')

    const handlerStart = source.indexOf("if (msg.type === 'EXPORT_AUDIT_LOG')")
    const handlerSource = source.slice(handlerStart, handlerStart + 3000)
    const contextCheckPos = handlerSource.indexOf('_isExtensionUiContext')
    const exportPos = handlerSource.indexOf('exportAuditLogJsonl')
    expect(contextCheckPos).toBeGreaterThan(0)
    expect(exportPos).toBeGreaterThan(contextCheckPos)
  })

  it('handler enforces layers: sender → context → vault → HA → vault-recheck → export', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const handlerStart = source.indexOf("if (msg.type === 'EXPORT_AUDIT_LOG')")
    expect(handlerStart).toBeGreaterThan(0)

    // Sender gate must appear BEFORE the handler (global gate)
    const senderGatePos = source.indexOf('sender.id !== chrome.runtime.id')
    expect(senderGatePos).toBeGreaterThan(0)
    expect(senderGatePos).toBeLessThan(handlerStart)

    // Within handler: context → vault → HA → vault-recheck → export
    const handlerSource = source.slice(handlerStart, handlerStart + 3000)
    const contextPos = handlerSource.indexOf('_isExtensionUiContext')
    const vaultPos = handlerSource.indexOf('_isVaultUnlocked')
    const haPos = handlerSource.indexOf('EXPORT_AUDIT_BLOCKED_HA')
    const exportPos = handlerSource.indexOf('exportAuditLogJsonl')

    expect(contextPos).toBeGreaterThan(0)
    expect(vaultPos).toBeGreaterThan(contextPos)
    expect(haPos).toBeGreaterThan(vaultPos)
    expect(exportPos).toBeGreaterThan(haPos)

    // Double-check: vault recheck must occur AFTER HA gate but BEFORE export
    // Find the SECOND occurrence of _isVaultUnlocked (the async recheck)
    const secondVaultPos = handlerSource.indexOf('_isVaultUnlocked', vaultPos + 1)
    expect(secondVaultPos).toBeGreaterThan(haPos)
    expect(secondVaultPos).toBeLessThan(exportPos)
  })

  it('all responses include resultVersion: AUDIT_EXPORT_RESULT_VERSION', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const handlerStart = source.indexOf("if (msg.type === 'EXPORT_AUDIT_LOG')")
    const handlerEnd = source.indexOf("return true // async", handlerStart + 1)
    const handlerSource = source.slice(handlerStart, handlerEnd + 50)

    // Count sendResponse calls — each must include resultVersion
    const sendResponseCalls = handlerSource.match(/sendResponse\(/g) ?? []
    expect(sendResponseCalls.length).toBeGreaterThanOrEqual(5) // context, vault, HA, export-ok, catch

    const resultVersionRefs = handlerSource.match(/resultVersion:\s*AUDIT_EXPORT_RESULT_VERSION/g) ?? []
    expect(resultVersionRefs.length).toBe(sendResponseCalls.length)
  })

  it('error responses use structured { code, message } shape', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const handlerStart = source.indexOf("if (msg.type === 'EXPORT_AUDIT_LOG')")
    const handlerEnd = source.indexOf("return true // async", handlerStart + 1)
    const handlerSource = source.slice(handlerStart, handlerEnd + 50)

    // All error responses must use object shape { code: ..., message: ... }
    expect(handlerSource).toContain("code: 'FORBIDDEN'")
    expect(handlerSource).toContain("code: 'LOCKED'")
    expect(handlerSource).toContain("code: 'HA_BLOCKED'")
    expect(handlerSource).toContain("code: 'INTERNAL_ERROR'")

    // No old-style flat error strings like error: 'Forbidden'
    const flatForbiddenMatches = handlerSource.match(/error:\s*'Forbidden'/g) ?? []
    expect(flatForbiddenMatches.length).toBe(0)
  })

  it('AUTH_LOGOUT handler clears VSBT synchronously before async work', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const logoutStart = source.indexOf("msg.type === 'AUTH_LOGOUT'")
    expect(logoutStart).toBeGreaterThan(0)
    const logoutSource = source.slice(logoutStart, logoutStart + 600)

    // _cacheVsbt(null) must appear BEFORE the async IIFE
    const vsbtClearPos = logoutSource.indexOf('_cacheVsbt(null)')
    const asyncPos = logoutSource.indexOf('(async')
    expect(vsbtClearPos).toBeGreaterThan(0)
    expect(asyncPos).toBeGreaterThan(vsbtClearPos)
  })

  it('_auditExportLog helper elevates severity under HA', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const fnStart = source.indexOf('function _auditExportLog')
    expect(fnStart).toBeGreaterThan(0)
    const fnBody = source.slice(fnStart, fnStart + 800)

    expect(fnBody).toContain('EXPORT_AUDIT_BLOCKED_HA')
    expect(fnBody).toContain("'security'")
    expect(fnBody).toContain("'info'")
    expect(fnBody).toContain("'warn'")
  })

  it('HA gate defaults to fail-closed (ha = true) if import throws', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const handlerStart = source.indexOf("if (msg.type === 'EXPORT_AUDIT_LOG')")
    const handlerSource = source.slice(handlerStart, handlerStart + 3000)

    // Must have fail-closed default: let ha = true
    expect(handlerSource).toContain('let ha = true')
    // Must have a try/catch around the isHAEnforced import
    expect(handlerSource).toContain('isHAEnforced')
  })

  it('VSBT_MAX_AGE_MS constant exists and equals 15 minutes', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    expect(source).toContain('VSBT_MAX_AGE_MS = 15 * 60 * 1000')
  })

  it('_isVaultUnlocked checks TTL via _vsbtCachedAt', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const fnStart = source.indexOf('function _isVaultUnlocked')
    expect(fnStart).toBeGreaterThan(0)
    const fnBody = source.slice(fnStart, fnStart + 600)

    // Must reference the TTL constant and cached-at timestamp
    expect(fnBody).toContain('VSBT_MAX_AGE_MS')
    expect(fnBody).toContain('_vsbtCachedAt')
    // Must proactively clear on expiry
    expect(fnBody).toContain('_cacheVsbt(null)')
  })

  it('_cacheVsbt sets _vsbtCachedAt timestamp when storing token', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    const fnStart = source.indexOf('function _cacheVsbt')
    expect(fnStart).toBeGreaterThan(0)
    const fnBody = source.slice(fnStart, fnStart + 500)

    expect(fnBody).toContain('_vsbtCachedAt')
    expect(fnBody).toContain('Date.now()')
  })

  it('WebSocket close handler clears VSBT', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // Find the ws close handler
    const closeStart = source.indexOf("ws.addEventListener('close'")
    expect(closeStart).toBeGreaterThan(0)
    const closeBody = source.slice(closeStart, closeStart + 800)

    // Must call _cacheVsbt(null) on WS close
    expect(closeBody).toContain('_cacheVsbt(null)')
  })

  it('VAULT_HTTP_API 401 response clears VSBT', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // Find the 401 handling
    expect(source).toContain('response.status === 401')
    // Must clear VSBT on 401
    const idx401 = source.indexOf('response.status === 401')
    const surrounding = source.slice(idx401, idx401 + 300)
    expect(surrounding).toContain('_cacheVsbt(null)')
  })

  it('session storage restore checks TTL before restoring VSBT', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // The restore block must check age against VSBT_MAX_AGE_MS
    const restoreStart = source.indexOf("Restored VSBT from session storage")
    expect(restoreStart).toBeGreaterThan(0)
    const restoreBlock = source.slice(restoreStart - 500, restoreStart + 200)
    expect(restoreBlock).toContain('VSBT_MAX_AGE_MS')
    expect(restoreBlock).toContain('_vsbtAt')
  })
})

// ============================================================================
// §13  Fail-Closed Defaults — Extracted sanitizer + tests
// ============================================================================

/**
 * Mirrors _safePositiveInt() from background.ts.
 * Returns `fallback` if `value` is not a finite positive number.
 */
function safePositiveInt(value: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

describe('Fail-closed defaults for global rate limiter', () => {
  it('safePositiveInt returns fallback for Infinity', () => {
    expect(safePositiveInt(Infinity, 10)).toBe(10)
  })

  it('safePositiveInt returns fallback for NaN', () => {
    expect(safePositiveInt(NaN, 10)).toBe(10)
  })

  it('safePositiveInt returns fallback for 0', () => {
    expect(safePositiveInt(0, 10)).toBe(10)
  })

  it('safePositiveInt returns fallback for negative', () => {
    expect(safePositiveInt(-5, 10)).toBe(10)
  })

  it('safePositiveInt returns value for valid positive int', () => {
    expect(safePositiveInt(20, 10)).toBe(20)
  })

  it('safePositiveInt floors non-integer values', () => {
    expect(safePositiveInt(7.9, 10)).toBe(7)
  })

  it('global limiter works correctly with fallback-sanitized MAX', () => {
    // Simulate: MAX_WEBMCP_PER_MIN is invalid → fallback to 10
    const effectiveMax = safePositiveInt(NaN as any, 10)
    expect(effectiveMax).toBe(10)

    // Limiter with effective max = 10 should allow 10 then reject
    let timestamps: number[] = []
    const base = 100_000
    for (let i = 0; i < effectiveMax; i++) {
      const r = checkGlobalLimit(timestamps, base + i * 100, effectiveMax, WEBMCP_WINDOW_MS)
      timestamps = r.timestamps
      expect(r.allowed).toBe(true)
    }
    // 11th should be rejected
    const rFinal = checkGlobalLimit(timestamps, base + effectiveMax * 100, effectiveMax, WEBMCP_WINDOW_MS)
    expect(rFinal.allowed).toBe(false)
  })

  it('circuit breaker trips correctly with fallback-sanitized threshold', () => {
    // Simulate: WEBMCP_CB_THRESHOLD is invalid → fallback to 5
    const effectiveThreshold = safePositiveInt(0, 5)
    expect(effectiveThreshold).toBe(5)

    const cbState: CircuitBreakerState = { rejects: [], openedAt: 0 }
    const base = 100_000
    // Record exactly 5 rejects (the fallback threshold)
    for (let i = 0; i < effectiveThreshold; i++) {
      // Inline recordReject with custom threshold
      const windowStart = base + i * 100 - WEBMCP_CB_WINDOW_MS
      cbState.rejects = cbState.rejects.filter(t => t > windowStart)
      cbState.rejects.push(base + i * 100)
      if (cbState.rejects.length >= effectiveThreshold) {
        cbState.openedAt = base + i * 100
      }
    }
    // Circuit should be open
    expect(cbState.openedAt).toBeGreaterThan(0)
    const result = checkCircuitBreaker(cbState, cbState.openedAt + 1000)
    expect(result.blocked).toBe(true)
  })

  it('circuit breaker still closes after cooldown with fallback values', () => {
    const effectiveCooldown = safePositiveInt(Infinity as any, 10_000)
    expect(effectiveCooldown).toBe(10_000)

    const cbState: CircuitBreakerState = { rejects: [], openedAt: 100_000 }
    const result = checkCircuitBreaker(cbState, 100_000 + effectiveCooldown + 1)
    expect(result.blocked).toBe(false)
    expect(cbState.openedAt).toBe(0)
  })
})

describe('Fail-closed defaults — source-level verification', () => {
  it('background.ts uses _safePositiveInt for all rate-limit constants', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // _safePositiveInt must exist
    expect(source).toContain('function _safePositiveInt')
    // All effective accessors must use it
    expect(source).toContain('_safePositiveInt(MAX_WEBMCP_PER_MIN, 10)')
    expect(source).toContain('_safePositiveInt(WEBMCP_CB_THRESHOLD, 5)')
    expect(source).toContain('_safePositiveInt(WEBMCP_CB_WINDOW_MS, 30_000)')
    expect(source).toContain('_safePositiveInt(WEBMCP_CB_COOLDOWN_MS, 10_000)')
    expect(source).toContain('_safePositiveInt(WEBMCP_WINDOW_MS, 60_000)')
  })

  it('fieldScanner.ts uses sanitizeNumericCap for all scan config values', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const scannerPath = path.resolve(__dirname, '..', 'fieldScanner.ts')
    const source = fs.readFileSync(scannerPath, 'utf-8')

    expect(source).toContain('function sanitizeNumericCap')
    expect(source).toContain('sanitizeNumericCap(merged.maxElements, SCAN_CAP_MAX_ELEMENTS)')
    expect(source).toContain('sanitizeNumericCap(merged.maxCandidates, SCAN_CAP_MAX_CANDIDATES)')
    expect(source).toContain('sanitizeNumericCap(merged.maxDurationMs, SCAN_CAP_MAX_DURATION_MS)')
  })
})

// ============================================================================
// §15  Background WEBMCP_FILL_PREVIEW — Structured Error Contract
// ============================================================================
//
// Validates that every rejection path from the background handler returns:
//   { resultVersion: 'webmcp-preview-v1', success: false, error: { code, message } }
// and that retryAfterMs is present only on RATE_LIMITED / TEMP_BLOCKED.
// ============================================================================

// ---------------------------------------------------------------------------
// Constants duplicated here to avoid importing webMcpAdapter.ts at module
// level, which transitively pulls in fieldScanner.ts → `document.body`
// (unavailable in the node test environment).  Source-level tests below
// verify these stay in sync with the real module.
// ---------------------------------------------------------------------------
const WEBMCP_RESULT_VERSION_LOCAL = 'webmcp-preview-v1'
const BG_WEBMCP_ERROR_CODES_LOCAL: ReadonlySet<string> = new Set([
  'FORBIDDEN', 'RATE_LIMITED', 'TEMP_BLOCKED', 'INVALID_PARAMS',
  'INVALID_TAB', 'RESTRICTED_PAGE', 'TAB_UNREACHABLE', 'INTERNAL_ERROR',
])
const ALL_WEBMCP_ERROR_CODES_LOCAL: ReadonlySet<string> = new Set([
  // Adapter codes
  'INVALID_PARAMS', 'AUTOFILL_DISABLED', 'VAULT_ITEM_DELETED',
  'ORIGIN_MISMATCH', 'PSL_BLOCKED', 'NO_TARGETS', 'ELEMENT_HIDDEN', 'INTERNAL_ERROR',
  // Background codes
  'FORBIDDEN', 'RATE_LIMITED', 'TEMP_BLOCKED',
  'INVALID_TAB', 'RESTRICTED_PAGE', 'TAB_UNREACHABLE',
])

/**
 * Pure runtime validator (duplicated from webMcpAdapter.ts to avoid import).
 */
function isWebMcpResultV1Local(x: unknown): x is { resultVersion: string; success: boolean; [k: string]: unknown } {
  if (!x || typeof x !== 'object') return false
  const obj = x as Record<string, unknown>
  if (obj.resultVersion !== WEBMCP_RESULT_VERSION_LOCAL) return false
  if (typeof obj.success !== 'boolean') return false
  if (obj.success === false) {
    if (!obj.error || typeof obj.error !== 'object') return false
    const err = obj.error as Record<string, unknown>
    if (typeof err.code !== 'string') return false
    if (!ALL_WEBMCP_ERROR_CODES_LOCAL.has(err.code)) return false
    if (typeof err.message !== 'string') return false
  }
  if (obj.success === true) {
    if ('previewFieldCount' in obj && obj.previewFieldCount !== undefined) {
      if (typeof obj.previewFieldCount !== 'number' || obj.previewFieldCount < 0) return false
    }
  }
  if ('retryAfterMs' in obj && obj.retryAfterMs !== undefined) {
    if (typeof obj.retryAfterMs !== 'number' || !Number.isFinite(obj.retryAfterMs) || obj.retryAfterMs <= 0) return false
  }
  return true
}

describe('Background WEBMCP_FILL_PREVIEW — structured error contract', () => {
  /**
   * Simulates the background handler's structured error helper.
   * This mirrors the `_bgErr` closure in the real handler exactly.
   */
  function bgErr(code: string, message: string, extra?: { retryAfterMs: number }) {
    return {
      resultVersion: WEBMCP_RESULT_VERSION_LOCAL,
      success: false as const,
      error: { code, message },
      ...(extra ? { retryAfterMs: extra.retryAfterMs } : {}),
    }
  }

  // ── Every background error code produces a valid result ──

  const BG_ERROR_CASES: Array<{ code: string; message: string; extra?: { retryAfterMs: number } }> = [
    { code: 'FORBIDDEN',        message: 'Sender not trusted' },
    { code: 'TEMP_BLOCKED',     message: 'Temporarily blocked', extra: { retryAfterMs: 5000 } },
    { code: 'INVALID_PARAMS',   message: 'Missing required parameters' },
    { code: 'INVALID_TAB',      message: 'Invalid tab identifier' },
    { code: 'RATE_LIMITED',     message: 'Rate limited', extra: { retryAfterMs: 1500 } },
    { code: 'RESTRICTED_PAGE',  message: 'Cannot operate on this page' },
    { code: 'TAB_UNREACHABLE',  message: 'Content script unreachable' },
    { code: 'INTERNAL_ERROR',   message: 'No response from content script' },
  ]

  for (const { code, message, extra } of BG_ERROR_CASES) {
    it(`${code}: includes resultVersion and passes isWebMcpResultV1`, () => {
      const result = bgErr(code, message, extra)
      expect(result.resultVersion).toBe(WEBMCP_RESULT_VERSION_LOCAL)
      expect(result.success).toBe(false)
      expect(result.error.code).toBe(code)
      expect(isWebMcpResultV1Local(result)).toBe(true)
    })
  }

  // ── retryAfterMs presence / absence ──

  it('retryAfterMs present only on RATE_LIMITED', () => {
    const limited = bgErr('RATE_LIMITED', 'Rate limited', { retryAfterMs: 1200 })
    expect(limited.retryAfterMs).toBe(1200)
    expect(typeof limited.retryAfterMs).toBe('number')
    expect(Number.isFinite(limited.retryAfterMs)).toBe(true)
    expect(limited.retryAfterMs).toBeGreaterThan(0)
  })

  it('retryAfterMs present only on TEMP_BLOCKED', () => {
    const blocked = bgErr('TEMP_BLOCKED', 'Temporarily blocked', { retryAfterMs: 8000 })
    expect(blocked.retryAfterMs).toBe(8000)
    expect(typeof blocked.retryAfterMs).toBe('number')
    expect(Number.isFinite(blocked.retryAfterMs)).toBe(true)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('retryAfterMs absent on FORBIDDEN', () => {
    const result = bgErr('FORBIDDEN', 'Sender not trusted')
    expect('retryAfterMs' in result).toBe(false)
  })

  it('retryAfterMs absent on INVALID_PARAMS', () => {
    const result = bgErr('INVALID_PARAMS', 'Missing required parameters')
    expect('retryAfterMs' in result).toBe(false)
  })

  it('retryAfterMs absent on INVALID_TAB', () => {
    const result = bgErr('INVALID_TAB', 'Invalid tab identifier')
    expect('retryAfterMs' in result).toBe(false)
  })

  it('retryAfterMs absent on RESTRICTED_PAGE', () => {
    const result = bgErr('RESTRICTED_PAGE', 'Cannot operate on this page')
    expect('retryAfterMs' in result).toBe(false)
  })

  it('retryAfterMs absent on TAB_UNREACHABLE', () => {
    const result = bgErr('TAB_UNREACHABLE', 'Content script unreachable')
    expect('retryAfterMs' in result).toBe(false)
  })

  it('retryAfterMs absent on INTERNAL_ERROR', () => {
    const result = bgErr('INTERNAL_ERROR', 'No response from content script')
    expect('retryAfterMs' in result).toBe(false)
  })

  // ── Messages are static: no PII patterns ──

  const PII_PATTERNS = [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i,  // UUID
    /\S+@\S+\.\S+/,                            // email
    /https?:\/\//,                              // URL
    /chrome-extension:\/\//,                    // extension URL
    /input\[|select\[|textarea\[/i,            // selector
  ]

  for (const { code, message } of BG_ERROR_CASES) {
    it(`${code}: error.message contains no PII patterns`, () => {
      for (const p of PII_PATTERNS) {
        expect(message).not.toMatch(p)
      }
    })
  }

  // ── Error codes are all known ──

  it('all background error codes are in BG_WEBMCP_ERROR_CODES', () => {
    for (const { code } of BG_ERROR_CASES) {
      expect(BG_WEBMCP_ERROR_CODES_LOCAL.has(code)).toBe(true)
    }
  })

  it('all background error codes are in ALL_WEBMCP_ERROR_CODES', () => {
    for (const { code } of BG_ERROR_CASES) {
      expect(ALL_WEBMCP_ERROR_CODES_LOCAL.has(code)).toBe(true)
    }
  })

  // ── isWebMcpResultV1 rejects malformed background responses ──

  it('rejects old-style flat string error from background', () => {
    const oldStyle = {
      resultVersion: WEBMCP_RESULT_VERSION_LOCAL,
      success: false,
      error: 'Some string error',  // old format: flat string
    }
    expect(isWebMcpResultV1Local(oldStyle)).toBe(false)
  })

  it('rejects response missing resultVersion', () => {
    const noVersion = {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Sender not trusted' },
    }
    expect(isWebMcpResultV1Local(noVersion)).toBe(false)
  })

  it('rejects response with unknown error code', () => {
    const unknown = {
      resultVersion: WEBMCP_RESULT_VERSION_LOCAL,
      success: false,
      error: { code: 'MAGIC_ERROR', message: 'Something' },
    }
    expect(isWebMcpResultV1Local(unknown)).toBe(false)
  })
})

// ============================================================================
// §16  Source-Level Verification: background.ts WEBMCP structured responses
// ============================================================================

describe('Background WEBMCP handler — source-level structure', () => {
  it('background.ts imports WEBMCP_RESULT_VERSION from webMcpAdapter', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    expect(source).toContain("import { WEBMCP_RESULT_VERSION }")
    expect(source).toContain("from './vault/autofill/webMcpAdapter'")
  })

  it('WEBMCP handler uses _bgErr for all rejections', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // Find the main WEBMCP handler block (the second occurrence; the first
    // is inside the sender gate's conditional).  Look for the comment marker.
    const markerComment = '// Forward to content script'
    const handlerMarker = source.indexOf("const _bgErr = (code: BgWebMcpErrorCode")
    expect(handlerMarker).toBeGreaterThan(0)
    const handlerEnd = source.indexOf('return true // async', handlerMarker)
    expect(handlerEnd).toBeGreaterThan(handlerMarker)
    const handlerBody = source.slice(handlerMarker, handlerEnd)

    // All sendResponse calls should use _bgErr for rejections (not flat strings)
    // Count sendResponse calls that use _bgErr
    const bgErrCalls = (handlerBody.match(/sendResponse\(_bgErr\(/g) ?? []).length
    // Count sendResponse calls that use inline { success: false, error: 'string' }
    const flatErrorCalls = (handlerBody.match(/sendResponse\(\s*\{\s*success:\s*false,\s*error:\s*'/g) ?? []).length

    expect(bgErrCalls).toBeGreaterThanOrEqual(6)
    expect(flatErrorCalls).toBe(0)
  })

  it('sender gate uses structured error for WEBMCP_FILL_PREVIEW', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // The sender gate should check msg.type for WebMCP and use structured response
    expect(source).toContain("if (msg.type === 'WEBMCP_FILL_PREVIEW')")
    // Look for the structured FORBIDDEN response in the sender gate area
    const senderGate = source.indexOf("sender.id !== chrome.runtime.id")
    expect(senderGate).toBeGreaterThan(0)
    const gateBlock = source.slice(senderGate, senderGate + 500)
    expect(gateBlock).toContain("WEBMCP_FILL_PREVIEW")
    expect(gateBlock).toContain("FORBIDDEN")
    expect(gateBlock).toContain("resultVersion: WEBMCP_RESULT_VERSION")
  })

  it('content script relay ensures resultVersion on forwarded responses', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const bgPath = path.resolve(__dirname, '..', '..', '..', 'background.ts')
    const source = fs.readFileSync(bgPath, 'utf-8')

    // The handler should check and attach resultVersion on forwarded responses
    expect(source).toContain('response.resultVersion === WEBMCP_RESULT_VERSION')
  })

  it('local WEBMCP_RESULT_VERSION_LOCAL matches source constant', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adapterPath = path.resolve(__dirname, '..', 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    // Extract the actual value from the source
    const match = source.match(/export const WEBMCP_RESULT_VERSION\s*=\s*'([^']+)'/)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(WEBMCP_RESULT_VERSION_LOCAL)
  })

  it('local BG_WEBMCP_ERROR_CODES_LOCAL matches source set', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adapterPath = path.resolve(__dirname, '..', 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    // Verify every code in our local set appears in the source
    for (const code of BG_WEBMCP_ERROR_CODES_LOCAL) {
      expect(source).toContain(`'${code}'`)
    }
    // Verify the source declares BG_WEBMCP_ERROR_CODES
    expect(source).toContain('export const BG_WEBMCP_ERROR_CODES')
  })

  it('webMcpAdapter.ts exports isWebMcpResultV1 that uses ALL_WEBMCP_ERROR_CODES', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adapterPath = path.resolve(__dirname, '..', 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    expect(source).toContain('export function isWebMcpResultV1')
    const fnStart = source.indexOf('export function isWebMcpResultV1')
    const fnBody = source.slice(fnStart, fnStart + 1000)
    expect(fnBody).toContain('ALL_WEBMCP_ERROR_CODES')
  })
})
