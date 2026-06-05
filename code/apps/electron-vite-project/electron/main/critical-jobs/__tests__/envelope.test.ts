/**
 * Envelope serialization + INV-2 (seal-key custody) structural proof.
 *
 * Asserts that a well-formed CriticalJobSpec of EVERY kind, when serialized,
 * contains no field able to carry vault-derived key material. Public keys
 * (custodyPubKeyB64) are allowed; private/seal/application/vault keys are not.
 */

import { describe, test, expect } from 'vitest'
import type { CriticalJobSpec } from '../types'

// Field-name patterns that would indicate smuggled secret/key material.
// NB: deliberately does NOT match "pubkey" / "custodyPubKeyB64" (public keys).
const FORBIDDEN_KEY_FIELD = /seal[_-]?key|application[_-]?key|vault[_-]?key|private[_-]?key|"priv"|secret|vmk|hmac[_-]?key/i

function specsOfEveryKind(): CriticalJobSpec[] {
  const limits = { maxWallClockMs: 5000, maxInputBytes: 1_000_000 }
  return [
    {
      jobId: 'j-depackage',
      kind: 'depackage',
      input: { inputBytes: Buffer.from('Subject: x\r\n\r\nbody') },
      custodyPubKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      limits,
      flush: 'per-action',
    },
    {
      jobId: 'j-valdec',
      kind: 'validate-decrypted-beap',
      input: {
        envelope: { kind: 'qbeap' },
        plaintext_or_encrypted: {
          kind: 'qbeap_encrypted',
          ciphertext: 'b64ciphertextopaque',
          handshake_id: 'hs-123',
        },
        provenance: {} as never,
        target_row_id: 'row-1',
      },
      limits,
      flush: 'session',
    },
    {
      jobId: 'j-valnative',
      kind: 'validate-native-beap',
      input: { candidate: { kind: 'qbeap' } as never },
      limits,
      flush: 'session',
    },
    {
      // RESERVED kind: carries the package + a handshake *identifier* only
      // (INV-2 — no key field; INV-6 keys arrive out-of-band in a future build).
      jobId: 'j-decrypt',
      kind: 'decrypt-qbeap',
      input: { packageJson: '{"kind":"qbeap"}', handshakeId: 'hs-123' },
      limits,
      flush: 'per-action',
    },
    {
      jobId: 'j-link',
      kind: 'open-link',
      input: { url: 'https://example.test/x' },
      limits,
      flush: 'per-action',
    },
    {
      jobId: 'j-att',
      kind: 'view-attachment',
      input: { artifactRef: 'blob-abc' },
      custodyPubKeyB64: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      limits,
      flush: 'per-action',
    },
  ]
}

describe('CriticalJobSpec envelope', () => {
  test('serializes round-trip for every kind', () => {
    for (const spec of specsOfEveryKind()) {
      const json = JSON.stringify(spec)
      const back = JSON.parse(json)
      expect(back.jobId).toBe(spec.jobId)
      expect(back.kind).toBe(spec.kind)
      expect(back.flush).toBe(spec.flush)
    }
  })

  test('INV-2: no spec of any kind can carry seal/application/vault/private key material', () => {
    for (const spec of specsOfEveryKind()) {
      const json = JSON.stringify(spec)
      expect(json).not.toMatch(FORBIDDEN_KEY_FIELD)
    }
  })

  test('INV-2: a public custody key is permitted (sanity — pattern is not over-broad)', () => {
    const spec = specsOfEveryKind()[0]
    expect(spec.custodyPubKeyB64).toBeTruthy()
    // The presence of a *public* key must not trip the forbidden-field guard.
    expect(JSON.stringify({ custodyPubKeyB64: spec.custodyPubKeyB64 })).not.toMatch(
      FORBIDDEN_KEY_FIELD,
    )
  })
})
