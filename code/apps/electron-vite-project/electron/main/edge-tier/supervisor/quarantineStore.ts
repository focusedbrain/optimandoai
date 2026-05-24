/**
 * Desktop local quarantine entry store (P5.5).
 *
 * Mirrors edge layout under userData/diagnostic-reports/{replica_id}/quarantine/{hash}/
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export interface LocalQuarantineMetadata {
  hash: string
  envelope_from: string
  envelope_to: string
  envelope_date: string
  envelope_subject_filtered: string
  quarantined_at: string
  failed_container_role: string
  failed_stage: string
}

const REPORTS_DIRNAME = 'diagnostic-reports'

let _reportsRootOverride: string | null = null

export function _setLocalQuarantineRootForTest(path: string | null): void {
  _reportsRootOverride = path
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

function getReportsRoot(): string {
  if (_reportsRootOverride) return _reportsRootOverride
  return join(getUserDataDir(), REPORTS_DIRNAME)
}

function quarantineDir(replicaId: string, hash: string): string {
  return join(getReportsRoot(), replicaId, 'quarantine', hash)
}

export interface StoredQuarantineEntry {
  replica_id: string
  hash: string
  metadata: LocalQuarantineMetadata
}

export function storeLocalQuarantineEntry(
  replicaId: string,
  hash: string,
  rawBytesContent: string,
  metadataJson: string,
): void {
  const dir = quarantineDir(replicaId, hash)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'raw_bytes'), rawBytesContent, { mode: 0o600 })
  writeFileSync(join(dir, 'metadata.json'), metadataJson, { mode: 0o600 })
}

export function listLocalQuarantineEntries(replicaId?: string): StoredQuarantineEntry[] {
  const root = getReportsRoot()
  if (!existsSync(root)) return []

  const replicaIds = replicaId
    ? [replicaId]
    : readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)

  const entries: StoredQuarantineEntry[] = []
  for (const id of replicaIds) {
    const qRoot = join(root, id, 'quarantine')
    if (!existsSync(qRoot)) continue
    for (const hash of readdirSync(qRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)) {
      try {
        const metaRaw = readFileSync(join(qRoot, hash, 'metadata.json'), 'utf8')
        entries.push({
          replica_id: id,
          hash,
          metadata: JSON.parse(metaRaw) as LocalQuarantineMetadata,
        })
      } catch {
        /* skip malformed */
      }
    }
  }
  return entries
}

export function cleanupLocalQuarantine(retentionDays: number, now = Date.now()): string[] {
  const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000
  const removed: string[] = []
  for (const entry of listLocalQuarantineEntries()) {
    const ts = Date.parse(entry.metadata.quarantined_at)
    if (Number.isNaN(ts) || ts >= cutoffMs) continue
    const dir = quarantineDir(entry.replica_id, entry.hash)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      removed.push(`${entry.replica_id}/${entry.hash}`)
    }
  }
  return removed
}

export function getLocalQuarantineRetentionDays(settingsRetention?: number): number {
  if (typeof settingsRetention === 'number' && settingsRetention > 0) {
    return Math.floor(settingsRetention)
  }
  return 30
}

function quarantineEntryDir(replicaId: string, hash: string): string {
  return quarantineDir(replicaId, hash)
}

export function readLocalQuarantineRawBytesWire(
  replicaId: string,
  hash: string,
): string | null {
  const path = join(quarantineEntryDir(replicaId, hash), 'raw_bytes')
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
}

export function deleteLocalQuarantineEntry(replicaId: string, hash: string): boolean {
  const dir = quarantineEntryDir(replicaId, hash)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}
