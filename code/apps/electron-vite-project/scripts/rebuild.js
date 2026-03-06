#!/usr/bin/env node
/**
 * Cross-platform rebuild helper.
 * Kills any running WR Desk process and removes stale build output
 * before rebuilding — equivalent to the old Windows-only PowerShell rebuild script.
 */
const { execSync } = require('child_process')
const { existsSync, rmSync } = require('fs')
const path = require('path')
const os = require('os')

// 1. Kill running WR Desk processes
try {
  if (process.platform === 'win32') {
    execSync('taskkill /F /IM "WR Desk*" /T 2>nul', { stdio: 'ignore' })
  } else {
    execSync('pkill -f "WR Desk" 2>/dev/null || true', { stdio: 'ignore', shell: true })
  }
  console.log('[rebuild] Killed running WR Desk processes (if any)')
} catch {
  // Ignore — process may not have been running
}

// 2. Remove stale unpacked build output
const dirs = [
  path.join(__dirname, '..', 'dist', 'release', 'linux-unpacked'),
  path.join(__dirname, '..', 'dist', 'release', 'win-unpacked'),
  path.join(__dirname, '..', 'dist', 'release', 'mac'),
]
for (const dir of dirs) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
    console.log('[rebuild] Removed:', dir)
  }
}
