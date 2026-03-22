/**
 * Removes tool caches that pnpm store prune does NOT touch (Vite, electron-builder,
 * Electron renderer bytecode caches). Safe to run after WR Desk is killed.
 *
 * Run: node scripts/clear-build-caches.cjs
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

function rmDir(p) {
  if (!fs.existsSync(p)) return
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
    console.log('[clear-build-caches] Removed:', p)
  } catch (e) {
    console.warn('[clear-build-caches] Could not remove', p, '-', e.message)
  }
}

/** Basename of extension Vite outDir (e.g. build712) — never delete this folder here. */
function getActiveExtensionOutDir(extensionRoot) {
  try {
    const viteCfg = fs.readFileSync(path.join(extensionRoot, 'vite.config.ts'), 'utf8')
    const m = viteCfg.match(/outDir:\s*['"]([^'"]+)['"]/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function clearBuildCaches() {
  const scriptsDir = __dirname
  const electronRoot = path.join(scriptsDir, '..')
  const codeRoot = path.join(electronRoot, '..', '..')
  const extensionRoot = path.join(electronRoot, '..', 'extension-chromium')
  const keepExt = getActiveExtensionOutDir(extensionRoot)

  /** Prior extension outDir(s) — remove stale unpacked builds; skip active outDir from vite.config.ts */
  const staleExtensionOutDirs = [
    'build1',
    'build1024',
    'build24',
    'build74',
    'build74172',
    'build772',
    'build752',
    'build702',
    'build802',
    'build82',
    'build812',
    'build7972',
  ]
  for (const name of staleExtensionOutDirs) {
    if (keepExt && name === keepExt) {
      console.log('[clear-build-caches] Keeping active extension outDir:', path.join(extensionRoot, name))
      continue
    }
    rmDir(path.join(extensionRoot, name))
  }

  /** Vite / Rollup transform caches */
  const dirs = [
    path.join(electronRoot, '.vite'),
    path.join(electronRoot, 'node_modules', '.vite'),
    path.join(electronRoot, 'node_modules', '.cache'),
    path.join(extensionRoot, '.vite'),
    path.join(extensionRoot, 'node_modules', '.vite'),
    path.join(extensionRoot, 'node_modules', '.cache'),
    path.join(codeRoot, 'node_modules', '.vite'),
    path.join(codeRoot, 'node_modules', '.cache'),
  ]

  for (const d of dirs) {
    rmDir(d)
  }

  /** electron-builder download / tool cache (Windows) */
  const local = process.env.LOCALAPPDATA || ''
  if (local && process.platform === 'win32') {
    rmDir(path.join(local, 'electron-builder', 'Cache'))
    rmDir(path.join(local, '.cache', 'electron-builder'))
  }

  /**
   * Electron Chromium caches under custom userData (see main.ts app.setPath).
   * Do NOT delete all of userData — only bytecode/GPU/HTTP disk cache so the next
   * launch does not reuse stale renderer artifacts.
   */
  const userData = path.join(os.homedir(), '.opengiraffe', 'electron-data')
  for (const sub of ['Code Cache', 'GPUCache', 'Cache']) {
    rmDir(path.join(userData, sub))
  }

  console.log('[clear-build-caches] Done.')
}

module.exports = { clearBuildCaches }

if (require.main === module) {
  clearBuildCaches()
}
