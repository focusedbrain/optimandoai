import { describe, test, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  verifyBeapImageDigest,
  ImageDigestMismatchError,
  loadExpectedDigest,
} from '../imageDigestVerify.js'

describe('verifyBeapImageDigest', () => {
  test('passes when inspect digest matches expected file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'))
    const digestPath = join(dir, 'expected-image-digest.json')
    writeFileSync(
      digestPath,
      JSON.stringify({ 'beap-components': { dev: 'sha256:abc' } }),
    )
    await expect(
      verifyBeapImageDigest('beap-components:dev', {
        digestPath,
        inspect: async () => 'sha256:abc',
      }),
    ).resolves.toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test('throws ImageDigestMismatchError on mismatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'))
    const digestPath = join(dir, 'expected-image-digest.json')
    writeFileSync(
      digestPath,
      JSON.stringify({ 'beap-components': { dev: 'sha256:expected' } }),
    )
    await expect(
      verifyBeapImageDigest('beap-components:dev', {
        digestPath,
        inspect: async () => 'sha256:actual',
      }),
    ).rejects.toBeInstanceOf(ImageDigestMismatchError)
    rmSync(dir, { recursive: true, force: true })
  })

  test('skips verify when expected digest is placeholder', () => {
    expect(loadExpectedDigest('beap-components:dev')).toBeNull()
  })
})
