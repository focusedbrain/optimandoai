#!/usr/bin/env node
/**
 * Export beap-components:dev as an OCI tarball for packaged desktop self-heal.
 *
 * Usage (after docker:build):
 *   node packages/beap-pod/scripts/export-image-artifact.mjs
 *
 * Output: packages/beap-pod/beap-components-dev.tar
 * Ship via electron-builder extraResources (included when present).
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_BEAP_IMAGE,
  beapImageRefCandidates,
  ensurePodmanImageAliases,
  resolvePodmanImageRef,
} from './beap-image-ref.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const beapPodDir = join(scriptDir, '..')
const outPath = join(beapPodDir, 'beap-components-dev.tar')
const imageRef = DEFAULT_BEAP_IMAGE

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit', windowsHide: true })
}

function runCapture(cmd, args) {
  execFileSync(cmd, args, { stdio: 'pipe', windowsHide: true })
}

function resolvePodman() {
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'RedHat', 'Podman', 'podman.exe'),
      'podman',
    ]
    for (const c of candidates) {
      try {
        run(c, ['version'])
        return c
      } catch {
        /* try next */
      }
    }
  } else {
    return 'podman'
  }
  throw new Error('podman not found — install Podman and build the image first')
}

const podman = resolvePodman()

const podmanRun = (args) => {
  if (args[0] === 'tag') {
    run(podman, args)
    return
  }
  runCapture(podman, args)
}

const resolved = resolvePodmanImageRef(beapImageRefCandidates(imageRef), (ref) => {
  runCapture(podman, ['image', 'inspect', ref])
  return ref
})

if (!resolved) {
  console.error(
    `[export-image-artifact] ${imageRef} not found (also tried localhost/ alias) — run: pnpm --filter @repo/beap-pod docker:build`,
  )
  process.exit(1)
}

ensurePodmanImageAliases(imageRef, podmanRun)

run(podman, ['save', '-o', outPath, resolved])

if (!existsSync(outPath)) {
  console.error('[export-image-artifact] save failed — output missing:', outPath)
  process.exit(1)
}

console.log('[export-image-artifact] OK —', outPath, `(saved ${resolved})`)
