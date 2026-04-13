/**
 * Persisted orchestrator role (host vs sandbox), device identity, and connected peers.
 * Single JSON file under Electron userData.
 */

import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'

const FILE_NAME = 'orchestrator-mode.json'

export interface ConnectedPeer {
  instanceId: string
  deviceName: string
  mode: 'host' | 'sandbox'
  handshakeId: string
  lastSeen: string
  status: 'connected' | 'disconnected'
}

export interface OrchestratorModeConfig {
  mode: 'host' | 'sandbox'
  deviceName: string
  instanceId: string
  connectedPeers: ConnectedPeer[]
}

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function isConnectedPeer(x: unknown): x is ConnectedPeer {
  if (x == null || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.instanceId === 'string' &&
    o.instanceId.trim().length > 0 &&
    typeof o.deviceName === 'string' &&
    typeof o.handshakeId === 'string' &&
    typeof o.lastSeen === 'string' &&
    (o.mode === 'host' || o.mode === 'sandbox') &&
    (o.status === 'connected' || o.status === 'disconnected')
  )
}

function readRawJson(): unknown {
  try {
    const p = storePath()
    if (!fs.existsSync(p)) return {}
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) {
    console.warn('[OrchestratorMode] read failed — treating as empty:', e)
    return {}
  }
}

function buildConfigFromRaw(raw: unknown): { config: OrchestratorModeConfig; missingInstanceId: boolean } {
  const o = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  let mode: 'host' | 'sandbox' = 'host'
  if (o.mode === 'sandbox' || o.mode === 'host') mode = o.mode

  let instanceId = typeof o.instanceId === 'string' && o.instanceId.trim() ? o.instanceId.trim() : ''
  const missingInstanceId = !instanceId
  if (missingInstanceId) instanceId = randomUUID()

  let deviceName = typeof o.deviceName === 'string' && o.deviceName.trim() ? o.deviceName.trim() : ''
  if (!deviceName) deviceName = os.hostname()

  let connectedPeers: ConnectedPeer[] = []
  if (Array.isArray(o.connectedPeers)) {
    connectedPeers = o.connectedPeers.filter(isConnectedPeer)
  }

  // Legacy `sandbox.hostUrl` and related fields are ignored (migration — no crash).

  return {
    config: { mode, deviceName, instanceId, connectedPeers },
    missingInstanceId,
  }
}

function persistConfig(config: OrchestratorModeConfig): void {
  const p = storePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const payload = JSON.stringify(config, null, 2)
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

export function getOrchestratorMode(): OrchestratorModeConfig {
  const raw = readRawJson()
  const { config, missingInstanceId } = buildConfigFromRaw(raw)
  if (missingInstanceId) persistConfig(config)
  return config
}

/**
 * Legacy sandbox → host HTTPS base URL (e.g. https://workstation:51248), if still present on disk.
 * Silent-handshake flow does not require this; sandbox inference uses it when configured.
 */
export function getSandboxHostUrl(): string {
  const raw = readRawJson()
  if (raw == null || typeof raw !== 'object') return ''
  const o = raw as Record<string, unknown>
  const sandbox = o.sandbox
  if (sandbox == null || typeof sandbox !== 'object') return ''
  const hostUrl = (sandbox as Record<string, unknown>).hostUrl
  return typeof hostUrl === 'string' && hostUrl.trim() ? hostUrl.trim() : ''
}

function validatePeer(p: ConnectedPeer): ConnectedPeer {
  if (!p.instanceId?.trim()) throw new Error('OrchestratorMode: peer.instanceId is required')
  if (!p.deviceName?.trim()) throw new Error('OrchestratorMode: peer.deviceName is required')
  if (p.mode !== 'host' && p.mode !== 'sandbox') {
    throw new Error(`OrchestratorMode: peer.mode must be 'host' or 'sandbox'`)
  }
  if (!p.handshakeId?.trim()) throw new Error('OrchestratorMode: peer.handshakeId is required')
  if (!p.lastSeen?.trim()) throw new Error('OrchestratorMode: peer.lastSeen is required')
  if (p.status !== 'connected' && p.status !== 'disconnected') {
    throw new Error(`OrchestratorMode: peer.status must be 'connected' or 'disconnected'`)
  }
  return {
    instanceId: p.instanceId.trim(),
    deviceName: p.deviceName.trim(),
    mode: p.mode,
    handshakeId: p.handshakeId.trim(),
    lastSeen: p.lastSeen.trim(),
    status: p.status,
  }
}

function validateForWrite(config: OrchestratorModeConfig): OrchestratorModeConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('OrchestratorMode: config is required')
  }
  if (config.mode !== 'host' && config.mode !== 'sandbox') {
    throw new Error(`OrchestratorMode: mode must be 'host' or 'sandbox'`)
  }
  const deviceName = typeof config.deviceName === 'string' ? config.deviceName.trim() : ''
  if (!deviceName) {
    throw new Error('OrchestratorMode: deviceName is required')
  }
  const instanceId = typeof config.instanceId === 'string' ? config.instanceId.trim() : ''
  if (!instanceId) {
    throw new Error('OrchestratorMode: instanceId is required')
  }
  if (!Array.isArray(config.connectedPeers)) {
    throw new Error('OrchestratorMode: connectedPeers must be an array')
  }
  const connectedPeers = config.connectedPeers.map((p) => validatePeer(p))
  return { mode: config.mode, deviceName, instanceId, connectedPeers }
}

export function setOrchestratorMode(config: OrchestratorModeConfig): void {
  const normalized = validateForWrite(config)
  persistConfig(normalized)
}

export function isHostMode(): boolean {
  return getOrchestratorMode().mode === 'host'
}

export function isSandboxMode(): boolean {
  return getOrchestratorMode().mode === 'sandbox'
}

export function getInstanceId(): string {
  return getOrchestratorMode().instanceId
}

export function getDeviceName(): string {
  return getOrchestratorMode().deviceName
}

export function setDeviceName(name: string): void {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new Error('OrchestratorMode: deviceName cannot be empty')
  const c = getOrchestratorMode()
  setOrchestratorMode({ ...c, deviceName: trimmed })
}

export function addConnectedPeer(peer: ConnectedPeer): void {
  const c = getOrchestratorMode()
  const p = validatePeer(peer)
  const others = c.connectedPeers.filter((x) => x.instanceId !== p.instanceId)
  setOrchestratorMode({ ...c, connectedPeers: [...others, p] })
}

export function removeConnectedPeer(instanceId: string): void {
  const id = typeof instanceId === 'string' ? instanceId.trim() : ''
  if (!id) return
  const c = getOrchestratorMode()
  setOrchestratorMode({
    ...c,
    connectedPeers: c.connectedPeers.filter((p) => p.instanceId !== id),
  })
}

export function updatePeerStatus(
  instanceId: string,
  status: 'connected' | 'disconnected',
): void {
  const id = typeof instanceId === 'string' ? instanceId.trim() : ''
  if (!id) return
  const c = getOrchestratorMode()
  const idx = c.connectedPeers.findIndex((p) => p.instanceId === id)
  if (idx === -1) return
  const next = [...c.connectedPeers]
  next[idx] = { ...next[idx], status }
  setOrchestratorMode({ ...c, connectedPeers: next })
}
