/**
 * Edge Ed25519 keypair generation — Phase 3 (P3.8).
 *
 * Used by edge-cli (Phase 3) and the Phase 4 wizard.
 */

import { randomUUID } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519.js'

export interface EdgeKeypair {
  privateKeyHex: string
  publicKeyHex: string
  /** `ed25519:<hex>` claim format for SSO attestation. */
  publicKeyClaim: string
  podId: string
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Generate a fresh edge pod identity (Ed25519 + UUID v4 pod id). */
export function generateEdgeKeypair(): EdgeKeypair {
  const secretKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  const publicKeyHex = bytesToHex(publicKey)
  return {
    privateKeyHex: bytesToHex(secretKey),
    publicKeyHex,
    publicKeyClaim: `ed25519:${publicKeyHex}`,
    podId: randomUUID(),
  }
}

/** Sign/verify round-trip helper for tests. */
export function verifyEdgeKeypairRoundTrip(keypair: EdgeKeypair): boolean {
  const message = new TextEncoder().encode('beap-edge-keygen-smoke')
  const privateKey = Uint8Array.from(Buffer.from(keypair.privateKeyHex, 'hex'))
  const publicKey = Uint8Array.from(Buffer.from(keypair.publicKeyHex, 'hex'))
  const signature = ed25519.sign(message, privateKey)
  return ed25519.verify(signature, message, publicKey)
}
