/**
 * Per-Record Envelope Encryption (schema_version = 2)
 * =====================================================
 *
 * Key hierarchy:
 *   Master Password → scrypt → KEK (vault-level, in-session)
 *   KEK → AES-256-GCM → wraps per-record DEK
 *   record DEK → XChaCha20-Poly1305 → encrypts fields JSON blob
 *
 * Each vault record has its own random 256-bit DEK that is wrapped
 * (encrypted) with the vault-level KEK.  The wrapped DEK and ciphertext
 * are stored alongside the record.  On read, the KEK unwraps the record
 * DEK, decrypts the ciphertext, and the record DEK is zeroized.
 *
 * This module is ZERO-dependency on VaultService — pure crypto functions.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { createRequire } from 'module'
import { zeroize, buildAAD } from './crypto'

const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Lazy libsodium loader (shared with crypto.ts pattern)
// ---------------------------------------------------------------------------
let sodium: any = null
let sodiumReady = false

async function ensureSodium(): Promise<void> {
  if (sodiumReady) return
  if (!sodium) sodium = require('libsodium-wrappers')
  await sodium.ready
  sodiumReady = true
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current envelope schema version written by createItem / migrateItem. */
export const ENVELOPE_SCHEMA_VERSION = 2

/** Legacy schema version (HKDF-based field-level encryption). */
export const LEGACY_SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// Record DEK — generation, wrapping, unwrapping
// ---------------------------------------------------------------------------

/** Generate a fresh random 256-bit record DEK. */
export function generateRecordDEK(): Buffer {
  return randomBytes(32)
}

/**
 * Wrap (encrypt) a record DEK with the vault KEK using AES-256-GCM.
 *
 * Format: nonce(12) || ciphertext(32) || authTag(16) = 60 bytes.
 * Identical layout to the vault-level wrapDEK in crypto.ts but kept
 * separate for clarity and to avoid coupling.
 *
 * @param recordDEK  32-byte per-record DEK
 * @param kek        32-byte vault KEK
 * @param aad        Optional AAD (binds wrapped key to vault + record context)
 */
export function wrapRecordDEK(recordDEK: Buffer, kek: Buffer, aad?: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kek, nonce)
  if (aad) cipher.setAAD(aad)
  const ct = Buffer.concat([cipher.update(recordDEK), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ct, tag]) // 60 bytes total
}

/**
 * Unwrap (decrypt) a record DEK.
 *
 * @param wrapped  60-byte wrapped DEK blob
 * @param kek      32-byte vault KEK
 * @param aad      Optional AAD (must match what was used during wrap)
 * @throws Error if auth tag validation fails (tampered, wrong KEK, or AAD mismatch).
 */
export function unwrapRecordDEK(wrapped: Buffer, kek: Buffer, aad?: Buffer): Buffer {
  if (wrapped.length !== 60) {
    throw new Error(`Invalid wrapped record DEK length: ${wrapped.length} (expected 60)`)
  }
  const nonce = wrapped.subarray(0, 12)
  const ct = wrapped.subarray(12, 44)
  const tag = wrapped.subarray(44, 60)

  const decipher = createDecipheriv('aes-256-gcm', kek, nonce)
  decipher.setAuthTag(tag)
  if (aad) decipher.setAAD(aad)
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()])
  } catch {
    throw new Error('Record DEK unwrap failed — KEK mismatch, AAD mismatch, or data tampered')
  }
}

// ---------------------------------------------------------------------------
// Record ciphertext — encrypt / decrypt the entire fields JSON blob
// ---------------------------------------------------------------------------

/**
 * Encrypt the serialised fields JSON with a record DEK.
 *
 * Uses libsodium XChaCha20-Poly1305 AEAD (same primitive as the legacy
 * per-field encryption, but applied to the whole record at once).
 *
 * Returns a Buffer:  nonce(24) || ciphertext+tag(variable)
 *
 * @param fieldsJson  JSON string of the record fields
 * @param recordDEK   32-byte per-record DEK
 * @param aad         Optional AAD (binds ciphertext to vault + record context)
 */
export async function encryptRecord(
  fieldsJson: string,
  recordDEK: Buffer,
  aad?: Buffer,
): Promise<Buffer> {
  await ensureSodium()
  const nonce: Uint8Array = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES, // 24
  )
  const plaintext = Buffer.from(fieldsJson, 'utf-8')
  const ciphertext: Uint8Array = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad ?? null,
    null, // no secret nonce
    nonce,
    recordDEK,
  )
  return Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)])
}

/**
 * Decrypt record ciphertext with a record DEK.
 *
 * @param blob       Ciphertext blob (nonce || ciphertext+tag)
 * @param recordDEK  32-byte per-record DEK
 * @param aad        Optional AAD (must match what was used during encrypt)
 * @returns The original fields JSON string.
 * @throws Error on auth failure or AAD mismatch.
 */
export async function decryptRecord(
  blob: Buffer,
  recordDEK: Buffer,
  aad?: Buffer,
): Promise<string> {
  await ensureSodium()
  const NONCE_LEN = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES // 24
  if (blob.length < NONCE_LEN + 1) {
    throw new Error('Record ciphertext too short')
  }
  const nonce = blob.subarray(0, NONCE_LEN)
  const ct = blob.subarray(NONCE_LEN)

  try {
    const plaintext: Uint8Array = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,  // no secret nonce
      ct,
      aad ?? null,
      nonce,
      recordDEK,
    )
    return Buffer.from(plaintext).toString('utf-8')
  } catch {
    throw new Error('Record decryption failed — wrong DEK, AAD mismatch, or data tampered')
  }
}

// ---------------------------------------------------------------------------
// High-level helpers (compose the primitives above)
// ---------------------------------------------------------------------------

export interface EnvelopeWriteResult {
  /** AES-256-GCM wrapped record DEK (60 bytes). */
  wrappedDEK: Buffer
  /** XChaCha20-Poly1305 encrypted fields blob. */
  ciphertext: Buffer
}

/**
 * Seal a record: generate a fresh DEK, encrypt fields, wrap the DEK.
 * The record DEK is zeroized before returning.
 *
 * @param fieldsJson  JSON string of the record fields
 * @param kek         Vault KEK
 * @param aad         Optional AAD built via `buildAAD()` — binds ciphertext to context
 */
export async function sealRecord(
  fieldsJson: string,
  kek: Buffer,
  aad?: Buffer,
): Promise<EnvelopeWriteResult> {
  const recordDEK = generateRecordDEK()
  try {
    const ciphertext = await encryptRecord(fieldsJson, recordDEK, aad)
    const wrappedDEK = wrapRecordDEK(recordDEK, kek, aad)
    return { wrappedDEK, ciphertext }
  } finally {
    zeroize(recordDEK)
  }
}

/**
 * Open a record: unwrap the DEK, decrypt the ciphertext.
 * The record DEK is zeroized before returning.
 *
 * @param wrappedDEK   Wrapped record DEK (60 bytes)
 * @param ciphertext   Record ciphertext blob
 * @param kek          Vault KEK
 * @param aad          Optional AAD (must match what was used during seal)
 * @returns Parsed fields array (JSON.parse of the decrypted blob).
 */
export async function openRecord(
  wrappedDEK: Buffer,
  ciphertext: Buffer,
  kek: Buffer,
  aad?: Buffer,
): Promise<any[]> {
  const recordDEK = unwrapRecordDEK(wrappedDEK, kek, aad)
  try {
    const json = await decryptRecord(ciphertext, recordDEK, aad)
    return JSON.parse(json) as any[]
  } finally {
    zeroize(recordDEK)
  }
}
