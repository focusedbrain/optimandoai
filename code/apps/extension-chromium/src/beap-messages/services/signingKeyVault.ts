/**
 * BEAP Signing Key Vault
 *
 * Persistent, encrypted storage for the Ed25519 signing key pair.
 *
 * Problem solved:
 *   The previous MVP stored the Ed25519 signing key in `_ephemeralSigningKey`
 *   (a module-level variable). It was lost on every extension service-worker
 *   restart, breaking signature verification across sessions and breaking
 *   handshake binding that depends on stable identity.
 *
 * Solution:
 *   Persist the Ed25519 keypair to `chrome.storage.local` using the same
 *   pattern as `x25519KeyAgreement.ts` (which already stores the X25519
 *   device keypair persistently). The key material is AES-256-GCM encrypted
 *   at rest — using a device-bound, derivation-key stored separately — so
 *   that even if `chrome.storage.local` contents are inspected, the raw
 *   Ed25519 private key is not exposed in plaintext.
 *
 * Storage layout (chrome.storage.local):
 *   STORAGE_KEY_VAULT   = 'beap_ed25519_signing_vault'   ← encrypted keypair
 *   STORAGE_KEY_DEK_WRAP = 'beap_ed25519_dek_wrap'       ← wrapped DEK (optional)
 *
 * Encryption at rest:
 *   The keypair JSON is encrypted with AES-256-GCM using a Data Encryption Key
 *   (DEK) derived via HKDF-SHA256 from a device-level anchor. For the
 *   extension MVP the device anchor is the X25519 device private key (already
 *   persisted in chrome.storage.local). This gives content encryption without
 *   requiring a user password prompt.
 *
 * Production path (future):
 *   Replace the device-anchor DEK derivation with WRVault™ / Electron vault
 *   key-wrapping when the vault HTTP API supports key custody operations. The
 *   store/load interface is stable — only `deriveEncryptionKey()` needs to be
 *   swapped.
 *
 * Key rotation:
 *   `rotateSigningKeyPair()` generates a new keypair, archives the old one
 *   with a rotation timestamp, and persists both. Old packages signed with the
 *   archived key remain verifiable: recipients use `pkg.header.signing.publicKey`.
 *
 * Migration:
 *   `migrateEphemeralSigningKey(ephemeralKey)` persists an in-memory key that
 *   was generated before this vault was implemented, so no identity break occurs
 *   on first upgrade.
 */

// =============================================================================
// Imports
// =============================================================================

// NOTE: This module is intentionally self-contained (no imports from beapCrypto)
// to avoid circular dependencies. All WebCrypto operations use the browser's
// native crypto.subtle directly.

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY_VAULT = 'beap_ed25519_signing_vault'
const STORAGE_KEY_ARCHIVE = 'beap_ed25519_signing_vault_archive'
const X25519_STORAGE_KEY = 'beap_x25519_device_keypair'

/** AES-256-GCM nonce length (12 bytes). */
const GCM_NONCE_BYTES = 12

/** HKDF info label for the signing vault DEK. */
const DEK_HKDF_INFO = 'BEAP Ed25519 Signing Vault DEK v1'

/** Maximum number of archived (rotated-out) signing keys to keep. */
const MAX_ARCHIVED_KEYS = 5

// =============================================================================
// Types
// =============================================================================

/**
 * Persistent Ed25519 key pair (stored encrypted in chrome.storage.local).
 */
export interface PersistedEd25519KeyPair {
  /** Private key (32 bytes, base64) — encrypted at rest. */
  privateKey: string
  /** Public key (32 bytes, base64) — safe to share. */
  publicKey: string
  /** Key ID: first 16 hex chars (8 bytes) of SHA-256 of public key. */
  keyId: string
  /** Unix timestamp (ms) when this key was created. */
  createdAt: number
  /** Unix timestamp (ms) of the most recent use. Updated on every signing op. */
  lastUsedAt: number
}

/**
 * Encrypted vault record as stored in chrome.storage.local.
 */
interface VaultRecord {
  /** Schema version for forward compatibility. */
  version: 1
  /** Base64-encoded AES-256-GCM nonce (12 bytes). */
  nonce: string
  /** Base64-encoded AES-256-GCM ciphertext of the keypair JSON. */
  ciphertext: string
  /** Key ID of the keypair inside (allows fast lookup without decryption). */
  keyId: string
  /** Timestamp of creation (mirrors keypair.createdAt). */
  createdAt: number
  /**
   * Encryption method tag.
   * 'device_x25519_hkdf' means the DEK is derived from the X25519 private key
   * (device-anchor — no user password required).
   */
  encMethod: 'device_x25519_hkdf'
}

/**
 * Archive of rotated-out signing key pairs.
 * Old keys are retained so that previously signed packages remain verifiable.
 */
interface VaultArchive {
  archivedKeys: ArchivedVaultRecord[]
}

interface ArchivedVaultRecord extends VaultRecord {
  /** Timestamp when this key was rotated out. */
  rotatedOutAt: number
}

/**
 * Result of a key rotation operation.
 */
export interface KeyRotationResult {
  /** The new active key pair. */
  newKeyPair: PersistedEd25519KeyPair
  /** Key ID of the old key that was rotated out. */
  rotatedOutKeyId: string
  /** How many archived keys are now stored. */
  archiveCount: number
}

/**
 * Migration result.
 */
export interface MigrationResult {
  /** Whether a migration was performed (false = no ephemeral key to migrate). */
  migrated: boolean
  /** Key ID of the persisted key (either pre-existing or newly migrated). */
  keyId: string
}

// =============================================================================
// WebCrypto Utilities (self-contained, no beapCrypto import)
// =============================================================================

function toBase64Vault(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64Vault(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function getRandomBytesVault(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

async function sha256Vault(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// DEK Derivation (Device-Anchor)
// =============================================================================

/**
 * Derive the Data Encryption Key for the signing vault.
 *
 * The DEK is deterministically derived from the device's X25519 private key
 * (already stored in chrome.storage.local) via HKDF-SHA256. This gives
 * encryption at rest without requiring an interactive user password.
 *
 * If the X25519 keypair is not found (first-run race condition), falls back to
 * a device-bound random salt stored alongside the vault record. The DEK is
 * NEVER stored directly — only derived on demand.
 */
async function deriveEncryptionKey(): Promise<CryptoKey> {
  // Load the X25519 device private key as the HKDF input key material.
  let ikmBytes: Uint8Array

  try {
    let x25519Raw: { privateKey: string } | null = null

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(X25519_STORAGE_KEY)
      x25519Raw = result[X25519_STORAGE_KEY] ?? null
    } else {
      const stored = localStorage.getItem(X25519_STORAGE_KEY)
      x25519Raw = stored ? JSON.parse(stored) : null
    }

    if (x25519Raw?.privateKey) {
      ikmBytes = fromBase64Vault(x25519Raw.privateKey)
    } else {
      // Fallback: use a device-level random material stored in extension storage.
      ikmBytes = await getOrCreateFallbackIKM()
    }
  } catch {
    ikmBytes = await getOrCreateFallbackIKM()
  }

  // Import the raw bytes as HKDF key material.
  const ikm = await crypto.subtle.importKey(
    'raw',
    ikmBytes,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )

  // Use a fixed salt (all-zeros is fine for deterministic derivation per RFC 5869 §3.1).
  const salt = new Uint8Array(32)

  const info = new TextEncoder().encode(DEK_HKDF_INFO)

  // Derive a 256-bit AES-GCM key.
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  )
}

/** Fallback IKM storage key (used when X25519 key is unavailable). */
const FALLBACK_IKM_KEY = 'beap_signing_vault_ikm_fallback'

async function getOrCreateFallbackIKM(): Promise<Uint8Array> {
  const storageKey = FALLBACK_IKM_KEY
  try {
    let existing: string | null = null
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const r = await chrome.storage.local.get(storageKey)
      existing = r[storageKey] ?? null
    } else {
      existing = localStorage.getItem(storageKey)
    }
    if (existing) return fromBase64Vault(existing)
  } catch { /* fall through to generate */ }

  const ikm = getRandomBytesVault(32)
  const b64 = toBase64Vault(ikm)
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [storageKey]: b64 })
    } else {
      localStorage.setItem(storageKey, b64)
    }
  } catch { /* non-fatal — IKM won't be stable, but signing will still work */ }
  return ikm
}

// =============================================================================
// Vault Encryption / Decryption
// =============================================================================

async function encryptKeypair(
  keypair: PersistedEd25519KeyPair,
  dek: CryptoKey
): Promise<{ nonce: string; ciphertext: string }> {
  const plaintext = new TextEncoder().encode(JSON.stringify(keypair))
  const nonce = getRandomBytesVault(GCM_NONCE_BYTES)

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    dek,
    plaintext
  )

  return {
    nonce: toBase64Vault(nonce),
    ciphertext: toBase64Vault(new Uint8Array(ciphertextBuf)),
  }
}

async function decryptKeypair(
  record: VaultRecord,
  dek: CryptoKey
): Promise<PersistedEd25519KeyPair> {
  const nonce = fromBase64Vault(record.nonce)
  const ciphertext = fromBase64Vault(record.ciphertext)

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    dek,
    ciphertext
  )

  return JSON.parse(new TextDecoder().decode(plainBuf)) as PersistedEd25519KeyPair
}

// =============================================================================
// Chrome Storage Helpers
// =============================================================================

async function readVaultRecord(): Promise<VaultRecord | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const r = await chrome.storage.local.get(STORAGE_KEY_VAULT)
      return r[STORAGE_KEY_VAULT] ?? null
    }
    const s = localStorage.getItem(STORAGE_KEY_VAULT)
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

async function writeVaultRecord(record: VaultRecord): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY_VAULT]: record })
  } else {
    localStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(record))
  }
}

async function readArchive(): Promise<VaultArchive> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const r = await chrome.storage.local.get(STORAGE_KEY_ARCHIVE)
      return r[STORAGE_KEY_ARCHIVE] ?? { archivedKeys: [] }
    }
    const s = localStorage.getItem(STORAGE_KEY_ARCHIVE)
    return s ? JSON.parse(s) : { archivedKeys: [] }
  } catch {
    return { archivedKeys: [] }
  }
}

async function writeArchive(archive: VaultArchive): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY_ARCHIVE]: archive })
  } else {
    localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(archive))
  }
}

// =============================================================================
// Keypair Generation (Ed25519 via @noble/ed25519)
// =============================================================================

// Dynamic import to avoid circular deps with beapCrypto.ts.
// @noble/ed25519 is already in package.json.
async function generateRawEd25519(): Promise<PersistedEd25519KeyPair> {
  // Inline the minimal generation logic here so this module stays self-contained.
  // Identical algorithm to generateEd25519KeyPair() in beapCrypto.ts.
  const { default: ed_module, getPublicKeyAsync } = await import('@noble/ed25519').then(m => ({
    default: m,
    getPublicKeyAsync: m.getPublicKeyAsync,
  }))

  // Configure SHA-512 for @noble/ed25519 (browser requirement).
  if (!ed_module.etc.sha512Async) {
    ed_module.etc.sha512Async = async (msg: Uint8Array): Promise<Uint8Array> => {
      const h = await crypto.subtle.digest('SHA-512', msg)
      return new Uint8Array(h)
    }
  }

  const privateKeyBytes = getRandomBytesVault(32)
  const publicKeyBytes = await getPublicKeyAsync(privateKeyBytes)
  const pubHash = await sha256Vault(publicKeyBytes)
  const keyId = pubHash.substring(0, 16)
  const now = Date.now()

  return {
    privateKey: toBase64Vault(privateKeyBytes),
    publicKey: toBase64Vault(publicKeyBytes),
    keyId,
    createdAt: now,
    lastUsedAt: now,
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check whether a persistent signing key exists in storage.
 */
export async function signingKeyExists(): Promise<boolean> {
  const record = await readVaultRecord()
  return record !== null
}

/**
 * Persist a signing key pair to encrypted storage.
 *
 * Overwrites any existing persisted key (use `rotateSigningKeyPair` if you
 * want the old key archived).
 */
export async function storeSigningKeyPair(
  keypair: PersistedEd25519KeyPair
): Promise<void> {
  const dek = await deriveEncryptionKey()
  const { nonce, ciphertext } = await encryptKeypair(keypair, dek)

  const record: VaultRecord = {
    version: 1,
    nonce,
    ciphertext,
    keyId: keypair.keyId,
    createdAt: keypair.createdAt,
    encMethod: 'device_x25519_hkdf',
  }

  await writeVaultRecord(record)
  console.log('[SigningKeyVault] Signing key pair stored. keyId:', keypair.keyId)
}

/**
 * Load and decrypt the persistent signing key pair from storage.
 *
 * Returns `null` if no key is stored (first run or after key deletion).
 */
export async function loadSigningKeyPair(): Promise<PersistedEd25519KeyPair | null> {
  const record = await readVaultRecord()
  if (!record) return null

  try {
    const dek = await deriveEncryptionKey()
    const keypair = await decryptKeypair(record, dek)
    return keypair
  } catch (err) {
    // Decryption failure — could mean DEK changed (e.g. X25519 key was rotated).
    // Log the error and return null so a new key is generated.
    console.error('[SigningKeyVault] Failed to decrypt signing key vault. A new key will be generated.', err)
    return null
  }
}

/**
 * Get the persistent signing key pair, generating and storing a new one if
 * none exists.
 *
 * This is the primary entry point for all signing operations. Replaces the
 * previous `getSigningKeyPair()` in-memory-only implementation.
 */
export async function getOrCreateSigningKeyPair(): Promise<PersistedEd25519KeyPair> {
  const existing = await loadSigningKeyPair()
  if (existing) {
    return existing
  }

  console.log('[SigningKeyVault] No persisted signing key found — generating new Ed25519 key pair.')
  const newPair = await generateRawEd25519()
  await storeSigningKeyPair(newPair)
  console.log('[SigningKeyVault] New signing key pair created and persisted. keyId:', newPair.keyId)
  return newPair
}

/**
 * Touch the `lastUsedAt` timestamp on the stored signing key.
 * Called after every signing operation to track key usage.
 *
 * Best-effort — does not throw on failure.
 */
export async function touchSigningKeyLastUsed(): Promise<void> {
  try {
    const keypair = await loadSigningKeyPair()
    if (!keypair) return
    keypair.lastUsedAt = Date.now()
    await storeSigningKeyPair(keypair)
  } catch {
    // Non-fatal — signing still succeeds even if the timestamp update fails.
  }
}

/**
 * Rotate the signing key pair.
 *
 * 1. Generates a new Ed25519 key pair.
 * 2. Moves the current key to the archive (retained for verification of
 *    previously signed packages).
 * 3. Stores the new key as the active key.
 *
 * After rotation: all NEW packages are signed with the new key. Packages
 * signed with the old key remain verifiable because the public key is embedded
 * in `pkg.header.signing.publicKey`.
 *
 * @returns KeyRotationResult with the new keypair and rotation metadata.
 */
export async function rotateSigningKeyPair(): Promise<KeyRotationResult> {
  const oldKeypair = await getOrCreateSigningKeyPair()
  const newKeypair = await generateRawEd25519()

  // Read current archive and prepend old key.
  const archive = await readArchive()
  const dek = await deriveEncryptionKey()
  const { nonce, ciphertext } = await encryptKeypair(oldKeypair, dek)

  const archivedRecord: ArchivedVaultRecord = {
    version: 1,
    nonce,
    ciphertext,
    keyId: oldKeypair.keyId,
    createdAt: oldKeypair.createdAt,
    encMethod: 'device_x25519_hkdf',
    rotatedOutAt: Date.now(),
  }

  // Keep at most MAX_ARCHIVED_KEYS.
  archive.archivedKeys = [archivedRecord, ...archive.archivedKeys].slice(0, MAX_ARCHIVED_KEYS)
  await writeArchive(archive)

  // Store the new key as active.
  await storeSigningKeyPair(newKeypair)

  console.log(
    '[SigningKeyVault] Key rotated. Old keyId:', oldKeypair.keyId,
    '→ New keyId:', newKeypair.keyId,
    '| Archive size:', archive.archivedKeys.length
  )

  return {
    newKeyPair: newKeypair,
    rotatedOutKeyId: oldKeypair.keyId,
    archiveCount: archive.archivedKeys.length,
  }
}

/**
 * List all archived (rotated-out) signing key IDs.
 * Used for audit / key management UI.
 */
export async function listArchivedSigningKeyIds(): Promise<string[]> {
  const archive = await readArchive()
  return archive.archivedKeys.map(r => r.keyId)
}

/**
 * Load a specific archived signing key pair by keyId.
 *
 * Used when verifying old packages signed with a rotated-out key (in case
 * the public key embedded in the package header needs cross-referencing with
 * local state).
 *
 * Returns null if the key is not in the local archive.
 */
export async function loadArchivedSigningKeyPair(
  keyId: string
): Promise<PersistedEd25519KeyPair | null> {
  const archive = await readArchive()
  const record = archive.archivedKeys.find(r => r.keyId === keyId)
  if (!record) return null

  try {
    const dek = await deriveEncryptionKey()
    return await decryptKeypair(record, dek)
  } catch {
    return null
  }
}

/**
 * Delete the persistent signing key vault (all data).
 *
 * Use with extreme caution — any packages signed with the deleted key will
 * no longer be re-signable. Pre-existing signatures remain verifiable via
 * the public key embedded in each package's header.
 *
 * Intended for: factory reset, identity revocation, test cleanup.
 */
export async function deleteSigningKeyVault(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.remove([STORAGE_KEY_VAULT, STORAGE_KEY_ARCHIVE])
  } else {
    localStorage.removeItem(STORAGE_KEY_VAULT)
    localStorage.removeItem(STORAGE_KEY_ARCHIVE)
  }
  console.log('[SigningKeyVault] Signing key vault deleted.')
}

// =============================================================================
// Migration
// =============================================================================

/**
 * Migrate an ephemeral (in-memory) signing key to persistent storage.
 *
 * Call this on extension startup when upgrading from the MVP ephemeral key
 * implementation. If the caller has an in-memory key that was generated before
 * persistent storage was implemented, this function persists it so identity
 * continuity is preserved.
 *
 * If a key is already persisted, the ephemeral key is discarded (the persisted
 * key takes priority — identity continuity is already established).
 *
 * @param ephemeralKey  - The in-memory Ed25519KeyPair from the old implementation
 * @returns MigrationResult indicating whether migration occurred
 */
export async function migrateEphemeralSigningKey(ephemeralKey: {
  privateKey: string
  publicKey: string
  keyId: string
}): Promise<MigrationResult> {
  // If a persisted key already exists, no migration needed.
  const existing = await loadSigningKeyPair()
  if (existing) {
    console.log(
      '[SigningKeyVault] Migration skipped — persisted key already exists. keyId:', existing.keyId
    )
    return { migrated: false, keyId: existing.keyId }
  }

  // Persist the ephemeral key.
  const now = Date.now()
  const toStore: PersistedEd25519KeyPair = {
    privateKey: ephemeralKey.privateKey,
    publicKey: ephemeralKey.publicKey,
    keyId: ephemeralKey.keyId,
    createdAt: now,
    lastUsedAt: now,
  }

  await storeSigningKeyPair(toStore)

  console.log(
    '[SigningKeyVault] Migration complete — ephemeral key persisted. keyId:', toStore.keyId
  )

  return { migrated: true, keyId: toStore.keyId }
}
