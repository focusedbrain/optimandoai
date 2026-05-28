/**
 * Pick up signed diagnostic reports from local pod containers via podman cp (Stream A — A5).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { isEscalationReportFilename } from '../../../../../../packages/beap-pod/src/shared/failurePolicy.js'
import { runPodman } from './podmanLocal.js'

const DIAG_DIR = '/tmp/diagnostic-reports'
const HOST_LOCAL_REPLICA_ID = 'host-pod'

export interface LocalPickedReport {
  filename: string
  isEscalation: boolean
  rawJson: string
}

export async function pickupLocalDiagnosticReports(
  containerName: string,
): Promise<LocalPickedReport[]> {
  const staging = mkdtempSync(join(tmpdir(), 'beap-host-diag-'))
  try {
    await runPodman(['cp', `${containerName}:${DIAG_DIR}/.`, `${staging}/`])
    const names = readdirSync(staging).filter((n) => n.endsWith('.json'))
    const out: LocalPickedReport[] = []
    for (const name of names) {
      const rawJson = readFileSync(join(staging, name), 'utf8')
      out.push({
        filename: name,
        isEscalation: isEscalationReportFilename(name),
        rawJson,
      })
      // Persist under host-local diagnostic path (opaque JSON only)
      try {
        const { storeDiagnosticReport } = await import(
          '../../edge-tier/supervisor/reportStore.js'
        )
        storeDiagnosticReport(HOST_LOCAL_REPLICA_ID, 'host-pod', rawJson, name)
      } catch {
        /* electron edge-tier optional in unit tests */
      }
    }
    return out
  } catch {
    return []
  } finally {
    try {
      rmSync(staging, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
