#!/usr/bin/env node
/**
 * Shared helpers for two-box session bootstrap (test-infra only).
 */
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const CODE_ROOT = path.resolve(__dirname, '..', '..')
const COORD_PKG = path.join(CODE_ROOT, 'packages', 'coordination-service')
const ELECTRON_APP = path.join(CODE_ROOT, 'apps', 'electron-vite-project')
const RELAY_PORT = 51249
const PID_FILE = '/tmp/coord-xmachine.pid'
const RELAY_DB = '/tmp/coord-xmachine.db'
const RELAY_LOG = path.join(os.homedir(), 'relay-xmachine.log')

/**
 * Windows: `spawnSync('pnpm')` without `shell: true` fails with ENOENT (pnpm is a .cmd shim).
 */
function spawnPnpmSync(args, options = {}) {
  const { cwd, stdio = 'pipe', env = process.env, ...rest } = options
  const usePipe = stdio !== 'inherit'
  const spawnOpts = {
    cwd,
    env,
    shell: process.platform === 'win32',
    ...rest,
  }
  if (usePipe) {
    spawnOpts.stdio = ['ignore', 'pipe', 'pipe']
    spawnOpts.encoding = 'utf8'
  } else {
    spawnOpts.stdio = 'inherit'
  }
  return spawnSync('pnpm', args, spawnOpts)
}

function formatSpawnFailure(label, res) {
  const lines = [`${label} failed`]
  if (res.error) lines.push(`spawn error: ${res.error.message}`)
  if (res.status != null) lines.push(`exit code: ${res.status}`)
  const stderr = typeof res.stderr === 'string' ? res.stderr.trim() : ''
  const stdout = typeof res.stdout === 'string' ? res.stdout.trim() : ''
  if (stderr) lines.push(`stderr:\n${stderr}`)
  else if (stdout) lines.push(`stdout:\n${stdout}`)
  return lines.join('\n')
}

function ledgerDbPath() {
  return path.join(os.homedir(), '.opengiraffe', 'electron-data', 'handshake-ledger.db')
}

function detectLanIPv4() {
  const nets = os.networkInterfaces()
  const candidates = []
  for (const name of Object.keys(nets)) {
    const addrs = nets[name]
    if (!addrs) continue
    for (const addr of addrs) {
      const isV4 = addr.family === 'IPv4' || addr.family === 4
      if (isV4 && !addr.internal) candidates.push(addr.address)
    }
  }
  const unique = [...new Set(candidates)]
  const preferred = unique.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'))
  return preferred ?? unique[0] ?? '127.0.0.1'
}

function relayUrls(relayIp) {
  const host = relayIp.includes(':') ? `[${relayIp}]` : relayIp
  return {
    coordination_url: `http://${host}:${RELAY_PORT}`,
    coordination_ws_url: `ws://${host}:${RELAY_PORT}/beap/ws`,
  }
}

function runElectronNode(scriptPath, args = []) {
  const electronBin = require('electron')
  const res = spawnSync(electronBin, [scriptPath, ...args], {
    cwd: ELECTRON_APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || '').trim() || `exit ${res.status}`
    throw new Error(msg)
  }
  return (res.stdout || '').trim()
}

function configureCoordinationOnMachine(relayIp) {
  const dbPath = ledgerDbPath()
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Handshake ledger not found at ${dbPath} — launch WR Desk and log in once on this machine, then re-run.`,
    )
  }
  const urls = relayUrls(relayIp)
  const worker = path.join(__dirname, 'configure-coordination-worker.cjs')
  const out = runElectronNode(worker, [
    dbPath,
    urls.coordination_url,
    urls.coordination_ws_url,
  ])
  if (out !== 'ok') throw new Error(out || 'configure failed')
  return urls
}

function buildCoordinationService() {
  const res = spawnPnpmSync(['--filter', '@repo/coordination-service', 'build'], {
    cwd: CODE_ROOT,
    stdio: 'pipe',
    env: process.env,
  })
  if (res.status !== 0 || res.error) {
    throw new Error(formatSpawnFailure('coordination-service build (pnpm --filter @repo/coordination-service build)', res))
  }
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim()
    const pid = Number(raw)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForHealth(host, port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host, port, path: '/health', timeout: 2000 }, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else if (Date.now() >= deadline) reject(new Error(`/health returned ${res.statusCode}`))
        else setTimeout(attempt, 250)
      })
      req.on('error', () => {
        if (Date.now() >= deadline) reject(new Error(`relay not reachable on ${host}:${port}`))
        else setTimeout(attempt, 250)
      })
      req.on('timeout', () => {
        req.destroy()
        if (Date.now() >= deadline) reject(new Error(`relay health check timed out on ${host}:${port}`))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

function startRelay() {
  const existingPid = readPid()
  if (existingPid && isProcessAlive(existingPid)) {
    return { reused: true, pid: existingPid }
  }

  buildCoordinationService()
  const distEntry = path.join(COORD_PKG, 'dist', 'index.js')
  if (!fs.existsSync(distEntry)) throw new Error(`Missing ${distEntry} after build`)

  const electronBin = require('electron')
  const logFd = fs.openSync(RELAY_LOG, 'a')
  const child = spawn(electronBin, [distEntry], {
    cwd: COORD_PKG,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      COORD_PORT: String(RELAY_PORT),
      COORD_HOST: '0.0.0.0',
      COORD_DB_PATH: RELAY_DB,
    },
  })
  fs.closeSync(logFd)
  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))
  return { reused: false, pid: child.pid }
}

/**
 * Start the LAN coordination relay if needed and block until /health succeeds.
 * Idempotent: reuses an already-live relay (startRelay → { reused: true }).
 * Throws on health timeout so deploy fails loudly when the relay does not come up.
 */
async function ensureRelayUp(host = '127.0.0.1', port = RELAY_PORT) {
  const result = startRelay()
  await waitForHealth(host, port)
  const action = result.reused ? 'reused' : 'started'
  console.log(`relay ok (${action}) pid=${result.pid} health=http://${host}:${port}/health`)
  return result
}

function stopRelay() {
  const pid = readPid()
  if (!pid) return { stopped: false, reason: 'not_running' }
  if (!isProcessAlive(pid)) {
    try {
      fs.unlinkSync(PID_FILE)
    } catch {
      /* ignore */
    }
    return { stopped: false, reason: 'stale_pid' }
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    throw new Error(`Failed to stop relay pid ${pid}: ${err.message}`)
  }
  try {
    fs.unlinkSync(PID_FILE)
  } catch {
    /* ignore */
  }
  return { stopped: true, pid }
}

function windowsHostLine(relayIp) {
  return `cd $HOME\\dev\\optimandoai\\code; pnpm session:build; pnpm session:configure-remote ${relayIp}`
}

module.exports = {
  CODE_ROOT,
  ELECTRON_APP,
  RELAY_PORT,
  RELAY_LOG,
  RELAY_DB,
  PID_FILE,
  spawnPnpmSync,
  formatSpawnFailure,
  detectLanIPv4,
  relayUrls,
  configureCoordinationOnMachine,
  startRelay,
  ensureRelayUp,
  stopRelay,
  waitForHealth,
  windowsHostLine,
}
