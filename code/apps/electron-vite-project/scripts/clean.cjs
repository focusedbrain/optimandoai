#!/usr/bin/env node
/**
 * Cross-platform clean script.
 * Kills running WR Desk processes, deletes build output, dist, and caches
 * so the next build uses fresh binaries.
 */
const { execSync } = require('child_process')
const { existsSync, rmSync } = require('fs')
const path = require('path')
const os = require('os')

const appDir = path.join(__dirname, '..')
const { clearBuildCaches } = require('./clear-build-caches.cjs')

// 1. Kill running WR Desk processes
try {
  if (process.platform === 'win32') {
    execSync('taskkill /F /IM "WR Desk*" /T 2>nul', { stdio: 'ignore' })
  } else {
    execSync('pkill -f "WR Desk" 2>/dev/null || true', { stdio: 'ignore', shell: true })
  }
  console.log('[clean] Killed running WR Desk processes (if any)')
} catch {
  // Ignore
}

// Wait for processes to finish
if (process.platform === 'win32') {
  try {
    execSync('timeout /t 2 /nobreak >nul', { stdio: 'ignore' })
  } catch {}
}

// 2. Remove build output — on Windows remove entire C:\build-output (all builds)
if (process.platform === 'win32') {
  const buildOutputRoot = 'C:\\build-output'
  if (existsSync(buildOutputRoot)) {
    try {
      rmSync(buildOutputRoot, { recursive: true, force: true, maxRetries: 3 })
      console.log('[clean] Removed:', buildOutputRoot, '(all builds)')
    } catch (err) {
      console.warn('[clean] Could not remove', buildOutputRoot, err.message)
    }
  }
} else {
  const releaseDir = path.join(appDir, 'dist', 'release')
  if (existsSync(releaseDir)) {
    try {
      rmSync(releaseDir, { recursive: true, force: true })
      console.log('[clean] Removed:', releaseDir)
    } catch (err) {
      console.warn('[clean] Could not remove', releaseDir, err.message)
    }
  }
}

// 3. Remove dist, dist-electron
for (const d of ['dist', 'dist-electron']) {
  const full = path.join(appDir, d)
  if (existsSync(full)) {
    try {
      rmSync(full, { recursive: true, force: true })
      console.log('[clean] Removed:', d)
    } catch (err) {
      console.warn('[clean] Could not remove', d, err.message)
    }
  }
}

// 4–5. Vite / extension / electron-builder / Electron renderer caches (shared with kill-wr-desk prebuild)
try {
  clearBuildCaches()
} catch (err) {
  console.warn('[clean] clearBuildCaches:', err.message)
}

// 6. Remove native module build dirs (forces fresh rebuild of better-sqlite3, keytar, canvas)
const nativeBuildDirs = [
  path.join(appDir, 'node_modules', 'better-sqlite3', 'build'),
  path.join(appDir, 'node_modules', 'keytar', 'build'),
  path.join(appDir, 'node_modules', 'canvas', 'build'),
]
for (const p of nativeBuildDirs) {
  if (existsSync(p)) {
    try {
      rmSync(p, { recursive: true, force: true })
      console.log('[clean] Removed native build:', path.relative(appDir, p))
    } catch (err) {
      console.warn('[clean] Could not remove', p, err.message)
    }
  }
}

// 7. Remove dist-build (legacy)
const distBuild = path.join(appDir, 'dist-build')
if (existsSync(distBuild)) {
  try {
    rmSync(distBuild, { recursive: true, force: true })
    console.log('[clean] Removed:', 'dist-build')
  } catch (err) {
    console.warn('[clean] Could not remove dist-build', err.message)
  }
}

console.log('[clean] Done. Run npm run build or npm run build:clean for a fresh build.')
console.log('[clean] Note: Extension (apps/extension-chromium) has its own build. Run "cd apps/extension-chromium && npm run build" if needed.')
