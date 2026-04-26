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
    executableName: exeM ? exeM[1] : 'WRDeskT',
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

/** Prefer current config name; accept legacy `WR DeskT.exe` until everyone rebuilds. */
function resolvePackagedExePath() {
  const tryNames = [executableName, 'WRDeskT', 'WR DeskT']
  const seen = new Set()
  for (const n of tryNames) {
    if (seen.has(n)) continue
    seen.add(n)
    const p = path.join(winUnpackedDir, `${n}.exe`)
    if (fs.existsSync(p)) return p
  }
  return null
}

const exePath = resolvePackagedExePath()

/** Electron always ships these next to the EXE; missing => incomplete tree (AV, or portable-only build). */
const REQUIRED_PEER_FILES = [{ name: 'ffmpeg.dll', minBytes: 64 * 1024 }]

function verifyRequiredPeers() {
  for (const { name, minBytes } of REQUIRED_PEER_FILES) {
    const p = path.join(winUnpackedDir, name)
    if (!fs.existsSync(p)) {
      return { ok: false, detail: `missing ${name}` }
    }
    try {
      const s = fs.statSync(p)
      if (s.size < minBytes) {
        return { ok: false, detail: `${name} too small (${s.size}B)` }
      }
    } catch (e) {
      return { ok: false, detail: `cannot stat ${name}: ${e.message}` }
    }
  }
  return { ok: true }
}

if (!exePath) {
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
  const expected = path.join(winUnpackedDir, `${executableName}.exe`)
  console.error(
    `[verify-win-unpacked] MISSING main EXE (tried ${executableName}, WRDeskT, WR DeskT): ${expected}\n` +
      '  electron-builder did not produce a complete win-unpacked folder.' +
      listing +
      '\n  Run from apps/electron-vite-project: pnpm run build' +
      '\n  If win-unpacked only has locales/ and resources/: you may have run build:portable with --win portable only (fixed: build:portable now uses dir+portable), or antivirus removed .exe/.dll from this folder.' +
      '\n  Chrome "Load unpacked" must use apps/extension-chromium/buildNN — never win-unpacked.' +
      '\n  Exclude C:\\build-output from antivirus, delete the buildNN folder, rebuild.',
  )
  process.exit(1)
}

const peers = verifyRequiredPeers()
if (!peers.ok) {
  console.error(
    `[verify-win-unpacked] INCOMPLETE win-unpacked (${peers.detail}). Expected ${executableName}.exe (or legacy WR DeskT.exe) plus Chromium DLLs next to locales/.\n` +
      '  Fix: pnpm run build (or pnpm run build:portable), exclude C:\\build-output from AV, delete C:\\build-output\\' +
      basename +
      ' and retry.\n' +
      '  Chrome extension path is apps\\extension-chromium\\' +
      basename +
      ' — not win-unpacked.',
  )
  process.exit(1)
}

const expectedConfigured = path.join(winUnpackedDir, `${executableName}.exe`)
if (exePath !== expectedConfigured) {
  console.log(
    `[verify-win-unpacked] Using ${path.basename(exePath)}; fresh builds emit ${executableName}.exe per electron-builder.config.cjs.`,
  )
}

/** Real Electron apps are tens of MB; 0-byte or tiny files usually mean AV, locked tree, or a failed rename. */
const MIN_EXE_BYTES = 8 * 1024 * 1024
let st
try {
  st = fs.statSync(exePath)
} catch (e) {
  console.error('[verify-win-unpacked] Could not stat EXE:', exePath, e.message)
  process.exit(1)
}
if (st.size < MIN_EXE_BYTES) {
  let listing = ''
  try {
    const exes = fs
      .readdirSync(winUnpackedDir)
      .filter((f) => f.toLowerCase().endsWith('.exe'))
      .map((f) => {
        try {
          const p = path.join(winUnpackedDir, f)
          return `${f}=${fs.statSync(p).size}B`
        } catch {
          return f
        }
      })
    listing = '\n  .exe files in win-unpacked: ' + (exes.length ? exes.join(', ') : '(none)')
  } catch (_) {
    listing = ''
  }
  console.error(
    `[verify-win-unpacked] INVALID EXE (too small): ${exePath} size=${st.size}B (expected >= ${MIN_EXE_BYTES}B).` +
      listing +
      '\n  Typical causes: antivirus quarantine, OneDrive/cloud sync on C:\\build-output, or interrupted electron-builder.' +
      '\n  Exclude C:\\build-output from real-time scan, delete the buildNN folder, run: pnpm run build',
  )
  process.exit(1)
}

let mz = Buffer.alloc(0)
try {
  const fd = fs.openSync(exePath, 'r')
  try {
    mz = Buffer.alloc(2)
    fs.readSync(fd, mz, 0, 2, 0)
  } finally {
    fs.closeSync(fd)
  }
} catch (e) {
  console.error('[verify-win-unpacked] Could not read EXE header:', exePath, e.message)
  process.exit(1)
}
if (mz[0] !== 0x4d || mz[1] !== 0x5a) {
  console.error(
    `[verify-win-unpacked] INVALID EXE (not a PE/MZ file): ${exePath} first_bytes=${mz[0]},${mz[1]}`,
  )
  process.exit(1)
}

console.log('[verify-win-unpacked] OK:', exePath, `size=${st.size}`)
console.log(
  '[verify-win-unpacked] The desktop EXE is inside win-unpacked (not the git repo root). ' +
    'Double-click:',
)
console.log('  ' + exePath)

/** Helps when users open only `C:\\build-output\\buildNN` and expect the EXE next to builder-debug.yml. */
try {
  const marker = path.join(BUILD_BASE, basename, 'WHERE_IS_THE_EXE.txt')
  const body = [
    'WR Desk Windows unpacked build (desktop Electron app — NOT the Chrome extension).',
    '',
    'Run the desktop app from (double-click):',
    exePath,
    '',
    'Chrome MV3 "Load unpacked": use folder (must contain manifest.json):',
    path.join(path.resolve(__dirname, '..', '..', 'extension-chromium'), basename),
    'Do NOT point Chrome at win-unpacked (that is the desktop app).',
    '',
    `EXE size should be large (about ${Math.round(st.size / (1024 * 1024))} MB). 0 KB often means antivirus quarantined the file — exclude C:\\build-output.`,
    '',
    'The EXE sits next to ffmpeg.dll and .pak files inside win-unpacked. If you only see locales/ and resources/, the build was incomplete — run pnpm run build again.',
    '',
  ].join('\r\n')
  // UTF-8 BOM so Notepad always shows text (some viewers treat BOM-less UTF-8 as empty).
  fs.writeFileSync(marker, '\uFEFF' + body, 'utf8')
  const fd = fs.openSync(marker, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  console.log('[verify-win-unpacked] Wrote pointer file:', marker)
} catch (e) {
  console.warn('[verify-win-unpacked] Could not write WHERE_IS_THE_EXE.txt:', e.message)
}

process.exit(0)
