/**
 * VMK-wrapped SSH credentials for edge replica reboot recovery (P4.5.8).
 *
 * Stored only after explicit user consent during edge-fetch migration; used by
 * the reboot recovery poll to reach mail-fetcher without re-prompting every cycle.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { VaultLockedError } from './accountKeyStorage.js'

export const EDGE_REPLICA_SSH_INFO = 'edge-replica-ssh-v1'

export interface StoredReplicaSshCredentials {
  sshUser: string
  sshPort: number
  sshKey: string
  passphrase?: string
}

export interface EncryptedReplicaSshRecord {
  edge_pod_id: string
  ciphertext_b64: string
  created_at: string
}

interface ReplicaSshStoreFile {
  replicas: EncryptedReplicaSshRecord[]
}

const STORE_FILENAME = 'edge-replica-ssh-credentials.json'

let _storePathOverride: string | null = null

export function _setReplicaSshStorePathForTest(path: string | null): void {
  _storePathOverride = path
}

function getUserDataDir(): string {
  if (process.env['WR_DESK_USER_DATA']) return process.env['WR_DESK_USER_DATA']
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    return app.getPath('userData')
  } catch {
    return join(homedir(), '.config', 'wr-desk')
  }
}

function getStorePath(): string {
  if (_storePathOverride) return _storePathOverride
  return join(getUserDataDir(), STORE_FILENAME)
}

function loadStore(): ReplicaSshStoreFile {
  const path = getStorePath()
  if (!existsSync(path)) return { replicas: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ReplicaSshStoreFile
  } catch {
    return { replicas: [] }
  }
}

function saveStore(store: ReplicaSshStoreFile): void {
  const path = getStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
}

function encryptJson(payload: StoredReplicaSshCredentials, vault: EdgeTierPodVault): string {
  const key = vault.deriveApplicationKey(EDGE_REPLICA_SSH_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot store replica SSH credentials')
  }
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key.subarray(0, 32), iv)
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, encrypted, tag]).toString('base64')
  } finally {
    key.fill(0)
  }
}

function decryptJson(ciphertextB64: string, vault: EdgeTierPodVault): StoredReplicaSshCredentials {
  const key = vault.deriveApplicationKey(EDGE_REPLICA_SSH_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot load replica SSH credentials')
  }
  try {
    const buf = Buffer.from(ciphertextB64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ciphertext = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key.subarray(0, 32), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plain) as StoredReplicaSshCredentials
    if (!parsed?.sshUser || !parsed?.sshKey) {
      throw new Error('Invalid stored SSH credentials')
    }
    return parsed
  } finally {
    key.fill(0)
  }
}

export function storeReplicaSshCredentials(
  edgePodId: string,
  creds: StoredReplicaSshCredentials,
  vault: EdgeTierPodVault,
): void {
  const ciphertext_b64 = encryptJson(creds, vault)
  const store = loadStore()
  const replicas = store.replicas.filter(
    (r) => r.edge_pod_id.toLowerCase() !== edgePodId.toLowerCase(),
  )
  replicas.push({
    edge_pod_id: edgePodId,
    ciphertext_b64,
    created_at: new Date().toISOString(),
  })
  saveStore({ replicas })
}

export function loadReplicaSshCredentials(
  edgePodId: string,
  vault: EdgeTierPodVault,
): StoredReplicaSshCredentials | null {
  const store = loadStore()
  const record = store.replicas.find(
    (r) => r.edge_pod_id.toLowerCase() === edgePodId.toLowerCase(),
  )
  if (!record) return null
  return decryptJson(record.ciphertext_b64, vault)
}

export function removeReplicaSshCredentials(edgePodId: string): void {
  const store = loadStore()
  saveStore({
    replicas: store.replicas.filter(
      (r) => r.edge_pod_id.toLowerCase() !== edgePodId.toLowerCase(),
    ),
  })
}

export function hasReplicaSshCredentials(edgePodId: string): boolean {
  return loadStore().replicas.some(
    (r) => r.edge_pod_id.toLowerCase() === edgePodId.toLowerCase(),
  )
}
