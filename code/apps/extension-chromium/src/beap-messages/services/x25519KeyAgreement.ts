/**
 * X25519 Key Agreement for BEAP
 *
 * After the device key migration (Step 4), the X25519 private key lives in the
 * Electron orchestrator DB, not in chrome.storage.local.
 *
 * This module routes all key operations through Electron via VAULT_RPC:
 *   - `getDeviceX25519PublicKey()` → `beap.getDevicePublicKey` RPC
 *   - `deriveSharedSecretX25519()` → `beap.deriveSharedSecret` RPC (ECDH in main process)
 *
 * The private key NEVER travels to the extension. ECDH is performed in
 * Electron main process and only the shared secret is returned.
 *
 * Throws on missing key — does NOT silently regenerate. If the key is absent,
 * the error propagates to the caller (BeapPackageBuilder / handshakeRpc) which
 * must surface it to the user.
 */

import { x25519 } from '@noble/curves/ed25519'
import { safeAtob } from './beapCrypto'

// =============================================================================
// Types (kept for API compatibility)
// =============================================================================

export interface X25519KeyPair {
  /** Private key (32 bytes, base64) - only present in old chrome.storage path */
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
// Error type
// =============================================================================

export class DeviceKeyNotFoundError extends Error {
  readonly code = 'DEVICE_KEY_NOT_FOUND' as const
  constructor(message?: string) {
    super(message ?? 'X25519 device key not found. Re-establish handshakes.')
    this.name = 'DeviceKeyNotFoundError'
  }
}

// =============================================================================
// IPC helpers
// =============================================================================

let _rpcCounter = 0

/**
 * Send a VAULT_RPC beap.* method to Electron and return the response.
 * Uses chrome.runtime.sendMessage → background.ts → WebSocket → Electron.
 */
async function sendBeapRpc<T extends Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 12_000,
): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error(`[X25519] Chrome runtime not available (method: ${method})`)
  }

  return new Promise<T>((resolve, reject) => {
    const id = `x25519-rpc-${Date.now()}-${++_rpcCounter}`
    const timer = setTimeout(() => {
      reject(new Error(`[X25519] RPC timeout: ${method}`))
    }, timeoutMs + 2_000)

    chrome.runtime.sendMessage(
      { type: 'VAULT_RPC', id, method, params },
      (response: any) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!response) {
          reject(new Error(`[X25519] Empty response from ${method}`))
          return
        }
        resolve(response as T)
      },
    )
  })
}

// =============================================================================
// Public API — device key operations via IPC
// =============================================================================

/**
 * Get the device's X25519 public key from the Electron orchestrator DB.
 * Throws `DeviceKeyNotFoundError` if the key is absent.
 * NEVER generates a new key.
 */
export async function getDeviceX25519PublicKey(): Promise<string> {
  const response = await sendBeapRpc<{ success: boolean; publicKey?: string; error?: string; code?: string }>(
    'beap.getDevicePublicKey',
    {},
  )
  if (!response.success) {
    if (response.code === 'DEVICE_KEY_NOT_FOUND') {
      throw new DeviceKeyNotFoundError(response.error)
    }
    throw new Error(`[X25519] beap.getDevicePublicKey failed: ${response.error ?? 'unknown error'}`)
  }
  if (!response.publicKey) {
    throw new Error('[X25519] beap.getDevicePublicKey: success but no publicKey in response')
  }
  return response.publicKey
}

/**
 * Derive shared secret via X25519 ECDH. ECDH happens in Electron main process —
 * the private key never travels to the extension.
 *
 * @param peerPublicKeyBase64 - Peer's X25519 public key (base64, 32 bytes)
 * @param handshakeId - Handshake ID for audit logging (required)
 * @returns X25519KeyAgreementResult with shared secret (32 bytes)
 * @throws DeviceKeyNotFoundError if device key is absent
 * @throws Error if peer public key is invalid or ECDH fails
 */
export async function deriveSharedSecretX25519(
  peerPublicKeyBase64: string,
  handshakeId = '(unknown)',
): Promise<X25519KeyAgreementResult> {
  if (!peerPublicKeyBase64 || peerPublicKeyBase64.length === 0) {
    throw new Error('[X25519] Peer public key is required for ECDH key agreement')
  }

  const response = await sendBeapRpc<{
    success: boolean
    sharedSecretB64?: string
    error?: string
    code?: string
  }>('beap.deriveSharedSecret', { peerPublicKeyB64: peerPublicKeyBase64, handshakeId })

  if (!response.success) {
    if (response.code === 'DEVICE_KEY_NOT_FOUND') {
      throw new DeviceKeyNotFoundError(response.error)
    }
    throw new Error(`[X25519] beap.deriveSharedSecret failed: ${response.error ?? 'unknown error'}`)
  }
  if (!response.sharedSecretB64) {
    throw new Error('[X25519] beap.deriveSharedSecret: success but no sharedSecretB64 in response')
  }

  const binary = safeAtob(response.sharedSecretB64)
  const sharedSecret = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) sharedSecret[i] = binary.charCodeAt(i)

  if (sharedSecret.length !== 32) {
    throw new Error(`[X25519] Unexpected shared secret length: ${sharedSecret.length} (expected 32)`)
  }

  console.log('[X25519] ECDH key agreement completed via Electron main (handshake:', handshakeId, ')')

  return { sharedSecret, method: 'X25519_ECDH' }
}

// =============================================================================
// Pure utility functions (kept for API compatibility — no key material)
// =============================================================================

function fromBase64(base64: string): Uint8Array {
  const binary = safeAtob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Low-level X25519 ECDH — kept for callers that already have key bytes.
 * Do NOT use for device key operations — use `deriveSharedSecretX25519` instead.
 */
export function x25519ECDH(
  peerPublicKeyBase64: string,
  localPrivateKeyBase64: string,
): Uint8Array {
  const peerPublicKey = fromBase64(peerPublicKeyBase64)
  const localPrivateKey = fromBase64(localPrivateKeyBase64)
  if (peerPublicKey.length !== 32) {
    throw new Error(`Invalid peer public key length: expected 32 bytes, got ${peerPublicKey.length}`)
  }
  if (localPrivateKey.length !== 32) {
    throw new Error(`Invalid local private key length: expected 32 bytes, got ${localPrivateKey.length}`)
  }
  return x25519.getSharedSecret(localPrivateKey, peerPublicKey)
}

/**
 * Check if a handshake has the required X25519 key material for qBEAP.
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
 * @throws Error if invalid
 */
export function validateX25519PublicKey(publicKeyBase64: string): void {
  if (!publicKeyBase64) throw new Error('X25519 public key is required')
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
