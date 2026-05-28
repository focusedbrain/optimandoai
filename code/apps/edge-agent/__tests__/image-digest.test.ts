import { describe, test, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  ImageDigestMismatchError,
  ExpectedDigestMissingError,
  loadExpectedDigest,
  verifyAgentImageDigest,
} from '../src/image-digest.js'

describe('image digest verification', () => {
  test('rejects placeholder digest file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'))
    const path = join(dir, 'expected-image-digest.json')
    writeFileSync(
      path,
      JSON.stringify({ 'beap-components': { dev: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' } }),
    )
    try {
      expect(() => loadExpectedDigest('beap-components:dev', path)).toThrow(ExpectedDigestMissingError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('matching digest succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'))
    const path = join(dir, 'expected-image-digest.json')
    const digest = 'sha256:abc'
    writeFileSync(path, JSON.stringify({ 'beap-components': { dev: digest } }))
    try {
      const result = await verifyAgentImageDigest('beap-components:dev', {
        digestPath: path,
        inspect: async () => digest,
      })
      expect(result.expected).toBe(digest)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('mismatch throws ImageDigestMismatchError', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'))
    const path = join(dir, 'expected-image-digest.json')
    writeFileSync(path, JSON.stringify({ 'beap-components': { dev: 'sha256:aaa' } }))
    try {
      await expect(
        verifyAgentImageDigest('beap-components:dev', {
          digestPath: path,
          inspect: async () => 'sha256:bbb',
        }),
      ).rejects.toBeInstanceOf(ImageDigestMismatchError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
