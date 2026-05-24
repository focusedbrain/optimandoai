/**
 * Desktop diagnostic report store — Phase 5 (P5.4).
 *
 * Reports are signed JSON from the edge pod (P5.2). Invalid signatures are rejected
 * (logged only — may indicate VM compromise).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'

import type { DiagnosticReportV1 } from '@repo/beap-cert'
import { resolveDiagnosticReportSigner, verifyDiagnosticReport } from '@repo/beap-cert'

const REPORTS_DIRNAME = 'diagnostic-reports'

let _reportsRootOverride: string | null = null

export function _setDiagnosticReportsRootForTest(path: string | null): void {
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

/** Parse `ed25519:<hex>` or raw 64-char hex public key claim. */
export function parseEdgePublicKeyClaim(value: string): Uint8Array | null {
  const trimmed = value.trim()
  const prefix = 'ed25519:'
  const hex = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return null
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

export interface StoredReportRef {
  replica_id: string
  filename: string
}

function reportPath(replicaId: string, filename: string): string {
  return join(getReportsRoot(), replicaId, filename)
}

function listReplicaDir(replicaId: string): string {
  return join(getReportsRoot(), replicaId)
}

export interface StoreReportResult {
  stored: boolean
  filename?: string
  reason?: 'invalid_signature' | 'invalid_json'
}

/**
 * Verify signature and persist report as-is under
 * ${userData}/diagnostic-reports/{replica_id}/{timestamp}-{container_id}.json
 */
export function storeDiagnosticReport(
  replicaId: string,
  edgePublicKeyClaim: string,
  rawJson: string,
  suggestedFilename?: string,
  supervisorPublicKeyClaim?: string,
): StoreReportResult {
  let report: DiagnosticReportV1
  try {
    report = JSON.parse(rawJson) as DiagnosticReportV1
  } catch {
    console.warn('[SUPERVISOR] diagnostic report pickup: invalid JSON — rejected')
    return { stored: false, reason: 'invalid_json' }
  }

  const signer = resolveDiagnosticReportSigner(report)
  const publicKeyClaim =
    signer === 'supervisor' ? supervisorPublicKeyClaim : edgePublicKeyClaim
  if (!publicKeyClaim) {
    console.warn(
      `[SUPERVISOR] diagnostic report pickup: missing ${signer} public key — rejected`,
    )
    return { stored: false, reason: 'invalid_signature' }
  }

  const publicKey = parseEdgePublicKeyClaim(publicKeyClaim)
  if (!publicKey) {
    console.warn('[SUPERVISOR] diagnostic report pickup: invalid public key — rejected')
    return { stored: false, reason: 'invalid_signature' }
  }

  const verification = verifyDiagnosticReport(report, publicKey)
  if (!verification.ok) {
    console.warn(
      `[SUPERVISOR] diagnostic report pickup: invalid signature (${verification.reason}) — rejected (possible VM compromise)`,
    )
    return { stored: false, reason: 'invalid_signature' }
  }

  const timestamp = report.timestamp_iso8601.replace(/[:.]/g, '-')
  const containerId = report.failed_container.container_id_short
  const filename =
    suggestedFilename ?? `${timestamp}-${containerId}.json`

  const dir = listReplicaDir(replicaId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(reportPath(replicaId, filename), rawJson, { mode: 0o600 })
  return { stored: true, filename }
}

export function listReports(replicaId?: string): StoredReportRef[] {
  const root = getReportsRoot()
  if (!existsSync(root)) return []

  const replicaIds = replicaId ? [replicaId] : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

  const refs: StoredReportRef[] = []
  for (const id of replicaIds) {
    const dir = listReplicaDir(id)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.json')) {
        refs.push({ replica_id: id, filename: name })
      }
    }
  }
  return refs.sort((a, b) => a.filename.localeCompare(b.filename))
}

export function getReport(replicaId: string, filename: string): string | null {
  const path = reportPath(replicaId, filename)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
}

export function deleteReport(replicaId: string, filename: string): boolean {
  const path = reportPath(replicaId, filename)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

/** Resolve stored path for audit log reference. */
export function reportStorageFilename(replicaId: string, filename: string): string {
  return join(replicaId, basename(filename))
}
