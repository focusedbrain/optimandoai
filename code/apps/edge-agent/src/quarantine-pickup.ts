import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { AgentStorage, AgentPersistedState, QuarantineQueueEntry } from './storage.js'
import { runPodman } from './podman.js'

const QUARANTINE_DIR = '/var/lib/quarantine'

function signPayload(secret: Buffer, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export async function pickupQuarantineEntries(
  storage: AgentStorage,
  containerName: string,
  signingSecret: Buffer,
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
  const state = await storage.loadState()
  const queue = [...(state.quarantineQueue ?? [])]

  for (const hash of hashes) {
    const staging = mkdtempSync(join(tmpdir(), 'beap-agent-q-'))
    try {
      await runPodman(['cp', `${containerName}:${QUARANTINE_DIR}/${hash}/.`, `${staging}/`])
      const meta = readFileSync(join(staging, 'metadata.json'), 'utf8')
      const raw = readFileSync(join(staging, 'raw_bytes'))
      const entry: QuarantineQueueEntry = {
        hash,
        metadataJson: meta,
        rawBytesB64: raw.toString('base64'),
        pickedUpAt: new Date().toISOString(),
        signature: signPayload(signingSecret, `${hash}:${meta}:${raw.toString('base64')}`),
      }
      queue.push(entry)
      count += 1
      await runPodman(['exec', containerName, 'rm', '-rf', `${QUARANTINE_DIR}/${hash}`])
    } catch {
      /* skip corrupt */
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }

  if (count > 0) {
    await storage.saveState({ ...state, quarantineQueue: queue })
  }
  return count
}

/** Stable signing material without persisting extra secrets. */
export async function quarantineSigningSecretForStorage(storage: AgentStorage): Promise<Buffer> {
  const state = await storage.loadState()
  const material = JSON.stringify({ sub: state.ssoSub ?? 'anon', phase: state.phase })
  return createHmac('sha256', 'wrdesk-agent-quarantine-v1').update(material).digest()
}
