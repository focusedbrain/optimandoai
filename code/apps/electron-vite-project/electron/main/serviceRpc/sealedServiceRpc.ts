/**
 * E2E-sealed service-RPC envelopes — Phase A / Prompt A1.
 *
 * Reuses the audited X25519 + HKDF-SHA256 + AES-256-GCM chain from
 * `quarantine-encrypt/index.ts` (`encryptForQuarantine` / `decryptQuarantineBlob`),
 * which mirrors `decryptQBeapPackage.ts`. No new cryptography — domain separation
 * via HKDF info + GCM associated data only.
 *
 * INV-ENCRYPT: inner service-RPC JSON (type, payload) lives ONLY inside ciphertext.
 * Routing metadata on the wire is limited to handshake_id + device ids + envelope marker.
 */

import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'crypto'
import { x25519 } from '@noble/curves/ed25519'
import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'
import type { HandshakeRecord } from '../handshake/types'

/** Non-secret marker for relay allowlist / dispatch (A2). Inner RPC type stays in ciphertext. */
export const SEALED_SERVICE_RPC_ENVELOPE_TYPE = SEALED_SERVICE_RPC_CAPSULE_TYPE
export { SEALED_SERVICE_RPC_CAPSULE_TYPE }
export const SEALED_SERVICE_RPC_SCHEMA_VERSION = 1 as const
/**
 * Roadmap 0.26 — sender-authenticated envelope for the relay service-RPC paths.
 * The key additionally mixes the SENDER's static device X25519 key (static-static DH,
 * as in NaCl `box`), so only the holder of the device key pinned on the handshake can
 * produce an envelope the receiver opens. `expires_at` and `message_id` are bound in
 * the AAD; the receiver refuses expired, too-far-future and replayed envelopes.
 * v1 stays for the in-capsule `context_blocks_sealed` (canonical capsule form).
 */
export const SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH = 2 as const

/** Domain-separate from quarantine-blob-v1 (quarantine-encrypt/index.ts:42). */
const HKDF_INFO = 'wrdesk-service-rpc-v1'
const HKDF_INFO_AUTH = 'wrdesk-service-rpc-v2-auth'
const SALT_BYTES = 16
const NONCE_BYTES = 12
const KEY_BYTES = 32

/** Default lifetime of an authenticated envelope (relay store-and-forward window). */
export const SEALED_RPC_DEFAULT_TTL_MS = 10 * 60 * 1000
/** Receivers refuse an `expires_at` further away than this (bounds the replay cache). */
export const SEALED_RPC_MAX_TTL_MS = 24 * 60 * 60 * 1000
/** Clock skew tolerated on `expires_at`. */
const SEALED_RPC_CLOCK_SKEW_MS = 2 * 60 * 1000

export interface SealedServiceRpcEnvelope {
  readonly envelope_type: typeof SEALED_SERVICE_RPC_ENVELOPE_TYPE
  readonly schema_version: typeof SEALED_SERVICE_RPC_SCHEMA_VERSION | typeof SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  readonly sender_ephemeral_x25519_pub_b64: string
  readonly salt_b64: string
  readonly nonce_b64: string
  /** AES-256-GCM ciphertext with auth tag appended (matches quarantine convention). */
  readonly ciphertext_b64: string
  /** v2 only: epoch ms after which the receiver refuses the envelope. */
  readonly expires_at?: number
  /** v2 only: unique id; a receiver opens each id at most once. */
  readonly message_id?: string
}

export interface SealServiceRpcInput {
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  readonly plaintextJson: string | Record<string, unknown>
}

export type SealServiceRpcResult =
  | { readonly ok: true; readonly envelope: SealedServiceRpcEnvelope }
  | { readonly ok: false; readonly code: string; readonly message: string }

export type OpenServiceRpcResult =
  | { readonly ok: true; readonly plaintextJson: string }
  | { readonly ok: false; readonly code: string; readonly message: string }

function normalizePlaintextJson(input: string | Record<string, unknown>): string {
  if (typeof input === 'string') return input
  return JSON.stringify(input)
}

function trimNonEmpty(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : ''
}

function decodeX25519PubB64(pubB64: string): Buffer | null {
  try {
    const b = Buffer.from(pubB64, 'base64')
    return b.length === 32 ? b : null
  } catch {
    return null
  }
}

function decodeX25519PrivB64(privB64: string): Buffer | null {
  try {
    const b = Buffer.from(privB64, 'base64')
    return b.length === 32 ? b : null
  } catch {
    return null
  }
}

/** Canonical AAD binding — must match on seal and open (replay resistance). */
export function buildSealedServiceRpcAad(input: {
  handshake_id: string
  sender_device_id: string
  receiver_device_id: string
}): Buffer {
  const hid = input.handshake_id.trim()
  const sender = input.sender_device_id.trim()
  const receiver = input.receiver_device_id.trim()
  return Buffer.from(`${hid}|${sender}|${receiver}`, 'utf8')
}

/** v2 AAD: routing plus expiry and message id, so neither can be changed in transit. */
function buildAuthenticatedAad(input: {
  handshake_id: string
  sender_device_id: string
  receiver_device_id: string
  expires_at: number
  message_id: string
}): Buffer {
  return Buffer.concat([
    Buffer.from('v2|', 'utf8'),
    buildSealedServiceRpcAad(input),
    Buffer.from(`|${input.expires_at}|${input.message_id}`, 'utf8'),
  ])
}

/** v2 key: HKDF over DH(ephemeral, recipient) || DH(sender static, recipient). */
function deriveAuthenticatedKey(ss1: Uint8Array, ss2: Uint8Array, salt: Buffer): Buffer {
  const ikm = Buffer.concat([Buffer.from(ss1), Buffer.from(ss2)])
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(HKDF_INFO_AUTH, 'utf-8'), KEY_BYTES))
  ikm.fill(0)
  return key
}

// ── Replay guard (v2) ─────────────────────────────────────────────────────────
// message_id → expires_at. Entries live until their envelope expires; the TTL cap
// (SEALED_RPC_MAX_TTL_MS) bounds the cache. In-memory: after a restart, an envelope
// can be opened once more only within its own short lifetime.
const seenMessageIds = new Map<string, number>()

function pruneSeen(nowMs: number): void {
  for (const [id, exp] of seenMessageIds) {
    if (exp + SEALED_RPC_CLOCK_SKEW_MS < nowMs) seenMessageIds.delete(id)
  }
}

/** Test-only. */
export function __resetSealedRpcReplayGuardForTests(): void {
  seenMessageIds.clear()
}

/** Key lookups never succeed with an envelope — they fail or yield the key. */
type KeyLookupFailure = { readonly ok: false; readonly code: string; readonly message: string }

export function resolvePeerX25519PubForSeal(record: HandshakeRecord): KeyLookupFailure | { pubB64: string } {
  const pubB64 = trimNonEmpty(record.peer_x25519_public_key_b64)
  if (!pubB64) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_MISSING_PEER_X25519',
      message: 'peer_x25519_public_key_b64 missing on handshake record — cannot seal (no plaintext fallback)',
    }
  }
  const pub = decodeX25519PubB64(pubB64)
  if (!pub) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_PEER_X25519',
      message: 'peer_x25519_public_key_b64 must decode to 32 bytes',
    }
  }
  return { pubB64 }
}

export function resolveLocalX25519PrivForOpen(
  record: HandshakeRecord,
  fallbackPrivB64?: string | null,
): KeyLookupFailure | { privB64: string } {
  // Legacy handshakes carry the X25519 private key on the record. Post device-key
  // migration the private key lives ONLY in the orchestrator-DB device key store, so
  // the caller resolves it there and passes it as `fallbackPrivB64`. Fail-closed either way.
  const privB64 = trimNonEmpty(record.local_x25519_private_key_b64) || trimNonEmpty(fallbackPrivB64)
  if (!privB64) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_MISSING_LOCAL_X25519',
      message:
        'local X25519 private key unavailable (handshake record + orchestrator device key store) — cannot open (no plaintext fallback)',
    }
  }
  const priv = decodeX25519PrivB64(privB64)
  if (!priv) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_LOCAL_X25519',
      message: 'local_x25519_private_key_b64 must decode to 32 bytes',
    }
  }
  return { privB64 }
}

function validateSealInput(record: HandshakeRecord, input: SealServiceRpcInput): SealServiceRpcResult | null {
  const hid = trimNonEmpty(input.handshake_id)
  const sender = trimNonEmpty(input.sender_device_id)
  const receiver = trimNonEmpty(input.receiver_device_id)
  if (!hid || !sender || !receiver) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_ROUTING',
      message: 'handshake_id, sender_device_id, and receiver_device_id are required',
    }
  }
  const recordHid = trimNonEmpty(record.handshake_id)
  if (recordHid && recordHid !== hid) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_HANDSHAKE_MISMATCH',
      message: 'input handshake_id does not match handshake record',
    }
  }
  return null
}

function validateEnvelopeShape(envelope: SealedServiceRpcEnvelope): OpenServiceRpcResult | null {
  if (envelope.envelope_type !== SEALED_SERVICE_RPC_ENVELOPE_TYPE) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_ENVELOPE',
      message: `unsupported envelope_type ${String(envelope.envelope_type)}`,
    }
  }
  if (
    envelope.schema_version !== SEALED_SERVICE_RPC_SCHEMA_VERSION &&
    envelope.schema_version !== SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH
  ) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_ENVELOPE',
      message: `unsupported schema_version ${String(envelope.schema_version)}`,
    }
  }
  if (
    envelope.schema_version === SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH &&
    (typeof envelope.expires_at !== 'number' ||
      !Number.isFinite(envelope.expires_at) ||
      !trimNonEmpty(envelope.message_id))
  ) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_ENVELOPE',
      message: 'authenticated envelope requires expires_at and message_id',
    }
  }
  if (
    !trimNonEmpty(envelope.handshake_id) ||
    !trimNonEmpty(envelope.sender_device_id) ||
    !trimNonEmpty(envelope.receiver_device_id) ||
    !trimNonEmpty(envelope.sender_ephemeral_x25519_pub_b64) ||
    !trimNonEmpty(envelope.salt_b64) ||
    !trimNonEmpty(envelope.nonce_b64) ||
    !trimNonEmpty(envelope.ciphertext_b64)
  ) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_ENVELOPE',
      message: 'sealed envelope missing required fields',
    }
  }
  return null
}

/**
 * Seal a service-RPC JSON payload for the peer using `peer_x25519_public_key_b64`.
 * Mirrors `encryptForQuarantine` (quarantine-encrypt/index.ts:69-123).
 */
export function sealServiceRpcPayload(
  record: HandshakeRecord,
  input: SealServiceRpcInput,
): SealServiceRpcResult {
  const routingErr = validateSealInput(record, input)
  if (routingErr) return routingErr

  const peer = resolvePeerX25519PubForSeal(record)
  if ('ok' in peer) return peer

  const recipientPubBytes = decodeX25519PubB64(peer.pubB64)
  if (!recipientPubBytes) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_PEER_X25519',
      message: 'peer_x25519_public_key_b64 must decode to 32 bytes',
    }
  }

  const plaintext = Buffer.from(normalizePlaintextJson(input.plaintextJson), 'utf8')
  const aad = buildSealedServiceRpcAad(input)

  try {
    const ephemeralPriv = x25519.utils.randomPrivateKey()
    const ephemeralPub = x25519.getPublicKey(ephemeralPriv)
    const sharedSecret = x25519.getSharedSecret(ephemeralPriv, new Uint8Array(recipientPubBytes))

    const salt = randomBytes(SALT_BYTES)
    const derivedKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(sharedSecret), salt, Buffer.from(HKDF_INFO, 'utf-8'), KEY_BYTES),
    )

    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', derivedKey, nonce)
    cipher.setAAD(aad)
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()

    derivedKey.fill(0)
    ;(sharedSecret as Uint8Array).fill(0)
    ephemeralPriv.fill(0)

    return {
      ok: true,
      envelope: {
        envelope_type: SEALED_SERVICE_RPC_ENVELOPE_TYPE,
        schema_version: SEALED_SERVICE_RPC_SCHEMA_VERSION,
        handshake_id: input.handshake_id.trim(),
        sender_device_id: input.sender_device_id.trim(),
        receiver_device_id: input.receiver_device_id.trim(),
        sender_ephemeral_x25519_pub_b64: Buffer.from(ephemeralPub).toString('base64'),
        salt_b64: salt.toString('base64'),
        nonce_b64: nonce.toString('base64'),
        ciphertext_b64: Buffer.concat([ct, tag]).toString('base64'),
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'E_SEALED_RPC_SEAL_FAILED', message: msg }
  }
}

/**
 * Seal a sender-authenticated (v2) envelope. `senderStaticPrivB64` is THIS device's
 * static X25519 private key — the one whose public half the peer has pinned on the
 * handshake as `peer_x25519_public_key_b64`.
 */
export function sealServiceRpcPayloadAuthenticated(
  record: HandshakeRecord,
  input: SealServiceRpcInput,
  senderStaticPrivB64: string | null | undefined,
  opts: { ttlMs?: number; nowMs?: number; messageId?: string } = {},
): SealServiceRpcResult {
  const routingErr = validateSealInput(record, input)
  if (routingErr) return routingErr

  const peer = resolvePeerX25519PubForSeal(record)
  if ('ok' in peer) return peer
  const recipientPubBytes = decodeX25519PubB64(peer.pubB64)
  if (!recipientPubBytes) {
    return { ok: false, code: 'E_SEALED_RPC_INVALID_PEER_X25519', message: 'peer_x25519_public_key_b64 must decode to 32 bytes' }
  }
  const senderPriv = decodeX25519PrivB64(trimNonEmpty(senderStaticPrivB64))
  if (!senderPriv) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_MISSING_LOCAL_X25519',
      message: 'local static X25519 private key unavailable — cannot seal an authenticated envelope (no unauthenticated fallback)',
    }
  }

  const ttlMs = Math.min(Math.max(1, opts.ttlMs ?? SEALED_RPC_DEFAULT_TTL_MS), SEALED_RPC_MAX_TTL_MS)
  const expiresAt = (opts.nowMs ?? Date.now()) + ttlMs
  const messageId = trimNonEmpty(opts.messageId) || randomBytes(16).toString('hex')
  const routing = {
    handshake_id: input.handshake_id.trim(),
    sender_device_id: input.sender_device_id.trim(),
    receiver_device_id: input.receiver_device_id.trim(),
  }
  const plaintext = Buffer.from(normalizePlaintextJson(input.plaintextJson), 'utf8')
  const aad = buildAuthenticatedAad({ ...routing, expires_at: expiresAt, message_id: messageId })

  try {
    const ephemeralPriv = x25519.utils.randomPrivateKey()
    const ephemeralPub = x25519.getPublicKey(ephemeralPriv)
    const ss1 = x25519.getSharedSecret(ephemeralPriv, new Uint8Array(recipientPubBytes))
    const ss2 = x25519.getSharedSecret(new Uint8Array(senderPriv), new Uint8Array(recipientPubBytes))
    const salt = randomBytes(SALT_BYTES)
    const derivedKey = deriveAuthenticatedKey(ss1, ss2, salt)

    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', derivedKey, nonce)
    cipher.setAAD(aad)
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()

    derivedKey.fill(0)
    ss1.fill(0)
    ss2.fill(0)
    ephemeralPriv.fill(0)
    senderPriv.fill(0)

    return {
      ok: true,
      envelope: {
        envelope_type: SEALED_SERVICE_RPC_ENVELOPE_TYPE,
        schema_version: SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH,
        ...routing,
        sender_ephemeral_x25519_pub_b64: Buffer.from(ephemeralPub).toString('base64'),
        salt_b64: salt.toString('base64'),
        nonce_b64: nonce.toString('base64'),
        ciphertext_b64: Buffer.concat([ct, tag]).toString('base64'),
        expires_at: expiresAt,
        message_id: messageId,
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'E_SEALED_RPC_SEAL_FAILED', message: msg }
  }
}

/** Resolve this device's static X25519 private key the same way the open path does. */
async function resolveLocalStaticPrivB64(record: HandshakeRecord): Promise<string> {
  const onRecord = trimNonEmpty(record.local_x25519_private_key_b64)
  if (onRecord) return onRecord
  try {
    const { getDeviceX25519KeyPair } = await import('../device-keys/deviceKeyStore')
    const deviceKp = await getDeviceX25519KeyPair()
    return trimNonEmpty(deviceKp.privateKey)
  } catch {
    return ''
  }
}

/** Seal a v2 envelope, resolving this device's static key (record, then device key store). */
export async function sealServiceRpcPayloadAuthenticatedResolvingLocalKey(
  record: HandshakeRecord,
  input: SealServiceRpcInput,
  opts: { ttlMs?: number } = {},
): Promise<SealServiceRpcResult> {
  return sealServiceRpcPayloadAuthenticated(record, input, await resolveLocalStaticPrivB64(record), opts)
}

export interface OpenServiceRpcOptions {
  /** Refuse v1 (unauthenticated) envelopes — set on every relay service-RPC receiver. */
  readonly requireAuthenticated?: boolean
  readonly nowMs?: number
}

/**
 * Replay guard for v2 envelopes. Opening is stateless (relay dispatch lets several
 * handlers open one envelope to decide by inner type); the handler that TAKES the
 * message claims its id once, after its inner-type check. A second claim of the same
 * id is a replay. Receivers that are idempotent themselves (they answer a relay
 * redelivery from their own cache and never repeat the effect) need not claim.
 * v1 envelopes carry no id and always claim successfully.
 */
export function claimSealedServiceRpcMessage(
  envelope: SealedServiceRpcEnvelope,
  nowMs: number = Date.now(),
): { readonly ok: true } | { readonly ok: false; readonly code: 'E_SEALED_RPC_REPLAY'; readonly message: string } {
  if (envelope.schema_version !== SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH) return { ok: true }
  const messageId = trimNonEmpty(envelope.message_id)
  if (seenMessageIds.has(messageId)) {
    return { ok: false, code: 'E_SEALED_RPC_REPLAY', message: 'sealed envelope message_id already handled' }
  }
  pruneSeen(nowMs)
  seenMessageIds.set(messageId, envelope.expires_at as number)
  return { ok: true }
}

/**
 * Open a sealed service-RPC envelope using the local device's X25519 private key.
 *
 * The private key is resolved from the handshake record (legacy) or, when absent there,
 * from `localX25519PrivB64Override` (the orchestrator-DB device key store — see
 * `openServiceRpcPayloadResolvingLocalKey`). Mirrors `decryptQuarantineBlob`
 * (quarantine-encrypt/index.ts:137-180). Pure/synchronous: the async key lookup happens
 * in the resolver wrapper so this stays unit-testable.
 */
export function openServiceRpcPayload(
  record: HandshakeRecord,
  envelope: SealedServiceRpcEnvelope,
  localX25519PrivB64Override?: string | null,
  opts: OpenServiceRpcOptions = {},
): OpenServiceRpcResult {
  const shapeErr = validateEnvelopeShape(envelope)
  if (shapeErr) return shapeErr

  const recordHid = trimNonEmpty(record.handshake_id)
  if (recordHid && recordHid !== envelope.handshake_id.trim()) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_HANDSHAKE_MISMATCH',
      message: 'envelope handshake_id does not match handshake record',
    }
  }

  if (envelope.schema_version === SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH) {
    return openAuthenticated(record, envelope, localX25519PrivB64Override, opts.nowMs ?? Date.now())
  }
  if (opts.requireAuthenticated) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_UNAUTHENTICATED',
      message: 'unauthenticated (v1) envelope refused on this path — sender must run a build with authenticated service RPC',
    }
  }

  const local = resolveLocalX25519PrivForOpen(record, localX25519PrivB64Override)
  if ('ok' in local) return local

  const privBytes = decodeX25519PrivB64(local.privB64)
  const senderPubBytes = decodeX25519PubB64(envelope.sender_ephemeral_x25519_pub_b64)
  if (!privBytes || !senderPubBytes) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_ENVELOPE',
      message: 'invalid X25519 key material in envelope or record',
    }
  }

  const aad = buildSealedServiceRpcAad({
    handshake_id: envelope.handshake_id,
    sender_device_id: envelope.sender_device_id,
    receiver_device_id: envelope.receiver_device_id,
  })

  try {
    const sharedSecret = x25519.getSharedSecret(
      new Uint8Array(privBytes),
      new Uint8Array(senderPubBytes),
    )

    const salt = Buffer.from(envelope.salt_b64, 'base64')
    const derivedKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(sharedSecret), salt, Buffer.from(HKDF_INFO, 'utf-8'), KEY_BYTES),
    )

    const nonce = Buffer.from(envelope.nonce_b64, 'base64')
    const ciphertextWithTag = Buffer.from(envelope.ciphertext_b64, 'base64')
    if (ciphertextWithTag.length < 16) {
      return {
        ok: false,
        code: 'E_SEALED_RPC_DECRYPT_FAILED',
        message: 'ciphertext too short',
      }
    }
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16)
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16)

    const decipher = createDecipheriv('aes-256-gcm', derivedKey, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    derivedKey.fill(0)
    ;(sharedSecret as Uint8Array).fill(0)
    privBytes.fill(0)

    return { ok: true, plaintextJson: plaintext.toString('utf8') }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'E_SEALED_RPC_DECRYPT_FAILED', message: msg }
  }
}

function openAuthenticated(
  record: HandshakeRecord,
  envelope: SealedServiceRpcEnvelope,
  localX25519PrivB64Override: string | null | undefined,
  nowMs: number,
): OpenServiceRpcResult {
  const expiresAt = envelope.expires_at as number
  const messageId = (envelope.message_id as string).trim()
  if (expiresAt + SEALED_RPC_CLOCK_SKEW_MS < nowMs) {
    return { ok: false, code: 'E_SEALED_RPC_EXPIRED', message: 'sealed envelope expired' }
  }
  if (expiresAt > nowMs + SEALED_RPC_MAX_TTL_MS + SEALED_RPC_CLOCK_SKEW_MS) {
    return { ok: false, code: 'E_SEALED_RPC_EXPIRY_TOO_FAR', message: 'sealed envelope expires_at is too far in the future' }
  }

  const local = resolveLocalX25519PrivForOpen(record, localX25519PrivB64Override)
  if ('ok' in local) return local
  const peer = resolvePeerX25519PubForSeal(record)
  if ('ok' in peer) {
    return { ok: false, code: peer.code, message: `${peer.message} (needed to authenticate the sender)` }
  }

  const privBytes = decodeX25519PrivB64(local.privB64)
  const ephPubBytes = decodeX25519PubB64(envelope.sender_ephemeral_x25519_pub_b64)
  const senderStaticPubBytes = decodeX25519PubB64(peer.pubB64)
  if (!privBytes || !ephPubBytes || !senderStaticPubBytes) {
    return { ok: false, code: 'E_SEALED_RPC_INVALID_ENVELOPE', message: 'invalid X25519 key material in envelope or record' }
  }

  const aad = buildAuthenticatedAad({
    handshake_id: envelope.handshake_id,
    sender_device_id: envelope.sender_device_id,
    receiver_device_id: envelope.receiver_device_id,
    expires_at: expiresAt,
    message_id: messageId,
  })

  try {
    const ss1 = x25519.getSharedSecret(new Uint8Array(privBytes), new Uint8Array(ephPubBytes))
    const ss2 = x25519.getSharedSecret(new Uint8Array(privBytes), new Uint8Array(senderStaticPubBytes))
    const derivedKey = deriveAuthenticatedKey(ss1, ss2, Buffer.from(envelope.salt_b64, 'base64'))
    ss1.fill(0)
    ss2.fill(0)
    privBytes.fill(0)

    const nonce = Buffer.from(envelope.nonce_b64, 'base64')
    const ciphertextWithTag = Buffer.from(envelope.ciphertext_b64, 'base64')
    if (ciphertextWithTag.length < 16) {
      derivedKey.fill(0)
      return { ok: false, code: 'E_SEALED_RPC_DECRYPT_FAILED', message: 'ciphertext too short' }
    }
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16)
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', derivedKey, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    derivedKey.fill(0)
    return { ok: true, plaintextJson: plaintext.toString('utf8') }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // A failed tag here means: wrong recipient key, tampering, or a sender that does not
    // hold the device key pinned on this handshake.
    return { ok: false, code: 'E_SEALED_RPC_DECRYPT_FAILED', message: msg }
  }
}

/**
 * Open a sealed service-RPC envelope, resolving the local device's X25519 private key from
 * the SAME store the seal path / qBEAP decrypt use (INV-CRYPTO-REUSE):
 *   1. legacy handshakes keep the private key on the record (`local_x25519_private_key_b64`);
 *   2. post device-key migration it lives in the orchestrator-DB device key store
 *      (`getDeviceX25519KeyPair`, key_id `x25519_device_v1`), mirroring
 *      `decryptQBeapPackage.ts` and `ipc.ts` `beap.deriveSharedSecret`.
 *
 * Works in BOTH directions (sandbox opening the host's request; host opening the sandbox's
 * result) because each device opens with its own static device key. Fail-closed: if neither
 * source yields a 32-byte key, `openServiceRpcPayload` returns `E_SEALED_RPC_MISSING_LOCAL_X25519`
 * — never a plaintext fallback (INV-ENCRYPT).
 */
export async function openServiceRpcPayloadResolvingLocalKey(
  record: HandshakeRecord,
  envelope: SealedServiceRpcEnvelope,
  opts: OpenServiceRpcOptions = {},
): Promise<OpenServiceRpcResult> {
  // Empty → openServiceRpcPayload fails closed with MISSING_LOCAL_X25519 (no plaintext).
  const localPrivB64 = await resolveLocalStaticPrivB64(record)
  return openServiceRpcPayload(record, envelope, localPrivB64 || undefined, opts)
}
