/**
 * Resolve packages/beap-pod paths in dev and packaged Electron builds.
 */

import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const mainBundleDir = dirname(fileURLToPath(import.meta.url))

/** Directory containing pod.yaml, seccomp/, expected-image-digest.json. */
export function resolveBeapPodPackageDir(): string {
  if (process.env['BEAP_POD_PACKAGE_DIR']?.trim()) {
    return process.env['BEAP_POD_PACKAGE_DIR'].trim()
  }

  const candidates: string[] = []

  if (app.isPackaged && process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'packages', 'beap-pod'))
  }

  candidates.push(join(process.cwd(), 'packages', 'beap-pod'))

  // Dev: electron-vite-project cwd or workspace root from bundle location.
  candidates.push(resolve(mainBundleDir, '..', '..', '..', '..', 'packages', 'beap-pod'))
  candidates.push(resolve(mainBundleDir, '..', '..', '..', 'packages', 'beap-pod'))

  for (const dir of candidates) {
    if (existsSync(join(dir, 'pod.yaml'))) {
      return dir
    }
  }

  return candidates[0] ?? join(process.cwd(), 'packages', 'beap-pod')
}

export function resolveBeapPodManifestPath(filename = 'pod.yaml'): string {
  if (filename === 'pod.yaml' && process.env['BEAP_POD_MANIFEST']?.trim()) {
    return process.env['BEAP_POD_MANIFEST'].trim()
  }
  if (filename === 'pod-local-verify.yaml' && process.env['BEAP_POD_LOCAL_VERIFY_MANIFEST']?.trim()) {
    return process.env['BEAP_POD_LOCAL_VERIFY_MANIFEST'].trim()
  }
  return join(resolveBeapPodPackageDir(), filename)
}

export function resolveBeapPodExpectedDigestPath(): string {
  if (process.env['BEAP_EXPECTED_DIGEST_JSON']?.trim()) {
    return process.env['BEAP_EXPECTED_DIGEST_JSON'].trim()
  }
  return join(resolveBeapPodPackageDir(), 'expected-image-digest.json')
}

/** Pre-built OCI tarball shipped with packaged apps for silent image restore. */
export function resolveBeapImageArtifactPath(): string {
  if (process.env['BEAP_IMAGE_ARTIFACT']?.trim()) {
    return process.env['BEAP_IMAGE_ARTIFACT'].trim()
  }
  return join(resolveBeapPodPackageDir(), 'beap-components-dev.tar')
}

export function resolveBeapPodRemoteEdgeManifestPath(): string {
  if (process.env['BEAP_REMOTE_EDGE_MANIFEST']?.trim()) {
    return process.env['BEAP_REMOTE_EDGE_MANIFEST'].trim()
  }
  return join(resolveBeapPodPackageDir(), 'pod-remote-edge.yaml')
}

/**
 * Fail closed when pod.yaml (and packaged resource tree) is missing.
 * @throws when manifest assets are not on disk
 */
export function assertBeapPodPackageDirReady(): string {
  const dir = resolveBeapPodPackageDir()
  const manifestPath = join(dir, 'pod.yaml')
  if (!existsSync(manifestPath)) {
    if (app.isPackaged) {
      throw new Error(
        `[LOCAL_POD] Packaged BEAP pod assets missing at ${dir} (pod.yaml ENOENT). ` +
          'Rebuild the desktop installer — resources/packages/beap-pod must ship with the app.',
      )
    }
    throw new Error(`[LOCAL_POD] Cannot find pod.yaml at ${manifestPath}`)
  }
  return dir
}
