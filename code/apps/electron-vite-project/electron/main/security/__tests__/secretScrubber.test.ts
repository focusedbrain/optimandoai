/**
 * secretScrubber — unit tests (P4.5.14)
 */

import { describe, test, expect } from 'vitest'

import {
  REDACTED,
  assertNoSecretsInValue,
  scrubForLog,
  findSecretPatternsInText,
} from '../secretScrubber.js'

const PEM = `-----BEGIN OPENSSH PRIVATE KEY-----
MIIE
-----END OPENSSH PRIVATE KEY-----`

describe('scrubForLog', () => {
  test('redacts PEM material in strings', () => {
    expect(scrubForLog(PEM)).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(String(scrubForLog(PEM))).toContain(REDACTED)
  })

  test('redacts secret object keys regardless of value', () => {
    expect(scrubForLog({ privateKey: 'anything', host: 'edge.example' })).toEqual({
      privateKey: REDACTED,
      host: 'edge.example',
    })
  })

  test('redacts ssh public key prefixes in strings', () => {
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc123'
    expect(String(scrubForLog(key))).not.toContain('AAAAC3NzaC1lZDI1NTE5')
  })

  test('preserves host key fingerprints and operational fields', () => {
    const payload = {
      event: 'ssh_host_key_first_seen',
      host: 'edge.example',
      fingerprint_sha256: '494bc99a29a8a73cfeab24c835d4166408b1cc6b46c2fdd7efdbb2893255baa9',
    }
    expect(scrubForLog(payload)).toEqual(payload)
  })
})

describe('assertNoSecretsInValue', () => {
  test('throws on PEM in nested payload', () => {
    expect(() => assertNoSecretsInValue({ nested: { note: PEM } }, 'test')).toThrow(
      /Credential secret detected/,
    )
  })

  test('throws on sensitive field names', () => {
    expect(() => assertNoSecretsInValue({ passphrase: 'hunter2' }, 'ipc')).toThrow(
      /sensitive field "passphrase"/,
    )
  })

  test('allows public wizard state', () => {
    expect(() =>
      assertNoSecretsInValue(
        {
          step: 'provide_vm',
          vmCredentials: { host: 'h', port: 22, username: 'root' },
        },
        'wizard state',
      ),
    ).not.toThrow()
  })
})

describe('findSecretPatternsInText', () => {
  test('detects bearer tokens and authorization headers', () => {
    const hits = findSecretPatternsInText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')
    expect(hits).toContain('Bearer JWT')
    expect(hits).toContain('Authorization header')
  })
})
