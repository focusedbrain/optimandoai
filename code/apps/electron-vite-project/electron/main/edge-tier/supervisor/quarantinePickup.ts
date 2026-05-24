/**
 * Pick up quarantine entries from edge pod volume via SSH (P5.5).
 */

import { shellQuote } from '../ssh/deploy.js'
import type { ReplicaActionSshRunner } from '../replicaActions.js'
import { storeLocalQuarantineEntry } from './quarantineStore.js'

export const EDGE_QUARANTINE_DIR = '/var/lib/quarantine'
export const VM_QUARANTINE_PICKUP_DIR = '/tmp/beap-supervisor-quarantine-pickup'

export interface PickedUpQuarantineEntry {
  hash: string
  envelope_from: string
  failed_container_role: string
}

export interface QuarantinePickupResult {
  entries: PickedUpQuarantineEntry[]
}

function extractHashesFromReports(reportJsonContents: string[]): Set<string> {
  const hashes = new Set<string>()
  for (const raw of reportJsonContents) {
    try {
      const report = JSON.parse(raw) as {
        message_under_processing?: { sha256_hex?: string } | null
      }
      const hash = report.message_under_processing?.sha256_hex
      if (hash) hashes.add(hash)
    } catch {
      /* skip */
    }
  }
  return hashes
}

/** Pick up quarantine blobs referenced by stored diagnostic reports. */
export async function pickupQuarantineEntries(
  ssh: ReplicaActionSshRunner,
  replicaId: string,
  containerName: string,
  reportJsonContents: string[],
): Promise<QuarantinePickupResult> {
  const hashes = extractHashesFromReports(reportJsonContents)
  const entries: PickedUpQuarantineEntry[] = []

  for (const hash of hashes) {
    const staging = `${VM_QUARANTINE_PICKUP_DIR}/${hash}`
    await ssh.run(`rm -rf ${shellQuote(staging)} && mkdir -p ${shellQuote(staging)}`)
    await ssh.run(
      `podman cp ${containerName}:${EDGE_QUARANTINE_DIR}/${hash}/. ${shellQuote(`${staging}/`)} 2>/dev/null || true`,
    )

    const metaResult = await ssh.run(`cat ${shellQuote(`${staging}/metadata.json`)} 2>/dev/null || true`)
    const rawResult = await ssh.run(`cat ${shellQuote(`${staging}/raw_bytes`)} 2>/dev/null || true`)
    if (!metaResult.stdout.trim() || !rawResult.stdout.trim()) {
      await ssh.run(`rm -rf ${shellQuote(staging)}`)
      continue
    }

    storeLocalQuarantineEntry(replicaId, hash, rawResult.stdout, metaResult.stdout)

    let metadata: { envelope_from?: string; failed_container_role?: string } = {}
    try {
      metadata = JSON.parse(metaResult.stdout) as typeof metadata
    } catch {
      /* defaults */
    }

    entries.push({
      hash,
      envelope_from: metadata.envelope_from ?? '',
      failed_container_role: metadata.failed_container_role ?? 'unknown',
    })

    await ssh.run(`rm -rf ${shellQuote(staging)}`)
  }

  return { entries }
}
