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

/** Domain-separate from quarantine-blob-v1 (quarantine-encrypt/index.ts:42). */
const HKDF_INFO = 'wrdesk-service-rpc-v1'
const SALT_BYTES = 16
const NONCE_BYTES = 12
const KEY_BYTES = 32

export interface SealedServiceRpcEnvelope {
  readonly envelope_type: typeof SEALED_SERVICE_RPC_ENVELOPE_TYPE
  readonly schema_version: typeof SEALED_SERVICE_RPC_SCHEMA_VERSION
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  readonly sender_ephemeral_x25519_pub_b64: string
  readonly salt_b64: string
  readonly nonce_b64: string
  /** AES-256-GCM ciphertext with auth tag appended (matches quarantine convention). */
  readonly ciphertext_b64: string
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

export function resolvePeerX25519PubForSeal(record: HandshakeRecord): SealServiceRpcResult | { pubB64: string } {
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

export function resolveLocalX25519PrivForOpen(record: HandshakeRecord): OpenServiceRpcResult | { privB64: string } {
  const privB64 = trimNonEmpty(record.local_x25519_private_key_b64)
  if (!privB64) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_MISSING_LOCAL_X25519',
      message: 'local_x25519_private_key_b64 missing on handshake record — cannot open (no plaintext fallback)',
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
  if (envelope.schema_version !== SEALED_SERVICE_RPC_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'E_SEALED_RPC_INVALID_ENVELOPE',
      message: `unsupported schema_version ${String(envelope.schema_version)}`,
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
  if ('ok' in peer && peer.ok === false) return peer

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
 * Open a sealed service-RPC envelope using `local_x25519_private_key_b64`.
 * Mirrors `decryptQuarantineBlob` (quarantine-encrypt/index.ts:137-180).
 */
export function openServiceRpcPayload(
  record: HandshakeRecord,
  envelope: SealedServiceRpcEnvelope,
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

  const local = resolveLocalX25519PrivForOpen(record)
  if ('ok' in local && local.ok === false) return local

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
