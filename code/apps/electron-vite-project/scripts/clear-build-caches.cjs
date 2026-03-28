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

/** Basename of extension Vite outDir (e.g. build0012) — never delete this folder here. */
function getActiveExtensionOutDir(extensionRoot) {
  try {
    const viteCfg = fs.readFileSync(path.join(extensionRoot, 'vite.config.ts'), 'utf8')
    const m = viteCfg.match(/outDir:\s*['"]([^'"]+)['"]/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** Names like build2, build542, build02 — legacy Vite outputs under extension-chromium. */
const EXTENSION_BUILD_DIR_RE = /^build\d+$/

/**
 * Remove every `build<number>` directory except the active outDir from vite.config.ts.
 * A static list cannot keep up; leaving old folders causes Chrome "Load unpacked" to
 * keep pointing at stale JS (parsing pipeline never updates).
 */
function removeStaleExtensionBuildDirs(extensionRoot, keepBasename) {
  if (!fs.existsSync(extensionRoot)) return
  let entries
  try {
    entries = fs.readdirSync(extensionRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const name = ent.name
    if (!EXTENSION_BUILD_DIR_RE.test(name)) continue
    const full = path.join(extensionRoot, name)
    if (keepBasename && name === keepBasename) {
      console.log('[clear-build-caches] Keeping active extension outDir:', full)
      continue
    }
    rmDir(full)
  }
}

function clearBuildCaches() {
  const scriptsDir = __dirname
  const electronRoot = path.join(scriptsDir, '..')
  const codeRoot = path.join(electronRoot, '..', '..')
  const extensionRoot = path.join(electronRoot, '..', 'extension-chromium')
  const keepExt = getActiveExtensionOutDir(extensionRoot)
  removeStaleExtensionBuildDirs(extensionRoot, keepExt)
  if (keepExt) {
    console.log(
      '[clear-build-caches] Chrome: load unpacked from',
      path.join(extensionRoot, keepExt),
      '— then chrome://extensions → Reload (MV3 keeps old JS until reload).',
    )
  } else {
    console.warn('[clear-build-caches] Could not read extension outDir from vite.config.ts; stale build dirs may remain.')
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
