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

  // Weak-key rejection (0020 §2): native verify accepts the all-zero key with an
  // all-zero signature; the gate must reject small-order keys before verify.
  describe('weak-key rejection at the capsule boundary', () => {
    const hash = 'ab'.repeat(32)
    const zeroSig = '00'.repeat(64)

    test('all-zero public key + zero signature is REJECTED', () => {
      expect(verifyCapsuleSignature(hash, zeroSig, '00'.repeat(32))).toBe(false)
    })

    test('small-order public key is REJECTED', () => {
      const smallOrder = 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a'
      expect(verifyCapsuleSignature(hash, zeroSig, smallOrder)).toBe(false)
    })

    test('valid full-order key still verifies a genuine signature', () => {
      const kp = generateSigningKeypair()
      const sig = signCapsuleHash(hash, kp.privateKey)
      expect(verifyCapsuleSignature(hash, sig, kp.publicKey)).toBe(true)
    })
  })
})
