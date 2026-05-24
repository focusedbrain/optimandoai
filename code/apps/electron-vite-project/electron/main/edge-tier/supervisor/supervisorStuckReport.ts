/**
 * Supervisor-authored diagnostic reports for SIGKILL stuck containers (P5.9).
 */

import type { DiagnosticReportV1 } from '@repo/beap-cert'
import { signDiagnosticReport } from '@repo/beap-cert'

import type { EdgeReplica } from '../settings.js'
import type { EdgeTierPodVault } from '../podLifecycle.js'
import type { RemoteEdgeContainerRole } from './containers.js'
import { loadSupervisorSigningPrivateKey } from './supervisorSigningKey.js'
import { storeDiagnosticReport, type StoreReportResult } from './reportStore.js'

/** Line reference for supervisor-generated StuckHealthProbeError reports. */
export const SUPERVISOR_STUCK_KILL_SOURCE_LINE = 89

export interface BuildStuckContainerReportArgs {
  replica: EdgeReplica
  role: RemoteEdgeContainerRole
  containerIdShort: string
  previousUptimeSeconds: number
  vault: EdgeTierPodVault
  now?: () => Date
}

export function buildSupervisorStuckReport(
  args: BuildStuckContainerReportArgs,
): DiagnosticReportV1 | null {
  const privateKey = loadSupervisorSigningPrivateKey(args.vault)
  if (!privateKey) return null

  const unsigned = {
    report_v: 1 as const,
    signer: 'supervisor' as const,
    edge_pod_id: args.replica.edge_pod_id,
    replica_id: args.replica.edge_pod_id,
    timestamp_iso8601: (args.now ?? (() => new Date()))().toISOString(),
    failed_container: {
      role: args.role,
      container_id_short: args.containerIdShort,
      previous_uptime_seconds: args.previousUptimeSeconds,
    },
    failure: {
      exception_kind: 'StuckHealthProbeError' as const,
      stage: 'pod_internal' as const,
      source_file_basename: 'supervisor.ts',
      source_line: SUPERVISOR_STUCK_KILL_SOURCE_LINE,
    },
    system_metrics_at_failure: {
      cpu_percent: 0,
      memory_mb: 0,
      fd_count: 0,
      container_uptime_seconds: args.previousUptimeSeconds,
    },
    message_under_processing: null,
  }

  return signDiagnosticReport(unsigned, privateKey)
}

export function storeSupervisorStuckReport(
  args: BuildStuckContainerReportArgs,
  supervisorPublicKeyClaim: string,
): StoreReportResult & { rawJson?: string; filename?: string } {
  const report = buildSupervisorStuckReport(args)
  if (!report) {
    return { stored: false, reason: 'invalid_signature' }
  }

  const rawJson = JSON.stringify(report)
  const timestamp = report.timestamp_iso8601.replace(/[:.]/g, '-')
  const suggestedFilename = `${timestamp}-${report.failed_container.container_id_short}-supervisor.json`
  const result = storeDiagnosticReport(
    args.replica.edge_pod_id,
    args.replica.edge_public_key,
    rawJson,
    suggestedFilename,
    supervisorPublicKeyClaim,
  )
  return { ...result, rawJson, filename: result.filename ?? suggestedFilename }
}
