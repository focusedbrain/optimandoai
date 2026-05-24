/**
 * Encrypted edge private key storage — Phase 3 (P3.8).
 *
 * Private keys are encrypted to a VMK-derived key (same pattern as pod seal key).
 * Never stored in plaintext on disk.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const EDGE_PRIVATE_KEY_INFO = 'edge-private-key-v1'

export interface EncryptedEdgeKeyRecord {
  edge_pod_id: string
  /** base64(iv || ciphertext || authTag) */
  ciphertext_b64: string
  created_at: string
}

interface KeyStoreFile {
  keys: EncryptedEdgeKeyRecord[]
}

const KEYSTORE_FILENAME = 'edge-tier-encrypted-keys.json'

let _keyStorePathOverride: string | null = null

export function _setKeyStorePathForTest(path: string | null): void {
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

function loadKeyStore(): KeyStoreFile {
  const path = getKeyStorePath()
  if (!existsSync(path)) return { keys: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KeyStoreFile
  } catch {
    return { keys: [] }
  }
}

function saveKeyStore(store: KeyStoreFile): void {
  const path = getKeyStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
}

export function encryptEdgePrivateKeyHex(
  privateKeyHex: string,
  vault: { deriveApplicationKey(info: string): Buffer | null },
): string {
  const key = vault.deriveApplicationKey(EDGE_PRIVATE_KEY_INFO)
  if (!key || key.length < 32) {
    throw new Error('Vault is locked — cannot encrypt edge private key')
  }
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key.subarray(0, 32), iv)
    const encrypted = Buffer.concat([cipher.update(privateKeyHex, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, encrypted, tag]).toString('base64')
  } finally {
    key.fill(0)
  }
}

export function decryptEdgePrivateKeyHex(
  ciphertextB64: string,
  vault: { deriveApplicationKey(info: string): Buffer | null },
): string {
  const key = vault.deriveApplicationKey(EDGE_PRIVATE_KEY_INFO)
  if (!key || key.length < 32) {
    throw new Error('Vault is locked — cannot decrypt edge private key')
  }
  try {
    const buf = Buffer.from(ciphertextB64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ciphertext = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key.subarray(0, 32), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return plain
  } finally {
    key.fill(0)
  }
}

export function storeEncryptedEdgePrivateKey(
  edgePodId: string,
  privateKeyHex: string,
  vault: { deriveApplicationKey(info: string): Buffer | null },
): void {
  const ciphertext_b64 = encryptEdgePrivateKeyHex(privateKeyHex, vault)
  const store = loadKeyStore()
  const keys = store.keys.filter((k) => k.edge_pod_id !== edgePodId)
  keys.push({
    edge_pod_id: edgePodId,
    ciphertext_b64,
    created_at: new Date().toISOString(),
  })
  saveKeyStore({ keys })
}

export function loadEncryptedEdgePrivateKeyHex(
  edgePodId: string,
  vault: { deriveApplicationKey(info: string): Buffer | null },
): string | null {
  const store = loadKeyStore()
  const record = store.keys.find((k) => k.edge_pod_id === edgePodId)
  if (!record) return null
  return decryptEdgePrivateKeyHex(record.ciphertext_b64, vault)
}

export function removeEncryptedEdgePrivateKey(edgePodId: string): void {
  const store = loadKeyStore()
  const keys = store.keys.filter((k) => k.edge_pod_id.toLowerCase() !== edgePodId.toLowerCase())
  saveKeyStore({ keys })
}
