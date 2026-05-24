/**
 * VMK-wrapped mail-fetcher account keys (strategy §11.5).
 *
 * Plaintext account keys exist only transiently during deliver_key; persisted form
 * is AES-256-GCM ciphertext keyed from vault VMK.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { EdgeTierPodVault } from './podLifecycle.js'

export const EDGE_FETCH_ACCOUNT_KEY_INFO = 'edge-fetch-account-key-v1'

export class VaultLockedError extends Error {
  constructor(message = 'Vault is locked') {
    super(message)
    this.name = 'VaultLockedError'
  }
}

export class AccountKeyUnwrapError extends Error {
  constructor(message = 'Failed to unwrap account key') {
    super(message)
    this.name = 'AccountKeyUnwrapError'
  }
}

export interface EncryptedAccountKeyRecord {
  account_id: string
  /** base64(iv || ciphertext || authTag) */
  ciphertext_b64: string
  created_at: string
}

interface AccountKeyStoreFile {
  keys: EncryptedAccountKeyRecord[]
}

const KEYSTORE_FILENAME = 'edge-fetch-account-keys.json'

let _keyStorePathOverride: string | null = null

export function _setAccountKeyStorePathForTest(path: string | null): void {
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

function loadKeyStore(): AccountKeyStoreFile {
  const path = getKeyStorePath()
  if (!existsSync(path)) return { keys: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AccountKeyStoreFile
  } catch {
    return { keys: [] }
  }
}

function saveKeyStore(store: AccountKeyStoreFile): void {
  const path = getKeyStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
}

function encryptPlaintext(plaintext: string, vault: EdgeTierPodVault): string {
  const key = vault.deriveApplicationKey(EDGE_FETCH_ACCOUNT_KEY_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot encrypt account key')
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
  const key = vault.deriveApplicationKey(EDGE_FETCH_ACCOUNT_KEY_INFO)
  if (!key || key.length < 32) {
    throw new VaultLockedError('Vault is locked — cannot decrypt account key')
  }
  try {
    const buf = Buffer.from(ciphertextB64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ciphertext = buf.subarray(12, buf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key.subarray(0, 32), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (err) {
    if (err instanceof VaultLockedError) throw err
    throw new AccountKeyUnwrapError(
      err instanceof Error ? err.message : 'Account key unwrap failed (VMK may have rotated)',
    )
  } finally {
    key.fill(0)
  }
}

/** Persist VMK-wrapped account key; returns opaque blob for edge tmpfs. */
export function storeWrappedAccountKey(
  accountId: string,
  accountKeyHex: string,
  vault: EdgeTierPodVault,
): string {
  const ciphertext_b64 = encryptPlaintext(accountKeyHex, vault)
  const store = loadKeyStore()
  const keys = store.keys.filter((k) => k.account_id !== accountId)
  keys.push({
    account_id: accountId,
    ciphertext_b64,
    created_at: new Date().toISOString(),
  })
  saveKeyStore({ keys })
  return ciphertext_b64
}

export function loadAccountKeyHex(accountId: string, vault: EdgeTierPodVault): string | null {
  const store = loadKeyStore()
  const record = store.keys.find((k) => k.account_id === accountId)
  if (!record) return null
  return decryptCiphertext(record.ciphertext_b64, vault)
}

export function hasWrappedAccountKey(accountId: string): boolean {
  return loadKeyStore().keys.some((k) => k.account_id === accountId)
}

export function removeWrappedAccountKey(accountId: string): void {
  const store = loadKeyStore()
  saveKeyStore({ keys: store.keys.filter((k) => k.account_id !== accountId) })
}

export function isVaultAvailableForAccountKeys(vault: EdgeTierPodVault): boolean {
  const key = vault.deriveApplicationKey(EDGE_FETCH_ACCOUNT_KEY_INFO)
  if (key) {
    key.fill(0)
    return true
  }
  return false
}
