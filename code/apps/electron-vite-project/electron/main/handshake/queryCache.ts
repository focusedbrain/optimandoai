/**
 * RAG Query Cache — Frequently asked questions
 *
 * Cache key: capsule_id + normalized_query
 * Cache value: { answer, sources, timestamp }
 * TTL: 24 hours
 * Invalidate when capsule (handshake) context changes
 */

export interface CachedSource {
  handshake_id: string
  capsule_id?: string
  block_id: string
  source: string
  score: number
}

export interface CachedEntry {
  answer: string
  sources: CachedSource[]
  timestamp: string
}

const TTL_MS = 24 * 60 * 60 * 1000

/** Normalize query for cache key: trim, lowercase, collapse whitespace. */
export function normalizeQuery(query: string): string {
  if (!query || typeof query !== 'string') return ''
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Resolve capsule_id from scope filter.
 * Returns null for non-cacheable scopes (e.g. "all").
 */
export function resolveCapsuleId(filter: { handshake_id?: string; relationship_id?: string }): string | null {
  if (filter.handshake_id) return filter.handshake_id
  if (filter.relationship_id) return `rel:${filter.relationship_id}`
  return null
}

/** Get cached entry if valid (within TTL). */
export function getCached(
  db: any,
  capsuleId: string,
  normalizedQuery: string,
): CachedEntry | null {
  const row = db.prepare(
    `SELECT answer, sources_json, created_at FROM rag_query_cache
     WHERE capsule_id = ? AND normalized_query = ?`
  ).get(capsuleId, normalizedQuery) as { answer: string; sources_json: string; created_at: string } | undefined

  if (!row) return null

  const age = Date.now() - new Date(row.created_at).getTime()
  if (age > TTL_MS) return null

  let sources: CachedSource[] = []
  try {
    sources = JSON.parse(row.sources_json) as CachedSource[]
  } catch {
    /* ignore */
  }

  return {
    answer: row.answer,
    sources,
    timestamp: row.created_at,
  }
}

/** Store cache entry. */
export function setCached(
  db: any,
  capsuleId: string,
  normalizedQuery: string,
  entry: { answer: string; sources: CachedSource[] },
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR REPLACE INTO rag_query_cache (capsule_id, normalized_query, answer, sources_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(capsuleId, normalizedQuery, entry.answer, JSON.stringify(entry.sources), now)
}

/** Invalidate cache when capsule changes (e.g. context blocks ingested). */
export function invalidateByCapsule(db: any, capsuleId: string): void {
  db.prepare('DELETE FROM rag_query_cache WHERE capsule_id = ?').run(capsuleId)
}

/** Invalidate by handshake_id (same as capsule_id when scope is handshake). */
export function invalidateByHandshake(db: any, handshakeId: string): void {
  invalidateByCapsule(db, handshakeId)
}

/** Invalidate by relationship_id. */
export function invalidateByRelationship(db: any, relationshipId: string): void {
  invalidateByCapsule(db, `rel:${relationshipId}`)
}
