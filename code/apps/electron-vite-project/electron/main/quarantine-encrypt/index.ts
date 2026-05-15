/**
 * Quarantine Blob Encryption — Phase B, PR B-3
 *
 * Hybrid X25519 + HKDF-SHA256 + AES-256-GCM encryption for quarantine blobs.
 *
 * DESIGN NOTE — KEY REUSE:
 * This module uses the paired sandbox's `peer_x25519_public_key_b64`
 * for encryption. The same key is used by qBEAP for receive-direction
 * key agreement.
 *
 * Cryptographically, this is sound: X25519 receive-only key reuse
 * is safe under the standard ECIES/HPKE security model. Multiple
 * ciphertexts encrypted to the same public key remain independently
 * secure because each encryption uses a fresh ephemeral keypair and
 * random salt, binding the shared secret uniquely to each ciphertext.
 *
 * A future PR may introduce a dedicated `quarantine_x25519_pub_b64`
 * field on the handshake record if separation is desired for audit
 * or operational reasons. The encryption itself does not need to
 * change to support that — only the key lookup.
 *
 * Primitive chain (mirrors qBEAP decrypt in `decryptQBeapPackage.ts`):
 *   1. Generate ephemeral X25519 keypair (sender).
 *   2. X25519 ECDH: sharedSecret = DH(ephemeral_priv, recipient_pub).
 *   3. HKDF-SHA256(ikm=sharedSecret, salt=random_16, info='quarantine-blob-v1') → 32-byte key.
 *   4. AES-256-GCM(key, nonce=random_12, plaintext=emailBytes) → ciphertext (includes tag).
 *
 * Sandbox decrypt chain (symmetric inverse):
 *   1. X25519 ECDH: sharedSecret = DH(sandbox_priv, ephemeral_pub).
 *   2. HKDF-SHA256(sharedSecret, salt, 'quarantine-blob-v1') → 32-byte key.
 *   3. AES-256-GCM decrypt.
 *
 * per Phase B Architecture, Amendment 2 to B-3, Decision A.
 */

import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'crypto'
import { x25519 } from '@noble/curves/ed25519'
import type { QuarantineBlobFile } from '../quarantine-blob-storage/index'

// ── Constants ──

const HKDF_INFO = 'quarantine-blob-v1'
const SALT_BYTES = 16
const NONCE_BYTES = 12
const KEY_BYTES = 32

// ── Types ──

export type QuarantineEncryptResult =
  | { ok: true; blob: QuarantineBlobFile }
  | { ok: false; error: string }

export type QuarantineDecryptResult =
  | { ok: true; plaintext: Buffer }
  | { ok: false; error: string }

// ── Encrypt ──

/**
 * Encrypts `emailBytes` to the sandbox's X25519 public key.
 *
 * Returns a `QuarantineBlobFile` ready to be written to disk via
 * `writeQuarantineBlob`.
 *
 * @param emailBytes   Raw email bytes (the original message the host cannot depackage).
 * @param sandboxPeerX25519PubB64  The sandbox's `peer_x25519_public_key_b64` from
 *                                  the handshake record.
 */
export function encryptForQuarantine(
  emailBytes: Buffer,
  sandboxPeerX25519PubB64: string,
): QuarantineEncryptResult {
  try {
    const recipientPubBytes = Buffer.from(sandboxPeerX25519PubB64, 'base64')
    if (recipientPubBytes.length !== 32) {
      return {
        ok: false,
        error: `sandbox peer X25519 public key must be 32 bytes; got ${recipientPubBytes.length}`,
      }
    }

    // 1. Ephemeral sender keypair.
    const ephemeralPriv = x25519.utils.randomPrivateKey()
    const ephemeralPub = x25519.getPublicKey(ephemeralPriv)

    // 2. X25519 shared secret.
    const sharedSecret = x25519.getSharedSecret(ephemeralPriv, new Uint8Array(recipientPubBytes))

    // 3. HKDF-SHA256 key derivation.
    const salt = randomBytes(SALT_BYTES)
    const derivedKey = hkdfSync(
      'sha256',
      Buffer.from(sharedSecret),
      salt,
      Buffer.from(HKDF_INFO, 'utf-8'),
      KEY_BYTES,
    )

    // 4. AES-256-GCM encrypt.
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', derivedKey, nonce)
    const ct = Buffer.concat([cipher.update(emailBytes), cipher.final()])
    const tag = cipher.getAuthTag()

    // Zeroize sensitive key material.
    ;(derivedKey as Buffer).fill(0)
    ;(sharedSecret as Uint8Array).fill(0)
    ephemeralPriv.fill(0)

    return {
      ok: true,
      blob: {
        version: 'quarantine-v1',
        sender_ephemeral_x25519_pub_b64: Buffer.from(ephemeralPub).toString('base64'),
        salt_b64: salt.toString('base64'),
        nonce_b64: nonce.toString('base64'),
        // Auth tag appended to ciphertext (matches decryptQBeapPackage.ts convention).
        ciphertext_b64: Buffer.concat([ct, tag]).toString('base64'),
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `encryptForQuarantine: ${msg}` }
  }
}

// ── Decrypt (sandbox-side) ──

/**
 * Decrypts a quarantine blob using the sandbox's local X25519 private key.
 *
 * Called by the sandbox's receive-side pipeline when it receives a
 * `sandbox_clone_quarantine: true` package from the host.
 *
 * @param blob                 The parsed `QuarantineBlobFile` from the clone package.
 * @param sandboxLocalX25519PrivB64  The sandbox's local X25519 private key
 *                                    (`local_x25519_private_key_b64` from the handshake).
 */
export function decryptQuarantineBlob(
  blob: QuarantineBlobFile,
  sandboxLocalX25519PrivB64: string,
): QuarantineDecryptResult {
  try {
    const privBytes = Buffer.from(sandboxLocalX25519PrivB64, 'base64')
    const senderPubBytes = Buffer.from(blob.sender_ephemeral_x25519_pub_b64, 'base64')
    if (privBytes.length !== 32 || senderPubBytes.length !== 32) {
      return { ok: false, error: 'quarantine decrypt: invalid key length' }
    }

    // 1. X25519 shared secret (sandbox private × sender ephemeral public).
    const sharedSecret = x25519.getSharedSecret(
      new Uint8Array(privBytes),
      new Uint8Array(senderPubBytes),
    )

    // 2. HKDF-SHA256.
    const salt = Buffer.from(blob.salt_b64, 'base64')
    const derivedKey = hkdfSync(
      'sha256',
      Buffer.from(sharedSecret),
      salt,
      Buffer.from(HKDF_INFO, 'utf-8'),
      KEY_BYTES,
    )

    // 3. AES-256-GCM decrypt (tag is last 16 bytes of ciphertext_b64).
    const nonce = Buffer.from(blob.nonce_b64, 'base64')
    const ciphertextWithTag = Buffer.from(blob.ciphertext_b64, 'base64')
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16)
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16)

    const decipher = createDecipheriv('aes-256-gcm', derivedKey, nonce)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    // Zeroize sensitive key material.
    ;(derivedKey as Buffer).fill(0)
    ;(sharedSecret as Uint8Array).fill(0)
    privBytes.fill(0)

    return { ok: true, plaintext }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `decryptQuarantineBlob: ${msg}` }
  }
}
