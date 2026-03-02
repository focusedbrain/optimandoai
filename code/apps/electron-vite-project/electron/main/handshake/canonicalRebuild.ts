/**
 * Gate 2 — Canonical Rebuild for Handshake Capsules
 *
 * Accepts a raw parsed JSON object (unknown), validates every field against
 * a strict allowlist, rejects if any denied field is present, then returns
 * a NEWLY CONSTRUCTED canonical capsule. The original object is never passed
 * downstream — only the rebuilt canonical object enters the Trusted Zone.
 *
 * Security invariants:
 *   - Only explicitly listed fields survive the rebuild
 *   - Denied fields (context_blocks, data, payload, etc.) cause immediate rejection
 *   - All strings are NFC-normalized and control-char stripped
 *   - Emails are validated
 *   - Size limit: 64KB on serialized input
 *   - context_block_proofs carry only SHA-256 hashes, never content
 */

import { normalizeNFC, stripControlChars, isValidEmail } from './sanitize'

// ── Max input size ──

const MAX_INPUT_BYTES = 64 * 1024

// ── Result type ──

export type RebuildResult =
  | { ok: true; capsule: HandshakeCapsuleCanonical }
  | { ok: false; reason: string; field?: string }

// ── Canonical capsule type (output of Gate 2) ──

export interface CanonicalSenderIdentity {
  readonly email: string
  readonly iss: string
  readonly sub: string
  readonly email_verified: true
  readonly wrdesk_user_id: string
}

export interface CanonicalTierSignals {
  readonly plan: 'free' | 'pro' | 'publisher' | 'enterprise'
  readonly hardwareAttestation: { verified: true; fresh: boolean; attestedAt: string } | null
  readonly dnsVerification: { verified: true; domain: string } | null
  readonly wrStampStatus: { verified: true; stampId: string } | null
}

export interface ContextBlockProof {
  readonly block_id: string
  readonly block_hash: string
}

export interface HandshakeCapsuleCanonical {
  readonly schema_version: 1
  readonly capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke'
  readonly handshake_id: string
  readonly relationship_id: string
  readonly sender_id: string
  readonly sender_wrdesk_user_id: string
  readonly senderIdentity: CanonicalSenderIdentity
  readonly capsule_hash: string
  readonly timestamp: string
  readonly seq: number
  readonly external_processing: 'none' | 'local_only'
  readonly reciprocal_allowed: boolean
  readonly tierSignals: CanonicalTierSignals
  readonly wrdesk_policy_hash: string
  readonly wrdesk_policy_version: string
  readonly sharing_mode?: 'receive-only' | 'reciprocal'
  readonly prev_hash?: string
  readonly context_block_proofs?: ReadonlyArray<ContextBlockProof>
}

// ── Denied fields — presence triggers immediate rejection ──

const DENIED_FIELDS: ReadonlySet<string> = new Set([
  'context_blocks',
  'data',
  'payload',
  'body',
  'content',
  'attachment',
  'attachments',
  'file',
  'files',
  'binary',
  'script',
  'code',
  'html',
  'exec',
  'command',
  'eval',
])

// ── Field validation rules ──

type FieldRule =
  | { type: 'literal'; value: unknown }
  | { type: 'enum'; values: readonly unknown[] }
  | { type: 'regex'; pattern: RegExp; maxLength?: number }
  | { type: 'email' }
  | { type: 'iso8601' }
  | { type: 'integer'; min?: number; max?: number }
  | { type: 'boolean' }
  | { type: 'string'; maxLength: number }

const FIELD_RULES: Record<string, FieldRule> = {
  schema_version: { type: 'literal', value: 1 },
  capsule_type: { type: 'enum', values: ['initiate', 'accept', 'refresh', 'revoke'] },
  handshake_id: { type: 'regex', pattern: /^hs-[a-f0-9-]{1,128}$/, maxLength: 136 },
  relationship_id: { type: 'regex', pattern: /^rel-[a-f0-9-]{1,128}$/, maxLength: 136 },
  sender_id: { type: 'regex', pattern: /^[a-zA-Z0-9_-]{1,256}$/, maxLength: 256 },
  sender_wrdesk_user_id: { type: 'regex', pattern: /^[a-zA-Z0-9_-]{1,256}$/, maxLength: 256 },
  capsule_hash: { type: 'regex', pattern: /^[a-f0-9]{64}$/ },
  timestamp: { type: 'iso8601' },
  seq: { type: 'integer', min: 0, max: 2_147_483_647 },
  external_processing: { type: 'enum', values: ['none', 'local_only'] },
  reciprocal_allowed: { type: 'boolean' },
  wrdesk_policy_hash: { type: 'string', maxLength: 256 },
  wrdesk_policy_version: { type: 'string', maxLength: 128 },
  sharing_mode: { type: 'enum', values: ['receive-only', 'reciprocal'] },
  prev_hash: { type: 'regex', pattern: /^[a-f0-9]{64}$/ },
}

// ── Sender identity validation rules ──

const SENDER_IDENTITY_RULES: Record<string, FieldRule> = {
  email: { type: 'email' },
  iss: { type: 'string', maxLength: 512 },
  sub: { type: 'string', maxLength: 256 },
  email_verified: { type: 'literal', value: true },
  wrdesk_user_id: { type: 'regex', pattern: /^[a-zA-Z0-9_-]{1,256}$/, maxLength: 256 },
}

// ── Tier signals validation rules ──

const TIER_PLAN_VALUES = ['free', 'pro', 'publisher', 'enterprise'] as const

// ── Helpers ──

function sanitizeString(s: string): string {
  return stripControlChars(normalizeNFC(s))
}

function validateField(value: unknown, rule: FieldRule): { valid: boolean; sanitized?: unknown } {
  switch (rule.type) {
    case 'literal':
      return { valid: value === rule.value, sanitized: rule.value }

    case 'enum':
      return { valid: rule.values.includes(value as any), sanitized: value }

    case 'regex': {
      if (typeof value !== 'string') return { valid: false }
      const clean = sanitizeString(value)
      if (rule.maxLength && clean.length > rule.maxLength) return { valid: false }
      return { valid: rule.pattern.test(clean), sanitized: clean }
    }

    case 'email': {
      if (typeof value !== 'string') return { valid: false }
      const clean = sanitizeString(value)
      return { valid: isValidEmail(clean), sanitized: clean }
    }

    case 'iso8601': {
      if (typeof value !== 'string') return { valid: false }
      const clean = sanitizeString(value)
      const ts = Date.parse(clean)
      return { valid: !isNaN(ts), sanitized: clean }
    }

    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return { valid: false }
      if (rule.min !== undefined && value < rule.min) return { valid: false }
      if (rule.max !== undefined && value > rule.max) return { valid: false }
      return { valid: true, sanitized: value }
    }

    case 'boolean':
      return { valid: typeof value === 'boolean', sanitized: value }

    case 'string': {
      if (typeof value !== 'string') return { valid: false }
      const clean = sanitizeString(value)
      if (clean.length > rule.maxLength) return { valid: false }
      return { valid: true, sanitized: clean }
    }

    default:
      return { valid: false }
  }
}

function rebuildSenderIdentity(raw: unknown): { ok: true; identity: CanonicalSenderIdentity } | { ok: false; reason: string; field: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'senderIdentity must be an object', field: 'senderIdentity' }
  }

  const obj = raw as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, rule] of Object.entries(SENDER_IDENTITY_RULES)) {
    if (!(key in obj)) {
      return { ok: false, reason: `Missing required field in senderIdentity`, field: `senderIdentity.${key}` }
    }
    const validation = validateField(obj[key], rule)
    if (!validation.valid) {
      return { ok: false, reason: `Invalid value for senderIdentity.${key}`, field: `senderIdentity.${key}` }
    }
    result[key] = validation.sanitized
  }

  return { ok: true, identity: result as unknown as CanonicalSenderIdentity }
}

function rebuildTierSignals(raw: unknown): { ok: true; signals: CanonicalTierSignals } | { ok: false; reason: string; field: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'tierSignals must be an object', field: 'tierSignals' }
  }

  const obj = raw as Record<string, unknown>

  if (!('plan' in obj) || !TIER_PLAN_VALUES.includes(obj.plan as any)) {
    return { ok: false, reason: 'Invalid tierSignals.plan', field: 'tierSignals.plan' }
  }

  const validateAttestation = (val: unknown): { verified: true; fresh: boolean; attestedAt: string } | null => {
    if (val === null || val === undefined) return null
    if (typeof val !== 'object' || Array.isArray(val)) return undefined as any
    const a = val as Record<string, unknown>
    if (a.verified !== true || typeof a.fresh !== 'boolean' || typeof a.attestedAt !== 'string') return undefined as any
    return { verified: true, fresh: a.fresh, attestedAt: sanitizeString(a.attestedAt) }
  }

  const validateDns = (val: unknown): { verified: true; domain: string } | null => {
    if (val === null || val === undefined) return null
    if (typeof val !== 'object' || Array.isArray(val)) return undefined as any
    const d = val as Record<string, unknown>
    if (d.verified !== true || typeof d.domain !== 'string') return undefined as any
    return { verified: true, domain: sanitizeString(d.domain) }
  }

  const validateWrStamp = (val: unknown): { verified: true; stampId: string } | null => {
    if (val === null || val === undefined) return null
    if (typeof val !== 'object' || Array.isArray(val)) return undefined as any
    const w = val as Record<string, unknown>
    if (w.verified !== true || typeof w.stampId !== 'string') return undefined as any
    return { verified: true, stampId: sanitizeString(w.stampId) }
  }

  const hw = validateAttestation(obj.hardwareAttestation)
  if (hw === undefined as any) {
    return { ok: false, reason: 'Invalid tierSignals.hardwareAttestation', field: 'tierSignals.hardwareAttestation' }
  }

  const dns = validateDns(obj.dnsVerification)
  if (dns === undefined as any) {
    return { ok: false, reason: 'Invalid tierSignals.dnsVerification', field: 'tierSignals.dnsVerification' }
  }

  const stamp = validateWrStamp(obj.wrStampStatus)
  if (stamp === undefined as any) {
    return { ok: false, reason: 'Invalid tierSignals.wrStampStatus', field: 'tierSignals.wrStampStatus' }
  }

  return {
    ok: true,
    signals: {
      plan: obj.plan as CanonicalTierSignals['plan'],
      hardwareAttestation: hw,
      dnsVerification: dns,
      wrStampStatus: stamp,
    },
  }
}

function rebuildContextBlockProofs(raw: unknown): { ok: true; proofs: ContextBlockProof[] } | { ok: false; reason: string; field: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'context_block_proofs must be an array', field: 'context_block_proofs' }
  }

  if (raw.length > 1000) {
    return { ok: false, reason: 'context_block_proofs exceeds max count (1000)', field: 'context_block_proofs' }
  }

  const proofs: ContextBlockProof[] = []
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: `Invalid proof entry at index ${i}`, field: `context_block_proofs[${i}]` }
    }

    const e = entry as Record<string, unknown>

    if (typeof e.block_id !== 'string' || !/^blk_[a-f0-9]{1,64}$/.test(sanitizeString(e.block_id))) {
      return { ok: false, reason: `Invalid block_id at index ${i}`, field: `context_block_proofs[${i}].block_id` }
    }

    if (typeof e.block_hash !== 'string' || !/^[a-f0-9]{64}$/.test(sanitizeString(e.block_hash))) {
      return { ok: false, reason: `Invalid block_hash at index ${i}`, field: `context_block_proofs[${i}].block_hash` }
    }

    proofs.push({
      block_id: sanitizeString(e.block_id),
      block_hash: sanitizeString(e.block_hash),
    })
  }

  return { ok: true, proofs }
}

// ── Main entry point ──

export function canonicalRebuild(raw: unknown): RebuildResult {
  // Size check
  let serialized: string
  try {
    serialized = JSON.stringify(raw)
  } catch {
    return { ok: false, reason: 'Input is not serializable', field: 'root' }
  }

  if (Buffer.byteLength(serialized, 'utf-8') > MAX_INPUT_BYTES) {
    return { ok: false, reason: `Input exceeds ${MAX_INPUT_BYTES} byte limit`, field: 'root' }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'Input must be a plain object', field: 'root' }
  }

  const obj = raw as Record<string, unknown>

  // Denied field check — reject if ANY denied field is present
  for (const denied of DENIED_FIELDS) {
    if (denied in obj) {
      return { ok: false, reason: `Denied field present: ${denied}`, field: denied }
    }
  }

  // Validate required top-level fields
  const REQUIRED_FIELDS = [
    'schema_version', 'capsule_type', 'handshake_id', 'relationship_id',
    'sender_id', 'sender_wrdesk_user_id', 'capsule_hash', 'timestamp',
    'seq', 'external_processing', 'reciprocal_allowed', 'wrdesk_policy_hash',
    'wrdesk_policy_version',
  ]

  const canonical: Record<string, unknown> = {}

  for (const fieldName of REQUIRED_FIELDS) {
    if (!(fieldName in obj)) {
      return { ok: false, reason: `Missing required field: ${fieldName}`, field: fieldName }
    }
    const rule = FIELD_RULES[fieldName]
    if (!rule) {
      return { ok: false, reason: `No validation rule for required field: ${fieldName}`, field: fieldName }
    }
    const result = validateField(obj[fieldName], rule)
    if (!result.valid) {
      return { ok: false, reason: `Invalid value for ${fieldName}`, field: fieldName }
    }
    canonical[fieldName] = result.sanitized
  }

  // Validate optional top-level fields
  for (const optField of ['sharing_mode', 'prev_hash'] as const) {
    if (optField in obj && obj[optField] !== undefined) {
      const rule = FIELD_RULES[optField]
      const result = validateField(obj[optField], rule)
      if (!result.valid) {
        return { ok: false, reason: `Invalid value for ${optField}`, field: optField }
      }
      canonical[optField] = result.sanitized
    }
  }

  // Validate senderIdentity (required nested object)
  if (!('senderIdentity' in obj)) {
    return { ok: false, reason: 'Missing required field: senderIdentity', field: 'senderIdentity' }
  }
  const identityResult = rebuildSenderIdentity(obj.senderIdentity)
  if (!identityResult.ok) {
    return identityResult
  }
  canonical.senderIdentity = identityResult.identity

  // Validate tierSignals (required nested object)
  if (!('tierSignals' in obj)) {
    return { ok: false, reason: 'Missing required field: tierSignals', field: 'tierSignals' }
  }
  const tierResult = rebuildTierSignals(obj.tierSignals)
  if (!tierResult.ok) {
    return tierResult
  }
  canonical.tierSignals = tierResult.signals

  // Validate context_block_proofs (optional)
  if ('context_block_proofs' in obj && obj.context_block_proofs !== undefined) {
    const proofsResult = rebuildContextBlockProofs(obj.context_block_proofs)
    if (!proofsResult.ok) {
      return proofsResult
    }
    if (proofsResult.proofs.length > 0) {
      canonical.context_block_proofs = proofsResult.proofs
    }
  }

  return { ok: true, capsule: canonical as unknown as HandshakeCapsuleCanonical }
}
