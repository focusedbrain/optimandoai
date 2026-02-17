// ============================================================================
// WRVault Autofill — Vault Index (In-Memory Search for QuickSelect)
// ============================================================================
//
// Provides a fast, privacy-conscious in-memory index of vault items for
// the QuickSelect dropdown search.
//
// Design constraints:
//   - Index lives in content-script memory only (never persisted to disk)
//   - Only stores search tokens (title, domain, masked username) — NEVER passwords
//   - Cleared + scrubbed on vault lock or page unload
//   - Rebuilt on demand from the vault API (lazy, cached)
//   - Search is synchronous after initial build (no async in hot path)
//   - Supports prefix matching and fuzzy-ish scoring (token overlap)
//
// Security — Hardened invariants:
//
//   S1  Passwords and sensitive field values are NEVER indexed.
//   S2  Usernames are stored in two forms:
//       a) `maskedUsername` — display-safe redacted form (e.g., "j***@example.com")
//       b) `usernameTokens` — lowercase prefix tokens derived from the username
//          for search matching only; the full value is NOT stored.
//   S3  Clearing the index overwrites every entry's string fields with empty
//       strings before releasing the array, minimizing lingering references.
//   S4  The public `searchIndex` function enforces domain filtering.
//       Unfiltered enumeration is not exposed.
//   S5  Empty queries require explicit user interaction (the UI must gate this;
//       `searchIndexFiltered` with `requireInteraction = true` returns nothing
//       until the user has typed at least `MIN_QUERY_LENGTH` characters).
//   S6  Result counts are coarsened to prevent exact vault-size inference.
//
// ============================================================================

import * as vaultAPI from '../api'
import type { IndexProjection } from '../api'
import type { VaultItem, Field } from '../types'
import {
  classifyRelevance,
  relevanceWeight,
  type RelevanceTier,
} from '../../../../../packages/shared/src/vault/originPolicy'

// ============================================================================
// §1  Types
// ============================================================================

/** A searchable entry in the index. */
export interface IndexEntry {
  /** Source VaultItem ID. */
  itemId: string
  /** Item title. */
  title: string
  /** Item category. */
  category: string
  /** Associated domain/origin (if any). */
  domain: string
  /**
   * Masked display form of the primary username/email.
   * Example: "j***@example.com".  NEVER the full value.
   */
  maskedUsername: string
  /** Whether the item is a favorite. */
  favorite: boolean
  /** Last updated timestamp. */
  updatedAt: number
  /** Pre-computed search tokens (lowercase, split on word boundaries). */
  tokens: string[]
}

/** Search result with relevance score. */
export interface SearchResult {
  entry: IndexEntry
  /** Relevance score: higher = better match. */
  score: number
  /** Which tokens matched (for highlighting). */
  matchedTokens: string[]
}

// ============================================================================
// §2  State
// ============================================================================

let _entries: IndexEntry[] = []
let _builtAt = 0
let _building = false

/** Index is considered stale after this many ms. */
const INDEX_TTL_MS = 60_000 // 1 minute

/** Maximum entries in the index (safety cap). */
const MAX_INDEX_ENTRIES = 2000

/**
 * Minimum query length before results are returned.
 * When `requireInteraction` is true in `searchIndexFiltered`, queries
 * shorter than this return zero results — the UI shows a prompt instead.
 */
const MIN_QUERY_LENGTH = 1

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Build (or rebuild) the in-memory search index from the vault API.
 *
 * Call this:
 *   - When QuickSelect opens for the first time
 *   - After a vault item is created/updated/deleted
 *   - When the index is stale (older than INDEX_TTL_MS)
 *
 * Returns true if the index was rebuilt, false if still fresh.
 */
export async function buildIndex(): Promise<boolean> {
  if (_building) return false
  if (Date.now() - _builtAt < INDEX_TTL_MS && _entries.length > 0) return false

  _building = true
  try {
    // Least-privilege: fetch only fillable categories with sensitive values stripped
    const items = await vaultAPI.listItemsForIndex()
    _entries = items
      .slice(0, MAX_INDEX_ENTRIES)
      .map(itemToEntry)
    _builtAt = Date.now()
    return true
  } catch (err) {
    console.error('[VAULT-INDEX] Failed to build index')
    return false
  } finally {
    _building = false
  }
}

/**
 * Search the index with a query string.
 *
 * Delegates to `searchIndexFiltered` with `includeGlobal = false` and
 * `requireInteraction = true`.  This is the safe default: no cross-domain
 * enumeration and no results until the user types.
 *
 * @param query — user-typed search text
 * @param currentOrigin — the page's origin (domain matches get a boost)
 * @param limit — max results to return (default: 20)
 */
export function searchIndex(
  query: string,
  currentOrigin: string,
  limit: number = 20,
): SearchResult[] {
  return searchIndexFiltered(query, currentOrigin, false, true, limit)
}

/**
 * Clear the index.  Called on vault lock or page unload.
 *
 * Scrubs all string fields in every entry before releasing the array to
 * reduce the window during which vault metadata lingers in the JS heap.
 */
export function clearIndex(): void {
  for (const entry of _entries) {
    entry.title = ''
    entry.domain = ''
    entry.maskedUsername = ''
    entry.itemId = ''
    entry.category = ''
    entry.tokens.length = 0
  }
  _entries.length = 0
  _entries = []
  _builtAt = 0
}

/**
 * Invalidate the index so the next search triggers a rebuild.
 */
export function invalidateIndex(): void {
  _builtAt = 0
}

/**
 * Whether the index is populated (non-empty).
 * Does NOT reveal the exact count — use `hasEntries` for boolean check.
 */
export function hasEntries(): boolean {
  return _entries.length > 0
}

/**
 * Get a coarsened entry count — rounded to the nearest bucket to prevent
 * exact vault-size inference from the content script.
 *
 * Buckets: 0, 1-5, 6-20, 21-100, 100+
 */
export function indexSize(): number {
  const n = _entries.length
  if (n === 0) return 0
  if (n <= 5) return 5
  if (n <= 20) return 20
  if (n <= 100) return 100
  return 100
}

/**
 * Check if the index needs rebuilding.
 */
export function isIndexStale(): boolean {
  return _entries.length === 0 || Date.now() - _builtAt >= INDEX_TTL_MS
}

// ============================================================================
// §4  Index Building
// ============================================================================

/**
 * Convert a VaultItem to an IndexEntry.
 *
 * Sensitive data handling:
 *   - Passwords are NEVER included.
 *   - The username is masked for display (`maskedUsername`).
 *   - Only prefix tokens of the username are indexed for search, not the
 *     full value.  This allows type-ahead matching while preventing
 *     full-value extraction from the index.
 */
function itemToEntry(item: IndexProjection): IndexEntry {
  const rawUsername = extractUsername(item.fields)
  const domain = (item.domain ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')

  // Build search tokens: title + domain + username PREFIX tokens + category
  // The username tokens are truncated to prevent full-value recovery.
  const raw = [
    item.title,
    domain,
    usernameSearchHint(rawUsername),
    item.category,
  ].join(' ')

  return {
    itemId: item.id,
    title: item.title,
    category: item.category,
    domain,
    maskedUsername: maskUsername(rawUsername),
    favorite: item.favorite,
    updatedAt: item.updated_at,
    tokens: tokenize(raw),
  }
}

/** Extract the primary username/email from item fields. */
function extractUsername(fields: Field[]): string {
  const keys = ['username', 'email', 'user', 'login', 'user_email']
  for (const key of keys) {
    const field = fields.find(f => f.key.toLowerCase() === key && f.type !== 'password')
    if (field?.value) return field.value
  }
  return ''
}

/**
 * Mask a username for safe display in the QuickSelect list.
 *
 * Rules:
 *   - Email: first char + "***" + "@" + domain  ("j***@example.com")
 *   - Short (<=3): first char + "***"            ("j***")
 *   - Other: first 2 chars + "***"               ("jo***")
 *   - Empty: empty string
 */
function maskUsername(raw: string): string {
  if (!raw) return ''
  const atIdx = raw.indexOf('@')
  if (atIdx > 0) {
    // Email: show first char of local part + mask + domain
    return raw[0] + '\u2022\u2022\u2022' + raw.slice(atIdx)
  }
  if (raw.length <= 3) {
    return raw[0] + '\u2022\u2022\u2022'
  }
  return raw.slice(0, 2) + '\u2022\u2022\u2022'
}

/**
 * Generate a search hint from a username — only the first 3 characters
 * of each token are indexed, preventing full-value extraction while
 * still supporting type-ahead search.
 */
function usernameSearchHint(raw: string): string {
  if (!raw) return ''
  // For email: index the first 3 chars of local part + domain
  const atIdx = raw.indexOf('@')
  if (atIdx > 0) {
    const localPrefix = raw.slice(0, Math.min(3, atIdx))
    const domainPart = raw.slice(atIdx + 1)
    return localPrefix + ' ' + domainPart
  }
  // For non-email: index only the first 3 characters
  return raw.slice(0, 3)
}

// ============================================================================
// §5  Tokenization & Scoring
// ============================================================================

/** Tokenize a string into lowercase word tokens. */
function tokenize(s: string): string[] {
  if (!s) return []
  return s
    .toLowerCase()
    .replace(/[^a-z0-9@.\-_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0)
}

/**
 * Score an entry against query tokens.
 *
 * Scoring:
 *   - Exact token match: +10
 *   - Prefix match: +6
 *   - Substring match: +3
 *   - Strict origin match with current page: weighted by relevance tier
 *   - Favorite: +2 bonus
 *   - Title match: weighted 1.5x
 */
function scoreEntry(
  entry: IndexEntry,
  queryTokens: string[],
  currentOrigin: string,
): { score: number; matchedTokens: string[] } {
  let score = 0
  const matchedTokens: string[] = []

  for (const qt of queryTokens) {
    let tokenScore = 0

    // Check against each entry token
    for (const et of entry.tokens) {
      if (et === qt) {
        tokenScore = Math.max(tokenScore, 10)
      } else if (et.startsWith(qt)) {
        tokenScore = Math.max(tokenScore, 6)
      } else if (et.includes(qt)) {
        tokenScore = Math.max(tokenScore, 3)
      }
    }

    // Check against title directly (weighted higher)
    const titleLower = entry.title.toLowerCase()
    if (titleLower === qt) {
      tokenScore = Math.max(tokenScore, 15)
    } else if (titleLower.startsWith(qt)) {
      tokenScore = Math.max(tokenScore, 9)
    } else if (titleLower.includes(qt)) {
      tokenScore = Math.max(tokenScore, 5)
    }

    if (tokenScore > 0) {
      score += tokenScore
      matchedTokens.push(qt)
    }
  }

  // All query tokens must match something (AND semantics)
  if (matchedTokens.length < queryTokens.length) {
    return { score: 0, matchedTokens: [] }
  }

  // Domain boost — strict origin matching
  if (entry.domain) {
    const tier = classifyRelevance(entry.domain, currentOrigin)
    score += relevanceWeight(tier) > 0 ? Math.round(relevanceWeight(tier) * 0.15) : 0
  }

  // Favorite boost
  if (entry.favorite) {
    score += 2
  }

  return { score, matchedTokens }
}

/**
 * Rank entries when query is empty: strict origin matches first.
 *
 * Only called when the interaction gate has been satisfied (the caller
 * has verified user intent).
 *
 * Grouping (in display order):
 *   1. exact_origin / www_equivalent — credential for THIS page
 *   2. subdomain / same_domain       — same registrable domain
 *   3. global                         — everything else (hidden unless expanded)
 */
function rankEmpty(currentOrigin: string, limit: number, includeGlobal: boolean): SearchResult[] {
  const exact: SearchResult[]  = []
  const related: SearchResult[] = []
  const global: SearchResult[] = []

  for (const entry of _entries) {
    const tier = classifyRelevance(entry.domain || undefined, currentOrigin)
    const weight = relevanceWeight(tier)
    const result: SearchResult = { entry, score: weight, matchedTokens: [] }

    if (tier === 'exact_origin' || tier === 'www_equivalent') {
      exact.push(result)
    } else if (tier === 'subdomain' || tier === 'same_domain') {
      related.push(result)
    } else {
      global.push(result)
    }
  }

  const sortFn = (a: SearchResult, b: SearchResult) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.entry.favorite !== b.entry.favorite) return a.entry.favorite ? -1 : 1
    return b.entry.updatedAt - a.entry.updatedAt
  }
  exact.sort(sortFn)
  related.sort(sortFn)
  global.sort(sortFn)

  const combined = [...exact, ...related]
  if (includeGlobal) combined.push(...global)
  return combined.slice(0, limit)
}

/**
 * Search with explicit control over domain filtering and interaction gate.
 *
 * @param query           — user-typed search text
 * @param currentOrigin   — page origin for strict matching
 * @param includeGlobal   — whether to include cross-domain entries
 * @param requireInteraction — if true, returns empty until query >= MIN_QUERY_LENGTH
 * @param limit           — max results (default: 20)
 */
export function searchIndexFiltered(
  query: string,
  currentOrigin: string,
  includeGlobal: boolean,
  requireInteraction: boolean = true,
  limit: number = 20,
): SearchResult[] {
  if (_entries.length === 0) return []

  const trimmed = query.trim()
  const queryTokens = tokenize(trimmed)

  // ── Interaction gate ──
  // If requireInteraction is set and the user hasn't typed enough,
  // return nothing.  The UI should show a "Type to search..." prompt.
  if (requireInteraction && trimmed.length < MIN_QUERY_LENGTH) {
    return []
  }

  if (queryTokens.length === 0) {
    return rankEmpty(currentOrigin, limit, includeGlobal)
  }

  const results: SearchResult[] = []

  for (const entry of _entries) {
    const { score, matchedTokens } = scoreEntry(entry, queryTokens, currentOrigin)
    if (score <= 0) continue

    // Filter out global entries unless includeGlobal is true
    if (!includeGlobal) {
      const tier = classifyRelevance(entry.domain || undefined, currentOrigin)
      if (tier === 'global') continue
    }

    results.push({ entry, score, matchedTokens })
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.entry.favorite !== b.entry.favorite) return a.entry.favorite ? -1 : 1
    return b.entry.updatedAt - a.entry.updatedAt
  })

  return results.slice(0, limit)
}

/**
 * Count how many entries match the current origin (exact + www_equivalent).
 * Returns a boolean indicator, not exact count, to prevent enumeration.
 */
export function hasOriginMatches(currentOrigin: string): boolean {
  for (const entry of _entries) {
    const tier = classifyRelevance(entry.domain || undefined, currentOrigin)
    if (tier === 'exact_origin' || tier === 'www_equivalent') return true
  }
  return false
}
