/**
 * Append-only supervisor audit trail — Phase 5 (P5.4).
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export type SupervisorAuditEventKind =
  | 'container_replaced'
  | 'container_replaced_failed'
  | 'container_unreachable'
  | 'message_quarantined'
  | 'message_discarded'
  | 'replacement_budget_exhausted'
  | 'replacement_budget_cleared'
  | 'pod_replaced'
  | 'pod_replaced_failed'
  | 'nuclear_reset'

export interface SupervisorAuditEntry {
  timestamp: string
  event: SupervisorAuditEventKind
  replica_id: string
  container_role: string
  report_filename?: string
  duration_ms?: number
  success: boolean
  reason?: string
  message_hash?: string
  envelope_from?: string
  confirmation_timestamp?: string
  confirmation_user_input_hash?: string
}

const AUDIT_FILENAME = 'edge-tier-audit.log'

let _auditPathOverride: string | null = null

export function _setSupervisorAuditPathForTest(path: string | null): void {
  _auditPathOverride = path
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

function getAuditPath(): string {
  if (_auditPathOverride) return _auditPathOverride
  return join(getUserDataDir(), AUDIT_FILENAME)
}

export function appendSupervisorAudit(entry: Omit<SupervisorAuditEntry, 'timestamp'>): void {
  const line: SupervisorAuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  }
  const path = getAuditPath()
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(line)}\n`, { mode: 0o600 })
}

export function readSupervisorAuditEntries(): SupervisorAuditEntry[] {
  const path = getAuditPath()
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SupervisorAuditEntry)
}
