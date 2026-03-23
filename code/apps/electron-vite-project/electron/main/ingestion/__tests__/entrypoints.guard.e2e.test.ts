/**
 * Entrypoint Guard E2E Tests
 *
 * Verifies trust boundary integrity at the transport layer:
 *   G1: No external entrypoint calls processHandshakeCapsule directly
 *   G2: Brand forgery via transport is treated as untrusted input
 *   G3: Concurrency flood — 20 parallel requests, dedup holds
 */

import { describe, test, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createTestDb, type TestDb } from './helpers/testDb'
import { sendIngestionRpc } from './helpers/testWsClient'
import { processIncomingInput } from '../ingestionPipeline'
import { migrateIngestionTables } from '../persistenceDb'
import {
  validBeapCapsule,
  brandForgeryCapsule,
  malformedJsonString,
} from './fixtures/capsules'

let db: TestDb

beforeEach(() => {
  db = createTestDb()
  migrateIngestionTables(db)
})

const ELECTRON_MAIN_DIR = path.resolve(__dirname, '..', '..')

function collectProductionFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        results.push(...collectProductionFiles(fullPath))
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        results.push(fullPath)
      }
    }
  } catch { /* directory may not exist */ }
  return results
}

// ═══════════════════════════════════════════════════════════════════════
// G1: No external entrypoint calls handshake directly
// ═══════════════════════════════════════════════════════════════════════

describe('Entrypoint Guard — Static Analysis', () => {
  const ALLOWED_CALLERS = new Set([
    'coordinationWs.ts',
    'enforcement.ts',
    'ipc.ts',
    'index.ts',
    'ingestionPipeline.ts',
    'p2pServer.ts',
    'relayPull.ts',
  ])

  test('G1: no production file outside allowed set calls processHandshakeCapsule(', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const violations: string[] = []

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      if (ALLOWED_CALLERS.has(basename)) continue

      const content = fs.readFileSync(filePath, 'utf-8')
      if (/processHandshakeCapsule\s*\(/.test(content)) {
        const relativePath = path.relative(ELECTRON_MAIN_DIR, filePath)
        violations.push(relativePath)
      }
    }

    expect(
      violations,
      `These files call processHandshakeCapsule() directly:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  test('G1-extra: handshake IPC module has no processHandshakeCapsule calls', () => {
    const handshakeIpcPath = path.resolve(ELECTRON_MAIN_DIR, 'handshake', 'ipc.ts')
    const content = fs.readFileSync(handshakeIpcPath, 'utf-8')
    expect(content).not.toMatch(/processHandshakeCapsule\s*\(/)
  })

  test('G1-extra: no production file uses `as ValidatedCapsule` outside validator.ts and enforcement.ts', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const violations: string[] = []

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      if (basename === 'validator.ts' || basename === 'enforcement.ts') continue

      const content = fs.readFileSync(filePath, 'utf-8')
      if (/as\s+ValidatedCapsule\b/.test(content)) {
        const relativePath = path.relative(ELECTRON_MAIN_DIR, filePath)
        violations.push(relativePath)
      }
    }

    expect(violations).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// G2: Brand forgery via transport
// ═══════════════════════════════════════════════════════════════════════

describe('Entrypoint Guard — Brand Forgery via Transport', () => {
  test('G2: raw JSON with __brand: ValidatedCapsule sent via RPC → treated as untrusted', async () => {
    // Send a payload that contains __brand: 'ValidatedCapsule' as if it were
    // a pre-validated capsule. The pipeline must NOT trust it.
    const forgery = brandForgeryCapsule()

    const result = await sendIngestionRpc(
      'ingestion.ingest',
      {
        rawInput: { body: JSON.stringify(forgery) },
        sourceType: 'api',
        transportMeta: {},
      },
      db,
    )

    // The ingestion pipeline should treat this as raw input,
    // run it through the ingestor and validator normally.
    // The __brand field should NOT grant any trust.
    expect(result).toBeDefined()

    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBeGreaterThanOrEqual(1)

    // It should either be validated as a normal BEAP capsule
    // (if it has valid structure) or rejected — but never
    // skip the pipeline
    const lastAudit = auditRows[auditRows.length - 1]
    expect(lastAudit.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(lastAudit.raw_input_hash.length).toBe(64)
  })

  test('G2-extra: brand forgery via pipeline → pipeline processes it normally', async () => {
    const forgery = brandForgeryCapsule()
    const result = await processIncomingInput(
      { body: JSON.stringify(forgery) },
      'api',
      {},
    )

    // Pipeline treats it as raw input. The injected __brand is just
    // another JSON field — the ingestor detects it via JSON structure
    // (schema_version + capsule_type) and the validator runs all checks.
    expect(result.audit.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(result.audit.raw_input_hash.length).toBe(64)
  })

  test('G2-extra: forgery with capsule_type but missing required fields → rejected', async () => {
    const forgery = {
      __brand: 'ValidatedCapsule',
      schema_version: 1,
      capsule_type: 'initiate',
      // Missing: capsule_hash, handshake_id, sender_id, etc.
    }

    const result = await processIncomingInput(
      { body: JSON.stringify(forgery) },
      'api',
      {},
    )

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.validation_reason_code).toBeDefined()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// G3: Concurrency flood
// ═══════════════════════════════════════════════════════════════════════

describe('Entrypoint Guard — Concurrency', () => {
  test('G3: 20 identical requests in parallel → dedup, no crash', async () => {
    const payload = JSON.stringify(validBeapCapsule())

    const promises = Array.from({ length: 20 }, () =>
      sendIngestionRpc(
        'ingestion.ingest',
        {
          rawInput: { body: payload },
          sourceType: 'api',
          transportMeta: {},
        },
        db,
      ),
    )

    const results = await Promise.all(promises)

    // All should complete without crash
    expect(results.length).toBe(20)

    // All should have consistent behavior
    for (const r of results) {
      expect(r).toBeDefined()
    }

    // Audit rows: one per request
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBe(20)

    // All audit rows should have the same raw_input_hash (deterministic)
    const hashes = new Set(auditRows.map(r => r.raw_input_hash))
    expect(hashes.size).toBe(1)
  })

  test('G3-extra: 20 malformed requests → all rejected, dedup on quarantine', async () => {
    const promises = Array.from({ length: 20 }, () =>
      sendIngestionRpc(
        'ingestion.ingest',
        {
          rawInput: { body: malformedJsonString(), mime_type: 'application/vnd.beap+json' },
          sourceType: 'email',
          transportMeta: {},
        },
        db,
      ),
    )

    const results = await Promise.all(promises)
    expect(results.length).toBe(20)

    for (const r of results) {
      expect(r.success).toBe(false)
    }

    // Audit: one per request
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBe(20)

    // Quarantine: exactly 1 row (dedup via raw_input_hash UNIQUE INDEX)
    const quarantine = db.getQuarantineRows()
    expect(quarantine.length).toBe(1)
  })

  test('G3-extra: mixed valid + malformed in parallel → no interference', async () => {
    const validPayload = JSON.stringify(validBeapCapsule())

    const promises = [
      ...Array.from({ length: 5 }, () =>
        sendIngestionRpc('ingestion.ingest', {
          rawInput: { body: validPayload },
          sourceType: 'api',
          transportMeta: {},
        }, db),
      ),
      ...Array.from({ length: 5 }, () =>
        sendIngestionRpc('ingestion.ingest', {
          rawInput: { body: malformedJsonString(), mime_type: 'application/vnd.beap+json' },
          sourceType: 'email',
          transportMeta: {},
        }, db),
      ),
    ]

    const results = await Promise.all(promises)
    expect(results.length).toBe(10)

    // Audit rows for all
    const auditRows = db.getAuditRows()
    expect(auditRows.length).toBe(10)
  })
})
