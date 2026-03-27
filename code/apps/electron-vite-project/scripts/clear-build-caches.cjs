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

/** Basename of extension Vite outDir (e.g. build2) — never delete this folder here. */
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
    'build18817',
    'build1917',
    'build1687',
    'build175',
    'build15575',
    'build18875',
    'build9445',
    'build15',
    'build2315',
    'build0015',
    'build005',
    'build5',
    'build2334',
    'build224',
    'build774',
    'build554',
    'build124',
    'build6',
    'build1',
    'build1024',
    'build17',
    'build2',
    'build24',
    'build74',
    'build74172',
    'build772',
    'build752',
    'build702',
    'build802',
    'build807',
    'build82',
    'build12',
    'build354',
    'build4',
    'build0004',
    'build0005',
    'build0105',
    'build085',
    'build812',
    'build712',
    'build72',
    'build7972',
    'build24977',
    'build1557',
    'build0001',
    'build441',
    'build371',
    'build375',
    'build991',
    'build665',
    'build995',
    'build775',
    'build1057',
    'build107',
    'build195',
    'build19957',
    'build197777',
    'build15555777',
    'build119589',
    'build12407',
    'build1003',
    'build13009',
    'build1509',
    'build1209',
    'build129',
    'build29',
    'build39',
    'build377',
    'build119',
    'build9',
    'build0079',
    'build179',
    'build100009',
    'build1354009',
    'build139',
    'build1007',
    'build691',
    'build115',
    'build2455',
    'build1175',
    'build1775',
    'build295',
    'build2333',
    'build2553',
    'build23',
    'build3',
    'build222',
    'build1115',
    'build2664',
    'build7543',
    'build43',
    'build143',
    'build1156',
    'build2225',
    'build442',
    'build882',
    'build992',
    'build002',
    'build8802',
    'build2227',
    'build2557',
    'build22227',
    'build5427',
    'build56',
    'build5667',
    'build1756',
    'build06',
    'build54606',
    'build27',
    'build975',
    'build1045',
    'build215',
    'build1555',
    'build1475',
    'build1875417',
    'build766',
    'build556',
    'build5686',
    'build246',
    /** Previous active outDir — safe to remove after bumping vite outDir */
    'build006',
    'build045',
    'build845',
    'build945',
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
