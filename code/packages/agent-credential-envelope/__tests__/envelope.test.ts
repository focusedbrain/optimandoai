import { describe, test, expect } from 'vitest'

import {
  generateAgentEncryptionKeypair,
  unwrapCredentialEnvelope,
  wrapCredentialPlaintext,
  type CredentialRelayEnvelopeV1,
} from '../src/envelope.js'

describe('credential envelope v1', () => {
  test('wrap and unwrap round-trip', () => {
    const agent = generateAgentEncryptionKeypair()
    const plaintext = {
      encrypted_bundle: '{"iv":"ab","tag":"cd","ciphertext":"ef"}',
      account_key_hex: 'a'.repeat(64),
    }
    const envelope = wrapCredentialPlaintext(
      agent.publicKeyB64,
      plaintext,
      'account:acct-1',
    )
    const out = unwrapCredentialEnvelope(agent.privateKeyB64, envelope)
    expect(out).toEqual(plaintext)
  })

  test('rejects wrong private key', () => {
    const a = generateAgentEncryptionKeypair()
    const b = generateAgentEncryptionKeypair()
    const envelope = wrapCredentialPlaintext(a.publicKeyB64, {
      encrypted_bundle: '{}',
      account_key_hex: 'b'.repeat(64),
    }, 'account:x')
    expect(() => unwrapCredentialEnvelope(b.privateKeyB64, envelope)).toThrow()
  })

  test('rejects tampered ciphertext', () => {
    const agent = generateAgentEncryptionKeypair()
    const envelope = wrapCredentialPlaintext(
      agent.publicKeyB64,
      { encrypted_bundle: '{}', account_key_hex: 'c'.repeat(64) },
      'account:x',
    )
    const bad: CredentialRelayEnvelopeV1 = {
      ...envelope,
      ciphertext_b64: Buffer.from('tamper').toString('base64'),
    }
    expect(() => unwrapCredentialEnvelope(agent.privateKeyB64, bad)).toThrow()
  })

  test('rejects unsupported version', () => {
    const agent = generateAgentEncryptionKeypair()
    const envelope = wrapCredentialPlaintext(
      agent.publicKeyB64,
      { encrypted_bundle: '{}', account_key_hex: 'd'.repeat(64) },
      'account:x',
    )
    expect(() =>
      unwrapCredentialEnvelope(agent.privateKeyB64, { ...envelope, version: 99 as 1 }),
    ).toThrow(/unsupported_envelope_version/)
  })
})
