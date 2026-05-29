#!/usr/bin/env node
/**
 * Release gate — per-distributable third-party notices must be version-controlled
 * and wired into the build paths that actually ship artifacts.
 *
 * Usage: node scripts/check-distributable-notices.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function main() {
  const violations = []

  const edgeNotices = read('packages/beap-pod/THIRD-PARTY-NOTICES')
  const edgeContainerfile = read('packages/beap-pod/Containerfile')
  const relayDockerfile = read('packages/coordination-service/Dockerfile')
  const ebConfig = read('apps/electron-vite-project/electron-builder.config.cjs')
  const rootLicenses = read('THIRD_PARTY_LICENSES.md')

  if (!existsSync(join(ROOT, 'packages/beap-pod/licenses/alpine-linux-notice.txt'))) {
    violations.push('beap-pod: missing licenses/alpine-linux-notice.txt')
  }
  if (!edgeNotices.includes('beap-components')) {
    violations.push('beap-pod/THIRD-PARTY-NOTICES: missing beap-components scope')
  }
  if (!edgeNotices.includes('Podman')) {
    violations.push('beap-pod/THIRD-PARTY-NOTICES: missing Podman external-runtime disclosure')
  }
  if (!edgeContainerfile.includes('COPY packages/beap-pod/THIRD-PARTY-NOTICES')) {
    violations.push('beap-pod/Containerfile: must COPY THIRD-PARTY-NOTICES into image')
  }
  if (!edgeContainerfile.includes('COPY packages/beap-pod/licenses/')) {
    violations.push('beap-pod/Containerfile: must COPY licenses/ into image')
  }
  if (!edgeNotices.includes('AUTO:PNPM_PROD_DEPS_BEGIN')) {
    violations.push('beap-pod/THIRD-PARTY-NOTICES: missing npm scan markers (run generate script)')
  }
  if (edgeNotices.includes('_Run generate script to populate_')) {
    violations.push('beap-pod/THIRD-PARTY-NOTICES: npm table not generated — run generate-third-party-notices.mjs')
  }

  if (!relayDockerfile.includes('THIRD-PARTY-NOTICES')) {
    violations.push('coordination-service/Dockerfile: must COPY THIRD-PARTY-NOTICES (relay)')
  }

  if (!ebConfig.includes('THIRD_PARTY_LICENSES')) {
    violations.push('electron-builder.config.cjs: must bundle THIRD_PARTY_LICENSES via extraResources')
  }
  if (!ebConfig.includes('THIRD_PARTY_LICENSES.md')) {
    violations.push('electron-builder.config.cjs: must bundle THIRD_PARTY_LICENSES.md')
  }

  if (!rootLicenses.includes('### Podman')) {
    violations.push('THIRD_PARTY_LICENSES.md: missing Podman external-tools section')
  }
  if (!existsSync(join(ROOT, 'apps/electron-vite-project/THIRD_PARTY_LICENSES/podman-Apache-2.0.txt'))) {
    violations.push('desktop: missing THIRD_PARTY_LICENSES/podman-Apache-2.0.txt')
  }
  if (!existsSync(join(ROOT, 'docs/LEGAL-REVIEW-FLAGS.md'))) {
    violations.push('docs/LEGAL-REVIEW-FLAGS.md: missing consolidated legal review list')
  }

  if (violations.length > 0) {
    console.error('[distributable-notices] FATAL — attribution gaps detected:')
    for (const v of violations) {
      console.error(`  - ${v}`)
    }
    process.exit(1)
  }

  console.log('[distributable-notices] OK — edge, relay, desktop notice wiring present')
  process.exit(0)
}

main()
