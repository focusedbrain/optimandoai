#!/usr/bin/env node
/**
 * `pnpm run build:wrc-test` — the normal build with the built-in WR Code test
 * registry compiled in (WRDESK_WRC_BUILD_FLAVOR=wrc-test for the whole chain:
 * vite define, bundle guard, output folder). The packaged app goes to its own
 * `…-wrc-test` folder, so an existing release build is kept.
 */
const path = require('path')
const { spawnSync } = require('child_process')

const res = spawnSync('pnpm', ['run', 'build'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  // pnpm is a .cmd shim on Windows; spawning it needs a shell there.
  shell: process.platform === 'win32',
  env: { ...process.env, WRDESK_WRC_BUILD_FLAVOR: 'wrc-test' },
})
process.exit(res.status == null ? 1 : res.status)
