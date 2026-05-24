/**
 * Pick up signed diagnostic reports from an exited container on the VM (P5.4).
 */

import { shellQuote } from '../ssh/deploy.js'
import type { ReplicaActionSshRunner } from '../replicaActions.js'
import { storeDiagnosticReport, type StoreReportResult } from './reportStore.js'

export const VM_DIAG_PICKUP_DIR = '/tmp/beap-supervisor-diag-pickup'

export interface PickedUpReport {
  filename: string
  storeResult: StoreReportResult
}

export interface ReportPickupResult {
  reports: PickedUpReport[]
}

/** Copy reports from container to VM staging, read contents, delete staging. */
export async function pickupDiagnosticReports(
  ssh: ReplicaActionSshRunner,
  replicaId: string,
  edgePublicKeyClaim: string,
  containerName: string,
): Promise<ReportPickupResult> {
  const staging = `${VM_DIAG_PICKUP_DIR}/${containerName}`
  await ssh.run(`rm -rf ${shellQuote(staging)} && mkdir -p ${shellQuote(staging)}`)
  await ssh.run(
    `podman cp ${containerName}:/tmp/diagnostic-reports/. ${shellQuote(`${staging}/`)} 2>/dev/null || true`,
  )

  const listResult = await ssh.run(`ls -1 ${shellQuote(staging)} 2>/dev/null || true`)
  const filenames = listResult.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((name) => name.endsWith('.json'))

  const reports: PickedUpReport[] = []
  for (const name of filenames) {
    const catResult = await ssh.run(`cat ${shellQuote(`${staging}/${name}`)}`)
    if (catResult.code !== 0 || !catResult.stdout.trim()) continue
    const storeResult = storeDiagnosticReport(
      replicaId,
      edgePublicKeyClaim,
      catResult.stdout,
      name,
    )
    reports.push({ filename: name, storeResult })
  }

  await ssh.run(`rm -rf ${shellQuote(staging)}`)

  return { reports }
}

/** Host-level pickup when reports were written to VM /tmp/diagnostic-reports (legacy path). */
export async function pickupHostDiagnosticReports(
  ssh: ReplicaActionSshRunner,
  replicaId: string,
  edgePublicKeyClaim: string,
  hostDir = '/tmp/diagnostic-reports',
): Promise<ReportPickupResult> {
  const listResult = await ssh.run(`ls -1 ${shellQuote(hostDir)} 2>/dev/null || true`)
  const filenames = listResult.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((name) => name.endsWith('.json'))

  const reports: PickedUpReport[] = []
  for (const name of filenames) {
    const catResult = await ssh.run(`cat ${shellQuote(`${hostDir}/${name}`)}`)
    if (catResult.code !== 0 || !catResult.stdout.trim()) continue
    const storeResult = storeDiagnosticReport(
      replicaId,
      edgePublicKeyClaim,
      catResult.stdout,
      name,
    )
    reports.push({ filename: name, storeResult })
    await ssh.run(`rm -f ${shellQuote(`${hostDir}/${name}`)}`)
  }
  return { reports }
}
