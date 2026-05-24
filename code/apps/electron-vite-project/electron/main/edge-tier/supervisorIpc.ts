/**
 * Supervisor dashboard IPC — replacement budget recovery (P5.7).
 */

import { ipcMain } from 'electron'
import { appendSupervisorAudit } from './supervisor/auditLog.js'
import {
  resumeAutomaticRecovery,
  getReplacementBudgetNotifications,
} from './supervisor/index.js'
import type { RemoteEdgeContainerRole } from './supervisor/containers.js'
import { listReports, getReport } from './supervisor/reportStore.js'
import { notifyDashboardUpdated } from './dashboard.js'

const CONTAINER_ROLES: ReadonlySet<string> = new Set([
  'ingestor',
  'validator',
  'depackager',
  'certifier',
  'mail-fetcher',
])

function parseContainerRole(raw: unknown): RemoteEdgeContainerRole {
  if (typeof raw !== 'string' || !CONTAINER_ROLES.has(raw)) {
    throw new Error('containerRole: expected valid REMOTE_EDGE container role')
  }
  return raw as RemoteEdgeContainerRole
}

function parseReplicaId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) {
    throw new Error('replicaId: expected non-empty string')
  }
  return raw
}

export function registerSupervisorDashboardIpcHandlers(): void {
  ipcMain.handle('dashboard:getReplacementBudgetNotifications', async () =>
    getReplacementBudgetNotifications(),
  )

  ipcMain.handle('dashboard:resumeAutomaticRecovery', async (_event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Invalid resumeAutomaticRecovery input')
    }
    const o = raw as Record<string, unknown>
    const replicaId = parseReplicaId(o.replicaId)
    const containerRole = parseContainerRole(o.containerRole)

    resumeAutomaticRecovery(replicaId, containerRole)
    appendSupervisorAudit({
      event: 'replacement_budget_cleared',
      replica_id: replicaId,
      container_role: containerRole,
      success: true,
      reason: 'manual_resume',
    })
    notifyDashboardUpdated()
    return { ok: true }
  })

  ipcMain.handle('dashboard:listDiagnosticReportsForRole', async (_event, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Invalid listDiagnosticReportsForRole input')
    }
    const o = raw as Record<string, unknown>
    const replicaId = parseReplicaId(o.replicaId)
    const containerRole = parseContainerRole(o.containerRole)

    const refs = listReports(replicaId)
    const reports: Array<{ filename: string; timestamp_iso8601: string; report_json: string }> = []

    for (const ref of refs) {
      const reportJson = getReport(replicaId, ref.filename)
      if (!reportJson) continue
      try {
        const parsed = JSON.parse(reportJson) as {
          timestamp_iso8601?: string
          failed_container?: { role?: string }
        }
        if (parsed.failed_container?.role !== containerRole) continue
        reports.push({
          filename: ref.filename,
          timestamp_iso8601: parsed.timestamp_iso8601 ?? ref.filename,
          report_json: reportJson,
        })
      } catch {
        /* skip malformed */
      }
    }

    reports.sort((a, b) => b.timestamp_iso8601.localeCompare(a.timestamp_iso8601))
    return reports
  })

  console.log(
    '[MAIN] IPC handlers registered: dashboard:getReplacementBudgetNotifications, dashboard:resumeAutomaticRecovery, dashboard:listDiagnosticReportsForRole',
  )
}
