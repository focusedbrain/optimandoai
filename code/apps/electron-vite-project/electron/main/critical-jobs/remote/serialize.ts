/**
 * Serialization for the `critical_job_*` wire (Build C, spec 0017 §2.2).
 *
 * `CriticalJobSpec.input` and `CriticalJobResult.output` contain `Buffer`s
 * (raw `inputBytes`, sealed artifact `ciphertext`, candidate envelopes). JSON
 * loses `Buffer`, so we use a Buffer-aware codec that encodes every `Buffer` as
 * `{ "$buf": "<base64>" }` and restores it on the far side byte-for-byte. Byte
 * fidelity matters: the depackage job-result signature commits to artifact
 * ciphertext bytes, so a lossy round-trip would (correctly) fail verification.
 *
 * INV-2 (key custody): the spec has no field able to carry seal/vault/private
 * keys; `custodyPubKeyB64` is a PUBLIC key only. `assertNoKeyMaterialOnWire`
 * re-checks this at the wire level on both send and receipt — defense in depth
 * per spec §2.2 ("add a wire-level assertion anyway").
 */

import {
  CriticalJobError,
  type CriticalJobKind,
  type CriticalJobResult,
  type CriticalJobSpec,
  type FlushMode,
} from '../types'
import type { SerializedCriticalJobResult, SerializedCriticalJobSpec } from './wire'

const BUF_TAG = '$buf'

/** Recursively encode `Buffer`s into `{ $buf: base64 }`; pass other values through. */
export function encodeBuffers(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { [BUF_TAG]: value.toString('base64') }
  }
  if (Array.isArray(value)) {
    return value.map(encodeBuffers)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodeBuffers(v)
    }
    return out
  }
  return value
}

/** Inverse of {@link encodeBuffers}. Restores `Buffer`s from `{ $buf: base64 }`. */
export function decodeBuffers(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 1 && keys[0] === BUF_TAG && typeof o[BUF_TAG] === 'string') {
      return Buffer.from(o[BUF_TAG] as string, 'base64')
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      out[k] = decodeBuffers(v)
    }
    return out
  }
  if (Array.isArray(value)) {
    return value.map(decodeBuffers)
  }
  return value
}

/**
 * Field-name patterns that must NEVER appear anywhere in a wire spec (INV-2).
 * `custodyPubKeyB64` is explicitly allowed (public). The match is conservative —
 * it targets private/seal/vault key shapes, not the public custody key.
 *
 * Prompt 2 extension (A2 split): OAuth/credential MATERIAL must also never cross
 * the handshake. The host send-client token and the sandbox read-client token are
 * NODE-LOCAL (see `email/roleScopedTokenStore.ts`); a `critical_job_*` payload is
 * never the carrier. We reject token/secret/password field shapes here so an
 * accidental serialization fails closed at the wire instead of leaking a token.
 */
const FORBIDDEN_KEY_PATTERN =
  /(privatekey|priv_key|secretkey|secret_key|sealkey|seal_key|vaultkey|vault_key|privkey|accesstoken|access_token|refreshtoken|refresh_token|oauthtoken|oauth_token|clientsecret|client_secret|bearertoken|bearer_token|imap_?password|smtp_?password)/i

const ALLOWED_SPEC_TOP_KEYS: ReadonlySet<string> = new Set([
  'jobId',
  'kind',
  'input',
  'custodyPubKeyB64',
  'limits',
  'flush',
])

function scanForKeyMaterial(value: unknown, path: string): void {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'custodyPubKeyB64') continue // public key — explicitly allowed (INV-2)
      if (FORBIDDEN_KEY_PATTERN.test(k)) {
        throw new CriticalJobError(
          'E_REMOTE_PROTOCOL',
          `INV-2 violation: forbidden key-material field "${path}${k}" on critical-job wire`,
        )
      }
      scanForKeyMaterial(v, `${path}${k}.`)
    }
  }
}

/**
 * Assert a serialized spec carries no private key material (INV-2). Enforces both
 * a strict top-level allowlist and a recursive forbidden-field-name scan.
 */
export function assertNoKeyMaterialOnWire(s: SerializedCriticalJobSpec): void {
  for (const k of Object.keys(s)) {
    if (!ALLOWED_SPEC_TOP_KEYS.has(k)) {
      throw new CriticalJobError(
        'E_REMOTE_PROTOCOL',
        `INV-2 violation: unexpected top-level field "${k}" on critical-job wire spec`,
      )
    }
  }
  if (s.custodyPubKeyB64 !== undefined && typeof s.custodyPubKeyB64 !== 'string') {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'custodyPubKeyB64 must be a string (public key)')
  }
  scanForKeyMaterial(s.input, 'input.')
}

export function serializeCriticalJobSpec<K extends CriticalJobKind>(
  spec: CriticalJobSpec<K>,
): SerializedCriticalJobSpec {
  const s: SerializedCriticalJobSpec = {
    jobId: spec.jobId,
    kind: spec.kind,
    input: encodeBuffers(spec.input),
    ...(spec.custodyPubKeyB64 !== undefined ? { custodyPubKeyB64: spec.custodyPubKeyB64 } : {}),
    limits: {
      maxWallClockMs: spec.limits.maxWallClockMs,
      ...(spec.limits.maxInputBytes !== undefined ? { maxInputBytes: spec.limits.maxInputBytes } : {}),
    },
    flush: spec.flush,
  }
  assertNoKeyMaterialOnWire(s)
  return s
}

const VALID_FLUSH: ReadonlySet<string> = new Set<FlushMode>(['per-action', 'per-vm', 'session'])

export function deserializeCriticalJobSpec(s: SerializedCriticalJobSpec): CriticalJobSpec {
  if (!s || typeof s !== 'object') {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'malformed critical-job spec')
  }
  if (typeof s.jobId !== 'string' || !s.jobId.trim()) {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'spec.jobId required')
  }
  if (typeof s.kind !== 'string') {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'spec.kind required')
  }
  if (!s.limits || typeof s.limits.maxWallClockMs !== 'number' || !(s.limits.maxWallClockMs > 0)) {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'spec.limits.maxWallClockMs required')
  }
  if (!VALID_FLUSH.has(s.flush)) {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'spec.flush invalid')
  }
  // Re-assert INV-2 on the way in — never trust a remote peer's serialization.
  assertNoKeyMaterialOnWire(s)
  return {
    jobId: s.jobId,
    kind: s.kind,
    input: decodeBuffers(s.input) as CriticalJobSpec['input'],
    ...(s.custodyPubKeyB64 !== undefined ? { custodyPubKeyB64: s.custodyPubKeyB64 } : {}),
    limits: {
      maxWallClockMs: s.limits.maxWallClockMs,
      ...(s.limits.maxInputBytes !== undefined ? { maxInputBytes: s.limits.maxInputBytes } : {}),
    },
    flush: s.flush,
  } as CriticalJobSpec
}

export function serializeCriticalJobResult<K extends CriticalJobKind>(
  result: CriticalJobResult<K>,
): SerializedCriticalJobResult {
  return encodeBuffers(result)
}

export function deserializeCriticalJobResult(s: SerializedCriticalJobResult): CriticalJobResult {
  const r = decodeBuffers(s)
  if (!r || typeof r !== 'object' || typeof (r as Record<string, unknown>).jobId !== 'string') {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'malformed critical-job result')
  }
  if (typeof (r as Record<string, unknown>).ok !== 'boolean') {
    throw new CriticalJobError('E_REMOTE_PROTOCOL', 'result.ok required')
  }
  return r as CriticalJobResult
}
