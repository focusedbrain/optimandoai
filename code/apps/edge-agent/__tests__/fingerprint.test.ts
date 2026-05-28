import { describe, test, expect } from 'vitest'

import { computePairingFingerprint } from '../src/fingerprint.js'

const PUB_A = 'a'.repeat(64)
const PUB_B = 'b'.repeat(64)

describe('pairing fingerprint', () => {
  test('is deterministic for fixed inputs', () => {
    const fp1 = computePairingFingerprint(PUB_A, PUB_B, 'nonce-orch', 'nonce-agent')
    const fp2 = computePairingFingerprint(PUB_A, PUB_B, 'nonce-orch', 'nonce-agent')
    expect(fp1).toBe(fp2)
    expect(fp1).toMatch(/^[a-f0-9]{4}(-[a-f0-9]{4}){3}$/)
  })

  test('changes when nonces change', () => {
    const a = computePairingFingerprint(PUB_A, PUB_B, 'n1', 'n2')
    const b = computePairingFingerprint(PUB_A, PUB_B, 'n3', 'n2')
    expect(a).not.toBe(b)
  })

  test('matches documented example inputs shape', () => {
    const fp = computePairingFingerprint(
      '0000000000000000000000000000000000000000000000000000000000000001',
      '0000000000000000000000000000000000000000000000000000000000000002',
      'orch',
      'agent',
    )
    expect(fp).toHaveLength(19)
  })
})
