/**
 * Weak-key rejection (docs/build-specs/0020 §2).
 *
 * The all-zero Ed25519 finding, reclassified from observation to security finding:
 * a small-order / identity public key has a trivially-known discrete log, so any
 * party can forge a signature under it. Both verification stacks accepted the
 * all-zero key with an all-zero signature (verified empirically, below). These
 * tests pin the guard `isWeakEd25519PublicKey` AND the job-result verification
 * boundary that consumes it.
 */

import { describe, test, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { isWeakEd25519PublicKey } from '../ed25519WeakKey'
import {
  signJobResult,
  verifyJobResultSignature,
  type JobResult,
} from '../../depackaging-microvm/hypervisorProvider'

const ZERO32 = new Uint8Array(32)
const NEUTRAL = (() => {
  const b = new Uint8Array(32)
  b[0] = 0x01
  return b
})()
const SMALL_ORDER = Uint8Array.from(
  Buffer.from('c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', 'hex'),
)

describe('isWeakEd25519PublicKey — the guard', () => {
  test('all-zero (identity) key → weak', () => {
    expect(isWeakEd25519PublicKey(ZERO32)).toBe(true)
  })

  test('neutral element (y=1) → weak', () => {
    expect(isWeakEd25519PublicKey(NEUTRAL)).toBe(true)
  })

  test('small-order torsion point → weak', () => {
    expect(isWeakEd25519PublicKey(SMALL_ORDER)).toBe(true)
  })

  test('wrong length → weak (fail closed)', () => {
    expect(isWeakEd25519PublicKey(new Uint8Array(31))).toBe(true)
    expect(isWeakEd25519PublicKey(new Uint8Array(33))).toBe(true)
  })

  test('genuine full-order public key → NOT weak', () => {
    const pub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey())
    expect(isWeakEd25519PublicKey(pub)).toBe(false)
  })
})

// Pin the library's pre-fix behavior so the regression is documented, not assumed.
describe('library baseline (documents WHY the guard exists)', () => {
  test('@noble verify accepts all-zero key + all-zero signature (cofactored)', () => {
    const ok = ed25519.verify(new Uint8Array(64), new Uint8Array([1, 2, 3]), ZERO32)
    expect(ok).toBe(true)
  })
})

describe('verifyJobResultSignature — boundary hardened', () => {
  const base = { jobId: 'job-1', ok: true, safeText: undefined, artifacts: [] as never[] }

  test('valid signed result still verifies (no regression)', () => {
    const priv = ed25519.utils.randomPrivateKey()
    const { result_signing_pub_b64, result_signature_b64 } = signJobResult(base, priv)
    const r: JobResult = { ...base, result_signing_pub_b64, result_signature_b64 }
    expect(verifyJobResultSignature(r)).toBe(true)
  })

  test('all-zero key + all-zero signature is REJECTED (was accepted pre-fix)', () => {
    const r: JobResult = {
      ...base,
      result_signing_pub_b64: Buffer.from(ZERO32).toString('base64'),
      result_signature_b64: Buffer.from(new Uint8Array(64)).toString('base64'),
    }
    expect(verifyJobResultSignature(r)).toBe(false)
  })

  test('small-order key + all-zero signature is REJECTED', () => {
    const r: JobResult = {
      ...base,
      result_signing_pub_b64: Buffer.from(SMALL_ORDER).toString('base64'),
      result_signature_b64: Buffer.from(new Uint8Array(64)).toString('base64'),
    }
    expect(verifyJobResultSignature(r)).toBe(false)
  })
})
