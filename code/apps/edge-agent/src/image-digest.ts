import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defaultPodmanInspectDigest, type PodmanInspectFn } from './podman.js'

const moduleDir = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_BEAP_IMAGE = 'beap-components:dev'

export class ImageDigestMismatchError extends Error {
  readonly code = 'image_digest_mismatch' as const
  readonly expected: string
  readonly actual: string
  readonly imageRef: string

  constructor(imageRef: string, expected: string, actual: string) {
    super(`Image digest mismatch for ${imageRef}: expected ${expected}, found ${actual}`)
    this.name = 'ImageDigestMismatchError'
    this.imageRef = imageRef
    this.expected = expected
    this.actual = actual
  }
}

export class ExpectedDigestMissingError extends Error {
  readonly code = 'expected_digest_missing' as const
  constructor(message: string) {
    super(message)
    this.name = 'ExpectedDigestMissingError'
  }
}

export interface ExpectedDigestFile {
  'beap-components'?: Record<string, string>
  _doc?: string
}

export function resolveAgentExpectedDigestPath(override?: string): string {
  if (override) return override
  if (process.env['WRDESK_AGENT_EXPECTED_DIGEST_JSON']) {
    return process.env['WRDESK_AGENT_EXPECTED_DIGEST_JSON']
  }
  return join(moduleDir, '..', 'expected-image-digest.json')
}

export function loadExpectedDigest(
  imageRef = DEFAULT_BEAP_IMAGE,
  digestPath?: string,
): string {
  const [, tag = 'dev'] = imageRef.includes(':') ? imageRef.split(':', 2) : ['beap-components', 'dev']
  const path = resolveAgentExpectedDigestPath(digestPath)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new ExpectedDigestMissingError(`Missing expected digest file: ${path}`)
  }
  const parsed = JSON.parse(raw) as ExpectedDigestFile
  const resolved = parsed['beap-components']?.[tag]
  if (!resolved || !resolved.startsWith('sha256:')) {
    throw new ExpectedDigestMissingError(`No expected digest for ${imageRef} in ${path}`)
  }
  if (resolved === 'sha256:0000000000000000000000000000000000000000000000000000000000000000') {
    throw new ExpectedDigestMissingError(
      `Placeholder digest for ${imageRef} — run update-image-digest after building the image`,
    )
  }
  return resolved
}

export async function verifyAgentImageDigest(
  imageRef = DEFAULT_BEAP_IMAGE,
  options?: { digestPath?: string; inspect?: PodmanInspectFn },
): Promise<{ expected: string; actual: string }> {
  const expected = loadExpectedDigest(imageRef, options?.digestPath)
  const inspect = options?.inspect ?? defaultPodmanInspectDigest
  const actual = await inspect(imageRef)
  if (!actual) {
    throw new Error(
      `Image ${imageRef} is not available locally. Pull with the digest pinned in install.sh.`,
    )
  }
  if (actual !== expected) {
    throw new ImageDigestMismatchError(imageRef, expected, actual)
  }
  return { expected, actual }
}
