/**
 * SSH host key fingerprint store — P4.5.13 (TOFU pinning).
 *
 * TOFU model: the first successful SSH connect to a host:port stores that server's
 * host key fingerprint. Later connects must match. The trust boundary is the first
 * connect — if that session is MITM'd, the attacker's key is pinned (unavoidable
 * with TOFU; SSHFP/CA pinning are out of scope).
 *
 * Fingerprints are stored as lowercase SHA-256 hex digests of the raw SSH host public
 * key bytes (same material ssh2 passes to hostVerifier before hashing).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export interface HostKeyEntry {
  host: string
  port: number
  key_type: string
  /** Lowercase hex SHA-256 of raw host public key bytes. */
  fingerprint_sha256: string
  first_seen: string
  last_verified: string
}

export interface HostKeyStoreFile {
  entries: HostKeyEntry[]
}

const STORE_FILENAME = 'edge-tier-host-keys.json'

let _storePathOverride: string | null = null
let _storeCache: HostKeyStoreFile | null = null

export function _setHostKeyStorePathForTest(path: string | null): void {
  _storePathOverride = path
  _storeCache = null
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

export function getHostKeyStorePath(): string {
  if (_storePathOverride) return _storePathOverride
  return join(getUserDataDir(), STORE_FILENAME)
}

function entryKey(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`
}

function emptyStore(): HostKeyStoreFile {
  return { entries: [] }
}

function loadStore(): HostKeyStoreFile {
  if (_storeCache) return _storeCache
  const path = getHostKeyStorePath()
  if (!existsSync(path)) {
    _storeCache = emptyStore()
    return _storeCache
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as HostKeyStoreFile
    _storeCache = {
      entries: Array.isArray(raw.entries) ? raw.entries.filter(isValidEntry) : [],
    }
    return _storeCache
  } catch {
    _storeCache = emptyStore()
    return _storeCache
  }
}

function isValidEntry(entry: unknown): entry is HostKeyEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.host === 'string' &&
    typeof e.port === 'number' &&
    typeof e.key_type === 'string' &&
    typeof e.fingerprint_sha256 === 'string' &&
    typeof e.first_seen === 'string' &&
    typeof e.last_verified === 'string'
  )
}

function saveStore(store: HostKeyStoreFile): void {
  const path = getHostKeyStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
  _storeCache = store
}

export function getStoredFingerprint(host: string, port: number): HostKeyEntry | null {
  const key = entryKey(host, port)
  return loadStore().entries.find((e) => entryKey(e.host, e.port) === key) ?? null
}

export function storeFingerprint(
  host: string,
  port: number,
  keyType: string,
  fingerprintSha256Hex: string,
): HostKeyEntry {
  const now = new Date().toISOString()
  const normalized = fingerprintSha256Hex.toLowerCase()
  const store = loadStore()
  const key = entryKey(host, port)
  const existingIdx = store.entries.findIndex((e) => entryKey(e.host, e.port) === key)
  const entry: HostKeyEntry = {
    host: host.trim(),
    port,
    key_type: keyType,
    fingerprint_sha256: normalized,
    first_seen: existingIdx >= 0 ? store.entries[existingIdx]!.first_seen : now,
    last_verified: now,
  }
  if (existingIdx >= 0) {
    store.entries[existingIdx] = entry
  } else {
    store.entries.push(entry)
  }
  saveStore(store)
  return entry
}

export function touchVerifiedFingerprint(host: string, port: number): void {
  const stored = getStoredFingerprint(host, port)
  if (!stored) return
  storeFingerprint(host, port, stored.key_type, stored.fingerprint_sha256)
}

export function removeFingerprint(host: string, port: number): boolean {
  const store = loadStore()
  const key = entryKey(host, port)
  const next = store.entries.filter((e) => entryKey(e.host, e.port) !== key)
  if (next.length === store.entries.length) return false
  saveStore({ entries: next })
  return true
}

export function listKnownHostFingerprints(): readonly HostKeyEntry[] {
  return [...loadStore().entries].sort((a, b) =>
    `${a.host}:${a.port}`.localeCompare(`${b.host}:${b.port}`),
  )
}

/** OpenSSH-style display: SHA256:<base64(sha256 digest)> */
export function formatFingerprintForDisplay(fingerprintSha256Hex: string): string {
  const digest = Buffer.from(fingerprintSha256Hex.toLowerCase(), 'hex')
  const b64 = digest.toString('base64').replace(/=+$/, '')
  return `SHA256:${b64}`
}
