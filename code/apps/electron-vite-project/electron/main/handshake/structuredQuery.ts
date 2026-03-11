/**
 * Structured Query Fast-Path
 *
 * Detects questions that refer to structured fields and answers them directly
 * from the context graph without calling the LLM.
 */

// ── Phrase → Field Path Mapping ─────────────────────────────────────────────
// Common user phrases mapped to graph field paths (dot notation).

const PHRASE_TO_FIELD: Array<{ phrases: RegExp[]; fieldPath: string }> = [
  // Opening hours
  {
    phrases: [
      /opening\s*hours?/i,
      /when\s*(?:are\s*you|do\s*you)\s*open/i,
      /business\s*hours?/i,
      /hours?\s*of\s*operation/i,
      /what\s*(?:are\s*)?(?:your\s*)?(?:opening\s*)?hours?/i,
    ],
    fieldPath: 'opening_hours.schedule',
  },
  // Contact - support
  {
    phrases: [
      /support\s*email/i,
      /contact\s*support/i,
      /support\s*contact/i,
      /email\s*(?:for\s*)?support/i,
    ],
    fieldPath: 'contact.support.email',
  },
  {
    phrases: [
      /support\s*phone/i,
      /support\s*(?:number|line)/i,
      /phone\s*(?:for\s*)?support/i,
    ],
    fieldPath: 'contact.support.phone',
  },
  // Contact - general
  {
    phrases: [
      /phone\s*number/i,
      /(?:what(?:'s| is)\s*)?(?:your\s*)?(?:contact\s*)?phone/i,
      /call\s*(?:you|us)/i,
      /telephone/i,
    ],
    fieldPath: 'contact.general.phone',
  },
  {
    phrases: [
      /(?:general\s*)?contact\s*email/i,
      /(?:what(?:'s| is)\s*)?(?:your\s*)?(?:contact\s*)?email/i,
      /email\s*address/i,
    ],
    fieldPath: 'contact.general.email',
  },
  // Company
  {
    phrases: [
      /company\s*name/i,
      /(?:what(?:'s| is|s)\s*)?(?:the\s*)?(?:company\s*)?name/i,
      /whats?\s*(?:the\s*)?(?:company\s*)?name/i,
      /business\s*name/i,
    ],
    fieldPath: 'company.name',
  },
  {
    phrases: [
      /headquarters/i,
      /(?:where\s*)?(?:is\s*)?(?:your\s*)?(?:company\s*)?(?:headquarters?|hq)/i,
      /main\s*office/i,
      /corporate\s*address/i,
    ],
    fieldPath: 'company.headquarters',
  },
  {
    phrases: [
      /company\s*address/i,
      /(?:what(?:'s| is)\s*)?(?:your\s*)?(?:company\s*)?address/i,
      /physical\s*address/i,
    ],
    fieldPath: 'company.address',
  },
]

export interface QueryClassifierResult {
  matched: boolean
  fieldPath?: string
}

/**
 * Classifies a user question to detect if it refers to a structured field.
 * Returns the matched field path if found.
 */
export function queryClassifier(query: string): QueryClassifierResult {
  const trimmed = query.trim()
  if (!trimmed) return { matched: false }

  const normalized = trimmed.replace(/\s+/g, ' ').toLowerCase()

  for (const { phrases, fieldPath } of PHRASE_TO_FIELD) {
    for (const re of phrases) {
      if (re.test(normalized)) {
        return { matched: true, fieldPath }
      }
    }
  }

  return { matched: false }
}

export interface ScoredContextBlock {
  handshake_id: string
  block_id: string
  payload_ref: string
  source?: string
  score?: number
  [key: string]: unknown
}

/**
 * Retrieves a value at a dot-notation path from a JSON object.
 * Returns undefined if path not found or value is null/undefined.
 */
function getAtPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Formats a value for display. Handles primitives and simple objects.
 * Objects are formatted as human-readable key-value pairs, not raw JSON.
 */
function formatValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value.map(v => formatValue(v)).join(', ')
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const label = k.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        const val = formatValue(v)
        return val ? `${label}: ${val}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return String(value)
}

export interface StructuredLookupResult {
  found: boolean
  value?: string
  source?: { handshake_id: string; block_id: string; source?: string }
}

/**
 * Looks up a structured field value from context blocks.
 * Parses payload_ref as JSON when possible and extracts the value at the given path.
 * Supports context_graph format: tries fieldPath and context_graph.fieldPath.
 */
export function structuredLookup(
  blocks: ScoredContextBlock[],
  fieldPath: string
): StructuredLookupResult {
  for (const block of blocks) {
    const payload = block.payload_ref
    if (!payload || typeof payload !== 'string') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      // Not JSON — try simple text match for leaf values (e.g. plain email/phone)
      const trimmed = payload.trim()
      if (trimmed && fieldPath.includes('email') && trimmed.includes('@')) {
        return { found: true, value: trimmed, source: { handshake_id: block.handshake_id, block_id: block.block_id, source: block.source } }
      }
      if (trimmed && (fieldPath.includes('phone') || fieldPath.includes('schedule'))) {
        return { found: true, value: trimmed, source: { handshake_id: block.handshake_id, block_id: block.block_id, source: block.source } }
      }
      continue
    }

    // Try direct path first
    let value = getAtPath(parsed, fieldPath)
    // Try context_graph.fieldPath for context-graph blocks (e.g. ctx-*)
    if ((value === undefined || value === null) && parsed && typeof parsed === 'object' && 'context_graph' in parsed) {
      value = getAtPath(parsed, `context_graph.${fieldPath}`)
    }
    // Try nodes array in context_graph (some formats use nodes with id/data)
    if ((value === undefined || value === null) && parsed && typeof parsed === 'object') {
      const cg = (parsed as Record<string, unknown>).context_graph
      if (cg && typeof cg === 'object' && Array.isArray((cg as Record<string, unknown>).nodes)) {
        const nodes = (cg as { nodes?: Array<{ id?: string; data?: unknown }> }).nodes ?? []
        const prefix = fieldPath.split('.')[0]
        for (const node of nodes) {
          if (node.id === prefix || node.id === fieldPath) {
            const data = node.data
            if (data != null) {
              const subPath = fieldPath.includes('.') ? fieldPath.split('.').slice(1).join('.') : ''
              value = subPath ? getAtPath(data, subPath) : data
              if (value !== undefined && value !== null) break
            }
          }
        }
      }
    }

    if (value !== undefined && value !== null) {
      const formatted = formatValue(value)
      if (formatted) {
        return {
          found: true,
          value: formatted,
          source: { handshake_id: block.handshake_id, block_id: block.block_id, source: block.source },
        }
      }
    }
  }

  return { found: false }
}

import { visibilityWhereClause, isVaultCurrentlyUnlocked } from './visibilityFilter'

/** Filter for block fetch (relationship or handshake scope). */
export interface StructuredLookupFilter {
  relationship_id?: string
  handshake_id?: string
}

/**
 * Fetches blocks from the DB that may contain a structured field.
 * Used for parallel structured lookup (no embedding needed).
 * Includes:
 * - Blocks whose block_id matches the field path (e.g. opening_hours.schedule)
 * - Blocks whose block_id starts with the prefix (e.g. opening_hours%)
 * - Context-graph blocks (ctx-*) whose payload may contain the field under context_graph
 */
export function fetchBlocksForStructuredLookup(
  db: any,
  filter: StructuredLookupFilter,
  fieldPath: string,
): ScoredContextBlock[] {
  const prefix = fieldPath.split('.')[0]
  if (!prefix) return []

  const vaultUnlocked = isVaultCurrentlyUnlocked()
  const { sql: visSql, params: visParams } = visibilityWhereClause('context_blocks', vaultUnlocked)

  let sql = `SELECT handshake_id, block_id, block_hash, relationship_id, source, payload
    FROM context_blocks
    WHERE (block_id = ? OR block_id LIKE ? OR block_id LIKE 'ctx-%')`
  const params: any[] = [fieldPath, `${prefix}%`]

  if (filter.relationship_id) {
    sql += ' AND relationship_id = ?'
    params.push(filter.relationship_id)
  }
  if (filter.handshake_id) {
    sql += ' AND handshake_id = ?'
    params.push(filter.handshake_id)
  }

  sql += visSql
  params.push(...visParams)

  sql += ' ORDER BY handshake_id, block_id'

  const rows = db.prepare(sql).all(...params) as Array<{
    handshake_id: string
    block_id: string
    block_hash: string
    relationship_id: string
    source: string
    payload: string
  }>

  return rows.map((r) => ({
    handshake_id: r.handshake_id,
    block_id: r.block_id,
    payload_ref: r.payload,
    source: r.source,
    score: 1,
  }))
}
