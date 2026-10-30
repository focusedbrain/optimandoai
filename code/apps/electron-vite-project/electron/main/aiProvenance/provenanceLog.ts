/**
 * Append-only Art. 50 generation provenance log (JSONL under userData).
 * Not stored in handshake-ledger / email-accounts / orchestrator-mode files.
 */

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AiProvenance } from '../../../../../packages/shared/src/aiProvenance'

const LOG_DIR = 'ai-provenance'
const LOG_FILE = 'generations.jsonl'

function logPath(): string {
  return path.join(app.getPath('userData'), LOG_DIR, LOG_FILE)
}

export type ProvenanceLogRecord = AiProvenance & {
  logged_at: string
  event?: 'generation' | 'editorial_responsibility' | 'human_edit'
}

/** Append one generation (or related) event. Failures are swallowed — never block inference. */
export function logGeneration(
  p: AiProvenance,
  event: ProvenanceLogRecord['event'] = 'generation',
): void {
  try {
    const dir = path.join(app.getPath('userData'), LOG_DIR)
    fs.mkdirSync(dir, { recursive: true })
    const record: ProvenanceLogRecord = {
      ...p,
      logged_at: new Date().toISOString(),
      event,
    }
    fs.appendFileSync(logPath(), `${JSON.stringify(record)}\n`, 'utf8')
  } catch (e) {
    console.warn(
      '[art50-prov] logGeneration failed:',
      e instanceof Error ? e.message : String(e),
    )
  }
}

/** Convenience: create is caller's job; this only logs. */
export function logEditorialResponsibility(p: AiProvenance): void {
  logGeneration(p, 'editorial_responsibility')
}
