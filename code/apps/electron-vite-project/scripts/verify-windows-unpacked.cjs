/**
 * After electron-builder on Windows, fail the build if win-unpacked is missing the main EXE.
 * Catches incomplete packaging (e.g. wrong target order, AV quarantine) instead of silent success.
 */
const fs = require('fs')
const path = require('path')

const BUILD_BASE = 'C:\\build-output'

function getOutputBasenameAndExecutableName() {
  const cfgPath = path.join(__dirname, '..', 'electron-builder.config.cjs')
  const text = fs.readFileSync(cfgPath, 'utf8')
  const dirM = text.match(/return\s+['"]C:\\\\build-output\\\\((?:bui|build)\d+)['"]/)
  const exeM = text.match(/executableName:\s*['"]([^'"]+)['"]/)
  return {
    basename: dirM ? dirM[1] : null,
    executableName: exeM ? exeM[1] : 'WR DeskT',
  }
}

if (process.platform !== 'win32') {
  process.exit(0)
}

const { basename, executableName } = getOutputBasenameAndExecutableName()
if (!basename) {
  console.error('[verify-win-unpacked] Could not parse build output folder from electron-builder.config.cjs')
  process.exit(1)
}

const winUnpackedDir = path.join(BUILD_BASE, basename, 'win-unpacked')
const exePath = path.join(winUnpackedDir, `${executableName}.exe`)
if (!fs.existsSync(exePath)) {
  let listing = ''
  try {
    if (fs.existsSync(winUnpackedDir)) {
      listing = '\n  Contents of win-unpacked: ' + fs.readdirSync(winUnpackedDir).join(', ')
    } else {
      listing = '\n  win-unpacked directory does not exist.'
    }
  } catch (_) {
    listing = ''
  }
  console.error(
    `[verify-win-unpacked] MISSING: ${exePath}\n` +
      '  electron-builder did not produce a complete win-unpacked folder.' +
      listing +
      '\n  Run from apps/electron-vite-project: pnpm run build' +
      '\n  If this persists, exclude C:\\build-output from antivirus real-time scan or delete that folder and rebuild.',
  )
  process.exit(1)
}

console.log('[verify-win-unpacked] OK:', exePath)
process.exit(0)
