/**
 * Edge verification audit trail — Phase 3 (P3.10).
 *
 * Ring buffer (last 50) persisted to userData. Populated by parsing verifier
 * JSON audit lines from podman logs.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const MAX_EDGE_VERIFICATIONS = 50

/** Must match packages/beap-pod verifier BEAP_EDGE_VERIFICATION_AUDIT_TYPE. */
export const BEAP_EDGE_VERIFICATION_AUDIT_TYPE = 'beap_edge_verification'

export interface EdgeVerificationRecord {
  timestamp: string
  edge_pod_id: string
  sub: string
  /** `verified` or a verifier reason code. */
  result: string
  phase: 'shallow' | 'deep'
}

export interface ReplicaVerificationStats {
  last_success_at?: string
  last_failure_at?: string
  last_failure_reason?: string
}

interface AuditStoreFile {
  verifications: EdgeVerificationRecord[]
  replica_stats: Record<string, ReplicaVerificationStats>
}

const STORE_FILENAME = 'edge-verification-audit.json'

let _storePathOverride: string | null = null
let _storeCache: AuditStoreFile | null = null

export function _setAuditStorePathForTest(path: string | null): void {
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

function getStorePath(): string {
  if (_storePathOverride) return _storePathOverride
  return join(getUserDataDir(), STORE_FILENAME)
}

function emptyStore(): AuditStoreFile {
  return { verifications: [], replica_stats: {} }
}

function loadStore(): AuditStoreFile {
  if (_storeCache) return _storeCache
  const path = getStorePath()
  if (!existsSync(path)) {
    _storeCache = emptyStore()
    return _storeCache
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as AuditStoreFile
    _storeCache = {
      verifications: Array.isArray(raw.verifications) ? raw.verifications : [],
      replica_stats:
        raw.replica_stats && typeof raw.replica_stats === 'object' ? raw.replica_stats : {},
    }
    return _storeCache
  } catch {
    _storeCache = emptyStore()
    return _storeCache
  }
}

function saveStore(store: AuditStoreFile): void {
  const path = getStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
  _storeCache = store
}

export function parseVerifierAuditLine(line: string): EdgeVerificationRecord | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>
    if (json['type'] !== BEAP_EDGE_VERIFICATION_AUDIT_TYPE) return null
    if (
      typeof json['timestamp'] !== 'string' ||
      typeof json['edge_pod_id'] !== 'string' ||
      typeof json['sub'] !== 'string' ||
      typeof json['result'] !== 'string' ||
      (json['phase'] !== 'shallow' && json['phase'] !== 'deep')
    ) {
      return null
    }
    return {
      timestamp: json['timestamp'],
      edge_pod_id: json['edge_pod_id'],
      sub: json['sub'],
      result: json['result'],
      phase: json['phase'],
    }
  } catch {
    return null
  }
}

function updateReplicaStats(
  stats: Record<string, ReplicaVerificationStats>,
  record: EdgeVerificationRecord,
): void {
  const key = record.edge_pod_id.toLowerCase()
  const current = stats[key] ?? {}
  if (record.result === 'verified') {
    stats[key] = { ...current, last_success_at: record.timestamp }
  } else {
    stats[key] = {
      ...current,
      last_failure_at: record.timestamp,
      last_failure_reason: record.result,
    }
  }
}

export function appendEdgeVerification(record: EdgeVerificationRecord): void {
  const store = loadStore()
  const verifications = [...store.verifications, record]
  if (verifications.length > MAX_EDGE_VERIFICATIONS) {
    verifications.splice(0, verifications.length - MAX_EDGE_VERIFICATIONS)
  }
  const replica_stats = { ...store.replica_stats }
  updateReplicaStats(replica_stats, record)
  saveStore({ verifications, replica_stats })
}

export function ingestVerifierLogLine(line: string): boolean {
  const record = parseVerifierAuditLine(line)
  if (!record) return false
  appendEdgeVerification(record)
  return true
}

export function getRecentEdgeVerifications(limit = MAX_EDGE_VERIFICATIONS): EdgeVerificationRecord[] {
  const store = loadStore()
  return store.verifications.slice(-limit).reverse()
}

export function getReplicaVerificationStats(): Record<string, ReplicaVerificationStats> {
  return { ...loadStore().replica_stats }
}

export function _resetAuditStoreForTest(): void {
  _storeCache = null
}
