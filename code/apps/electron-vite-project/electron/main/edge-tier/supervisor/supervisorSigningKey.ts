/**
 * Desktop supervisor Ed25519 signing key for supervisor-authored diagnostic reports (P5.9).
 *
 * Distinct from edge pod signing keys — used when SIGKILL prevents the container from
 * writing its own report.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { ed25519 } from '@noble/curves/ed25519.js'

import type { EdgeTierPodVault } from '../podLifecycle.js'
import { VaultLockedError } from '../accountKeyStorage.js'

export const SUPERVISOR_SIGNING_KEY_INFO = 'supervisor-diagnostic-signing-v1'

interface SupervisorSigningKeyStoreFile {
  public_key_hex: string
  ciphertext_b64: string
  created_at: string
}

const KEYSTORE_FILENAME = 'edge-supervisor-signing-key.json'

let _keyStorePathOverride: string | null = null

export function _setSupervisorSigningKeyStorePathForTest(path: string | null): void {
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

function loadKeyStore(): SupervisorSigningKeyStoreFile | null {
  const path = getKeyStorePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SupervisorSigningKeyStoreFile
  } catch {
    return null
  }
}

function saveKeyStore(store: SupervisorSigningKeyStoreFile): void {
  const path = getKeyStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
}

function encryptPrivateKeyHex(privateKeyHex: string, vault: EdgeTierPodVault): string {
  const key = vault.deriveApplicationKey(SUPERVISOR_SIGNING_KEY_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot encrypt supervisor signing key')
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

function decryptPrivateKeyHex(ciphertextB64: string, vault: EdgeTierPodVault): string {
  const key = vault.deriveApplicationKey(SUPERVISOR_SIGNING_KEY_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot decrypt supervisor signing key')
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

function ensureKeyStore(vault: EdgeTierPodVault): SupervisorSigningKeyStoreFile {
  const existing = loadKeyStore()
  if (existing) return existing

  const privateKey = ed25519.utils.randomSecretKey()
  const publicKeyHex = Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex')
  const privateKeyHex = Buffer.from(privateKey).toString('hex')
  const store: SupervisorSigningKeyStoreFile = {
    public_key_hex: publicKeyHex,
    ciphertext_b64: encryptPrivateKeyHex(privateKeyHex, vault),
    created_at: new Date().toISOString(),
  }
  saveKeyStore(store)
  return store
}

export function getSupervisorSigningPublicKeyClaim(vault: EdgeTierPodVault): string {
  const store = ensureKeyStore(vault)
  return `ed25519:${store.public_key_hex}`
}

export function loadSupervisorSigningPrivateKey(vault: EdgeTierPodVault): Uint8Array | null {
  try {
    const store = ensureKeyStore(vault)
    const privateKeyHex = decryptPrivateKeyHex(store.ciphertext_b64, vault)
    if (privateKeyHex.length !== 64 || !/^[0-9a-f]+$/i.test(privateKeyHex)) {
      return null
    }
    return Uint8Array.from(Buffer.from(privateKeyHex, 'hex'))
  } catch {
    return null
  }
}
