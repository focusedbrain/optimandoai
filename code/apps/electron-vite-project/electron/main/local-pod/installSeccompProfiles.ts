/**
 * Install BEAP seccomp profiles for local Podman (Stream A — A2).
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { resolveBeapPodPackageDir } from './beapPodPaths.js'

const PROFILE_SOURCES: Record<string, string> = {
  'beap-sealer.json': 'sealer.json',
  'beap-depackager.json': 'depackager.json',
  'beap-pdf-parser.json': 'pdf-parser.json',
  'beap-certifier.json': 'certifier.json',
}

export function resolveSeccompInstallDir(): string {
  if (process.env['BEAP_SECCOMP_DIR']) {
    return process.env['BEAP_SECCOMP_DIR']
  }
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return join(homedir(), '.local', 'share', 'containers', 'seccomp')
  }
  return join(homedir(), '.local', 'share', 'containers', 'seccomp')
}

export function resolveBeapPodSeccompSourceDir(repoRoot?: string): string {
  if (repoRoot) {
    return join(repoRoot, 'packages', 'beap-pod', 'seccomp')
  }
  return join(resolveBeapPodPackageDir(), 'seccomp')
}

/** Copy sealer + depackager (+ certifier) profiles into Podman seccomp directory. */
export function installLocalPodSeccompProfiles(options?: {
  repoRoot?: string
  targetDir?: string
}): void {
  const sourceDir = resolveBeapPodSeccompSourceDir(options?.repoRoot)
  const targetDir = options?.targetDir ?? resolveSeccompInstallDir()
  mkdirSync(targetDir, { recursive: true })

  for (const [destName, srcName] of Object.entries(PROFILE_SOURCES)) {
    const src = join(sourceDir, srcName)
    const dest = join(targetDir, destName)
    if (!existsSync(src)) {
      console.warn(`[LOCAL_POD] Seccomp source missing: ${src}`)
      continue
    }
    copyFileSync(src, dest)
    console.log(`[LOCAL_POD] Installed seccomp profile: ${dest}`)
  }
}
