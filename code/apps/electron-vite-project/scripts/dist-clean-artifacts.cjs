#!/usr/bin/env node
/**
 * Remove Vite / electron-vite output dirs so packaged extraResources (e.g. google-oauth-client-id.txt)
 * always come from the current prepare-google-oauth + vite build, not stale dist trees.
 */
const { existsSync, rmSync } = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
for (const d of ['dist', 'dist-electron']) {
  const p = path.join(root, d)
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true })
    console.log('[dist-clean-artifacts] Removed', p)
  }
}
