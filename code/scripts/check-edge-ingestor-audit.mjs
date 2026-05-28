#!/usr/bin/env node
/**
 * CI guard: edge-ingestor-type-audit.md exists and lists reviewed sandbox-only sites.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const auditPath = join(root, 'docs', 'edge-ingestor-type-audit.md')

if (!existsSync(auditPath)) {
  console.error('Missing docs/edge-ingestor-type-audit.md')
  process.exit(1)
}

const text = readFileSync(auditPath, 'utf8')
const required = [
  'hostAiInternalPairingLedger',
  'outboundQueue.ts',
  'handshakeAccountIsolation',
  'pairingConfirm.ts',
  'edge_ingestor',
]

for (const needle of required) {
  if (!text.includes(needle)) {
    console.error(`Audit doc missing required reference: ${needle}`)
    process.exit(1)
  }
}

console.log('edge-ingestor audit checklist OK')
