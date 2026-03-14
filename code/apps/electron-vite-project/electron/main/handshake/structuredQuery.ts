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
      /(?:what\s*about\s*)?(?:the\s*)?address/i,
    ],
    fieldPath: 'company.address',
  },
  // Tax & Identifiers
  {
    phrases: [
      /\bvat\s*(?:number)?\b/i,
      /(?:what(?:'s| is)\s*)?(?:the\s*)?vat\s*(?:number)?/i,
      /(?:and\s*)?(?:the\s*)?vat\s*(?:number)?/i,
    ],
    fieldPath: 'tax.vat_number',
  },
  {
    phrases: [
      /\bregistration\s*(?:number)?\b/i,
      /(?:what(?:'s| is)\s*)?(?:the\s*)?registration\s*(?:number)?/i,
      /(?:what\s*about\s*)?(?:the\s*)?registration/i,
      /(?:and\s*)?(?:the\s*)?registration\s*(?:number)?/i,
    ],
    fieldPath: 'tax.registration_number',
  },
  // Billing
  {
    phrases: [
      /\bpayment\s*methods?\b/i,
      /(?:what(?:'s| are| is)\s*)?(?:that\s+then\s+)?(?:the\s*)?payment\s*methods?/i,
      /(?:what\s*about\s*)?(?:the\s*)?payment\s*methods?/i,
      /(?:show\s+me\s+)?(?:the\s*)?payment\s*methods?/i,
    ],
    fieldPath: 'billing.payment_methods',
  },
  // Legal company
  {
    phrases: [
      /\blegal\s*company\b/i,
      /(?:what(?:'s| is)\s*)?(?:the\s*)?legal\s*company/i,
    ],
    fieldPath: 'company.legal_name',
  },
  // Country
  {
    phrases: [
      /\bcountry\b/i,
      /(?:what(?:'s| is)\s*)?(?:the\s*)?country/i,
    ],
    fieldPath: 'company.country',
  },
  // General email/phone (looser phrasing)
  {
    phrases: [
      /(?:what(?:'s| is)\s*)?(?:the\s*)?email/i,
      /(?:what\s*about\s*)?(?:the\s*)?email/i,
      /(?:show\s+me\s+)?(?:the\s*)?email\s*(?:again)?/i,
    ],
    fieldPath: 'contact.general.email',
  },
  {
    phrases: [
      /(?:what(?:'s| is)\s*)?(?:the\s*)?phone/i,
      /(?:what\s*about\s*)?(?:the\s*)?phone/i,
    ],
    fieldPath: 'contact.general.phone',
  },
  // Contact person (from profile.fields.contacts array) — must precede general "contacts"
  {
    phrases: [
      /contact\s*person'?s?\s*phone/i,
      /(?:what(?:'s| is)\s*)?(?:the\s*)?contact\s*person'?s?\s*phone\s*(?:number)?/i,
      /phone\s*(?:number)?\s*(?:of\s*)?(?:the\s*)?contact\s*person/i,
    ],
    fieldPath: 'contact.person.phone',
  },
  {
    phrases: [
      /contact\s*person'?s?\s*name/i,
      /(?:what(?:'s| is)\s*)?(?:the\s*)?contact\s*person'?s?\s*name/i,
      /name\s*(?:of\s*)?(?:the\s*)?contact\s*person/i,
    ],
    fieldPath: 'contact.person.name',
  },
  {
    phrases: [
      /contact\s*person'?s?\s*email/i,
      /(?:what(?:'s| is)\s*)?(?:the\s*)?contact\s*person'?s?\s*email/i,
      /email\s*(?:of\s*)?(?:the\s*)?contact\s*person/i,
    ],
    fieldPath: 'contact.person.email',
  },
  // Contacts (top-level array) — after contact.person.*
  {
    phrases: [
      /\bcontacts?\b/i,
      /(?:who\s*is\s*)?(?:the\s*)?contact\s*(?:person)?/i,
      /(?:what(?:'s| are)\s*)?(?:the\s*)?contacts?/i,
    ],
    fieldPath: 'contact.persons',
  },
  // Links
  {
    phrases: [
      /\blinks?\b/i,
      /(?:what(?:'s| are)\s*)?(?:the\s*)?links?/i,
    ],
    fieldPath: 'company.links',
  },
]

/**
 * Maps graph field paths to vault_profile schema (profile.fields.*).
 * Vault blocks use profile: { fields: { openingHours, generalPhone, ... } }.
 */
/** Composes address from legacy or structured fields. */
function formatAddress(fields: Record<string, unknown>): unknown {
  const addr = fields?.address
  if (addr && typeof addr === 'string' && addr.trim()) return addr
  const parts = [
    [fields?.street, fields?.streetNumber].filter(Boolean).join(' '),
    [fields?.postalCode, fields?.city].filter(Boolean).join(' '),
    [fields?.state, fields?.country].filter(Boolean).join(', '),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}

/** Formats payment methods array for display. */
function formatPaymentMethods(fields: Record<string, unknown>): unknown {
  const pm = fields?.paymentMethods as Array<{ type?: string; iban?: string; bic?: string; bank_name?: string; account_holder?: string; paypal_email?: string }> | undefined
  if (!Array.isArray(pm) || pm.length === 0) return undefined
  return pm
    .map((m) => {
      if (m?.type === 'bank_account') return [m.iban, m.bic, m.bank_name, m.account_holder].filter(Boolean).join(' — ')
      if (m?.type === 'paypal' && m.paypal_email) return `PayPal: ${m.paypal_email}`
      if (m?.type === 'credit_card') return 'Card (masked)'
      return ''
    })
    .filter(Boolean)
    .join(' | ')
}

/** Collects link URLs from profile fields. */
function formatLinks(fields: Record<string, unknown>): unknown {
  const linkKeys = ['website', 'linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'officialLink', 'supportUrl']
  const urls = linkKeys.map((k) => fields?.[k]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return urls.length > 0 ? urls.join('\n') : undefined
}

const VAULT_PROFILE_PATH_MAP: Record<string, string | ((obj: Record<string, unknown>) => unknown)> = {
  'opening_hours.schedule': 'openingHours',
  'contact.support.email': 'supportEmail',
  'contact.support.phone': 'generalPhone', // vault has generalPhone; support uses same when no dedicated field
  'contact.general.phone': 'generalPhone',
  'contact.general.email': 'generalEmail',
  'company.name': 'legalCompanyName',
  'company.legal_name': 'legalCompanyName',
  'company.headquarters': formatAddress,
  'company.address': formatAddress,
  'company.country': 'country',
  'tax.vat_number': 'vatNumber',
  'tax.registration_number': 'companyRegistrationNumber',
  'billing.payment_methods': formatPaymentMethods,
  'contact.persons': (fields) => {
    const c = fields?.contacts as Array<{ name?: string; role?: string; email?: string; phone?: string }> | undefined
    if (!Array.isArray(c)) return undefined
    return c.map((x) => [x.name, x.role, x.email, x.phone].filter(Boolean).join(' · ')).filter(Boolean).join('\n')
  },
  'company.links': formatLinks,
  // contact.person.* — extracted from profile.fields.contacts array
  'contact.person.phone': (fields) => {
    const contacts = fields?.contacts as Array<{ phone?: string }> | undefined
    if (!Array.isArray(contacts)) return undefined
    const c = contacts.find((x) => x?.phone)
    return c?.phone
  },
  'contact.person.name': (fields) => {
    const contacts = fields?.contacts as Array<{ name?: string }> | undefined
    if (!Array.isArray(contacts)) return undefined
    const c = contacts.find((x) => x?.name)
    return c?.name
  },
  'contact.person.email': (fields) => {
    const contacts = fields?.contacts as Array<{ email?: string }> | undefined
    if (!Array.isArray(contacts)) return undefined
    const c = contacts.find((x) => x?.email)
    return c?.email
  },
}

/** Field paths for compound queries (contact + company, etc.). */
const MULTI_FIELD_GROUPS: Array<{ phrases: RegExp[]; fieldPaths: string[] }> = [
  {
    phrases: [
      /contact\s+and\s+company\s+(?:details?|info)/i,
      /company\s+and\s+contact\s+(?:details?|info)/i,
      /give\s+me\s+(?:the\s+)?(?:contact\s+and\s+company|company\s+and\s+contact)\s+(?:details?|info)/i,
      /(?:contact|company)\s+details?/i,
    ],
    fieldPaths: ['contact.general.phone', 'contact.general.email', 'contact.support.email', 'company.name', 'company.address'],
  },
  {
    phrases: [
      /contact\s+info\s+and\s+opening\s*hours?/i,
      /opening\s*hours?\s+and\s+contact\s+info/i,
      /(?:show|give)\s+me\s+contact\s+(?:info\s+)?and\s+opening\s*hours?/i,
    ],
    fieldPaths: ['contact.general.phone', 'contact.general.email', 'opening_hours.schedule'],
  },
  {
    phrases: [
      /phone\s*(?:number)?\s+and\s+(?:company\s+)?address/i,
      /(?:company\s+)?address\s+and\s+phone\s*(?:number)?/i,
      /phone\s+and\s+address/i,
    ],
    fieldPaths: ['contact.general.phone', 'company.address'],
  },
]

export interface QueryClassifierResult {
  matched: boolean
  fieldPath?: string
  /** When matched as compound query, multiple paths to aggregate. */
  fieldPaths?: string[]
}

/**
 * Classifies a user question to detect if it refers to a structured field.
 * Returns the matched field path (or paths for compound queries) if found.
 */
/** Imperative/command patterns that must NOT be treated as structured field lookups. */
const BLOCKLIST: RegExp[] = [
  /^(?:send|give|forward|reply)\s+me\s+(?:an?\s+)?email/i,
  /\bcountry\s+manager\b/i,
  /\blink\s+this\b/i,
  /\baddress\s+this\s+(?:issue|problem|matter)/i,
  /\bpayment\s+failed\b/i,
]

function isBlocked(query: string): boolean {
  return BLOCKLIST.some((re) => re.test(query))
}

export function queryClassifier(query: string): QueryClassifierResult {
  const trimmed = query.trim()
  if (!trimmed) return { matched: false }

  const normalized = trimmed.replace(/\s+/g, ' ').toLowerCase()

  // Check multi-field patterns first (more specific)
  for (const { phrases, fieldPaths } of MULTI_FIELD_GROUPS) {
    for (const re of phrases) {
      if (re.test(normalized)) {
        if (isBlocked(trimmed)) return { matched: false }
        return { matched: true, fieldPaths }
      }
    }
  }

  for (const { phrases, fieldPath } of PHRASE_TO_FIELD) {
    for (const re of phrases) {
      if (re.test(normalized)) {
        if (isBlocked(trimmed)) return { matched: false }
        return { matched: true, fieldPath }
      }
    }
  }

  // Label-based fallback: only when query looks like a question (avoids "send me an email", "address this issue", etc.)
  const looksLikeQuestion = /\b(what|which|who|where|when|how|show|give|tell|whats?|and\s+the)\b/i.test(normalized) || /\?$/.test(trimmed)
  if (looksLikeQuestion) {
    const LABEL_TO_FIELD: Array<{ label: RegExp; fieldPath: string }> = [
      { label: /\bpayment\s*methods?\b/i, fieldPath: 'billing.payment_methods' },
      { label: /\bvat\s*(?:number)?\b/i, fieldPath: 'tax.vat_number' },
      { label: /\bregistration\s*(?:number)?\b/i, fieldPath: 'tax.registration_number' },
      { label: /\blegal\s*company\b/i, fieldPath: 'company.legal_name' },
      { label: /\baddress\b/i, fieldPath: 'company.address' },
      { label: /\bcountry\b/i, fieldPath: 'company.country' },
      { label: /\bemail\b/i, fieldPath: 'contact.general.email' },
      { label: /\bphone\b/i, fieldPath: 'contact.general.phone' },
      { label: /\bcontacts?\b/i, fieldPath: 'contact.persons' },
      { label: /\blinks?\b/i, fieldPath: 'company.links' },
    ]
    for (const { label, fieldPath } of LABEL_TO_FIELD) {
      if (label.test(normalized)) {
        if (isBlocked(trimmed)) return { matched: false }
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

    // Try vault_profile format first (profile.fields.*)
    let value: unknown
    if (parsed && typeof parsed === 'object' && 'profile' in parsed) {
      const profile = (parsed as Record<string, unknown>).profile as Record<string, unknown> | undefined
      const fields = profile?.fields as Record<string, unknown> | undefined
      const mapper = VAULT_PROFILE_PATH_MAP[fieldPath]
      if (mapper && fields) {
        if (typeof mapper === 'function') {
          value = mapper(fields)
        } else {
          value = getAtPath(fields, mapper)
          // company.name: try legalCompanyName first, then profile.name
          if ((value === undefined || value === null) && mapper === 'legalCompanyName') {
            value = profile?.name
          }
        }
      }
    }
    // Fallback: direct path
    if (value === undefined || value === null) value = getAtPath(parsed, fieldPath)
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

/**
 * Looks up multiple structured fields and aggregates into a single result.
 * Used for compound queries like "Give me the contact and company details."
 */
export function structuredLookupMulti(
  blocks: ScoredContextBlock[],
  fieldPaths: string[],
): StructuredLookupResult {
  const parts: string[] = []
  let source: { handshake_id: string; block_id: string; source?: string } | undefined

  for (const block of blocks) {
    const payload = block.payload_ref
    if (!payload || typeof payload !== 'string') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }

    for (const fieldPath of fieldPaths) {
      let value: unknown
      if (parsed && typeof parsed === 'object' && 'profile' in parsed) {
        const profile = (parsed as Record<string, unknown>).profile as Record<string, unknown> | undefined
        const fields = profile?.fields as Record<string, unknown> | undefined
        const mapper = VAULT_PROFILE_PATH_MAP[fieldPath]
        if (mapper && fields) {
          if (typeof mapper === 'function') {
            value = mapper(fields)
          } else {
            value = getAtPath(fields, mapper)
            if ((value === undefined || value === null) && mapper === 'legalCompanyName') {
              value = profile?.name
            }
          }
        }
      }
      if (value === undefined || value === null) value = getAtPath(parsed, fieldPath)
      if ((value === undefined || value === null) && parsed && typeof parsed === 'object' && 'context_graph' in parsed) {
        value = getAtPath(parsed, `context_graph.${fieldPath}`)
      }

      if (value !== undefined && value !== null) {
        const formatted = formatValue(value)
        if (formatted) {
          const label = fieldPath.split('.').pop() ?? fieldPath
          const entry = `${label}: ${formatted}`
          if (!parts.includes(entry)) {
            parts.push(entry)
            if (!source) source = { handshake_id: block.handshake_id, block_id: block.block_id, source: block.source }
          }
        }
      }
    }
    if (parts.length > 0) break
  }

  if (parts.length === 0) return { found: false }
  return {
    found: true,
    value: parts.join('\n'),
    source,
  }
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
