/**
 * Ed25519 Handshake Signature Keys
 *
 * Keypair management and signing/verification for BEAP handshake capsules.
 * Uses Node.js native crypto module — no external dependencies.
 *
 * Storage format:
 *   - publicKey: 64-char hex (raw 32-byte Ed25519 public key)
 *   - privateKey: hex-encoded PKCS#8 DER (variable length, typically 96 chars)
 *     We store the full PKCS#8 to avoid seed extraction issues across Node versions.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'

export interface SigningKeypair {
  /** Hex-encoded raw 32-byte Ed25519 public key (64 chars) */
  publicKey: string
  /** Hex-encoded PKCS#8 DER private key (for signing). Accepts 64-char hex (raw seed) or full PKCS#8 hex. */
  privateKey: string
}

/**
 * Generate a new Ed25519 keypair.
 * Returns hex-encoded keys (publicKey: 64 chars raw, privateKey: PKCS#8 hex).
 */
export function generateSigningKeypair(): SigningKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' })
  return {
    publicKey: pubDer.slice(-32).toString('hex'),
    privateKey: privDer.toString('hex'),
  }
}

/** Build SPKI DER for raw 32-byte Ed25519 public key. */
function rawPubKeyToSpki(rawHex: string): Buffer {
  const key = Buffer.from(rawHex, 'hex')
  if (key.length !== 32) throw new Error('publicKey must be 32 bytes')
  const oid = Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70])
  const algSeq = Buffer.concat([Buffer.from([0x30, 0x05]), oid])
  const bitStr = Buffer.concat([Buffer.from([0x03, 0x21, 0x00]), key])
  const elements = Buffer.concat([algSeq, bitStr])
  return Buffer.concat([Buffer.from([0x30, elements.length]), elements])
}

/**
 * Sign a capsule_hash (64-char hex string) with the private key.
 * Returns hex-encoded 64-byte Ed25519 signature (128 chars).
 * privateKeyHex: either 64-char hex (raw seed) or full PKCS#8 DER hex.
 */
export function signCapsuleHash(capsuleHash: string, privateKeyHex: string): string {
  if (!/^[a-f0-9]{64}$/i.test(capsuleHash)) {
    throw new Error('capsule_hash must be 64-char hex')
  }
  if (!/^[a-f0-9]+$/i.test(privateKeyHex) || privateKeyHex.length < 64) {
    throw new Error('privateKey must be hex (64-char seed or PKCS#8 DER)')
  }
  const data = Buffer.from(capsuleHash, 'hex')
  let keyObj
  if (privateKeyHex.length === 64) {
    // Raw seed: create keypair from seed for signing
    const seed = Buffer.from(privateKeyHex, 'hex')
    keyObj = generateKeyPairSync('ed25519', { seed }).privateKey
  } else {
    // Full PKCS#8 DER
    keyObj = createPrivateKey({ key: Buffer.from(privateKeyHex, 'hex'), format: 'der', type: 'pkcs8' })
  }
  const sig = sign(null, data, keyObj)
  return sig.toString('hex')
}

/**
 * Verify a signature over a capsule_hash against a public key.
 * Returns true if valid.
 */
export function verifyCapsuleSignature(
  capsuleHash: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(capsuleHash)) return false
  if (!/^[a-f0-9]{128}$/i.test(signatureHex)) return false
  if (!/^[a-f0-9]{64}$/i.test(publicKeyHex)) return false
  try {
    const data = Buffer.from(capsuleHash, 'hex')
    const sig = Buffer.from(signatureHex, 'hex')
    const spki = rawPubKeyToSpki(publicKeyHex)
    const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    return verify(null, data, publicKey, sig)
  } catch {
    return false
  }
}
