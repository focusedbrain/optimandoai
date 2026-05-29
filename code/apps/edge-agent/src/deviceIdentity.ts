import { randomInt, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { generatePairingCode } from './pairingCode.js'

const FILE_NAME = 'agent-device-identity.json'
const PAIRING_CODE_RE = /^[0-9]{6}$/

export interface AgentDeviceIdentity {
  readonly instanceId: string
  readonly deviceName: string
  /** Coordination registry 6-digit code (sandbox/orchestrator model). */
  readonly registryPairingCode: string
}

interface RawIdentity {
  instanceId?: string
  deviceName?: string
  registryPairingCode?: string
}

function identityPath(stateDir: string): string {
  return join(stateDir, FILE_NAME)
}

function normalize(raw: RawIdentity): {
  identity: AgentDeviceIdentity
  missingInstanceId: boolean
  missingPairingCode: boolean
} {
  let instanceId = typeof raw.instanceId === 'string' && raw.instanceId.trim() ? raw.instanceId.trim() : ''
  const missingInstanceId = !instanceId
  if (missingInstanceId) instanceId = randomUUID()

  let deviceName = typeof raw.deviceName === 'string' && raw.deviceName.trim() ? raw.deviceName.trim() : ''
  if (!deviceName) deviceName = hostname()

  let registryPairingCode =
    typeof raw.registryPairingCode === 'string' && PAIRING_CODE_RE.test(raw.registryPairingCode)
      ? raw.registryPairingCode
      : ''
  const missingPairingCode = !registryPairingCode
  if (missingPairingCode) registryPairingCode = generatePairingCode()

  return {
    identity: { instanceId, deviceName, registryPairingCode },
    missingInstanceId,
    missingPairingCode,
  }
}

async function persist(stateDir: string, identity: AgentDeviceIdentity): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const path = identityPath(stateDir)
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  const payload = JSON.stringify(identity, null, 2)
  await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(tmp, path)
  } catch {
    await writeFile(path, payload, { encoding: 'utf8', mode: 0o600 })
  }
}

/** Stable device identity for coordination registry + handshake participation (WS1). */
export async function getOrCreateDeviceIdentity(stateDir: string): Promise<AgentDeviceIdentity> {
  const path = identityPath(stateDir)
  let raw: RawIdentity = {}
  try {
    raw = JSON.parse(await readFile(path, 'utf8')) as RawIdentity
  } catch {
    /* first run */
  }
  const { identity, missingInstanceId, missingPairingCode } = normalize(raw)
  if (missingInstanceId || missingPairingCode) {
    await persist(stateDir, identity)
  }
  return identity
}

export async function setDeviceName(stateDir: string, deviceName: string): Promise<AgentDeviceIdentity> {
  const trimmed = deviceName.trim()
  if (!trimmed) throw new Error('deviceName cannot be empty')
  const current = await getOrCreateDeviceIdentity(stateDir)
  const next = { ...current, deviceName: trimmed }
  await persist(stateDir, next)
  return next
}

export async function rotateRegistryPairingCode(stateDir: string): Promise<AgentDeviceIdentity> {
  const current = await getOrCreateDeviceIdentity(stateDir)
  const next = { ...current, registryPairingCode: generatePairingCode() }
  await persist(stateDir, next)
  return next
}
