/**
 * Edge verification audit store — unit tests (P3.10)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  _setAuditStorePathForTest,
  _resetAuditStoreForTest,
  parseVerifierAuditLine,
  appendEdgeVerification,
  getRecentEdgeVerifications,
  getReplicaVerificationStats,
  MAX_EDGE_VERIFICATIONS,
  BEAP_EDGE_VERIFICATION_AUDIT_TYPE,
} from '../verificationAudit.js'

describe('parseVerifierAuditLine', () => {
  test('parses valid verifier JSON audit line', () => {
    const line = JSON.stringify({
      type: BEAP_EDGE_VERIFICATION_AUDIT_TYPE,
      timestamp: '2026-05-24T12:00:00.000Z',
      edge_pod_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      sub: 'user-1',
      result: 'verified',
      phase: 'shallow',
    })
    const record = parseVerifierAuditLine(line)
    expect(record).not.toBeNull()
    expect(record!.result).toBe('verified')
    expect(record!.phase).toBe('shallow')
  })

  test('ignores non-audit lines', () => {
    expect(parseVerifierAuditLine('[verifier] verify-cert rejected')).toBeNull()
  })
})

describe('appendEdgeVerification ring buffer', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'edge-audit-'))
    _setAuditStorePathForTest(join(tempDir, 'edge-verification-audit.json'))
    _resetAuditStoreForTest()
  })

  afterEach(() => {
    _setAuditStorePathForTest(null)
    _resetAuditStoreForTest()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('keeps last 50 verifications', () => {
    for (let i = 0; i < MAX_EDGE_VERIFICATIONS + 5; i++) {
      appendEdgeVerification({
        timestamp: `2026-05-24T12:00:${String(i).padStart(2, '0')}.000Z`,
        edge_pod_id: 'pod-1',
        sub: 'sub',
        result: i % 2 === 0 ? 'verified' : 'CERT_EXPIRED',
        phase: 'shallow',
      })
    }
    const recent = getRecentEdgeVerifications()
    expect(recent.length).toBe(MAX_EDGE_VERIFICATIONS)
    expect(recent[0]!.timestamp).toContain(':54')
  })

  test('tracks replica success and failure timestamps', () => {
    appendEdgeVerification({
      timestamp: '2026-05-24T12:00:00.000Z',
      edge_pod_id: 'POD-A',
      sub: 'sub',
      result: 'verified',
      phase: 'shallow',
    })
    appendEdgeVerification({
      timestamp: '2026-05-24T12:01:00.000Z',
      edge_pod_id: 'POD-A',
      sub: 'sub',
      result: 'PACKAGE_HASH_MISMATCH',
      phase: 'deep',
    })
    const stats = getReplicaVerificationStats()
    expect(stats['pod-a']!.last_success_at).toContain('12:00')
    expect(stats['pod-a']!.last_failure_reason).toBe('PACKAGE_HASH_MISMATCH')
  })
})
