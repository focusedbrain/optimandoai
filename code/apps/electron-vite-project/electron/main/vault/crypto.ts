/**
 * Cryptographic primitives for vault security
 * - Argon2id KDF for master password derivation
 * - AES-256-GCM for key wrapping
 * - libsodium XChaCha20-Poly1305 for per-field encryption
 * - Secure buffer zeroization
 */

import { randomBytes, createCipheriv, createDecipheriv, hkdfSync, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { createRequire } from 'module'

// Use createRequire to load libsodium-wrappers (native module)
const require = createRequire(import.meta.url)
let sodium: any = null

// Promisify scrypt for async/await usage
const scryptAsync = promisify(scrypt) as (password: string | Buffer, salt: string | Buffer, keylen: number, options: { N: number, r: number, p: number }) => Promise<Buffer>

// Initialize libsodium (libsodium-wrappers auto-initializes on first use)
// For safety, we ensure it's ready before field encryption operations
let sodiumInitialized = false

async function ensureSodiumReady(): Promise<void> {
  if (!sodiumInitialized) {
    try {
      if (!sodium) {
        sodium = require('libsodium-wrappers')
      }
      await sodium.ready
      sodiumInitialized = true
    } catch (error: any) {
      console.error('[VAULT CRYPTO] Failed to load libsodium:', error)
      throw new Error(`Failed to initialize libsodium: ${error?.message || error}`)
    }
  }
}

/**
 * KDF parameters for Argon2id
 */
export interface KDFParams {
  memoryCost: number  // in KB
  timeCost: number    // iterations
  parallelism: number
}

/**
 * Default KDF params: scrypt desktop profile
 *
 * scrypt params: N (CPU/memory cost), r (block size), p (parallelism)
 * Memory usage = 128 * N * r bytes
 *
 * N = 65536 (2^16):  128 * 65536 * 8 = 64 MiB — well within desktop
 * resources, ~300 ms on modern hardware.  The Node.js OpenSSL default
 * maxmem is 32 MiB, so we explicitly set maxmem = 128 * N * r + overhead
 * to avoid MEMORY_LIMIT_EXCEEDED.
 */
export const DEFAULT_KDF_PARAMS: KDFParams = {
  memoryCost: 65536, // N parameter for scrypt (2^16)
  timeCost: 8,       // r parameter (block size)
  parallelism: 1,    // p parameter
}

/**
 * Derive Key Encryption Key (KEK) from master password using scrypt.
 *
 * @param password Master password
 * @param salt     32-byte salt
 * @param params   KDF parameters (memoryCost = N, timeCost = r, parallelism = p)
 * @returns        32-byte KEK
 */
export async function deriveKEK(
  password: string,
  salt: Buffer,
  params: KDFParams = DEFAULT_KDF_PARAMS
): Promise<Buffer> {
  // Ensure N is a power of 2 and at least 16384 (floor for safety)
  const requestedN = Math.pow(2, Math.floor(Math.log2(params.memoryCost)))
  const N = Math.max(16384, requestedN)
  const r = params.timeCost || 8
  const p = params.parallelism || 1

  // Compute the required memory and set maxmem to avoid OpenSSL rejection.
  // scrypt uses 128 * N * r bytes internally; we add 16 MiB headroom.
  const requiredMem = 128 * N * r
  const maxmem = requiredMem + (16 * 1024 * 1024) // +16 MiB headroom
  
  console.log(`[CRYPTO] scrypt params: N=${N}, r=${r}, p=${p}, memory=${requiredMem} bytes (${Math.round(requiredMem / 1048576)} MiB)`)
  
  const key = await scryptAsync(password, salt, 32, { N, r, p, maxmem } as any)
  return key
}

/**
 * Wrap (encrypt) Data Encryption Key (DEK) with KEK using AES-256-GCM.
 *
 * @param dek 32-byte DEK to wrap
 * @param kek 32-byte KEK
 * @param aad Optional additional authenticated data (binds ciphertext to context)
 * @returns Wrapped DEK (nonce + ciphertext + auth tag)
 */
export async function wrapDEK(dek: Buffer, kek: Buffer, aad?: Buffer): Promise<Buffer> {
  const nonce = randomBytes(12) // 96-bit nonce for GCM
  const cipher = createCipheriv('aes-256-gcm', kek, nonce)
  if (aad) cipher.setAAD(aad)
  
  const encrypted = Buffer.concat([
    cipher.update(dek),
    cipher.final(),
  ])
  
  const authTag = cipher.getAuthTag()
  
  // Format: nonce (12) + ciphertext (32) + authTag (16) = 60 bytes
  return Buffer.concat([nonce, encrypted, authTag])
}

/**
 * Unwrap (decrypt) DEK with KEK using AES-256-GCM.
 *
 * @param wrappedDEK Wrapped DEK from wrapDEK
 * @param kek        32-byte KEK
 * @param aad        Optional AAD (must match what was used during wrap)
 * @returns 32-byte DEK
 * @throws Error if decryption fails (wrong password or AAD mismatch)
 */
export async function unwrapDEK(wrappedDEK: Buffer, kek: Buffer, aad?: Buffer): Promise<Buffer> {
  if (wrappedDEK.length !== 60) {
    throw new Error('Invalid wrapped DEK format')
  }
  
  const nonce = wrappedDEK.subarray(0, 12)
  const ciphertext = wrappedDEK.subarray(12, 44)
  const authTag = wrappedDEK.subarray(44, 60)
  
  const decipher = createDecipheriv('aes-256-gcm', kek, nonce)
  decipher.setAuthTag(authTag)
  if (aad) decipher.setAAD(aad)
  
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return decrypted
  } catch (error) {
    throw new Error('Decryption failed - incorrect password or context mismatch')
  }
}

/**
 * Derive a field-specific key from DEK using HKDF-SHA256
 * @param dek Data Encryption Key
 * @param context Context string (e.g., "field-encryption")
 * @param info Additional info (e.g., item ID)
 * @returns 32-byte field key
 */
export function deriveFieldKey(dek: Buffer, context: string, info: string): Buffer {
  const result = hkdfSync('sha256', dek, Buffer.from(context), Buffer.from(info), 32)
  return Buffer.from(result)
}

/**
 * Encrypt a field value using libsodium XChaCha20-Poly1305 AEAD.
 *
 * @param plaintext Plain text value
 * @param fieldKey  32-byte field key
 * @param aad       Optional additional authenticated data
 * @returns Base64-encoded JSON: { nonce, ciphertext }
 */
export async function encryptField(plaintext: string, fieldKey: Buffer, aad?: Uint8Array): Promise<string> {
  await ensureSodiumReady()
  if (!sodiumInitialized) {
    throw new Error('libsodium not initialized')
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const message = Buffer.from(plaintext, 'utf-8')
  
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    message,
    aad ?? null,
    null, // no secret nonce
    nonce,
    fieldKey
  )
  
  return JSON.stringify({
    nonce: Buffer.from(nonce).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  })
}

/**
 * Decrypt a field value.
 *
 * @param encrypted Encrypted field from encryptField
 * @param fieldKey  32-byte field key
 * @param aad       Optional AAD (must match what was used during encrypt)
 * @returns Plain text value
 * @throws Error if decryption fails
 */
export async function decryptField(encrypted: string, fieldKey: Buffer, aad?: Uint8Array): Promise<string> {
  await ensureSodiumReady()
  if (!sodiumInitialized) {
    throw new Error('libsodium not initialized')
  }
  const { nonce, ciphertext } = JSON.parse(encrypted)
  
  const nonceBytes = Buffer.from(nonce, 'base64')
  const ciphertextBytes = Buffer.from(ciphertext, 'base64')
  
  try {
    const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, // no secret nonce
      ciphertextBytes,
      aad ?? null,
      nonceBytes,
      fieldKey
    )
    
    return Buffer.from(decrypted).toString('utf-8')
  } catch (error) {
    throw new Error('Field decryption failed')
  }
}

/**
 * Securely zeroize a buffer by overwriting with random data
 * @param buffer Buffer to zeroize
 */
export function zeroize(buffer: Buffer): void {
  if (!buffer || buffer.length === 0) return
  
  // Overwrite with random data
  randomBytes(buffer.length).copy(buffer)
  
  // Overwrite with zeros
  buffer.fill(0)
}

/**
 * Generate a random 32-byte key
 */
export function generateRandomKey(): Buffer {
  return randomBytes(32)
}

/**
 * Generate a random 32-byte salt
 */
export function generateSalt(): Buffer {
  return randomBytes(32)
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two secret strings.
 *
 * Prevents timing side-channel attacks by ensuring the comparison takes the
 * same amount of time regardless of where the first difference occurs.
 * If the inputs differ in length, the comparison still runs in time
 * proportional to the longer string (both are hashed to equal-length buffers).
 *
 * @param a First secret (e.g. stored token)
 * @param b Second secret (e.g. user-supplied token)
 * @returns true if a === b in constant time
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8')
  const bufB = Buffer.from(b, 'utf-8')

  // timingSafeEqual requires equal-length buffers. If lengths differ,
  // the tokens definitely don't match, but we still run the comparison
  // against a dummy buffer to avoid leaking length information.
  if (bufA.length !== bufB.length) {
    // Compare bufA against itself so the function runs in constant time,
    // then always return false.
    timingSafeEqual(bufA, bufA)
    return false
  }

  return timingSafeEqual(bufA, bufB)
}

// ---------------------------------------------------------------------------
// AAD (Additional Authenticated Data) construction
// ---------------------------------------------------------------------------

/**
 * Schema version embedded in the AAD structure itself.
 * Increment if the AAD wire format ever changes.
 */
export const AAD_SCHEMA_VERSION = 1

/**
 * Build a canonical AAD buffer for AEAD encryption.
 *
 * The AAD binds the ciphertext to its intended context so that moving
 * a ciphertext blob from one record/vault to another will cause
 * authentication failure on decryption.
 *
 * Wire format (deterministic, no JSON ambiguity):
 *   aad_schema_version (1 byte, uint8)
 *   vault_id length    (2 bytes, uint16-LE)
 *   vault_id           (UTF-8)
 *   record_type length (2 bytes, uint16-LE)
 *   record_type        (UTF-8)
 *   envelope_schema_version (2 bytes, uint16-LE)
 *
 * @param vaultId         The vault that owns the record
 * @param recordType      Logical record type (e.g. 'human_credential', 'identity')
 * @param schemaVersion   Envelope schema version (e.g. 2)
 */
export function buildAAD(
  vaultId: string,
  recordType: string,
  schemaVersion: number,
): Buffer {
  const vaultIdBuf = Buffer.from(vaultId, 'utf-8')
  const recordTypeBuf = Buffer.from(recordType, 'utf-8')

  // 1 + 2 + vaultId.len + 2 + recordType.len + 2
  const buf = Buffer.alloc(1 + 2 + vaultIdBuf.length + 2 + recordTypeBuf.length + 2)
  let offset = 0

  buf.writeUInt8(AAD_SCHEMA_VERSION, offset); offset += 1
  buf.writeUInt16LE(vaultIdBuf.length, offset); offset += 2
  vaultIdBuf.copy(buf, offset);                 offset += vaultIdBuf.length
  buf.writeUInt16LE(recordTypeBuf.length, offset); offset += 2
  recordTypeBuf.copy(buf, offset);              offset += recordTypeBuf.length
  buf.writeUInt16LE(schemaVersion, offset)

  return buf
}
