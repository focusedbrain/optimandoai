import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROFILE_SOURCES: Record<string, string> = {
  'beap-depackager.json': 'depackager.json',
  'beap-pdf-parser.json': 'pdf-parser.json',
  'beap-certifier.json': 'certifier.json',
}

export function resolveSeccompInstallDir(): string {
  if (process.env['BEAP_SECCOMP_DIR']) return process.env['BEAP_SECCOMP_DIR']
  return join(homedir(), '.local', 'share', 'containers', 'seccomp')
}

export function resolveBeapSeccompSourceDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  return join(moduleDir, 'seccomp')
}

export function installAgentPodSeccompProfiles(): void {
  const sourceDir = resolveBeapSeccompSourceDir()
  const targetDir = resolveSeccompInstallDir()
  mkdirSync(targetDir, { recursive: true })
  for (const [destName, srcName] of Object.entries(PROFILE_SOURCES)) {
    const src = join(sourceDir, srcName)
    const dest = join(targetDir, destName)
    if (!existsSync(src)) {
      console.warn(JSON.stringify({ level: 'warn', source: 'agent', event: 'seccomp_missing', path: src }))
      continue
    }
    copyFileSync(src, dest)
  }
}
