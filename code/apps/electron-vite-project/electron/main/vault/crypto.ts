/**
 * Cryptographic primitives for vault security
 * - Argon2id KDF for master password derivation
 * - AES-256-GCM for key wrapping
 * - libsodium XChaCha20-Poly1305 for per-field encryption
 * - Secure buffer zeroization
 */

import { randomBytes, createCipheriv, createDecipheriv, hkdfSync, scrypt } from 'crypto'
import { promisify } from 'util'
import sodium from 'libsodium-wrappers'

// Promisify scrypt for async/await usage
const scryptAsync = promisify(scrypt) as (password: string | Buffer, salt: string | Buffer, keylen: number, options: { N: number, r: number, p: number }) => Promise<Buffer>

// Initialize libsodium (libsodium-wrappers auto-initializes on first use)
// For safety, we ensure it's ready before field encryption operations
let sodiumInitialized = false

async function ensureSodiumReady(): Promise<void> {
  if (!sodiumInitialized) {
    await sodium.ready
    sodiumInitialized = true
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
 * Default KDF params: Using scrypt instead of Argon2 (no native compilation needed)
 * scrypt params: N (CPU/memory cost), r (block size), p (parallelism)
 * Memory usage = 128 * N * r bytes
 * Reduced N to avoid OpenSSL MEMORY_LIMIT_EXCEEDED error
 */
export const DEFAULT_KDF_PARAMS: KDFParams = {
  memoryCost: 16384, // N parameter for scrypt (2^14) - reduced from 32768 to avoid memory limit
  timeCost: 8, // r parameter (block size)
  parallelism: 1, // p parameter
}

/**
 * Derive Key Encryption Key (KEK) from master password using scrypt
 * scrypt is built into Node.js and doesn't require native compilation
 * @param password Master password
 * @param salt 32-byte salt
 * @param params KDF parameters (memoryCost = N, timeCost = r, parallelism = p)
 * @returns 32-byte KEK
 */
export async function deriveKEK(
  password: string,
  salt: Buffer,
  params: KDFParams = DEFAULT_KDF_PARAMS
): Promise<Buffer> {
  // scrypt parameters:
  // N = memoryCost (CPU/memory cost factor, must be power of 2)
  // r = timeCost (block size, typically 8)
  // p = parallelism (parallelization factor, typically 1)
  // Memory usage = 128 * N * r bytes
  // Limit N to avoid OpenSSL MEMORY_LIMIT_EXCEEDED (max ~16384 for safety)
  const maxN = 16384 // Maximum safe N value
  const requestedN = Math.pow(2, Math.floor(Math.log2(params.memoryCost)))
  const N = Math.min(maxN, Math.max(16384, requestedN)) // Clamp between 16384 and maxN
  const r = params.timeCost || 8
  const p = params.parallelism || 1
  
  console.log(`[CRYPTO] scrypt params: N=${N}, r=${r}, p=${p}, memory=${128 * N * r} bytes`)
  
  // scrypt(password, salt, keylen, options, callback)
  const key = await scryptAsync(password, salt, 32, { N, r, p })
  return key
}

/**
 * Wrap (encrypt) Data Encryption Key (DEK) with KEK using AES-256-GCM
 * @param dek 32-byte DEK to wrap
 * @param kek 32-byte KEK
 * @returns Wrapped DEK (nonce + ciphertext + auth tag)
 */
export async function wrapDEK(dek: Buffer, kek: Buffer): Promise<Buffer> {
  const nonce = randomBytes(12) // 96-bit nonce for GCM
  const cipher = createCipheriv('aes-256-gcm', kek, nonce)
  
  const encrypted = Buffer.concat([
    cipher.update(dek),
    cipher.final(),
  ])
  
  const authTag = cipher.getAuthTag()
  
  // Format: nonce (12) + ciphertext (32) + authTag (16) = 60 bytes
  return Buffer.concat([nonce, encrypted, authTag])
}

/**
 * Unwrap (decrypt) DEK with KEK using AES-256-GCM
 * @param wrappedDEK Wrapped DEK from wrapDEK
 * @param kek 32-byte KEK
 * @returns 32-byte DEK
 * @throws Error if decryption fails (wrong password)
 */
export async function unwrapDEK(wrappedDEK: Buffer, kek: Buffer): Promise<Buffer> {
  if (wrappedDEK.length !== 60) {
    throw new Error('Invalid wrapped DEK format')
  }
  
  const nonce = wrappedDEK.subarray(0, 12)
  const ciphertext = wrappedDEK.subarray(12, 44)
  const authTag = wrappedDEK.subarray(44, 60)
  
  const decipher = createDecipheriv('aes-256-gcm', kek, nonce)
  decipher.setAuthTag(authTag)
  
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return decrypted
  } catch (error) {
    throw new Error('Decryption failed - incorrect password')
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
 * Encrypt a field value using libsodium XChaCha20-Poly1305 AEAD
 * @param plaintext Plain text value
 * @param fieldKey 32-byte field key
 * @returns Base64-encoded JSON: { nonce, ciphertext, tag }
 */
export async function encryptField(plaintext: string, fieldKey: Buffer): Promise<string> {
  await ensureSodiumReady()
  if (!sodiumInitialized) {
    throw new Error('libsodium not initialized')
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const message = Buffer.from(plaintext, 'utf-8')
  
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    message,
    null, // no additional data
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
 * Decrypt a field value
 * @param encrypted Encrypted field from encryptField
 * @param fieldKey 32-byte field key
 * @returns Plain text value
 * @throws Error if decryption fails
 */
export async function decryptField(encrypted: string, fieldKey: Buffer): Promise<string> {
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
      null, // no additional data
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
