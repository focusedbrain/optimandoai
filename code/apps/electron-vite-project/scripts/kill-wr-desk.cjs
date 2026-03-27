/**
 * Kills WR Desk and related Electron processes, then deletes old build dirs.
 * Run: node scripts/kill-wr-desk.cjs
 * Or use npm run build (which runs this as prebuild).
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const { clearBuildCaches } = require('./clear-build-caches.cjs')

const BUILD_BASE = 'C:\\build-output'

/**
 * Basename of the active Windows output dir (e.g. build301) from electron-builder.config.cjs.
 * We must NOT delete this folder before `electron-builder` runs — that leaves C:\build-output\… empty
 * if the build fails or if only this script is run; electron-builder overwrites files in place.
 */
function getActiveWindowsOutputBasename() {
  if (process.platform !== 'win32') return null
  try {
    const cfgPath = path.join(__dirname, '..', 'electron-builder.config.cjs')
    const cfg = require(cfgPath)
    const out = cfg.directories && cfg.directories.output
    if (!out || typeof out !== 'string') return null
    const normalized = out.split(/[/\\]/).filter(Boolean)
    return normalized[normalized.length - 1] || null
  } catch {
    return null
  }
}

/** Remove other release folders under C:\\build-output; keep the configured output dir. */
function deleteOldBuilds() {
  if (process.platform !== 'win32') return
  if (!fs.existsSync(BUILD_BASE)) return
  const keep = getActiveWindowsOutputBasename()
  if (!keep) {
    console.warn(
      '[kill-wr-desk] Skipping build-output cleanup (could not read directories.output). Remove old folders manually if needed.'
    )
    return
  }
  for (const name of fs.readdirSync(BUILD_BASE)) {
    const full = path.join(BUILD_BASE, name)
    try {
      if (!fs.statSync(full).isDirectory()) continue
      if (name === keep) {
        console.log(`[kill-wr-desk] Keeping active output dir: ${full}`)
        continue
      }
      fs.rmSync(full, { recursive: true, force: true })
      console.log(`[kill-wr-desk] Deleted ${full}`)
    } catch (e) {
      console.warn(`[kill-wr-desk] Could not delete ${full}:`, e.message)
    }
  }
}

function killProcesses() {
  if (process.platform !== 'win32') {
    const unixKill = path.join(__dirname, 'kill-wr-desk-unix.sh')
    if (fs.existsSync(unixKill)) {
      try {
        execSync(`bash "${unixKill}"`, { stdio: 'inherit' })
      } catch (e) {
        console.warn('[kill-wr-desk] unix kill script:', e.message)
      }
    } else {
      console.warn('[kill-wr-desk] Missing kill-wr-desk-unix.sh')
    }
    try {
      clearBuildCaches()
    } catch (e) {
      console.warn('[kill-wr-desk] clearBuildCaches:', e.message)
    }
    return
  }

  const names = ['WR DeskT', 'WR Desk', 'electron']
  let killed = 0

  for (const name of names) {
    try {
      const out = execSync(
        `Get-Process -Name "${name}*" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; Write-Host $_.Id }`,
        { shell: 'powershell.exe', encoding: 'utf8' }
      )
      const ids = out.trim().split(/\s+/).filter(Boolean)
      if (ids.length) {
        console.log(`[kill-wr-desk] Killed ${name}: ${ids.join(', ')}`)
        killed += ids.length
      }
    } catch (_) {
      // Process not found or already dead
    }
  }

  // Also kill any process whose path contains build-output (WR Desk installs)
  try {
    const out = execSync(
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*build-output*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host $_.ProcessId }`,
      { shell: 'powershell.exe', encoding: 'utf8' }
    )
    const ids = out.trim().split(/\s+/).filter(Boolean)
    if (ids.length) {
      console.log(`[kill-wr-desk] Killed build-output processes: ${ids.join(', ')}`)
      killed += ids.length
    }
  } catch (_) {}

  if (killed) {
    console.log(`[kill-wr-desk] Killed ${killed} process(es)`)
  } else {
    console.log('[kill-wr-desk] No WR Desk processes found')
  }

  deleteOldBuilds()
  /** Vite / electron-builder / Electron disk caches (pnpm store prune does not clear these) */
  try {
    clearBuildCaches()
  } catch (e) {
    console.warn('[kill-wr-desk] clearBuildCaches:', e.message)
  }
}

killProcesses()
