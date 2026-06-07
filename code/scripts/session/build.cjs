#!/usr/bin/env node
/**
 * Full orchestrator packaging build for two-box sessions (test-infra only).
 * Kills stale WR Desk processes, runs `pnpm run build` in electron-vite-project,
 * and returns provenance read back from the compiled main bundle.
 */
const { execSync, spawnSync } = require('node:child_process')
const { spawnPnpmSync, formatSpawnFailure } = require('./lib.cjs')
const fs = require('node:fs')
const path = require('node:path')

const CODE_ROOT = path.resolve(__dirname, '..', '..')
const ELECTRON_APP = path.join(CODE_ROOT, 'apps', 'electron-vite-project')
const MAIN_BUNDLE = path.join(ELECTRON_APP, 'dist-electron', 'main.js')
const BUILDER_CFG = path.join(ELECTRON_APP, 'electron-builder.config.cjs')
const PROVENANCE_MANIFEST = path.join(ELECTRON_APP, 'dist', 'release', 'session-build-provenance.json')

function killOrchestrator() {
  if (process.platform === 'win32') {
    spawnSync('node', ['scripts/kill-wr-desk.cjs'], { cwd: ELECTRON_APP, stdio: 'inherit' })
    return
  }
  spawnSync('bash', ['scripts/kill-wr-desk-unix.sh'], { cwd: ELECTRON_APP, stdio: 'inherit' })
}

function readDefineFromBundle(bundlePath, defineName) {
  const src = fs.readFileSync(bundlePath, 'utf8')
  const patterns = [
    new RegExp(`${defineName}:\\s*"([^"]+)"`),
    new RegExp(`const\\s+${defineName}\\s*=\\s*"([^"]+)"`),
    new RegExp(`var\\s+${defineName}\\s*=\\s*"([^"]+)"`),
    new RegExp(`${defineName}\\s*=\\s*"([^"]+)"`),
  ]
  for (const re of patterns) {
    const m = src.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

function readBuildStampFromConfig() {
  const extVite = path.join(ELECTRON_APP, '..', 'extension-chromium', 'vite.config.ts')
  const src = fs.readFileSync(extVite, 'utf8')
  const m = src.match(/outDir:\s*['"]([^'"]+)['"]/)
  return m?.[1] || 'unknown'
}

function readBuiltProvenance() {
  if (fs.existsSync(PROVENANCE_MANIFEST)) {
    return JSON.parse(fs.readFileSync(PROVENANCE_MANIFEST, 'utf8'))
  }
  if (!fs.existsSync(MAIN_BUNDLE)) {
    throw new Error(`Missing compiled main bundle at ${MAIN_BUNDLE}`)
  }
  const commit = execSync('git rev-parse HEAD', { cwd: CODE_ROOT, encoding: 'utf8' }).trim()
  const builtAt = readDefineFromBundle(MAIN_BUNDLE, '__WR_BUILD_TIMESTAMP__') || 'unknown'
  const stamp = readDefineFromBundle(MAIN_BUNDLE, '__ORCHESTRATOR_BUILD_STAMP__') || readBuildStampFromConfig()
  const short = commit.length >= 7 ? commit.slice(0, 7) : commit
  return { commit, short, builtAt, stamp }
}

function writeBuiltProvenance(provenance) {
  fs.mkdirSync(path.dirname(PROVENANCE_MANIFEST), { recursive: true })
  fs.writeFileSync(PROVENANCE_MANIFEST, `${JSON.stringify(provenance, null, 2)}\n`)
}

function readWindowsOutputBasename() {
  const text = fs.readFileSync(BUILDER_CFG, 'utf8')
  const m = text.match(/return\s+['"]C:\\\\build-output\\\\((?:bui|build)\d+)['"]/)
  return m?.[1] || null
}

function readWindowsExecutableName() {
  const text = fs.readFileSync(BUILDER_CFG, 'utf8')
  const m = text.match(/executableName:\s*['"]([^'"]+)['"]/)
  return m?.[1] || 'WRDeskT'
}

function resolveLinuxLaunchPath() {
  const dir = path.join(ELECTRON_APP, 'dist', 'release', 'linux-unpacked')
  if (!fs.existsSync(dir)) {
    throw new Error(`Missing linux-unpacked dir at ${dir}`)
  }
  const preferred = ['WRDeskT', 'wrdesk', 'electron-vite-project', 'wr-desk', 'WR DeskT']
  for (const name of preferred) {
    const p = path.join(dir, name)
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  const entries = fs.readdirSync(dir)
  for (const name of entries) {
    const p = path.join(dir, name)
    if (!fs.statSync(p).isFile()) continue
    if (name.endsWith('.so') || name.endsWith('.pak') || name.endsWith('.dat')) continue
    if (name === 'chrome-sandbox' || name === 'chrome_crashpad_handler') continue
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      /* not executable */
    }
  }
  throw new Error(`Could not resolve Linux launch binary under ${dir}`)
}

function resolveWindowsLaunchPath() {
  const basename = readWindowsOutputBasename()
  const exeName = readWindowsExecutableName()
  if (!basename) {
    throw new Error('Could not parse Windows build output folder from electron-builder.config.cjs')
  }
  const dir = path.join('C:\\build-output', basename, 'win-unpacked')
  for (const name of [exeName, 'WRDeskT', 'WR DeskT']) {
    const p = path.join(dir, `${name}.exe`)
    if (fs.existsSync(p)) return p
  }
  throw new Error(`Missing Windows EXE under ${dir}`)
}

function resolveLaunchPath() {
  if (process.platform === 'win32') return resolveWindowsLaunchPath()
  return resolveLinuxLaunchPath()
}

function formatBuildLine(provenance) {
  return `build commit=${provenance.commit} short=${provenance.short} stamp=${provenance.stamp} builtAt=${provenance.builtAt}`
}

function runOrchestratorBuild() {
  killOrchestrator()
  const res = spawnPnpmSync(['run', 'build'], {
    cwd: ELECTRON_APP,
    stdio: 'pipe',
    env: process.env,
  })
  if (res.stdout) process.stdout.write(res.stdout)
  if (res.stderr) process.stderr.write(res.stderr)
  if (res.status !== 0 || res.error) {
    throw new Error(
      formatSpawnFailure('orchestrator build (pnpm run build in apps/electron-vite-project)', res),
    )
  }
  const commit = execSync('git rev-parse HEAD', { cwd: CODE_ROOT, encoding: 'utf8' }).trim()
  const provenance = {
    commit,
    short: commit.length >= 7 ? commit.slice(0, 7) : commit,
    stamp: readBuildStampFromConfig(),
    builtAt:
      readDefineFromBundle(MAIN_BUNDLE, '__WR_BUILD_TIMESTAMP__') || new Date().toISOString(),
  }
  writeBuiltProvenance(provenance)
  const launchPath = resolveLaunchPath()
  return { provenance, launchPath }
}

module.exports = {
  killOrchestrator,
  runOrchestratorBuild,
  readBuiltProvenance,
  resolveLaunchPath,
  formatBuildLine,
}
