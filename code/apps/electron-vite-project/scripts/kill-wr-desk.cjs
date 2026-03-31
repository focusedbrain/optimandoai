/**
 * Kills WR Desk and related Electron processes, then deletes old build dirs.
 * Run: node scripts/kill-wr-desk.cjs
 * Or use npm run build (which runs this as prebuild).
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { clearBuildCaches } = require('./clear-build-caches.cjs')

const BUILD_BASE = 'C:\\build-output'

/**
 * Basename of the active Windows output dir (e.g. build010) from electron-builder.config.cjs.
 * Parsed from disk (regex) so we never rely on a stale require() cache or the wrong merged field.
 * We must NOT delete this folder before `electron-builder` runs.
 */
function getActiveWindowsOutputBasename() {
  if (process.platform !== 'win32') return null
  const cfgPath = path.join(__dirname, '..', 'electron-builder.config.cjs')
  try {
    const text = fs.readFileSync(cfgPath, 'utf8')
    // File literally contains JS-escaped backslashes: 'C:\\build-output\\build010'
    const m = text.match(/return\s+['"]C:\\\\build-output\\\\(build\d+)['"]/)
    if (m) return m[1]
  } catch {
    /* fall through */
  }
  try {
    delete require.cache[path.resolve(cfgPath)]
    const cfg = require(cfgPath)
    const out = cfg.directories && cfg.directories.output
    if (!out || typeof out !== 'string') return null
    const normalized = out.split(/[/\\]/).filter(Boolean)
    return normalized[normalized.length - 1] || null
  } catch {
    return null
  }
}

/**
 * Last resort: UAC elevation — stops WSearch and removes a locked tree (typical on Windows for empty win-unpacked).
 */
function tryElevatedDeleteWindowsFolder(folderPath) {
  if (process.platform !== 'win32') return false
  if (process.env.WR_DESK_SKIP_ELEVATED_PURGE === '1' || process.env.CI === 'true') {
    console.warn('[kill-wr-desk] Skipping elevated purge (WR_DESK_SKIP_ELEVATED_PURGE or CI).')
    return false
  }
  const esc = folderPath.replace(/'/g, "''")
  const tmp = path.join(os.tmpdir(), `wr-desk-purge-${process.pid}-${Date.now()}.ps1`)
  fs.writeFileSync(
    tmp,
    `$ErrorActionPreference = 'Stop'
Stop-Service WSearch -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item -LiteralPath '${esc}' -Recurse -Force
Start-Service WSearch -ErrorAction SilentlyContinue
`,
    'utf8',
  )
  const qFile = tmp.replace(/'/g, "''")
  console.warn(
    '[kill-wr-desk] Folder is locked. Approve the Administrator prompt to remove it, or delete it manually after closing Explorer.',
  )
  try {
    execSync(
      `powershell.exe -NoProfile -Command "Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${qFile}'"`,
      { stdio: 'inherit' },
    )
  } catch (e) {
    console.warn('[kill-wr-desk] Elevated purge:', e.message)
    try {
      fs.unlinkSync(tmp)
    } catch (_) {}
    return false
  }
  try {
    fs.unlinkSync(tmp)
  } catch (_) {}
  return !fs.existsSync(folderPath)
}

function sleepSyncSeconds(seconds) {
  try {
    execSync(`timeout /t ${seconds} /nobreak`, { stdio: 'ignore', windowsHide: true })
  } catch {
    /* timeout.exe exits 1 when the delay finishes */
  }
}

/** Stop anything still referencing stale C:\\build-output\\<not-keep> (EXE path, command line, search indexers). */
function killStaleBuildOutputProcesses(keepBasename) {
  if (process.platform !== 'win32') return
  if (!keepBasename) return
  const scriptPath = path.join(__dirname, 'kill-stale-build-output-processes.ps1')
  if (!fs.existsSync(scriptPath)) {
    console.warn('[kill-wr-desk] Missing kill-stale-build-output-processes.ps1')
    return
  }
  try {
    execSync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -KeepBasename "${keepBasename}"`,
      { encoding: 'utf8', stdio: 'inherit' },
    )
  } catch (e) {
    console.warn('[kill-wr-desk] Stale build-output process cleanup:', e.message)
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
  const rmOpts = { recursive: true, force: true }
  for (const name of fs.readdirSync(BUILD_BASE)) {
    const full = path.join(BUILD_BASE, name)
    try {
      if (!fs.statSync(full).isDirectory()) continue
      if (name === keep) {
        console.log(`[kill-wr-desk] Keeping active output dir: ${full}`)
        continue
      }
      let deleted = false
      const attempts = 5
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          fs.rmSync(full, rmOpts)
          deleted = true
          console.log(`[kill-wr-desk] Deleted ${full}`)
          break
        } catch (e) {
          if (attempt < attempts - 1) {
            console.warn(`[kill-wr-desk] Delete retry ${attempt + 1}/${attempts} for ${full}:`, e.message)
            killStaleBuildOutputProcesses(keep)
            sleepSyncSeconds(2)
          } else {
            throw e
          }
        }
      }
      if (!deleted) {
        console.warn(`[kill-wr-desk] Could not delete ${full} after ${attempts} attempts`)
      }
    } catch (e) {
      console.warn(`[kill-wr-desk] Could not delete ${full}:`, e.message)
      if (tryElevatedDeleteWindowsFolder(full)) {
        console.log(`[kill-wr-desk] Deleted (elevated) ${full}`)
      } else {
        console.warn(
          '[kill-wr-desk] Still locked? Close Explorer windows under that path, reboot, or run PowerShell as Administrator: Stop-Service WSearch -Force; Remove-Item -LiteralPath \'' +
            full +
            "' -Recurse -Force; Start-Service WSearch",
        )
      }
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

  const keepBasename = getActiveWindowsOutputBasename()
  killStaleBuildOutputProcesses(keepBasename)
  sleepSyncSeconds(2)

  if (killed) {
    console.log(`[kill-wr-desk] Killed ${killed} process(es)`)
  } else {
    console.log('[kill-wr-desk] No WR Desk processes found')
  }

  deleteOldBuilds()

  if (process.platform === 'win32') {
    const k = getActiveWindowsOutputBasename()
    if (k) {
      const winUnpacked = path.join(BUILD_BASE, k, 'win-unpacked')
      console.log(`[kill-wr-desk] Current Windows packaged app folder: ${winUnpacked}`)
      console.log(
        '[kill-wr-desk] Run the desktop EXE only from win-unpacked above. Extension: chrome://extensions → Load unpacked → …/extension-chromium/' +
          k +
          ' (reload after each build bump).',
      )
    }
  }

  if (process.platform === 'win32') {
    try {
      execSync(
        'powershell.exe -NoProfile -Command "Start-Service WSearch -ErrorAction SilentlyContinue"',
        { stdio: 'ignore' },
      )
    } catch {
      /* non-admin or service already running */
    }
  }
  /** Vite / electron-builder / Electron disk caches (pnpm store prune does not clear these) */
  try {
    clearBuildCaches()
  } catch (e) {
    console.warn('[kill-wr-desk] clearBuildCaches:', e.message)
  }
}

killProcesses()
