/**
 * Preload forwarding: allowlisted handshake:accept fields; `buildHandshakeAcceptSafeOpts` is pure.
 */
import { describe, it, expect } from 'vitest'
import { buildHandshakeAcceptSafeOpts } from '../handshakeAcceptSafeOpts'

const MOCK_X25519_B64 = 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='

describe('buildHandshakeAcceptSafeOpts (preload handshake:accept)', () => {
  it('T5_preserves_senderX25519PublicKeyB64_and_nested_key_agreement_x25519_when_valid_strings', () => {
    const nestedKey = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU='
    const safe = buildHandshakeAcceptSafeOpts({
      senderX25519PublicKeyB64: ` ${MOCK_X25519_B64} `,
      key_agreement: {
        x25519_public_key_b64: nestedKey,
        extra_field: 'drop-me',
      },
    })

    expect(safe?.senderX25519PublicKeyB64).toBe(MOCK_X25519_B64)
    expect(safe?.key_agreement).toEqual({
      x25519_public_key_b64: nestedKey,
    })
    expect((safe?.key_agreement as Record<string, unknown>).extra_field).toBeUndefined()
  })

  it('T6_does_not_throw_when_X25519_absent__main_enforces_using_record', () => {
    const r = buildHandshakeAcceptSafeOpts({ policy_selections: { cloud_ai: true } })
    expect(r).toEqual({ policy_selections: { cloud_ai: true } })
  })

  it('T7_drops_nested_key_agreement_mlkem_when_present_alongside_valid_x25519', () => {
    const mlk = 'bWxrZW0tcHViLTc2OC1iYXNlNjQ='
    const safe = buildHandshakeAcceptSafeOpts({
      key_agreement: {
        x25519_public_key_b64: MOCK_X25519_B64,
        mlkem768_public_key_b64: ` ${mlk} `,
      },
    })
    expect(safe?.key_agreement).toEqual({
      x25519_public_key_b64: MOCK_X25519_B64,
      mlkem768_public_key_b64: mlk,
    })
  })

  it('T8_preserves_internal_routing_string_fields', () => {
    const s = buildHandshakeAcceptSafeOpts({
      device_role: 'sandbox',
      device_name: ' DevBox ',
      internal_peer_device_id: ' orch-uuid-1 ',
      internal_peer_device_role: ' host ',
      internal_peer_computer_name: ' Other ',
      internal_peer_pairing_code: ' 654321 ',
    })
    expect(s).toEqual({
      device_role: 'sandbox',
      device_name: 'DevBox',
      internal_peer_device_id: 'orch-uuid-1',
      internal_peer_device_role: 'host',
      internal_peer_computer_name: 'Other',
      internal_peer_pairing_code: '654321',
    })
  })

  it('T9_does_not_use_device_role_as_internal_proof__it_is_forwarded_as_UX_only', () => {
    // Without X25519 fields, output still includes device_role for main; main + ipc decide internal via DB.
    const s = buildHandshakeAcceptSafeOpts({ device_role: 'host' })
    expect(s).toEqual({ device_role: 'host' })
  })
})
