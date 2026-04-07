/**
 * Device Key Store
 *
 * Persistent, encrypted storage for the X25519 device keypair.
 * Backend: `device_keys` table in orchestrator.db (SQLCipher-encrypted).
 *
 * Column-level encryption (defence in depth on top of SQLCipher):
 *   - A 256-bit sub-key is derived from the orchestrator DEK via HKDF-SHA256.
 *   - The private key bytes are encrypted with AES-256-GCM using that sub-key.
 *   - The public key is stored as plaintext (safe — it is a public value).
 *
 * Rules:
 *   - `storeDeviceX25519KeyPair()` refuses to overwrite an existing key.
 *   - `getDeviceX25519KeyPair()` NEVER generates — it reads or throws.
 *   - The ONLY place allowed to generate a new keypair is `deviceKeyMigration.ts`.
 *
 * Sub-key derivation:
 *   We cannot access the raw SQLCipher DEK from outside `db.ts`, so we use
 *   `electron.safeStorage` to derive a stable, DB-independent per-column key.
 *   The column key is derived deterministically: safeStorage.decryptString of
 *   the key file gives the hex DEK; HKDF over that gives the column sub-key.
 *
 *   In practice this means: column confidentiality = safeStorage + OS keychain,
 *   same root of trust as the SQLCipher DEK itself.
 */

import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { getOrchestratorService } from '../orchestrator-db/service'

// ── Constants ─────────────────────────────────────────────────────────────────

const KEY_ID_X25519 = 'x25519_device_v1'
const ALGORITHM = 'X25519'
const AES_ALGO = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16

// ── Error ─────────────────────────────────────────────────────────────────────

export class DeviceKeyNotFoundError extends Error {
  readonly code = 'DEVICE_KEY_NOT_FOUND' as const

  constructor() {
    super(
      'X25519 device key not found in orchestrator database. ' +
      'All active handshakes may be invalid. ' +
      'Re-establish handshakes to generate new device keys.',
    )
    this.name = 'DeviceKeyNotFoundError'
    this.code
  }
}

export class DeviceKeyAlreadyExistsError extends Error {
  readonly code = 'DEVICE_KEY_ALREADY_EXISTS' as const

  constructor() {
    super(
      'X25519 device key already exists in orchestrator database. ' +
      'Use the existing key — overwriting is not allowed.',
    )
    this.name = 'DeviceKeyAlreadyExistsError'
    this.code
  }
}

// ── Column-level encryption helpers ──────────────────────────────────────────

/**
 * Derive a stable 32-byte column encryption sub-key.
 *
 * We use the orchestrator DEK hex (from safeStorage) as IKM for HMAC-SHA256
 * with a fixed label. This is equivalent to HKDF with a zero-length salt.
 * The result is deterministic across restarts and does not require storing
 * additional key material.
 */
async function deriveColumnKey(): Promise<Buffer> {
  const { readFileSync, existsSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const { safeStorage } = await import('electron')

  const keyPath = join(homedir(), '.opengiraffe', 'electron-data', 'orchestrator.key')
  if (!existsSync(keyPath)) {
    throw new Error(
      '[DEVICE-KEY-STORE] orchestrator.key not found — cannot derive column key. ' +
      'Ensure the orchestrator DB has been opened at least once.',
    )
  }

  const encrypted = readFileSync(keyPath)
  const hexDek = safeStorage.decryptString(encrypted)

  // HMAC-SHA256(key=hexDek, data=label) → 32-byte column sub-key
  const subKey = createHmac('sha256', hexDek)
    .update('device_keys:X25519:private:v1')
    .digest()

  return subKey
}

function encryptPrivateKey(privateKeyBytes: Buffer, columnKey: Buffer): { enc: Buffer; nonce: Buffer } {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(AES_ALGO, columnKey, nonce)
  const enc = Buffer.concat([cipher.update(privateKeyBytes), cipher.final()])
  const tag = cipher.getAuthTag()
  // Append GCM auth tag to ciphertext
  return { enc: Buffer.concat([enc, tag]), nonce }
}

function decryptPrivateKey(enc: Buffer, nonce: Buffer, columnKey: Buffer): Buffer {
  // Last 16 bytes are the GCM auth tag
  const ciphertext = enc.subarray(0, enc.length - TAG_BYTES)
  const tag = enc.subarray(enc.length - TAG_BYTES)
  const decipher = createDecipheriv(AES_ALGO, columnKey, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DeviceKeyPair {
  keyId: string
  publicKey: string   // base64
  privateKey: string  // base64 — decrypted on read
}

/**
 * Read the X25519 device keypair from the orchestrator DB.
 * Throws `DeviceKeyNotFoundError` if the key is absent.
 * NEVER generates a new key.
 */
export async function getDeviceX25519KeyPair(): Promise<DeviceKeyPair> {
  const service = getOrchestratorService()
  const db = await service.getRawDb()

  const row = db
    .prepare('SELECT key_id, public_key_b64, private_key_enc, enc_nonce FROM device_keys WHERE key_id = ?')
    .get(KEY_ID_X25519) as {
      key_id: string
      public_key_b64: string
      private_key_enc: Buffer
      enc_nonce: Buffer
    } | undefined

  if (!row) {
    throw new DeviceKeyNotFoundError()
  }

  const columnKey = await deriveColumnKey()
  const privateKeyBytes = decryptPrivateKey(row.private_key_enc, row.enc_nonce, columnKey)

  return {
    keyId: row.key_id,
    publicKey: row.public_key_b64,
    privateKey: privateKeyBytes.toString('base64'),
  }
}

/**
 * Read only the public key (no decryption needed).
 * Throws `DeviceKeyNotFoundError` if absent.
 */
export async function getDeviceX25519PublicKey(): Promise<string> {
  const service = getOrchestratorService()
  const db = await service.getRawDb()

  const row = db
    .prepare('SELECT public_key_b64 FROM device_keys WHERE key_id = ?')
    .get(KEY_ID_X25519) as { public_key_b64: string } | undefined

  if (!row) {
    throw new DeviceKeyNotFoundError()
  }

  return row.public_key_b64
}

/**
 * Store the X25519 device keypair.
 * Throws `DeviceKeyAlreadyExistsError` if a key already exists — never overwrites.
 */
export async function storeDeviceX25519KeyPair(keypair: {
  publicKeyB64: string
  privateKeyB64: string
  migratedFrom?: string
}): Promise<void> {
  const service = getOrchestratorService()
  const db = await service.getRawDb()

  // Refuse to overwrite
  const existing = db
    .prepare('SELECT 1 FROM device_keys WHERE key_id = ?')
    .get(KEY_ID_X25519)
  if (existing) {
    throw new DeviceKeyAlreadyExistsError()
  }

  const columnKey = await deriveColumnKey()
  const privateKeyBytes = Buffer.from(keypair.privateKeyB64, 'base64')
  const { enc, nonce } = encryptPrivateKey(privateKeyBytes, columnKey)

  db.prepare(`
    INSERT INTO device_keys (key_id, algorithm, public_key_b64, private_key_enc, enc_nonce, created_at, migrated_from)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    KEY_ID_X25519,
    ALGORITHM,
    keypair.publicKeyB64,
    enc,
    nonce,
    Date.now(),
    keypair.migratedFrom ?? null,
  )

  console.log('[DEVICE-KEY-STORE] X25519 device keypair stored (migrated_from:', keypair.migratedFrom ?? 'none', ')')
}

/**
 * Check whether the device key exists (without throwing).
 */
export async function deviceKeyExists(): Promise<boolean> {
  try {
    await getDeviceX25519PublicKey()
    return true
  } catch (e) {
    if (e instanceof DeviceKeyNotFoundError) return false
    throw e
  }
}
