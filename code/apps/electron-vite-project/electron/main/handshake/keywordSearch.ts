/**
 * Keyword/lexical search fallback when embeddings are unavailable.
 * Searches block text, labels, document content, custom fields without semantic embeddings.
 */

import type { ScoredContextBlock } from './types'
import { visibilityWhereClause, isVaultCurrentlyUnlocked } from './visibilityFilter'
import { getHandshakeRecord } from './db'
import {
  parseGovernanceJson,
  resolveEffectiveGovernance,
  filterBlocksForSearch,
  baselineFromHandshake,
  type LegacyBlockInput,
} from './contextGovernance'

/** Extract searchable text from block payload (profile, documents, custom_fields, etc.). */
function extractSearchableText(payload: string): string {
  if (!payload || typeof payload !== 'string') return ''
  const trimmed = payload.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    if (Array.isArray(parsed)) {
      return parsed.map((v: unknown) =>
        extractSearchableText(typeof v === 'string' ? v : JSON.stringify(v))
      ).filter(Boolean).join('\n')
    }
    if (parsed && typeof parsed === 'object') {
      const parts: string[] = []
      for (const [k, v] of Object.entries(parsed)) {
        if (v == null) continue
        const label = k.replace(/[_-]/g, ' ').toLowerCase()
        if (typeof v === 'string') {
          parts.push(label, v)
        } else if (Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === 'object' && 'label' in item && 'value' in item) {
              parts.push(String((item as { label?: string }).label ?? ''), String((item as { value?: string }).value ?? ''))
            } else {
              parts.push(extractSearchableText(JSON.stringify(item)))
            }
          }
        } else if (typeof v === 'object') {
          const sub = extractSearchableText(JSON.stringify(v))
          if (sub) parts.push(label, sub)
        } else {
          parts.push(label, String(v))
        }
      }
      return parts.filter(Boolean).join(' ')
    }
  } catch {
    /* not JSON, use as-is */
  }
  return trimmed
}

/** Tokenize for lexical matching: lowercase, split on non-word, dedupe. */
function tokenize(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/\s+/g, ' ').split(/\W+/).filter(Boolean))]
}

/** Single-token queries that produce noisy matches; return empty when query is only this. */
const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'or', 'and', 'be', 'as', 'by', 'we', 'he', 'she'])

/**
 * Score a block's text against the query using simple lexical heuristics.
 * - Exact phrase match: high boost
 * - All query tokens present: base score + token overlap
 * - Title/label match: boost
 * - Multiple field hits: additional boost
 */
function scoreBlock(query: string, text: string, blockId: string): number {
  if (!text || !query) return 0
  const qNorm = query.toLowerCase().trim()
  const tNorm = text.toLowerCase()
  const qTokens = tokenize(query)
  const tTokens = tokenize(text)
  if (qTokens.length === 0) return 0

  let score = 0

  // Exact phrase match (highest boost)
  if (tNorm.includes(qNorm)) {
    score += 2
  }

  // Token overlap (base score)
  const overlap = qTokens.filter((t) => tTokens.includes(t)).length
  score += overlap / Math.max(1, qTokens.length)

  // Boost if block_id or common labels contain query tokens
  const blockIdNorm = blockId.toLowerCase().replace(/[._]/g, ' ')
  for (const qt of qTokens) {
    if (qt.length >= 2 && blockIdNorm.includes(qt)) score += 0.3
  }

  return Math.min(1, score / 2)
}

/**
 * Keyword search over context_blocks when embeddings are unavailable.
 * Respects scope, visibility, and governance. Returns results in ScoredContextBlock shape.
 */
export function keywordSearch(
  db: any,
  query: string,
  filter: { relationship_id?: string; handshake_id?: string },
  limit: number,
): ScoredContextBlock[] {
  const trimmed = (query ?? '').trim()
  if (!trimmed) return []

  const qTokens = tokenize(trimmed)
  if (qTokens.length === 1 && (qTokens[0].length <= 2 || STOPWORDS.has(qTokens[0]))) {
    return []
  }

  const vaultUnlocked = isVaultCurrentlyUnlocked()
  const { sql: visSql, params: visParams } = visibilityWhereClause('cb', vaultUnlocked)

  let sql = `SELECT cb.handshake_id, cb.block_id, cb.block_hash, cb.relationship_id, cb.source, cb.payload,
      cb.scope_id, cb.type, cb.data_classification, cb.sender_wrdesk_user_id, cb.publisher_id, cb.governance_json,
      cb.version, cb.valid_until
    FROM context_blocks cb
    WHERE 1=1`
  const params: any[] = []

  if (filter.relationship_id) {
    sql += ' AND cb.relationship_id = ?'
    params.push(filter.relationship_id)
  }
  if (filter.handshake_id) {
    sql += ' AND cb.handshake_id = ?'
    params.push(filter.handshake_id)
  }
  sql += visSql
  params.push(...visParams)
  sql += ' ORDER BY cb.handshake_id, cb.block_id'

  let rows: any[]
  try {
    rows = db.prepare(sql).all(...params) as any[]
  } catch {
    return []
  }

  const recordCache = new Map<string, ReturnType<typeof getHandshakeRecord>>()
  const scored: ScoredContextBlock[] = []

  for (const row of rows) {
    const record = recordCache.get(row.handshake_id) ?? getHandshakeRecord(db, row.handshake_id)
    if (!record) continue
    recordCache.set(row.handshake_id, record)

    const legacy: LegacyBlockInput = {
      block_id: row.block_id,
      type: row.type,
      data_classification: row.data_classification,
      scope_id: row.scope_id ?? undefined,
      sender_wrdesk_user_id: row.sender_wrdesk_user_id,
      publisher_id: row.publisher_id ?? row.sender_wrdesk_user_id,
      source: row.source,
    }
    const itemGov = parseGovernanceJson(row.governance_json)
    const governance = resolveEffectiveGovernance(itemGov, legacy, record, record.relationship_id)
    const baseline = baselineFromHandshake(record)
    if (filterBlocksForSearch([{ governance }], baseline).length === 0) continue

    const text = extractSearchableText(row.payload ?? '')
    const s = scoreBlock(trimmed, text, row.block_id)
    if (s <= 0) continue

    scored.push({
      block_id: row.block_id,
      block_hash: row.block_hash,
      relationship_id: row.relationship_id,
      handshake_id: row.handshake_id,
      scope_id: row.scope_id ?? undefined,
      type: row.type,
      data_classification: row.data_classification,
      version: row.version ?? 1,
      valid_until: row.valid_until ?? undefined,
      source: row.source,
      sender_wrdesk_user_id: row.sender_wrdesk_user_id,
      embedding_status: 'complete',
      payload_ref: row.payload,
      score: s,
    })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.block_id.localeCompare(b.block_id)
  })
  return scored.slice(0, limit)
}
