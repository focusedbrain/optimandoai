#!/usr/bin/env node
/**
 * Wrapper around electron-builder that guarantees a fresh packaging directory without wiping Vite output:
 * removes apps/electron-vite-project/dist/release immediately before pack (cross-platform rmSync).
 *
 * Also strips CI / GitHub CI-related env vars for the electron-builder child only (parent shell unchanged).
 * Packaging under CI=true triggers extra publishing/target parallelism that has raced hardlinks into the same
 * app.asar.unpacked paths on Linux; stripping for the child yields predictable local-equivalent packaging even when
 * the outer runner is GitHub Actions / pnpm CI.
 */
const { existsSync, rmSync } = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const releaseDir = path.join(root, 'dist', 'release')

if (existsSync(releaseDir)) {
  rmSync(releaseDir, { recursive: true, force: true })
  console.log('[electron-builder-pack] Removed', releaseDir)
}

const ebEnv = { ...process.env }
for (const k of ['CI', 'GITHUB_ACTIONS', 'GITHUB_CI', 'CONTINUOUS_INTEGRATION']) {
  if (k in ebEnv) delete ebEnv[k]
}
console.log(
  '[electron-builder-pack] Child env: CI/GitHub CI vars stripped so electron-builder uses non-CI packaging (avoids flaky parallel unpack hardlink races on Linux).',
)

const forwardArgs = process.argv.slice(2)
const result = spawnSync(
  'npx',
  ['electron-builder', '-c', 'electron-builder.config.cjs', ...forwardArgs],
  {
    cwd: root,
    stdio: 'inherit',
    env: ebEnv,
    shell: true,
  },
)

if (result.error) {
  console.error('[electron-builder-pack]', result.error)
  process.exit(1)
}
process.exit(result.status === null ? 1 : result.status)
