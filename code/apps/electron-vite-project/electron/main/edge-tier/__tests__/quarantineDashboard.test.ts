/**
 * Quarantine dashboard backend tests — P5.6.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, randomBytes } from 'node:crypto'

import {
  _setLocalQuarantineRootForTest,
  storeLocalQuarantineEntry,
} from '../supervisor/quarantineStore.js'
import { _setDiagnosticReportsRootForTest } from '../supervisor/reportStore.js'
import {
  buildQuarantineDashboardSummary,
  listQuarantineItems,
  prepareSandboxViewPayload,
  confirmationMatchesQuarantineEntry,
  findReportFilenameForHash,
} from '../quarantineDashboard.js'
import { _setQuarantineKeyStorePathForTest, storeWrappedQuarantineKey } from '../quarantineKeyStorage.js'

const replicaId = '11111111-1111-4111-8111-111111111111'
const hash = 'c'.repeat(64)

const mockVault = {
  deriveApplicationKey: () => Buffer.alloc(32, 7),
}

describe('quarantineDashboard (P5.6)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'quarantine-dashboard-'))
    process.env['WR_DESK_USER_DATA'] = tempDir
    _setLocalQuarantineRootForTest(join(tempDir, 'diagnostic-reports'))
    _setDiagnosticReportsRootForTest(join(tempDir, 'diagnostic-reports'))
    _setQuarantineKeyStorePathForTest(join(tempDir, 'edge-quarantine-keys.json'))
  })

  afterEach(() => {
    delete process.env['WR_DESK_USER_DATA']
    _setLocalQuarantineRootForTest(null)
    _setDiagnosticReportsRootForTest(null)
    _setQuarantineKeyStorePathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('buildQuarantineDashboardSummary aggregates counts', () => {
    storeLocalQuarantineEntry(
      replicaId,
      hash,
      '{"iv":"00","tag":"00","ciphertext":"aa"}',
      JSON.stringify({
        hash,
        envelope_from: 'a@b.com',
        envelope_subject_filtered: 'Hello',
        quarantined_at: '2026-05-24T12:00:00.000Z',
        failed_container_role: 'depackager',
      }),
    )

    const summary = buildQuarantineDashboardSummary()
    expect(summary.total_count).toBe(1)
    expect(summary.by_replica[0]?.count).toBe(1)
    expect(listQuarantineItems(replicaId)).toHaveLength(1)
  })

  test('findReportFilenameForHash links report to quarantine hash', () => {
    const reportsDir = join(tempDir, 'diagnostic-reports', replicaId)
    mkdirSync(reportsDir, { recursive: true })
    writeFileSync(
      join(reportsDir, '2026-05-24T12-00-00-000Z-abc123456789.json'),
      JSON.stringify({
        message_under_processing: { sha256_hex: hash },
      }),
    )
    expect(findReportFilenameForHash(replicaId, hash)).toBe(
      '2026-05-24T12-00-00-000Z-abc123456789.json',
    )
  })

  test('prepareSandboxViewPayload decrypts raw email body', () => {
    const keyHex = randomBytes(32).toString('hex')
    storeWrappedQuarantineKey(replicaId, keyHex, mockVault)

    const plaintext = Buffer.from('From: test@example.com\r\nSubject: Hi\r\n\r\nBody')
    const key = Buffer.from(keyHex, 'hex')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const wire = JSON.stringify({
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: encrypted.toString('hex'),
    })

    storeLocalQuarantineEntry(
      replicaId,
      hash,
      wire,
      JSON.stringify({
        hash,
        envelope_from: 'test@example.com',
        envelope_subject_filtered: 'Hi',
        quarantined_at: '2026-05-24T12:00:00.000Z',
        failed_container_role: 'depackager',
      }),
    )

    const result = prepareSandboxViewPayload('raw_email_body', replicaId, hash, mockVault)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.textContent).toContain('From: test@example.com')
    }
  })

  test('confirmationMatchesQuarantineEntry accepts from or subject', () => {
    const metadata = {
      hash,
      envelope_from: 'sender@example.com',
      envelope_to: 'to@example.com',
      envelope_date: '2026-05-24T12:00:00.000Z',
      envelope_subject_filtered: 'Filtered subject',
      quarantined_at: '2026-05-24T12:00:00.000Z',
      failed_container_role: 'depackager',
      failed_stage: 'mime_decode',
    }
    expect(confirmationMatchesQuarantineEntry(metadata, 'sender@example.com')).toBe(true)
    expect(confirmationMatchesQuarantineEntry(metadata, 'Filtered subject')).toBe(true)
    expect(confirmationMatchesQuarantineEntry(metadata, 'wrong')).toBe(false)
  })
})
