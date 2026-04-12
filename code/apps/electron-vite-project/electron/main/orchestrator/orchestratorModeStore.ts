/**
 * Persisted orchestrator role (host vs sandbox) and sandbox connection hints.
 * Single JSON file under Electron userData.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const FILE_NAME = 'orchestrator-mode.json'

const DEFAULT_CONFIG: OrchestratorModeConfig = { mode: 'host' }

export interface OrchestratorModeConfig {
  mode: 'host' | 'sandbox'
  sandbox?: {
    hostUrl: string
    hostFingerprint?: string
    lastConnected?: string
    connectionVerified: boolean
  }
}

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function isValidHttpsUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim())
    if (u.protocol !== 'https:') return false
    if (!u.hostname) return false
    return true
  } catch {
    return false
  }
}

function normalizeFromDisk(raw: unknown): OrchestratorModeConfig {
  if (raw == null || typeof raw !== 'object') {
    console.warn('[OrchestratorMode] invalid root — defaulting to host')
    return { ...DEFAULT_CONFIG }
  }
  const o = raw as Record<string, unknown>
  const mode = o.mode
  if (mode !== 'host' && mode !== 'sandbox') {
    console.warn('[OrchestratorMode] invalid or missing mode — defaulting to host')
    return { ...DEFAULT_CONFIG }
  }
  if (mode === 'host') {
    return { mode: 'host' }
  }
  const sb = o.sandbox
  if (sb == null || typeof sb !== 'object') {
    console.warn('[OrchestratorMode] sandbox mode without sandbox object — defaulting to host')
    return { ...DEFAULT_CONFIG }
  }
  const s = sb as Record<string, unknown>
  const hostUrl = typeof s.hostUrl === 'string' ? s.hostUrl.trim() : ''
  if (!isValidHttpsUrl(hostUrl)) {
    console.warn('[OrchestratorMode] sandbox hostUrl missing or not HTTPS — defaulting to host')
    return { ...DEFAULT_CONFIG }
  }
  const hostFingerprint =
    typeof s.hostFingerprint === 'string' && s.hostFingerprint.trim()
      ? s.hostFingerprint.trim()
      : undefined
  const lastConnected =
    typeof s.lastConnected === 'string' && s.lastConnected.trim() ? s.lastConnected.trim() : undefined
  const connectionVerified = s.connectionVerified === true

  return {
    mode: 'sandbox',
    sandbox: {
      hostUrl,
      ...(hostFingerprint !== undefined ? { hostFingerprint } : {}),
      ...(lastConnected !== undefined ? { lastConnected } : {}),
      connectionVerified,
    },
  }
}

function readRaw(): OrchestratorModeConfig {
  try {
    const p = storePath()
    if (!fs.existsSync(p)) {
      return { ...DEFAULT_CONFIG }
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return normalizeFromDisk(j)
  } catch (e) {
    console.warn('[OrchestratorMode] read failed — defaulting to host:', e)
    return { ...DEFAULT_CONFIG }
  }
}

export function getOrchestratorMode(): OrchestratorModeConfig {
  return readRaw()
}

function validateForWrite(config: OrchestratorModeConfig): OrchestratorModeConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('OrchestratorMode: config is required')
  }
  if (config.mode !== 'host' && config.mode !== 'sandbox') {
    throw new Error(`OrchestratorMode: mode must be 'host' or 'sandbox'`)
  }
  if (config.mode === 'host') {
    return { mode: 'host' }
  }
  const sb = config.sandbox
  if (sb == null || typeof sb !== 'object') {
    throw new Error('OrchestratorMode: sandbox mode requires a sandbox object with hostUrl')
  }
  const hostUrl = typeof sb.hostUrl === 'string' ? sb.hostUrl.trim() : ''
  if (!hostUrl) {
    throw new Error('OrchestratorMode: sandbox.hostUrl is required')
  }
  if (!isValidHttpsUrl(hostUrl)) {
    throw new Error('OrchestratorMode: sandbox.hostUrl must be a valid https:// URL (http is not allowed)')
  }
  let connectionVerified = false
  if (sb.connectionVerified !== undefined) {
    if (typeof sb.connectionVerified !== 'boolean') {
      throw new Error('OrchestratorMode: sandbox.connectionVerified must be a boolean')
    }
    connectionVerified = sb.connectionVerified
  }
  let hostFingerprint: string | undefined
  if (sb.hostFingerprint !== undefined) {
    if (typeof sb.hostFingerprint !== 'string') {
      throw new Error('OrchestratorMode: sandbox.hostFingerprint must be a string')
    }
    const fp = sb.hostFingerprint.trim()
    hostFingerprint = fp || undefined
  }
  let lastConnected: string | undefined
  if (sb.lastConnected !== undefined) {
    if (typeof sb.lastConnected !== 'string') {
      throw new Error('OrchestratorMode: sandbox.lastConnected must be a string')
    }
    const lc = sb.lastConnected.trim()
    lastConnected = lc || undefined
  }
  return {
    mode: 'sandbox',
    sandbox: {
      hostUrl,
      ...(hostFingerprint !== undefined ? { hostFingerprint } : {}),
      ...(lastConnected !== undefined ? { lastConnected } : {}),
      connectionVerified,
    },
  }
}

export function setOrchestratorMode(config: OrchestratorModeConfig): void {
  const normalized = validateForWrite(config)
  const p = storePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const payload = JSON.stringify(normalized, null, 2)
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, payload, 'utf-8')
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    fs.renameSync(tmp, p)
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

export function isHostMode(): boolean {
  return getOrchestratorMode().mode === 'host'
}

export function isSandboxMode(): boolean {
  return getOrchestratorMode().mode === 'sandbox'
}

export function getSandboxHostUrl(): string | null {
  const c = getOrchestratorMode()
  if (c.mode !== 'sandbox' || !c.sandbox?.hostUrl) return null
  return c.sandbox.hostUrl.trim() || null
}
