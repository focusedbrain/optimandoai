/**
 * Kills WR Desk and related Electron processes, then deletes old build dirs.
 * Run: node scripts/kill-wr-desk.cjs
 * Or use npm run build (which runs this as prebuild).
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const BUILD_BASE = 'C:\\build-output'
const OLD_BUILDS = ['build12', 'build17', 'build20', 'build33', 'build56', 'build105', 'build004', 'build003', 'build005', 'build006', 'build007', 'build008', 'build009']

function deleteOldBuilds() {
  if (process.platform !== 'win32') return
  for (const dir of OLD_BUILDS) {
    const full = path.join(BUILD_BASE, dir)
    if (fs.existsSync(full)) {
      try {
        fs.rmSync(full, { recursive: true })
        console.log(`[kill-wr-desk] Deleted ${full}`)
      } catch (e) {
        console.warn(`[kill-wr-desk] Could not delete ${full}:`, e.message)
      }
    }
  }
}

function killProcesses() {
  if (process.platform !== 'win32') {
    console.log('[kill-wr-desk] Skipping on non-Windows')
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
}

killProcesses()
