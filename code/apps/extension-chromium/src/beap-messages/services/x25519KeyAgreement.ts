/**
 * X25519 Key Agreement for BEAP
 * 
 * Implements X25519 ECDH key agreement for qBEAP package encryption.
 * Uses @noble/curves for cryptographic operations.
 * 
 * Key Storage Strategy:
 * - Device keypair stored in chrome.storage.local (extension storage)
 * - For production: should migrate to Electron vault
 * 
 * @version 1.0.0
 */

import { x25519 } from '@noble/curves/ed25519'

import { safeAtob } from './beapCrypto'

// =============================================================================
// Types
// =============================================================================

export interface X25519KeyPair {
  /** Private key (32 bytes, base64) - KEEP SECRET */
  privateKey: string
  /** Public key (32 bytes, base64) - Safe to share */
  publicKey: string
  /** Key ID (first 8 bytes of SHA-256 of public key, hex) */
  keyId: string
  /** Creation timestamp */
  createdAt: number
}

export interface X25519KeyAgreementResult {
  /** Shared secret from ECDH (32 bytes) */
  sharedSecret: Uint8Array
  /** Method used for key derivation */
  method: 'X25519_ECDH'
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'beap_x25519_device_keypair'

// =============================================================================
// Utility Functions
// =============================================================================

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = safeAtob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

// =============================================================================
// Keypair Generation
// =============================================================================

/**
 * Generate a new X25519 keypair
 * 
 * @returns X25519 keypair with private key, public key, and key ID
 */
export async function generateX25519KeyPair(): Promise<X25519KeyPair> {
  // Generate random 32-byte private key
  const privateKeyBytes = generateRandomBytes(32)
  
  // Derive public key from private key using X25519
  const publicKeyBytes = x25519.getPublicKey(privateKeyBytes)
  
  // Generate key ID from first 8 bytes of SHA-256 of public key
  const publicKeyHash = await sha256(publicKeyBytes)
  const keyId = publicKeyHash.substring(0, 16) // 8 bytes = 16 hex chars
  
  return {
    privateKey: toBase64(privateKeyBytes),
    publicKey: toBase64(publicKeyBytes),
    keyId,
    createdAt: Date.now()
  }
}

// =============================================================================
// Key Storage (Extension Storage)
// =============================================================================

/**
 * Store the device X25519 keypair in extension storage
 * 
 * @param keypair - Keypair to store
 */
export async function storeDeviceKeypair(keypair: X25519KeyPair): Promise<void> {
  // Use chrome.storage.local if available, otherwise fall back to localStorage
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY]: keypair })
    console.log('[X25519] Device keypair stored in chrome.storage.local')
  } else {
    // Fallback for dev/testing
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keypair))
    console.log('[X25519] Device keypair stored in localStorage (dev fallback)')
  }
}

/**
 * Load the device X25519 keypair from extension storage
 * 
 * @returns Keypair or null if not found
 */
export async function loadDeviceKeypair(): Promise<X25519KeyPair | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      // chrome.storage.local.get() returns a Promise<Record<string,unknown>>.
      // On some MV3 service-worker timing windows (context not yet fully ready) the
      // resolved value can be `undefined` instead of `{}`. Guard every access.
      const result = await chrome.storage.local.get(STORAGE_KEY)
      if (result == null) {
        // Storage returned undefined/null — treat as "no key present" (first run).
        console.log('[X25519] loadDeviceKeypair: storage returned nullish result — no device keypair present (first run or context not ready)')
        return null
      }
      const stored = result[STORAGE_KEY]
      if (stored == null) {
        // Key not present in storage — normal first-run path.
        return null
      }
      // Validate the stored object has the minimum required shape before trusting it.
      if (
        typeof stored !== 'object' ||
        typeof (stored as X25519KeyPair).privateKey !== 'string' ||
        typeof (stored as X25519KeyPair).publicKey !== 'string' ||
        (stored as X25519KeyPair).privateKey.length === 0 ||
        (stored as X25519KeyPair).publicKey.length === 0
      ) {
        console.error('[X25519] loadDeviceKeypair: stored keypair is malformed — discarding and regenerating.', { stored })
        return null
      }
      return stored as X25519KeyPair
    } else {
      // Fallback for dev/testing
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as X25519KeyPair
        if (typeof parsed?.privateKey !== 'string' || typeof parsed?.publicKey !== 'string') {
          console.error('[X25519] loadDeviceKeypair: localStorage keypair malformed — discarding.', { parsed })
          return null
        }
        return parsed
      } catch {
        console.error('[X25519] loadDeviceKeypair: localStorage JSON parse failed — discarding.')
        return null
      }
    }
  } catch (error) {
    console.error('[X25519] loadDeviceKeypair: storage API threw — cannot load device keypair:', error)
    return null
  }
}

/**
 * Get or create the device X25519 keypair.
 * This is the main entry point for getting the local private key.
 * 
 * @returns Device keypair (creates one if it doesn't exist)
 */
export async function getOrCreateDeviceKeypair(): Promise<X25519KeyPair> {
  let keypair = await loadDeviceKeypair()
  
  if (!keypair) {
    console.log('[X25519] No device keypair present — generating new one for this device.')
    keypair = await generateX25519KeyPair()
    await storeDeviceKeypair(keypair)
    console.log('[X25519] New device keypair created with ID:', keypair.keyId)
  } else {
    console.log('[X25519] Loaded existing device keypair (ID:', keypair.keyId, ') — no regeneration.')
  }
  
  return keypair
}

/**
 * Get the device's X25519 public key.
 * Use this when establishing new handshakes.
 * 
 * @returns Base64-encoded public key
 */
export async function getDeviceX25519PublicKey(): Promise<string> {
  const keypair = await getOrCreateDeviceKeypair()
  return keypair.publicKey
}

// =============================================================================
// ECDH Key Agreement
// =============================================================================

/**
 * Perform X25519 ECDH key agreement.
 * 
 * SECURITY: The shared secret is the raw ECDH output.
 * It should be passed through HKDF before use as an encryption key.
 * 
 * @param peerPublicKeyBase64 - Peer's public key (base64, 32 bytes)
 * @param localPrivateKeyBase64 - Our private key (base64, 32 bytes)
 * @returns Shared secret (32 bytes)
 */
export function x25519ECDH(
  peerPublicKeyBase64: string,
  localPrivateKeyBase64: string
): Uint8Array {
  const peerPublicKey = fromBase64(peerPublicKeyBase64)
  const localPrivateKey = fromBase64(localPrivateKeyBase64)
  
  // Validate key lengths
  if (peerPublicKey.length !== 32) {
    throw new Error(`Invalid peer public key length: expected 32 bytes, got ${peerPublicKey.length}`)
  }
  if (localPrivateKey.length !== 32) {
    throw new Error(`Invalid local private key length: expected 32 bytes, got ${localPrivateKey.length}`)
  }
  
  // Perform ECDH
  const sharedSecret = x25519.getSharedSecret(localPrivateKey, peerPublicKey)
  
  return sharedSecret
}

/**
 * Derive shared secret from a handshake using X25519 ECDH.
 * 
 * This is the main entry point for key derivation in qBEAP encryption.
 * 
 * @param peerPublicKeyBase64 - Peer's X25519 public key (base64)
 * @param localKeypairId - Optional: specific keypair ID to use (uses device keypair if null)
 * @returns X25519KeyAgreementResult with shared secret
 * @throws Error if peer public key is missing or invalid
 */
export async function deriveSharedSecretX25519(
  peerPublicKeyBase64: string,
  _localKeypairId?: string // Unused for now, always uses device keypair
): Promise<X25519KeyAgreementResult> {
  // Validate peer public key
  if (!peerPublicKeyBase64 || peerPublicKeyBase64.length === 0) {
    throw new Error('[X25519] Peer public key is required for ECDH key agreement')
  }
  
  // Get our device keypair
  const deviceKeypair = await getOrCreateDeviceKeypair()
  
  // Perform ECDH
  const sharedSecret = x25519ECDH(peerPublicKeyBase64, deviceKeypair.privateKey)
  
  console.log('[X25519] ECDH key agreement completed (device key ID:', deviceKeypair.keyId, ')')
  
  return {
    sharedSecret,
    method: 'X25519_ECDH'
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Check if a handshake has the required X25519 key material for qBEAP.
 * 
 * @param peerPublicKeyBase64 - Peer's public key (may be undefined)
 * @returns true if key material is present and valid
 */
export function hasValidX25519Key(peerPublicKeyBase64?: string): boolean {
  if (!peerPublicKeyBase64) return false
  
  try {
    const decoded = fromBase64(peerPublicKeyBase64)
    return decoded.length === 32
  } catch {
    return false
  }
}

/**
 * Validate X25519 public key format.
 * 
 * @param publicKeyBase64 - Public key to validate
 * @throws Error if invalid
 */
export function validateX25519PublicKey(publicKeyBase64: string): void {
  if (!publicKeyBase64) {
    throw new Error('X25519 public key is required')
  }
  
  let decoded: Uint8Array
  try {
    decoded = fromBase64(publicKeyBase64)
  } catch {
    throw new Error('X25519 public key is not valid base64')
  }
  
  if (decoded.length !== 32) {
    throw new Error(`X25519 public key must be 32 bytes, got ${decoded.length}`)
  }
}







