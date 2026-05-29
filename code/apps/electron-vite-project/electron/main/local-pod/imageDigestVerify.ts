/**
 * Runtime digest verification for beap-components images (Stream A — A3).
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { app } from 'electron'

import { resolveBeapPodExpectedDigestPath, resolveBeapPodPackageDir } from './beapPodPaths.js'

const execFileAsync = promisify(execFile)

export const DEFAULT_BEAP_IMAGE = 'beap-components:dev'

export class ImageDigestMismatchError extends Error {
  readonly expected: string
  readonly actual: string
  readonly imageRef: string

  constructor(imageRef: string, expected: string, actual: string) {
    super(
      `BEAP pod image digest mismatch for ${imageRef}: expected ${expected}, found ${actual}. ` +
        'Rebuild the image and update packages/beap-pod/expected-image-digest.json.',
    )
    this.name = 'ImageDigestMismatchError'
    this.imageRef = imageRef
    this.expected = expected
    this.actual = actual
  }
}

export interface ExpectedDigestFile {
  'beap-components'?: Record<string, string>
  _doc?: string
}

export function resolveExpectedDigestPath(override?: string): string {
  if (override) return override
  return resolveBeapPodExpectedDigestPath()
}

export function loadExpectedDigest(
  imageRef = DEFAULT_BEAP_IMAGE,
  digestPath?: string,
): string | null {
  const [name, tag = 'latest'] = imageRef.includes(':')
    ? imageRef.split(':', 2)
    : [imageRef, 'latest']
  const path = resolveExpectedDigestPath(digestPath)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const parsed = JSON.parse(raw) as ExpectedDigestFile
  const digest = parsed[name]?.[tag]
  if (!digest || !digest.startsWith('sha256:')) return null
  if (digest === 'sha256:0000000000000000000000000000000000000000000000000000000000000000') {
    return null
  }
  return digest
}

export type PodmanInspectFn = (imageRef: string) => Promise<string | null>

export async function isBeapImagePresent(imageRef = DEFAULT_BEAP_IMAGE): Promise<boolean> {
  if (process.env['BEAP_SKIP_IMAGE_DIGEST_VERIFY'] === '1') {
    try {
      await execFileAsync(
        'podman',
        ['image', 'inspect', imageRef, '--format', '{{.Id}}'],
        { timeout: 15_000, windowsHide: true },
      )
      return true
    } catch {
      return false
    }
  }
  try {
    const { stdout } = await execFileAsync(
      'podman',
      ['image', 'inspect', imageRef, '--format', '{{.Id}}'],
      { timeout: 15_000, windowsHide: true },
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function tryBuildBeapImageIfDev(imageRef: string): Promise<boolean> {
  if (app.isPackaged || process.env['BEAP_AUTO_BUILD_IMAGE'] !== '1') {
    return false
  }
  const containerfile = join(resolveBeapPodPackageDir(), 'Containerfile')
  if (!existsSync(containerfile)) {
    return false
  }
  const workspaceRoot = resolve(resolveBeapPodPackageDir(), '..', '..')
  console.log(
    `[LOCAL_POD] ${imageRef} missing — BEAP_AUTO_BUILD_IMAGE=1, building from ${containerfile}`,
  )
  try {
    await execFileAsync(
      'podman',
      ['build', '-t', imageRef, '-f', containerfile, workspaceRoot],
      { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    )
    return await isBeapImagePresent(imageRef)
  } catch (err) {
    console.warn('[LOCAL_POD] Auto-build failed:', (err as Error).message ?? err)
    return false
  }
}

/**
 * Require beap-components:dev (or override) in local Podman before play kube.
 * Digest verification is separate; this always runs unless skipImageDigestVerify on pod start.
 */
export async function ensureBeapPodImagePresent(
  imageRef = DEFAULT_BEAP_IMAGE,
  options?: { tryAutoBuild?: boolean },
): Promise<void> {
  if (await isBeapImagePresent(imageRef)) {
    return
  }
  if (options?.tryAutoBuild !== false && (await tryBuildBeapImageIfDev(imageRef))) {
    return
  }
  throw new Error(
    `BEAP pod image ${imageRef} is not available in Podman. Build and load it once per machine:\n` +
      '  From monorepo root: pnpm --filter @repo/beap-pod run docker:build\n' +
      '  Or: podman build -t beap-components:dev -f packages/beap-pod/Containerfile .\n' +
      'Dev auto-build: set BEAP_AUTO_BUILD_IMAGE=1 when Containerfile is present.',
  )
}

export async function defaultPodmanInspectDigest(imageRef: string): Promise<string | null> {
  if (process.env['BEAP_SKIP_IMAGE_DIGEST_VERIFY'] === '1') {
    return loadExpectedDigest(imageRef) ?? 'sha256:skipped'
  }
  try {
    const { stdout } = await execFileAsync(
      'podman',
      ['image', 'inspect', imageRef, '--format', '{{.Digest}}'],
      { timeout: 15_000, windowsHide: true },
    )
    const digest = stdout.trim()
    return digest.length > 0 ? digest : null
  } catch {
    return null
  }
}

/**
 * Verify local image digest matches expected-image-digest.json before pod start.
 * @throws ImageDigestMismatchError when digests differ
 */
export async function verifyBeapImageDigest(
  imageRef = DEFAULT_BEAP_IMAGE,
  options?: {
    digestPath?: string
    inspect?: PodmanInspectFn
  },
): Promise<void> {
  const expected = loadExpectedDigest(imageRef, options?.digestPath)
  if (!expected) {
    console.warn(
      `[LOCAL_POD] Image digest verify skipped — no expected digest for ${imageRef} ` +
        '(placeholder or missing expected-image-digest.json)',
    )
    return
  }

  const inspect = options?.inspect ?? defaultPodmanInspectDigest
  const actual = await inspect(imageRef)
  if (!actual) {
    throw new Error(
      `BEAP pod image ${imageRef} is not available locally. Build with: ` +
        'podman build -t beap-components:dev -f packages/beap-pod/Containerfile .',
    )
  }

  if (actual !== expected) {
    throw new ImageDigestMismatchError(imageRef, expected, actual)
  }

  console.log(`[LOCAL_POD] Image digest verified: ${imageRef} ${actual}`)
}
