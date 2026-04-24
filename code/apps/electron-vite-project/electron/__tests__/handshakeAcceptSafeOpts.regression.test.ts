/**
 * Preload forwarding: preserve camel + nested key_agreement X25519 for handshake:accept.
 */
import { describe, it, expect } from 'vitest'
import { buildHandshakeAcceptSafeOpts } from '../handshakeAcceptSafeOpts'

const ERR = 'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED'

const MOCK_X25519_B64 = 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='

describe('buildHandshakeAcceptSafeOpts (preload handshake:accept)', () => {
  it('T5_preserves_senderX25519PublicKeyB64_and_nested_key_agreement_x25519_when_valid_strings', () => {
    const nestedKey = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU='
    const safe = buildHandshakeAcceptSafeOpts(
      {
        senderX25519PublicKeyB64: ` ${MOCK_X25519_B64} `,
        key_agreement: {
          x25519_public_key_b64: nestedKey,
          extra_field: 'drop-me',
        },
      },
      ERR,
    )

    expect(safe?.senderX25519PublicKeyB64).toBe(MOCK_X25519_B64)
    expect(safe?.key_agreement).toEqual({
      x25519_public_key_b64: nestedKey,
    })
    expect((safe?.key_agreement as Record<string, unknown>).extra_field).toBeUndefined()
  })

  it('normal_accept_throws_when_no_X25519_in_any_shape', () => {
    expect(() => buildHandshakeAcceptSafeOpts({ policy_selections: {} }, ERR)).toThrow(ERR)
  })
})
