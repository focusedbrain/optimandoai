/**
 * WRC cryptographic conventions (contract §2), client side only.
 *
 * Canonical JSON is `canonicalJsonString` from `@repo/ingestion-core`:
 * recursively sorted keys, no insignificant whitespace, integers only. The
 * contract states its canonical form is byte-identical to the wr-connect
 * `wrc_canonical_json`, and that module is the repo's implementation of the
 * same rules, so it is reused rather than re-derived.
 *
 * One deliberate difference from the WR Handshake idiom: WRC signatures are
 * over the canonical object minus its `sig` field with **no** domain-separation
 * prefix (§2). `signingBytes()` prepends the `WRH1|type|vN|` tag and must NOT
 * be used here — a tagged input would never verify against a publisher
 * signature, and worse, silently reusing the tag would let a WRC object and a
 * handshake object share a preimage space they must not share.
 *
 * Verification only: this module has no signing function, because the client
 * is never a publisher and never the WRC ingest.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { canonicalJsonString, type CanonicalJsonValue } from '@repo/ingestion-core'
import type { WrcHash, WrcInclusionStep } from './wrcContract'

// ── Hashing ───────────────────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** `sha256:<base64url>` over raw bytes (§2). */
export function wrcHashBytes(bytes: Buffer | Uint8Array): WrcHash {
  return `sha256:${b64url(createHash('sha256').update(Buffer.from(bytes)).digest())}`
}

/** Canonical bytes of a JSON-shaped value. Throws only on non-canonicalizable input. */
export function wrcCanonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJsonString(value as CanonicalJsonValue), 'utf8')
}

/** `sha256:<base64url>` over the canonical JSON of an object (§2). */
export function wrcHashObject(value: unknown): WrcHash {
  return wrcHashBytes(wrcCanonicalBytes(value))
}

/** Raw 32-byte digest behind a `sha256:` hash string, or null when malformed. */
export function wrcHashToBytes(hash: WrcHash): Buffer | null {
  if (!hash.startsWith('sha256:')) return null
  const raw = fromB64Url(hash.slice('sha256:'.length))
  return raw.length === 32 ? raw : null
}

// ── Ed25519 ───────────────────────────────────────────────────────────────────

/** RFC 8410 SPKI DER prefix for a raw 32-byte Ed25519 public key. */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function publicKeyFromRaw(rawB64Url: string) {
  const raw = fromB64Url(rawB64Url)
  if (raw.length !== 32) return null
  try {
    return createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    })
  } catch {
    return null
  }
}

/**
 * Verify a detached Ed25519 signature over `message`.
 * Returns false for any malformed input rather than throwing — a malformed key
 * or signature is a verification failure, not an exceptional condition.
 */
export function wrcVerifyEd25519(
  message: Buffer | Uint8Array,
  signatureB64Url: string,
  publicKeyRawB64Url: string,
): boolean {
  const key = publicKeyFromRaw(publicKeyRawB64Url)
  if (!key) return false
  const sig = fromB64Url(signatureB64Url)
  if (sig.length !== 64) return false
  try {
    return cryptoVerify(null, Buffer.from(message), key, sig)
  } catch {
    return false
  }
}

/**
 * Verify an object's own `sig` field: canonical JSON of the object MINUS `sig`,
 * no domain tag (§2). The `sig` property is removed rather than blanked, since
 * canonicalization treats an absent property and an empty one differently.
 */
export function wrcVerifyObjectSignature(
  object: Record<string, unknown>,
  publicKeyRawB64Url: string,
): boolean {
  const sig = object.sig
  if (typeof sig !== 'string' || sig.length === 0) return false
  const { sig: _omitted, ...unsigned } = object
  let bytes: Buffer
  try {
    bytes = wrcCanonicalBytes(unsigned)
  } catch {
    return false
  }
  return wrcVerifyEd25519(bytes, sig, publicKeyRawB64Url)
}

/**
 * Ingest countersignature: signs `hash || epoch` (§3.4). The concatenation is
 * the ASCII hash string followed by the decimal epoch, which is what the
 * contract's wording denotes and what the fixture generator produces; there is
 * no separate canonical object for it.
 */
export function wrcCountersignatureMessage(hash: WrcHash, epoch: number): Buffer {
  return Buffer.from(`${hash}${String(epoch)}`, 'utf8')
}

// ── Merkle inclusion (§2) ─────────────────────────────────────────────────────

/**
 * Fold an inclusion proof from a leaf hash up to a root.
 * parent = sha256(left || right) over the RAW 32-byte digests, with `pos`
 * naming the side the SIBLING sits on.
 */
export function wrcFoldInclusionProof(
  leaf: WrcHash,
  proof: readonly WrcInclusionStep[],
): WrcHash | null {
  const leafBytes = wrcHashToBytes(leaf)
  if (!leafBytes) return null
  let acc: Buffer = leafBytes
  for (const step of proof) {
    const sib = wrcHashToBytes(step.hash)
    if (!sib) return null
    const pair: Buffer =
      step.pos === 'left' ? Buffer.concat([sib, acc]) : Buffer.concat([acc, sib])
    acc = createHash('sha256').update(pair).digest()
  }
  return `sha256:${b64url(acc)}`
}

/** Constant-time-ish string compare for hash equality. */
export function wrcHashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
