#!/usr/bin/env node
/**
 * Remove Vite / electron-vite output dirs so packaged extraResources (e.g. google-oauth-client-id.txt)
 * always come from the current prepare-google-oauth + vite build, not stale dist trees.
 *
 * Also removes dist/release (electron-builder linux-unpacked / AppImage prep, etc.) so repeated packaging
 * does not hit EEXIST hardlink cleanup failures from stale app.asar.unpacked trees.
 */
const { existsSync, rmSync } = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const dirs = [
  path.join(root, 'dist', 'release'),
  path.join(root, 'dist'),
  path.join(root, 'dist-electron'),
]
for (const p of dirs) {
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true })
    console.log('[dist-clean-artifacts] Removed', p)
  }
}
