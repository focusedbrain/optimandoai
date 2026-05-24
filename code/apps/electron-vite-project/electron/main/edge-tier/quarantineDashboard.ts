/**
 * Dashboard quarantine aggregation and sandbox payload preparation (P5.6).
 */

import type { EdgeTierPodVault } from './podLifecycle.js'
import { VaultLockedError } from './accountKeyStorage.js'
import { loadQuarantineKeyHex } from './quarantineKeyStorage.js'
import {
  listLocalQuarantineEntries,
  readLocalQuarantineRawBytesWire,
  type LocalQuarantineMetadata,
  type StoredQuarantineEntry,
} from './supervisor/quarantineStore.js'
import { getReport, listReports } from './supervisor/reportStore.js'
import {
  decryptLocalQuarantinePlaintext,
  quarantinePlaintextToSandboxText,
} from './quarantineDecrypt.js'
import { zeroizeBuffer } from '../security/zeroize.js'

export interface QuarantineListItem {
  replica_id: string
  hash: string
  quarantined_at: string
  envelope_from: string
  envelope_subject_filtered: string
  failed_role: string
  report_filename: string | null
}

export interface QuarantineReplicaSummary {
  replica_id: string
  count: number
  latest_at: string | null
}

export interface QuarantineDashboardSummary {
  total_count: number
  by_replica: QuarantineReplicaSummary[]
  recent_failures: Array<{
    replica_id: string
    hash: string
    quarantined_at: string
    failed_role: string
  }>
}

export type SandboxPrepareMode = 'diagnostic_report' | 'raw_email_body'

export function findReportFilenameForHash(replicaId: string, hash: string): string | null {
  for (const ref of listReports(replicaId)) {
    const raw = getReport(replicaId, ref.filename)
    if (!raw) continue
    try {
      const report = JSON.parse(raw) as {
        message_under_processing?: { sha256_hex?: string } | null
      }
      if (report.message_under_processing?.sha256_hex === hash) {
        return ref.filename
      }
    } catch {
      /* skip malformed */
    }
  }
  return null
}

function toListItem(entry: StoredQuarantineEntry): QuarantineListItem {
  const meta = entry.metadata
  return {
    replica_id: entry.replica_id,
    hash: entry.hash,
    quarantined_at: meta.quarantined_at,
    envelope_from: meta.envelope_from,
    envelope_subject_filtered: meta.envelope_subject_filtered,
    failed_role: meta.failed_container_role,
    report_filename: findReportFilenameForHash(entry.replica_id, entry.hash),
  }
}

export function listQuarantineItems(replicaId?: string): QuarantineListItem[] {
  return listLocalQuarantineEntries(replicaId)
    .map(toListItem)
    .sort((a, b) => b.quarantined_at.localeCompare(a.quarantined_at))
}

export function buildQuarantineDashboardSummary(): QuarantineDashboardSummary {
  const entries = listLocalQuarantineEntries()
  const byReplica = new Map<string, { count: number; latest_at: string | null }>()

  for (const entry of entries) {
    const id = entry.replica_id
    const existing = byReplica.get(id) ?? { count: 0, latest_at: null }
    existing.count += 1
    const ts = entry.metadata.quarantined_at
    if (!existing.latest_at || ts > existing.latest_at) {
      existing.latest_at = ts
    }
    byReplica.set(id, existing)
  }

  const recent = entries
    .map((e) => ({
      replica_id: e.replica_id,
      hash: e.hash,
      quarantined_at: e.metadata.quarantined_at,
      failed_role: e.metadata.failed_container_role,
    }))
    .sort((a, b) => b.quarantined_at.localeCompare(a.quarantined_at))
    .slice(0, 5)

  return {
    total_count: entries.length,
    by_replica: [...byReplica.entries()]
      .map(([replica_id, v]) => ({ replica_id, ...v }))
      .sort((a, b) => a.replica_id.localeCompare(b.replica_id)),
    recent_failures: recent,
  }
}

export function getQuarantineEntryMetadata(
  replicaId: string,
  hash: string,
): LocalQuarantineMetadata | null {
  const entry = listLocalQuarantineEntries(replicaId).find((e) => e.hash === hash)
  return entry?.metadata ?? null
}

export function formatDiagnosticReportForSandbox(rawJson: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error('Diagnostic report is not valid JSON')
  }
  return JSON.stringify(parsed, null, 2)
}

export function prepareSandboxViewPayload(
  mode: SandboxPrepareMode,
  replicaId: string,
  hash: string,
  vault: EdgeTierPodVault,
): { ok: true; textContent: string } | { ok: false; error: string } {
  if (mode === 'diagnostic_report') {
    const filename = findReportFilenameForHash(replicaId, hash)
    if (!filename) {
      return { ok: false, error: 'No diagnostic report found for this quarantine entry' }
    }
    const raw = getReport(replicaId, filename)
    if (!raw) {
      return { ok: false, error: 'Diagnostic report file missing' }
    }
    try {
      return { ok: true, textContent: formatDiagnosticReportForSandbox(raw) }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const wireRaw = readLocalQuarantineRawBytesWire(replicaId, hash)
  if (!wireRaw) {
    return { ok: false, error: 'Quarantine raw_bytes not found locally' }
  }

  let keyHex: string | null
  try {
    keyHex = loadQuarantineKeyHex(replicaId, vault)
  } catch (err) {
    if (err instanceof VaultLockedError) {
      return { ok: false, error: 'Vault is locked — unlock to view message body' }
    }
    throw err
  }
  if (!keyHex) {
    return { ok: false, error: 'Quarantine decryption key unavailable for this replica' }
  }

  let plaintext: Buffer | null = null
  try {
    plaintext = decryptLocalQuarantinePlaintext(wireRaw, keyHex)
    const textContent = quarantinePlaintextToSandboxText(plaintext)
    return { ok: true, textContent }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    zeroizeBuffer(plaintext)
  }
}

export function confirmationMatchesQuarantineEntry(
  metadata: LocalQuarantineMetadata,
  confirmationText: string,
): boolean {
  const trimmed = confirmationText.trim()
  if (!trimmed) return false
  return trimmed === metadata.envelope_from || trimmed === metadata.envelope_subject_filtered
}
