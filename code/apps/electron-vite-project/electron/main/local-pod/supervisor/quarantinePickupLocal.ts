/**
 * Pick up quarantine blobs from LOCAL_HOST depackager via podman cp (Stream A — A4/A5).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { storeLocalQuarantineEntry } from '../../edge-tier/supervisor/quarantineStore.js'
import { runPodman } from './podmanLocal.js'

const QUARANTINE_DIR = '/var/lib/quarantine'
const HOST_LOCAL_REPLICA_ID = 'host-pod'

export async function pickupLocalQuarantineEntries(
  containerName: string,
): Promise<number> {
  const list = await runPodman([
    'exec',
    containerName,
    'sh',
    '-c',
    `ls -1 ${QUARANTINE_DIR} 2>/dev/null || true`,
  ])
  if (list.code !== 0) return 0

  const hashes = list.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  let count = 0
  for (const hash of hashes) {
    const staging = mkdtempSync(join(tmpdir(), 'beap-host-q-'))
    try {
      await runPodman(['cp', `${containerName}:${QUARANTINE_DIR}/${hash}/.`, `${staging}/`])
      const metaPath = join(staging, 'metadata.json')
      const rawPath = join(staging, 'raw_bytes')
      const meta = readFileSync(metaPath, 'utf8')
      const raw = readFileSync(rawPath)
      storeLocalQuarantineEntry(HOST_LOCAL_REPLICA_ID, hash, raw.toString('latin1'), meta)
      count += 1
      await runPodman([
        'exec',
        containerName,
        'rm',
        '-rf',
        `${QUARANTINE_DIR}/${hash}`,
      ])
    } catch {
      /* skip corrupt entry */
    } finally {
      try {
        rmSync(staging, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
  return count
}
