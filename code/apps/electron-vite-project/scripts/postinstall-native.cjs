#!/usr/bin/env node
/**
 * Native module rebuild for Electron (test/build infra).
 * Avoids electron-builder install-app-deps invoking pnpm.cjs directly on Windows
 * (fails with "not a valid Win32 application" when rebuilding bufferutil/utf-8-validate).
 */
const path = require('path')
const { spawnSync } = require('child_process')

const appRoot = path.join(__dirname, '..')

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: appRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  if (res.error) {
    console.error(`[postinstall-native] spawn error (${cmd}): ${res.error.message}`)
    return 1
  }
  return res.status ?? 1
}

const eb = run('npx', ['electron-builder', 'install-app-deps'])
if (eb !== 0) {
  console.warn(
    '[postinstall-native] electron-builder install-app-deps failed (often bufferutil/utf-8-validate on Windows); continuing with electron-rebuild',
  )
}

const rebuild = run('npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3,keytar,canvas'])
process.exit(rebuild === 0 ? 0 : rebuild)
