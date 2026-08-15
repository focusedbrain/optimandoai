/**
 * Capability-token schema (Phase 5 — T4, Q13) [XII.12.6 — annex-number-provisional]
 *
 * Net-new token schema for grants/capabilities. Two disciplines:
 *
 *  1. PRESERVE-UNKNOWN-OPTIONAL parsing (the `p2p_signal` pattern, NOT the
 *     legacy `FIELD_RULES` allowlist strip): unknown optional fields —
 *     including future `context_scope` / `delegation_chain` refinements —
 *     survive a parse/serialize round trip byte-identically. The parser keeps
 *     the raw wire string; `serializeCapabilityToken` returns it unchanged.
 *     No validation of unknown fields is ever triggered (T4).
 *
 *  2. LIMIT-EXTENSION criticality [VII.10.8.3 — annex-number-provisional]:
 *     limit extensions are parse-level CRITICAL. A token carrying a limit
 *     extension we do not understand is REFUSED — it is never accepted as an
 *     unlimited grant. Absence of limit extensions = the unlimited-until-
 *     revoke ground state.
 *
 * Carriage only (Q13): `delegation_chain` is carried and preserved, never
 *     validated — delegation-chain validation arrives with CC. A `delegable`
 *     flag may be present but defaults to false and grants nothing.
 */

// ── Token model ───────────────────────────────────────────────────────────────

/**
 * Right kinds a token may confer [VII.10.1, VII.10.5 —
 * annex-number-provisional]. There is deliberately NO `execute` variant:
 * execution is never a standing right — every execution is a distinct human
 * consent tap (see electron main `execution/` consent gate). The
 * `preparation` scope slot stays open for standing action scopes (pinned
 * template hashes, effect vocabulary) which are spec'd but not built here.
 */
export type CapabilityTokenType = 'delivery' | 'preparation'

export const CAPABILITY_TOKEN_TYPES: readonly CapabilityTokenType[] = Object.freeze([
  'delivery',
  'preparation',
])

/** Limit extensions this build understands (parse-level critical set). */
export const UNDERSTOOD_LIMIT_EXTENSIONS: ReadonlySet<string> = new Set([
  'optirando.grant.single_use',
  'optirando.grant.ttl',
])

export interface CapabilityLimitExtension {
  /** Namespace, e.g. 'optirando.grant.ttl'. */
  ns: string
  /** Extension payload (e.g. { expires_at }) — carried, understood set only. */
  payload?: unknown
}

export interface CapabilityToken {
  token_id: string
  schema: 'wr.capability_token'
  schema_version: 1
  token_type: CapabilityTokenType
  /** Grant object this token is a carrier for. */
  grant_id: string
  handshake_id: string
  /** Right scopes (delivery scopes / open preparation scope slot). */
  scopes: readonly string[]
  /**
   * Optional context-scope restriction (Q13/CC forward-compat field) —
   * carried and preserved; consumers today treat it as opaque.
   */
  context_scope?: unknown
  /**
   * Optional delegation chain (CC forward-compat) — CARRIAGE ONLY. No
   * validation until CC ships [annex-number-provisional XII.12.6].
   */
  delegation_chain?: unknown
  /** Defaults false; grants nothing in this build. */
  delegable?: boolean
  /** Parse-level critical limit extensions [VII.10.8.3]. */
  limit_extensions?: readonly CapabilityLimitExtension[]
  created_at?: string
}

// ── Parse (preserve-unknown) ──────────────────────────────────────────────────

export type CapabilityTokenParseResult =
  | {
      ok: true
      token: CapabilityToken
      /** Exact wire bytes — serialize returns these unchanged (T4). */
      raw: string
      /** Top-level fields this build does not know (preserved, ignored). */
      unknown_fields: readonly string[]
    }
  | {
      ok: false
      reason:
        | 'invalid_json'
        | 'wrong_schema'
        | 'unsupported_schema_version'
        | 'invalid_token_type'
        | 'missing_required_field'
        | 'ununderstood_limit_extension'
      /** Named in the visible refusal (e.g. the unknown extension ns). */
      detail?: string
    }

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  'token_id',
  'schema',
  'schema_version',
  'token_type',
  'grant_id',
  'handshake_id',
  'scopes',
  'context_scope',
  'delegation_chain',
  'delegable',
  'limit_extensions',
  'created_at',
])

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Parse a capability token from its wire string. Unknown optional fields are
 * preserved (reported, never stripped, never validated). Present-but-not-
 * understood limit extensions REFUSE the token [VII.10.8.3].
 */
export function parseCapabilityToken(raw: string): CapabilityTokenParseResult {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: 'invalid_json' }
  }
  const t = obj as Record<string, unknown>

  if (t.schema !== 'wr.capability_token') {
    return { ok: false, reason: 'wrong_schema' }
  }
  if (t.schema_version !== 1) {
    return { ok: false, reason: 'unsupported_schema_version', detail: String(t.schema_version) }
  }
  if (t.token_type !== 'delivery' && t.token_type !== 'preparation') {
    // No 'execute' variant exists and none is accepted [VII.10.1].
    return { ok: false, reason: 'invalid_token_type', detail: String(t.token_type) }
  }
  for (const required of ['token_id', 'grant_id', 'handshake_id'] as const) {
    if (!isNonEmptyString(t[required])) {
      return { ok: false, reason: 'missing_required_field', detail: required }
    }
  }
  if (!Array.isArray(t.scopes) || t.scopes.some((s) => typeof s !== 'string')) {
    return { ok: false, reason: 'missing_required_field', detail: 'scopes' }
  }

  // Limit extensions: parse-level critical. Present + not understood →
  // refused, NEVER accepted as unlimited [VII.10.8.3].
  const limitExtensions: CapabilityLimitExtension[] = []
  if (t.limit_extensions !== undefined) {
    if (!Array.isArray(t.limit_extensions)) {
      return { ok: false, reason: 'ununderstood_limit_extension', detail: 'malformed limit_extensions' }
    }
    for (const entry of t.limit_extensions) {
      const ns = (entry as { ns?: unknown })?.ns
      if (!isNonEmptyString(ns)) {
        return { ok: false, reason: 'ununderstood_limit_extension', detail: 'missing ns' }
      }
      if (!UNDERSTOOD_LIMIT_EXTENSIONS.has(ns)) {
        return { ok: false, reason: 'ununderstood_limit_extension', detail: ns }
      }
      limitExtensions.push({ ns, payload: (entry as { payload?: unknown }).payload })
    }
  }

  const unknownFields = Object.keys(t).filter((k) => !KNOWN_FIELDS.has(k))

  const token: CapabilityToken = {
    token_id: t.token_id as string,
    schema: 'wr.capability_token',
    schema_version: 1,
    token_type: t.token_type as CapabilityTokenType,
    grant_id: t.grant_id as string,
    handshake_id: t.handshake_id as string,
    scopes: (t.scopes as string[]).slice(),
    ...(t.context_scope !== undefined ? { context_scope: t.context_scope } : {}),
    ...(t.delegation_chain !== undefined ? { delegation_chain: t.delegation_chain } : {}),
    // Defaults false; grants nothing either way in this build (Q13).
    delegable: t.delegable === true,
    ...(limitExtensions.length > 0 ? { limit_extensions: limitExtensions } : {}),
    ...(isNonEmptyString(t.created_at) ? { created_at: t.created_at } : {}),
  }

  return { ok: true, token, raw, unknown_fields: unknownFields }
}

/**
 * Serialize a parsed token back to the wire. Returns the EXACT bytes that
 * were parsed — unknown fields, key order, and whitespace preserved (T4).
 */
export function serializeCapabilityToken(parsed: { raw: string }): string {
  return parsed.raw
}

/**
 * Build a fresh token wire string for a locally created grant. (New tokens
 * are canonical; the preserve-unknown discipline applies to FOREIGN tokens.)
 */
export function buildCapabilityTokenWire(token: Omit<CapabilityToken, 'schema' | 'schema_version'>): string {
  return JSON.stringify({ schema: 'wr.capability_token', schema_version: 1, ...token })
}
