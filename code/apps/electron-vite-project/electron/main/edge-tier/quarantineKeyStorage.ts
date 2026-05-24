/**
 * VMK-wrapped per-replica quarantine encryption keys (P5.5).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { VaultLockedError } from './accountKeyStorage.js'

export const EDGE_QUARANTINE_KEY_INFO = 'edge-quarantine-key-v1'

export interface EncryptedQuarantineKeyRecord {
  edge_pod_id: string
  ciphertext_b64: string
  created_at: string
}

interface QuarantineKeyStoreFile {
  keys: EncryptedQuarantineKeyRecord[]
}

const KEYSTORE_FILENAME = 'edge-quarantine-keys.json'

let _keyStorePathOverride: string | null = null

export function _setQuarantineKeyStorePathForTest(path: string | null): void {
  _keyStorePathOverride = path
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

function getKeyStorePath(): string {
  if (_keyStorePathOverride) return _keyStorePathOverride
  return join(getUserDataDir(), KEYSTORE_FILENAME)
}

function loadKeyStore(): QuarantineKeyStoreFile {
  const path = getKeyStorePath()
  if (!existsSync(path)) return { keys: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as QuarantineKeyStoreFile
  } catch {
    return { keys: [] }
  }
}

function saveKeyStore(store: QuarantineKeyStoreFile): void {
  const path = getKeyStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
}

function encryptPlaintext(plaintext: string, vault: EdgeTierPodVault): string {
  const key = vault.deriveApplicationKey(EDGE_QUARANTINE_KEY_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot encrypt quarantine key')
  }
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key.subarray(0, 32), iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, encrypted, tag]).toString('base64')
  } finally {
    key.fill(0)
  }
}

function decryptCiphertext(ciphertextB64: string, vault: EdgeTierPodVault): string {
  const key = vault.deriveApplicationKey(EDGE_QUARANTINE_KEY_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot decrypt quarantine key')
  }
  try {
    const buf = Buffer.from(ciphertextB64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ciphertext = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key.subarray(0, 32), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } finally {
    key.fill(0)
  }
}

export function generateQuarantineKeyHex(): string {
  return randomBytes(32).toString('hex')
}

export function storeWrappedQuarantineKey(
  edgePodId: string,
  quarantineKeyHex: string,
  vault: EdgeTierPodVault,
): void {
  const ciphertext_b64 = encryptPlaintext(quarantineKeyHex, vault)
  const store = loadKeyStore()
  const keys = store.keys.filter((k) => k.edge_pod_id.toLowerCase() !== edgePodId.toLowerCase())
  keys.push({
    edge_pod_id: edgePodId,
    ciphertext_b64,
    created_at: new Date().toISOString(),
  })
  saveKeyStore({ keys })
}

export function loadQuarantineKeyHex(edgePodId: string, vault: EdgeTierPodVault): string | null {
  const store = loadKeyStore()
  const record = store.keys.find((k) => k.edge_pod_id.toLowerCase() === edgePodId.toLowerCase())
  if (!record) return null
  return decryptCiphertext(record.ciphertext_b64, vault)
}

export function ensureQuarantineKeyHex(edgePodId: string, vault: EdgeTierPodVault): string {
  const existing = loadQuarantineKeyHex(edgePodId, vault)
  if (existing) return existing
  const generated = generateQuarantineKeyHex()
  storeWrappedQuarantineKey(edgePodId, generated, vault)
  return generated
}

export function hasWrappedQuarantineKey(edgePodId: string): boolean {
  return loadKeyStore().keys.some((k) => k.edge_pod_id.toLowerCase() === edgePodId.toLowerCase())
}

export function removeWrappedQuarantineKey(edgePodId: string): void {
  const store = loadKeyStore()
  saveKeyStore({
    keys: store.keys.filter((k) => k.edge_pod_id.toLowerCase() !== edgePodId.toLowerCase()),
  })
}
