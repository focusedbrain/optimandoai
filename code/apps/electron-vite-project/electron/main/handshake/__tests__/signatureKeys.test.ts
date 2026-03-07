/**
 * Ed25519 Signature Keys Tests
 *
 * Verifies keypair generation, sign, and verify roundtrip.
 */

import { describe, test, expect } from 'vitest'
import {
  generateSigningKeypair,
  signCapsuleHash,
  verifyCapsuleSignature,
} from '../signatureKeys'

describe('signatureKeys', () => {
  test('generateSigningKeypair produces valid hex keys', () => {
    const kp = generateSigningKeypair()
    expect(kp.publicKey).toMatch(/^[a-f0-9]{64}$/)
    expect(kp.privateKey).toMatch(/^[a-f0-9]+$/)
    expect(kp.privateKey.length).toBeGreaterThanOrEqual(64) // PKCS#8 DER hex
  })

  test('sign → verify roundtrip succeeds', () => {
    const kp = generateSigningKeypair()
    const hash = 'a'.repeat(64)
    const sig = signCapsuleHash(hash, kp.privateKey)
    expect(sig).toMatch(/^[a-f0-9]{128}$/)
    expect(verifyCapsuleSignature(hash, sig, kp.publicKey)).toBe(true)
  })

  test('verify fails with wrong public key', () => {
    const kp1 = generateSigningKeypair()
    const kp2 = generateSigningKeypair()
    const hash = 'a'.repeat(64)
    const sig = signCapsuleHash(hash, kp1.privateKey)
    expect(verifyCapsuleSignature(hash, sig, kp2.publicKey)).toBe(false)
  })

  test('verify fails with tampered hash', () => {
    const kp = generateSigningKeypair()
    const hash = 'a'.repeat(64)
    const sig = signCapsuleHash(hash, kp.privateKey)
    expect(verifyCapsuleSignature('b' + 'a'.repeat(63), sig, kp.publicKey)).toBe(false)
  })
})
