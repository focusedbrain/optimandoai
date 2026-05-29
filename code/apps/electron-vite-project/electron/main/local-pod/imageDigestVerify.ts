/**
 * Runtime digest verification and self-healing image restore for beap-components.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

import { app } from 'electron'

import {
  resolveBeapPodExpectedDigestPath,
  resolveBeapPodPackageDir,
  resolveBeapImageArtifactPath,
} from './beapPodPaths.js'
import { resolvePodmanCli, runPodmanCli } from './podExec.js'

const execFileAsync = promisify(execFile)

export const DEFAULT_BEAP_IMAGE = 'beap-components:dev'

/** User-visible when image restore fails (no podman commands). */
export const BEAP_IMAGE_RESTORE_USER_MESSAGE =
  'Secure isolation could not be initialized. If this persists, reinstall the application or contact support.'

export class ImageDigestMismatchError extends Error {
  readonly expected: string
  readonly actual: string
  readonly imageRef: string

  constructor(imageRef: string, expected: string, actual: string) {
    super(
      `BEAP pod image digest mismatch for ${imageRef}: expected ${expected}, found ${actual}.`,
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
    return true
  }
  const result = await runPodmanCli(
    ['image', 'inspect', imageRef, '--format', '{{.Id}}'],
    { timeoutMs: 15_000 },
  )
  return result.code === 0 && result.stdout.trim().length > 0
}

function resolveMonorepoRootForBuild(): string | null {
  const packageDir = resolveBeapPodPackageDir()
  let dir = packageDir
  for (let i = 0; i < 8; i++) {
    const containerfile = join(dir, 'packages', 'beap-pod', 'Containerfile')
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(containerfile)) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function tryLoadBeapImageFromArtifact(imageRef: string): Promise<boolean> {
  const artifactPath = resolveBeapImageArtifactPath()
  if (!existsSync(artifactPath)) {
    return false
  }

  console.log(`[LOCAL_POD] Restoring ${imageRef} from bundled artifact`)
  const result = await runPodmanCli(['load', '-i', artifactPath], {
    timeoutMs: 20 * 60_000,
  })
  if (result.code !== 0) {
    console.warn(
      `[LOCAL_POD] Image load failed: ${result.stderr.trim() || result.stdout.trim()}`,
    )
    return false
  }
  return isBeapImagePresent(imageRef)
}

async function tryBuildBeapImageFromWorkspace(imageRef: string): Promise<boolean> {
  if (app.isPackaged && process.env['BEAP_AUTO_BUILD_IMAGE'] !== '1') {
    return false
  }

  const workspaceRoot = resolveMonorepoRootForBuild()
  if (!workspaceRoot) {
    return false
  }

  const containerfile = join(workspaceRoot, 'packages', 'beap-pod', 'Containerfile')
  if (!existsSync(containerfile)) {
    return false
  }

  if (!app.isPackaged && process.env['BEAP_AUTO_BUILD_IMAGE'] === '0') {
    return false
  }

  console.log(`[LOCAL_POD] Restoring ${imageRef} by building from workspace`)
  try {
    const bin = await resolvePodmanCli()
    await execFileAsync(
      bin,
      ['build', '-t', imageRef, '-f', containerfile, workspaceRoot],
      { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    )
    return isBeapImagePresent(imageRef)
  } catch (err) {
    console.warn('[LOCAL_POD] Workspace image build failed:', (err as Error).message ?? err)
    return false
  }
}

/**
 * Restore beap-components:dev when missing: bundled tar (product) then workspace build (dev).
 */
export async function restoreBeapPodImage(imageRef = DEFAULT_BEAP_IMAGE): Promise<boolean> {
  if (await isBeapImagePresent(imageRef)) {
    return true
  }

  if (await tryLoadBeapImageFromArtifact(imageRef)) {
    return true
  }

  if (await tryBuildBeapImageFromWorkspace(imageRef)) {
    return true
  }

  return false
}

/**
 * Require beap-components:dev in local Podman before play kube.
 * Restores automatically when missing; throws only when restore fails.
 */
export async function ensureBeapPodImagePresent(
  imageRef = DEFAULT_BEAP_IMAGE,
  options?: { tryAutoRestore?: boolean },
): Promise<void> {
  if (await isBeapImagePresent(imageRef)) {
    return
  }

  if (options?.tryAutoRestore !== false && (await restoreBeapPodImage(imageRef))) {
    return
  }

  throw new Error(BEAP_IMAGE_RESTORE_USER_MESSAGE)
}

export async function defaultPodmanInspectDigest(imageRef: string): Promise<string | null> {
  if (process.env['BEAP_SKIP_IMAGE_DIGEST_VERIFY'] === '1') {
    return loadExpectedDigest(imageRef) ?? 'sha256:skipped'
  }
  const result = await runPodmanCli(
    ['image', 'inspect', imageRef, '--format', '{{.Digest}}'],
    { timeoutMs: 15_000 },
  )
  if (result.code !== 0) return null
  const digest = result.stdout.trim()
  return digest.length > 0 ? digest : null
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
      `[LOCAL_POD] Image digest verify skipped — no expected digest for ${imageRef}`,
    )
    return
  }

  const inspect = options?.inspect ?? defaultPodmanInspectDigest
  const actual = await inspect(imageRef)
  if (!actual) {
    throw new Error(BEAP_IMAGE_RESTORE_USER_MESSAGE)
  }

  if (actual !== expected) {
    throw new ImageDigestMismatchError(imageRef, expected, actual)
  }

  console.log(`[LOCAL_POD] Image digest verified: ${imageRef} ${actual}`)
}

/** @deprecated dev-only alias — use restoreBeapPodImage */
export async function tryBuildBeapImageIfDev(imageRef = DEFAULT_BEAP_IMAGE): Promise<boolean> {
  return tryBuildBeapImageFromWorkspace(imageRef)
}
