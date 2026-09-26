#!/usr/bin/env node
/**
 * Runs after `vite build`: the main bundle must match its WR Code flavor.
 * A release bundle must not contain the built-in test registry (its seed
 * marker); a wrc-test bundle must contain it. Anything else fails the build.
 */
const fs = require('fs')
const path = require('path')

const MARKER = 'optirando-wrc-test-registry/v1'
const flavor = process.env.WRDESK_WRC_BUILD_FLAVOR === 'wrc-test' ? 'wrc-test' : 'release'
const bundleDir = path.join(__dirname, '..', 'dist-electron')

function scriptFiles(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) out.push(...scriptFiles(full))
    else if (/\.(c|m)?js$/.test(name)) out.push(full)
  }
  return out
}

if (!fs.existsSync(bundleDir)) {
  console.error(`[verify-wrc-build-flavor] Missing ${bundleDir}; run vite build first.`)
  process.exit(1)
}

const files = scriptFiles(bundleDir)
const carriers = files.filter((f) => fs.readFileSync(f, 'utf8').includes(MARKER))

if (flavor === 'release' && carriers.length > 0) {
  console.error('[verify-wrc-build-flavor] FAIL: the release bundle contains the WR Code test registry:')
  for (const f of carriers) console.error(`  ${path.relative(bundleDir, f)}`)
  process.exit(1)
}
if (flavor === 'wrc-test' && carriers.length === 0) {
  console.error('[verify-wrc-build-flavor] FAIL: the wrc-test bundle does not contain the WR Code test registry.')
  process.exit(1)
}
console.log(
  `[verify-wrc-build-flavor] OK: ${flavor} bundle (${files.length} files) ` +
    (flavor === 'release' ? 'contains no WR Code test registry' : 'contains the WR Code test registry'),
)
