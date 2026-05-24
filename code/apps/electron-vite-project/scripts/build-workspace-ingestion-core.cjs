#!/usr/bin/env node
/**
 * Ensures @repo/ingestion-core dist/ matches src/ before Electron bundles main (imports like CONTENT_VALIDATOR_VERSION).
 * Runs from the monorepo root (code/) so `pnpm --filter` resolves the workspace package on all platforms.
 */
const { spawnSync } = require('child_process')
const path = require('path')

const workspaceRoot = path.resolve(__dirname, '..', '..', '..')

console.log('[build-ingestion-core] workspace root:', workspaceRoot)

const result = spawnSync('pnpm', ['--filter', '@repo/ingestion-core', 'run', 'build'], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

if (result.error) {
  console.error('[build-ingestion-core]', result.error.message || result.error)
  process.exit(1)
}
process.exit(result.status === null ? 1 : result.status)
