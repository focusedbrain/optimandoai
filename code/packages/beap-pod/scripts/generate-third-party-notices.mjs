#!/usr/bin/env node
/**
 * Regenerate the npm dependency section of packages/beap-pod/THIRD-PARTY-NOTICES
 * from pnpm production tree for @repo/beap-pod and its workspace dependencies.
 *
 * Usage (repo root): node packages/beap-pod/scripts/generate-third-party-notices.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(__dirname, '..')
const REPO_ROOT = join(PKG_ROOT, '../..')
const NOTICES_PATH = join(PKG_ROOT, 'THIRD-PARTY-NOTICES')
const BEGIN = '<!-- AUTO:PNPM_PROD_DEPS_BEGIN -->'
const END = '<!-- AUTO:PNPM_PROD_DEPS_END -->'

const COPYLEFT = /\b(GPL|AGPL|LGPL)\b/i
const UNRECOGNIZED = /^\(.*\)$|WTFPL|UNLICENSED|UNKNOWN/i

function loadPnpmLicenseJson() {
  const raw = execSync('pnpm licenses list --filter @repo/beap-pod... --prod --json', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  return JSON.parse(raw)
}

function flattenByLicense(licenseMap) {
  const rows = []
  for (const [license, packages] of Object.entries(licenseMap)) {
    for (const pkg of packages) {
      const version = pkg.versions?.[0] ?? ''
      rows.push({ name: pkg.name, version, license })
    }
  }
  return filterEdgeImageRows(rows)
}

/** Edge image is Linux/musl — exclude other platforms' optional native binaries from notices. */
function filterEdgeImageRows(rows) {
  return rows
    .filter((row) => {
      if (row.name.startsWith('@napi-rs/canvas-') && !row.name.includes('musl')) {
        return false
      }
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

function legalFlags(rows) {
  const flags = []
  for (const row of rows) {
    if (COPYLEFT.test(row.license)) {
      flags.push(`${row.name}@${row.version}: ${row.license} (copyleft — legal review)`)
    } else if (UNRECOGNIZED.test(row.license)) {
      flags.push(`${row.name}@${row.version}: ${row.license} (unusual — legal review)`)
    }
  }
  return flags
}

function renderTable(rows) {
  const lines = [
    '| Package | Resolved version | SPDX / npm license |',
    '|---------|------------------|-------------------|',
  ]
  for (const row of rows) {
    lines.push(`| \`${row.name}\` | ${row.version || '(workspace)'} | ${row.license} |`)
  }
  return lines.join('\n')
}

function renderSection(rows) {
  const generated = new Date().toISOString().slice(0, 10)
  const flags = legalFlags(rows)
  let block = [
    BEGIN,
    '',
    `_Generated ${generated} via \`pnpm licenses list --filter @repo/beap-pod... --prod\`. Do not edit by hand._`,
    '',
    '_Platform-specific `@napi-rs/canvas-*` native binaries for non-Linux targets are omitted; the edge image is built from `node:20-alpine` (Linux/musl)._',
    '',
    renderTable(rows),
    '',
  ]
  if (flags.length > 0) {
    block.push('**Automated scanner — legal review flags (npm tree):**', '')
    for (const f of flags) {
      block.push(`- ${f}`)
    }
    block.push('')
  } else {
    block.push(
      '_Automated scanner: no GPL/AGPL/LGPL identifiers in npm license fields for this tree._',
      '',
    )
  }
  block.push(END)
  return block.join('\n')
}

function main() {
  const licenseMap = loadPnpmLicenseJson()
  const rows = flattenByLicense(licenseMap)
  const section = renderSection(rows)

  let notices = readFileSync(NOTICES_PATH, 'utf8')
  if (!notices.includes(BEGIN) || !notices.includes(END)) {
    console.error(`[beap-pod-licenses] Markers missing in ${NOTICES_PATH}`)
    process.exit(1)
  }
  const re = new RegExp(`${BEGIN}[\\s\\S]*?${END}`)
  notices = notices.replace(re, section)
  writeFileSync(NOTICES_PATH, notices, 'utf8')
  console.log(`[beap-pod-licenses] Updated ${rows.length} packages in THIRD-PARTY-NOTICES`)
  const flags = legalFlags(rows)
  if (flags.length > 0) {
    console.warn('[beap-pod-licenses] Legal review flags:')
    for (const f of flags) console.warn(`  - ${f}`)
  }
}

main()
