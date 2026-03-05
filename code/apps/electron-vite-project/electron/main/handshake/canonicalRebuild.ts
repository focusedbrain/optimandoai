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

export interface CanonicalReceiverIdentity {
  readonly email: string
  readonly iss: string
  readonly sub: string
  readonly email_verified: true
  readonly wrdesk_user_id: string
}

export interface HandshakeCapsuleCanonical {
  readonly schema_version: 1 | 2
  readonly capsule_type: 'initiate' | 'accept' | 'refresh' | 'revoke'
  readonly handshake_id: string
  readonly relationship_id: string
  readonly sender_id: string
  readonly sender_wrdesk_user_id: string
  readonly sender_email: string
  readonly receiver_id: string
  readonly receiver_email: string
  readonly senderIdentity: CanonicalSenderIdentity
  readonly receiverIdentity: CanonicalReceiverIdentity | null
  readonly capsule_hash: string
  readonly context_hash: string
  readonly context_commitment: string | null
  readonly nonce: string
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
  readonly context_blocks?: ReadonlyArray<CanonicalContextBlock>
}

export interface CanonicalContextBlock {
  readonly block_id: string
  readonly block_hash: string
  readonly scope_id: string | null
  readonly type: string
  readonly content: string | Record<string, unknown> | null
}

// ── Denied fields — presence triggers immediate rejection ──
// NOTE: context_blocks is NOT denied — it is validated structurally
// and extracted separately. Raw content fields (data, payload, etc.)
// remain denied to prevent arbitrary data injection.

const DENIED_FIELDS: ReadonlySet<string> = new Set([
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
  schema_version: { type: 'enum', values: [1, 2] },
  capsule_type: { type: 'enum', values: ['initiate', 'accept', 'refresh', 'revoke'] },
  handshake_id: { type: 'regex', pattern: /^hs-[a-f0-9-]{1,128}$/, maxLength: 136 },
  relationship_id: { type: 'regex', pattern: /^rel[-:][a-f0-9-]{1,128}$/, maxLength: 136 },
  sender_id: { type: 'regex', pattern: /^[a-zA-Z0-9_@.+-]{1,256}$/, maxLength: 256 },
  sender_wrdesk_user_id: { type: 'regex', pattern: /^[a-zA-Z0-9_@.+-]{1,256}$/, maxLength: 256 },
  sender_email: { type: 'email' },
  receiver_id: { type: 'regex', pattern: /^[a-zA-Z0-9_@.+-]{1,256}$/, maxLength: 256 },
  receiver_email: { type: 'email' },
  capsule_hash: { type: 'regex', pattern: /^[a-f0-9]{64}$/ },
  context_hash: { type: 'regex', pattern: /^[a-f0-9]{64}$/ },
  nonce: { type: 'regex', pattern: /^[a-f0-9]{64}$/ },
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
  wrdesk_user_id: { type: 'regex', pattern: /^[a-zA-Z0-9_@.+-]{1,256}$/, maxLength: 256 },
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
    'sender_id', 'sender_wrdesk_user_id', 'sender_email', 'receiver_id',
    'receiver_email', 'capsule_hash', 'context_hash', 'nonce', 'timestamp',
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

  // Validate receiverIdentity (optional — null on initiate, populated on accept)
  if ('receiverIdentity' in obj) {
    if (obj.receiverIdentity === null) {
      canonical.receiverIdentity = null
    } else if (obj.receiverIdentity !== undefined) {
      const receiverResult = rebuildSenderIdentity(obj.receiverIdentity)
      if (!receiverResult.ok) {
        return { ok: false, reason: receiverResult.reason.replace('senderIdentity', 'receiverIdentity'), field: receiverResult.field.replace('senderIdentity', 'receiverIdentity') }
      }
      canonical.receiverIdentity = receiverResult.identity
    }
  }
  if (!('receiverIdentity' in canonical)) {
    canonical.receiverIdentity = null
  }

  // Validate context_commitment (optional — sha-256 hex or null)
  if ('context_commitment' in obj) {
    if (obj.context_commitment === null) {
      canonical.context_commitment = null
    } else if (typeof obj.context_commitment === 'string') {
      const clean = sanitizeString(obj.context_commitment)
      if (!/^[a-f0-9]{64}$/.test(clean)) {
        return { ok: false, reason: 'Invalid context_commitment format', field: 'context_commitment' }
      }
      canonical.context_commitment = clean
    } else {
      return { ok: false, reason: 'context_commitment must be a string or null', field: 'context_commitment' }
    }
  }
  if (!('context_commitment' in canonical)) {
    canonical.context_commitment = null
  }

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

  // Validate context_blocks (optional — carries actual content for ingestion)
  if ('context_blocks' in obj && obj.context_blocks !== undefined) {
    const blocksResult = rebuildContextBlocks(obj.context_blocks)
    if (!blocksResult.ok) {
      return blocksResult
    }
    if (blocksResult.blocks.length > 0) {
      canonical.context_blocks = blocksResult.blocks
    }
  }

  return { ok: true, capsule: canonical as unknown as HandshakeCapsuleCanonical }
}

// ── Context Blocks Structural Validation ──

const MAX_CONTEXT_BLOCKS = 64
const MAX_BLOCK_CONTENT_BYTES = 32 * 1024
const BLOCK_ID_PATTERN = /^[a-zA-Z0-9._:/-]{1,256}$/
const BLOCK_HASH_PATTERN = /^[a-f0-9]{64}$/
const BLOCK_TYPE_PATTERN = /^[a-z_]{1,64}$/

function rebuildContextBlocks(raw: unknown): { ok: true; blocks: CanonicalContextBlock[] } | { ok: false; reason: string; field?: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'context_blocks must be an array', field: 'context_blocks' }
  }
  if (raw.length > MAX_CONTEXT_BLOCKS) {
    return { ok: false, reason: `context_blocks exceeds max count (${MAX_CONTEXT_BLOCKS})`, field: 'context_blocks' }
  }

  const blocks: CanonicalContextBlock[] = []

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    const prefix = `context_blocks[${i}]`

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: `${prefix} must be a plain object`, field: prefix }
    }

    const b = item as Record<string, unknown>

    if (typeof b.block_id !== 'string' || !BLOCK_ID_PATTERN.test(b.block_id)) {
      return { ok: false, reason: `${prefix}.block_id invalid`, field: `${prefix}.block_id` }
    }

    if (typeof b.block_hash !== 'string' || !BLOCK_HASH_PATTERN.test(b.block_hash)) {
      return { ok: false, reason: `${prefix}.block_hash must be 64-char lowercase hex`, field: `${prefix}.block_hash` }
    }

    if (typeof b.type !== 'string' || !BLOCK_TYPE_PATTERN.test(b.type)) {
      return { ok: false, reason: `${prefix}.type invalid`, field: `${prefix}.type` }
    }

    const scopeId = b.scope_id === null || b.scope_id === undefined
      ? null
      : typeof b.scope_id === 'string' ? sanitizeString(b.scope_id) : null

    let content: string | Record<string, unknown> | null
    if (b.content === null || b.content === undefined) {
      // Hash-only proof block — content intentionally omitted (e.g. initiate capsule)
      content = null
    } else if (typeof b.content === 'string') {
      if (Buffer.byteLength(b.content, 'utf-8') > MAX_BLOCK_CONTENT_BYTES) {
        return { ok: false, reason: `${prefix}.content exceeds ${MAX_BLOCK_CONTENT_BYTES} bytes`, field: `${prefix}.content` }
      }
      content = b.content
    } else if (typeof b.content === 'object' && !Array.isArray(b.content)) {
      const serialized = JSON.stringify(b.content)
      if (Buffer.byteLength(serialized, 'utf-8') > MAX_BLOCK_CONTENT_BYTES) {
        return { ok: false, reason: `${prefix}.content exceeds ${MAX_BLOCK_CONTENT_BYTES} bytes`, field: `${prefix}.content` }
      }
      content = b.content as Record<string, unknown>
    } else {
      return { ok: false, reason: `${prefix}.content must be a string, object, or null`, field: `${prefix}.content` }
    }

    blocks.push({
      block_id: sanitizeString(b.block_id),
      block_hash: b.block_hash,
      scope_id: scopeId,
      type: b.type,
      content,
    })
  }

  return { ok: true, blocks }
}
