import { describe, test, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import * as podExec from '../podExec.js'
import * as imageDigest from '../imageDigestVerify.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('verifyBeapImageDigest', () => {
  test('passes when inspect digest matches expected file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'))
    const digestPath = join(dir, 'expected-image-digest.json')
    writeFileSync(
      digestPath,
      JSON.stringify({ 'beap-components': { dev: 'sha256:abc' } }),
    )
    await expect(
      imageDigest.verifyBeapImageDigest('beap-components:dev', {
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
      imageDigest.verifyBeapImageDigest('beap-components:dev', {
        digestPath,
        inspect: async () => 'sha256:actual',
      }),
    ).rejects.toBeInstanceOf(imageDigest.ImageDigestMismatchError)
    rmSync(dir, { recursive: true, force: true })
  })

  test('skips verify when expected digest is placeholder', () => {
    expect(imageDigest.loadExpectedDigest('beap-components:dev')).toBeNull()
  })
})

describe('ensureBeapPodImagePresent', () => {
  test('throws user-facing message when image cannot be restored', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockResolvedValue({ code: 125, stdout: '', stderr: 'not known' })
    await expect(
      imageDigest.ensureBeapPodImagePresent('beap-components:dev', { tryAutoRestore: false }),
    ).rejects.toThrow(imageDigest.BEAP_IMAGE_RESTORE_USER_MESSAGE)
  })

  test('accepts localhost-qualified image when bare tag is missing', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockImplementation(async (args) => {
      const ref = args[2]
      if (args[0] === 'image' && args[1] === 'inspect') {
        if (ref === 'beap-components:dev') {
          return { code: 125, stdout: '', stderr: 'image not known' }
        }
        if (ref === 'localhost/beap-components:dev') {
          return { code: 0, stdout: 'sha256:abc123', stderr: '' }
        }
      }
      if (args[0] === 'tag') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: '' }
    })

    await expect(
      imageDigest.ensureBeapPodImagePresent('beap-components:dev', { tryAutoRestore: false }),
    ).resolves.toBeUndefined()

    expect(podExec.runPodmanCli).toHaveBeenCalledWith(
      ['image', 'inspect', 'beap-components:dev', '--format', '{{.Id}}'],
      expect.any(Object),
    )
    expect(podExec.runPodmanCli).toHaveBeenCalledWith(
      ['image', 'inspect', 'localhost/beap-components:dev', '--format', '{{.Id}}'],
      expect.any(Object),
    )
    expect(podExec.runPodmanCli).toHaveBeenCalledWith(
      ['tag', 'localhost/beap-components:dev', 'beap-components:dev'],
      expect.any(Object),
    )
  })
})

describe('isBeapImagePresent', () => {
  test('returns true when only localhost alias exists', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockImplementation(async (args) => {
      const ref = args[2]
      if (ref === 'localhost/beap-components:dev') {
        return { code: 0, stdout: 'id', stderr: '' }
      }
      return { code: 125, stdout: '', stderr: '' }
    })
    await expect(imageDigest.isBeapImagePresent('beap-components:dev')).resolves.toBe(true)
  })
})
