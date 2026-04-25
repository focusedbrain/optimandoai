/**
 * Persisted orchestrator role (host vs sandbox), device identity, and connected peers.
 * Single JSON file under Electron userData.
 *
 * This file is **setup / default metadata** and can be stale. **Host AI internal inference** eligibility
 * follows the ACTIVE internal handshake in the ledger (`hasActiveInternalLedgerSandboxToHostForHostAi`, etc.),
 * not `mode` alone — see `shouldMergeHostInternalRowsForGetAvailableModels` and `policy.assert*` for
 * internal P2P (ledger roles are authoritative there).
 */

import { randomInt, randomUUID } from 'crypto'
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
  /**
   * 6-digit decimal pairing code (string, zero-padded), unique per SSO account.
   * Stored without a dash — UI is responsible for "482-917" style display.
   * Persisted lazily: missing on disk triggers generate-and-save on next read.
   */
  pairingCode: string
  connectedPeers: ConnectedPeer[]
}

/**
 * Server-side pairing-code registrar. Injected by `main.ts` at startup so
 * the store stays free of HTTP / OIDC dependencies. When unset (e.g. tests
 * or before login), generation/regeneration only updates the local file.
 *
 * Returning `'inserted' | 'idempotent'` means the code is now owned by this
 * device. `'collision'` means the code is already held by another device on
 * the same account and the caller should retry with a new code.
 * `'unavailable'` means the registrar is not configured / network down — the
 * caller may still persist locally and retry registration later.
 */
export type PairingCodeRegistrar = (
  pairingCode: string,
) => Promise<'inserted' | 'idempotent' | 'collision' | 'unavailable'>

let pairingCodeRegistrar: PairingCodeRegistrar | null = null

export function setPairingCodeRegistrar(fn: PairingCodeRegistrar | null): void {
  pairingCodeRegistrar = fn
}

/** Generate a fresh 6-digit code (zero-padded). Cryptographically random. */
export function generatePairingCode(): string {
  // randomInt is exclusive of `max`, so 0..999_999 inclusive.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

const PAIRING_CODE_RE = /^[0-9]{6}$/

const MAX_REGISTRATION_ATTEMPTS = 5

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

function buildConfigFromRaw(raw: unknown): {
  config: OrchestratorModeConfig
  missingInstanceId: boolean
  missingPairingCode: boolean
} {
  const o = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  let mode: 'host' | 'sandbox' = 'host'
  if (o.mode === 'sandbox' || o.mode === 'host') mode = o.mode

  let instanceId = typeof o.instanceId === 'string' && o.instanceId.trim() ? o.instanceId.trim() : ''
  const missingInstanceId = !instanceId
  if (missingInstanceId) instanceId = randomUUID()

  let deviceName = typeof o.deviceName === 'string' && o.deviceName.trim() ? o.deviceName.trim() : ''
  if (!deviceName) deviceName = os.hostname()

  // Lazy-migrate: legacy on-disk configs predating pairing codes will be
  // missing this field. Generate one and let the caller persist it. Server
  // registration happens on the next call to `ensurePairingCodeRegistered`.
  let pairingCode = typeof o.pairingCode === 'string' && PAIRING_CODE_RE.test(o.pairingCode)
    ? o.pairingCode
    : ''
  const missingPairingCode = !pairingCode
  if (missingPairingCode) pairingCode = generatePairingCode()

  let connectedPeers: ConnectedPeer[] = []
  if (Array.isArray(o.connectedPeers)) {
    connectedPeers = o.connectedPeers.filter(isConnectedPeer)
  }

  return {
    config: { mode, deviceName, instanceId, pairingCode, connectedPeers },
    missingInstanceId,
    missingPairingCode,
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

/**
 * Persisted `orchestrator-mode.json` in Electron `userData` (UI defaults, server bind hints, etc.).
 * The renderer should use `orchestrator:getMode` (not `localStorage`). For **internal Host AI** and
 * related P2P policy, prefer ledger-derived flags from the same handler over `mode` alone.
 */
export function getOrchestratorMode(): OrchestratorModeConfig {
  const raw = readRawJson()
  const { config, missingInstanceId, missingPairingCode } = buildConfigFromRaw(raw)
  if (missingInstanceId || missingPairingCode) persistConfig(config)
  return config
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
  // Pairing code must be 6 decimal digits if present. To support code paths
  // (e.g. setOrchestratorMode from legacy callers / extension) that don't
  // know about pairing codes yet, accept missing/empty by minting a fresh
  // one rather than rejecting — this keeps callers backwards-compatible.
  let pairingCode = typeof config.pairingCode === 'string' ? config.pairingCode.trim() : ''
  if (!pairingCode) pairingCode = generatePairingCode()
  if (!PAIRING_CODE_RE.test(pairingCode)) {
    throw new Error('OrchestratorMode: pairingCode must be 6 decimal digits')
  }
  if (!Array.isArray(config.connectedPeers)) {
    throw new Error('OrchestratorMode: connectedPeers must be an array')
  }
  const connectedPeers = config.connectedPeers.map((p) => validatePeer(p))
  return { mode: config.mode, deviceName, instanceId, pairingCode, connectedPeers }
}

export function setOrchestratorMode(config: OrchestratorModeConfig): void {
  const before = getOrchestratorMode()
  const normalized = validateForWrite(config)
  persistConfig(normalized)
  if (before.mode !== normalized.mode || before.instanceId !== normalized.instanceId) {
    void import('../internalInference/p2pSession/p2pInferenceSessionManager').then((m) => {
      m.closeAllP2pInferenceSessions(m.P2pSessionLogReason.orchestrator_mode_change)
    })
  }
}

/** Persisted `mode === 'host'`. Do not use alone to deny internal Host AI when the ledger proves Sandbox↔Host. */
export function isHostMode(): boolean {
  return getOrchestratorMode().mode === 'host'
}

/** Persisted `mode === 'sandbox'`. Complement: `shouldMergeHostInternalRowsForGetAvailableModels` in listInference. */
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

/**
 * Read the persisted 6-digit pairing code (zero-padded). Generates and
 * persists one if the on-disk config predates pairing codes.
 */
export function getPairingCode(): string {
  return getOrchestratorMode().pairingCode
}

/** Internal — replace the persisted pairing code without server registration. */
function setPairingCodeLocal(code: string): void {
  if (!PAIRING_CODE_RE.test(code)) {
    throw new Error('OrchestratorMode: pairingCode must be 6 decimal digits')
  }
  const c = getOrchestratorMode()
  if (c.pairingCode === code) return
  setOrchestratorMode({ ...c, pairingCode: code })
}

/**
 * Ensure the currently-persisted pairing code is registered with the
 * coordination service. Safe to call repeatedly (idempotent on the server).
 *
 *   - If the registrar reports a collision, generate a new code and retry up
 *     to MAX_REGISTRATION_ATTEMPTS times. Each successful insert replaces the
 *     prior `(user, *) → instance` row server-side.
 *   - If the registrar is unavailable (no token / network), persist whatever
 *     we have and return; a later call will retry.
 *
 * Returns the code that ended up being registered (or attempted last).
 */
export async function ensurePairingCodeRegistered(): Promise<string> {
  let current = getPairingCode()
  if (!pairingCodeRegistrar) return current

  for (let attempt = 0; attempt < MAX_REGISTRATION_ATTEMPTS; attempt += 1) {
    let result: 'inserted' | 'idempotent' | 'collision' | 'unavailable'
    try {
      result = await pairingCodeRegistrar(current)
    } catch (err) {
      console.warn('[OrchestratorMode] pairing-code registrar threw:', err)
      return current
    }
    if (result === 'inserted' || result === 'idempotent') {
      return current
    }
    if (result === 'unavailable') {
      // Network / auth not ready yet — keep the local code, retry later.
      return current
    }
    // collision — pick a new code and try again.
    const next = generatePairingCode()
    setPairingCodeLocal(next)
    current = next
  }

  console.warn(
    '[OrchestratorMode] pairing-code registration: all retries collided; persisting locally anyway',
  )
  return current
}

/**
 * Generate a new pairing code, register it with the coordination service
 * (with collision retry), and persist it. Returns the new code.
 *
 * Local persistence happens before the server roundtrip so even if the
 * registrar is offline the new code takes effect locally; a later
 * `ensurePairingCodeRegistered` will sync it.
 */
export async function regeneratePairingCode(): Promise<string> {
  const fresh = generatePairingCode()
  setPairingCodeLocal(fresh)
  return ensurePairingCodeRegistered()
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
