/**
 * SSH host key TOFU pinning — P4.5.13 tests.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'

import {
  assertHostKeyTrusted,
  fingerprintSha256Hex,
  HostKeyMismatchError,
  toHostKeyMismatchPayload,
} from '../hostKeyPinning.js'
import {
  _setHostKeyStorePathForTest,
  getStoredFingerprint,
} from '../hostKeyStore.js'
import {
  SSH_HOST_KEY_FIRST_SEEN_EVENT,
  _clearHostKeyFirstSeenEventsForTest,
  _drainHostKeyFirstSeenEventsForTest,
} from '../hostKeyEvents.js'
import { SshClient } from '../client.js'

const HOST = 'vps.example.test'
const PORT = 22

/** Distinct raw host key byte sequences (ssh2 hostVerifier material). */
const HOST_KEY_A = Buffer.from(
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyPinningTestKeyA',
  'utf8',
)
const HOST_KEY_B = Buffer.from(
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyPinningTestKeyB',
  'utf8',
)

const FINGERPRINT_A = fingerprintSha256Hex(HOST_KEY_A)

describe('assertHostKeyTrusted (TOFU)', () => {
  let storePath: string

  beforeEach(() => {
    _clearHostKeyFirstSeenEventsForTest()
    const dir = mkdtempSync(join(tmpdir(), 'host-key-store-'))
    storePath = join(dir, 'edge-tier-host-keys.json')
    _setHostKeyStorePathForTest(storePath)
  })

  afterEach(() => {
    _setHostKeyStorePathForTest(null)
    _clearHostKeyFirstSeenEventsForTest()
    rmSync(join(storePath, '..'), { recursive: true, force: true })
  })

  test('first connect stores fingerprint and emits structured first_seen event', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z'))

    expect(assertHostKeyTrusted({ host: HOST, port: PORT, hostKey: HOST_KEY_A })).toBe(true)

    const stored = getStoredFingerprint(HOST, PORT)
    expect(stored?.fingerprint_sha256).toBe(fingerprintSha256Hex(HOST_KEY_A))

    const events = _drainHostKeyFirstSeenEventsForTest()
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      event: SSH_HOST_KEY_FIRST_SEEN_EVENT,
      host: HOST,
      port: PORT,
      key_type: 'unknown',
      fingerprint_sha256: FINGERPRINT_A,
      ts: '2026-05-24T12:00:00.000Z',
    })
    expect(Object.keys(events[0]!).sort()).toMatchInlineSnapshot(`
      [
        "event",
        "fingerprint_sha256",
        "host",
        "key_type",
        "port",
        "ts",
      ]
    `)

    vi.useRealTimers()
  })

  test('second connect with same fingerprint accepts and updates last_verified', () => {
    assertHostKeyTrusted({ host: HOST, port: PORT, hostKey: HOST_KEY_A })
    _drainHostKeyFirstSeenEventsForTest()

    const before = getStoredFingerprint(HOST, PORT)!
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-24T13:00:00.000Z'))

    expect(assertHostKeyTrusted({ host: HOST, port: PORT, hostKey: HOST_KEY_A })).toBe(true)

    const after = getStoredFingerprint(HOST, PORT)!
    expect(after.fingerprint_sha256).toBe(before.fingerprint_sha256)
    expect(after.first_seen).toBe(before.first_seen)
    expect(after.last_verified).toBe('2026-05-24T13:00:00.000Z')
    expect(_drainHostKeyFirstSeenEventsForTest()).toHaveLength(0)

    vi.useRealTimers()
  })

  test('second connect with different fingerprint throws HostKeyMismatchError with both fingerprints', () => {
    assertHostKeyTrusted({ host: HOST, port: PORT, hostKey: HOST_KEY_A })

    try {
      assertHostKeyTrusted({ host: HOST, port: PORT, hostKey: HOST_KEY_B })
      expect.fail('expected HostKeyMismatchError')
    } catch (err) {
      expect(err).toBeInstanceOf(HostKeyMismatchError)
      const mismatch = err as HostKeyMismatchError
      expect(mismatch.storedFingerprint).toBe(fingerprintSha256Hex(HOST_KEY_A))
      expect(mismatch.observedFingerprint).toBe(fingerprintSha256Hex(HOST_KEY_B))

      const payload = toHostKeyMismatchPayload(mismatch)
      expect(payload.code).toBe('HOST_KEY_MISMATCH')
      expect(payload.stored_fingerprint).toBe(mismatch.storedFingerprint)
      expect(payload.observed_fingerprint).toBe(mismatch.observedFingerprint)
      expect(payload.stored_fingerprint_display).toMatch(/^SHA256:/)
      expect(payload.observed_fingerprint_display).toMatch(/^SHA256:/)
    }
  })
})

describe('SshClient host key pinning', () => {
  let storePath: string

  beforeEach(() => {
    _clearHostKeyFirstSeenEventsForTest()
    const dir = mkdtempSync(join(tmpdir(), 'host-key-client-'))
    storePath = join(dir, 'edge-tier-host-keys.json')
    _setHostKeyStorePathForTest(storePath)
  })

  afterEach(() => {
    _setHostKeyStorePathForTest(null)
    _clearHostKeyFirstSeenEventsForTest()
    rmSync(join(storePath, '..'), { recursive: true, force: true })
  })

  function makePinningMockClient(hostKey: Buffer, failVerifier?: boolean) {
    const client = new EventEmitter() as Client & {
      connect: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }

    client.connect = vi.fn((config: { hostVerifier?: (key: Buffer) => boolean }) => {
      if (config.hostVerifier) {
        const ok = config.hostVerifier(hostKey)
        if (!ok || failVerifier) {
          process.nextTick(() => client.emit('error', new Error('Host key verification failed')))
          return client
        }
      }
      process.nextTick(() => client.emit('ready'))
      return client
    })

    client.end = vi.fn(() => {
      client.emit('close')
    })

    return client
  }

  test('connect pins host key on first successful connect', async () => {
    const client = makePinningMockClient(HOST_KEY_A)
    const ssh = new SshClient(() => client)

    await ssh.connect({
      host: HOST,
      port: PORT,
      username: 'root',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
    })

    expect(getStoredFingerprint(HOST, PORT)?.fingerprint_sha256).toBe(fingerprintSha256Hex(HOST_KEY_A))
    expect(_drainHostKeyFirstSeenEventsForTest()).toHaveLength(1)
    await ssh.disconnect()
  })

  test('connect rejects with HostKeyMismatchError when pinned key differs', async () => {
    const first = makePinningMockClient(HOST_KEY_A)
    const ssh1 = new SshClient(() => first)
    await ssh1.connect({
      host: HOST,
      port: PORT,
      username: 'root',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
    })
    await ssh1.disconnect()
    _drainHostKeyFirstSeenEventsForTest()

    const second = makePinningMockClient(HOST_KEY_B)
    const ssh2 = new SshClient(() => second)

    await expect(
      ssh2.connect({
        host: HOST,
        port: PORT,
        username: 'root',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      }),
    ).rejects.toMatchObject({
      name: 'HostKeyMismatchError',
      storedFingerprint: fingerprintSha256Hex(HOST_KEY_A),
      observedFingerprint: fingerprintSha256Hex(HOST_KEY_B),
    })
  })
})
