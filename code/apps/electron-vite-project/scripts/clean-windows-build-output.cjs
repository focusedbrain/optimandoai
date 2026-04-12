/**
 * Remove the previous win-unpacked tree before electron-builder runs on Windows.
 * Stale or half-finished folders (only locales/resources, no EXE) can otherwise persist.
 */
const fs = require('fs')
const path = require('path')

const BUILD_BASE = 'C:\\build-output'

function getOutputBasename() {
  const cfgPath = path.join(__dirname, '..', 'electron-builder.config.cjs')
  const text = fs.readFileSync(cfgPath, 'utf8')
  const dirM = text.match(/return\s+['"]C:\\\\build-output\\\\((?:bui|build)\d+)['"]/)
  return dirM ? dirM[1] : null
}

if (process.platform !== 'win32') {
  process.exit(0)
}

const basename = getOutputBasename()
if (!basename) {
  console.warn('[clean-windows-build-output] Could not parse output folder from electron-builder.config.cjs')
  process.exit(0)
}

const winUnpacked = path.join(BUILD_BASE, basename, 'win-unpacked')
if (fs.existsSync(winUnpacked)) {
  fs.rmSync(winUnpacked, { recursive: true, force: true })
  console.log('[clean-windows-build-output] Removed', winUnpacked)
}

process.exit(0)
