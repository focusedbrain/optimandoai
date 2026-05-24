/**
 * SSH key file reader — unit tests (P4.5.11)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { MAX_SSH_KEY_FILE_BYTES, readAndValidateSshKeyFile } from '../readSshKeyFile.js'

const FIXTURE_KEY = join(
  fileURLToPath(new URL('./fixtures/openssh-test-rsa-key', import.meta.url)),
)

let tempDir = ''

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'wizard-ssh-key-read-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('readAndValidateSshKeyFile', () => {
  test('reads and validates a valid OpenSSH private key', () => {
    const pem = readAndValidateSshKeyFile(FIXTURE_KEY)
    expect(pem).toContain('BEGIN OPENSSH PRIVATE KEY')
  })

  test('rejects oversized files', () => {
    const path = join(tempDir, 'huge.bin')
    writeFileSync(path, Buffer.alloc(MAX_SSH_KEY_FILE_BYTES + 1, 0x41))
    expect(() => readAndValidateSshKeyFile(path)).toThrow(/exceeds/)
  })

  test('rejects malformed key content', () => {
    const path = join(tempDir, 'bad-key')
    writeFileSync(path, 'not a private key')
    expect(() => readAndValidateSshKeyFile(path)).toThrow(/Invalid SSH private key/)
  })

  test('rejects symlink to non-regular file', () => {
    if (process.platform === 'win32') {
      return
    }
    const target = join(tempDir, 'target-key')
    writeFileSync(target, readFileSync(FIXTURE_KEY, 'utf8'))
    const link = join(tempDir, 'key-link')
    symlinkSync(target, link)
    expect(readAndValidateSshKeyFile(link)).toContain('BEGIN OPENSSH PRIVATE KEY')

    const dirLink = join(tempDir, 'dir-link')
    symlinkSync(tempDir, dirLink)
    expect(() => readAndValidateSshKeyFile(dirLink)).toThrow(/regular file/)
  })
})
