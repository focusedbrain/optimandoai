/**
 * Tests: Audit Log Retention + JSONL Export
 *
 * Validates:
 *   1. Ring buffer never exceeds MAX_AUDIT_ENTRIES
 *   2. Old entries are pruned by MAX_AUDIT_AGE_MS
 *   3. exportAuditLogJsonl() produces valid JSONL with schemaVersion
 *   4. Export respects MAX_EXPORT_BYTES and returns truncated=true
 *   5. Exported text contains no raw PII (email/uuid/iban/token)
 *   6. Message redaction and meta sanitization remain unchanged
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  auditLog,
  getAuditLog,
  clearAuditLog,
  exportAuditLogJsonl,
  MAX_AUDIT_ENTRIES,
  MAX_AUDIT_AGE_MS,
  MAX_EXPORT_BYTES,
} from '../hardening'

// ============================================================================
// Helpers
// ============================================================================

const PII = {
  email: 'oscar.schreyer@example.com',
  uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  iban: 'DE89370400440532013000',
  base64: 'dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB0aGF0IHNob3VsZCBub3QgYmUgbG9nZ2Vk',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.rg2e30W3k_Smple_Sig',
  password: 'My$ecretP@ssw0rd!',
}

function fillBuffer(count: number, codePrefix = 'TEST'): void {
  for (let i = 0; i < count; i++) {
    auditLog('info', `${codePrefix}_${i}`, `entry ${i}`, { fieldCount: i })
  }
}

// ============================================================================
// §1  Exported constants
// ============================================================================

describe('Exported constants', () => {
  it('MAX_AUDIT_ENTRIES is 500', () => {
    expect(MAX_AUDIT_ENTRIES).toBe(500)
  })

  it('MAX_AUDIT_AGE_MS is 24 hours', () => {
    expect(MAX_AUDIT_AGE_MS).toBe(86_400_000)
  })

  it('MAX_EXPORT_BYTES is 512 KB', () => {
    expect(MAX_EXPORT_BYTES).toBe(512 * 1024)
  })
})

// ============================================================================
// §2  Ring buffer retention — never exceeds MAX_AUDIT_ENTRIES
// ============================================================================

describe('Ring buffer retention', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('buffer grows up to MAX_AUDIT_ENTRIES', () => {
    fillBuffer(MAX_AUDIT_ENTRIES)
    expect(getAuditLog().length).toBe(MAX_AUDIT_ENTRIES)
  })

  it('buffer never exceeds MAX_AUDIT_ENTRIES after overflow', () => {
    fillBuffer(MAX_AUDIT_ENTRIES + 100)
    const log = getAuditLog()
    expect(log.length).toBeLessThanOrEqual(MAX_AUDIT_ENTRIES)
  })

  it('oldest entries are dropped on overflow', () => {
    fillBuffer(MAX_AUDIT_ENTRIES + 50)
    const log = getAuditLog()
    // The first entry should NOT be TEST_0 (it was dropped)
    expect(log[0].code).not.toBe('TEST_0')
    // The last entry should be the most recent
    expect(log[log.length - 1].code).toBe(`TEST_${MAX_AUDIT_ENTRIES + 49}`)
  })

  it('buffer is empty after clearAuditLog()', () => {
    fillBuffer(10)
    clearAuditLog()
    expect(getAuditLog().length).toBe(0)
  })
})

// ============================================================================
// §3  Time-based retention — prune entries older than MAX_AUDIT_AGE_MS
// ============================================================================

describe('Time-based retention (age pruning)', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prunes entries older than MAX_AUDIT_AGE_MS on next push', () => {
    // Insert an entry with a timestamp far in the past by manipulating Date
    const oldDate = new Date(Date.now() - MAX_AUDIT_AGE_MS - 60_000) // 1 min past cutoff

    // Manually push an old entry via auditLog by stubbing Date
    const origDate = globalThis.Date
    const mockDate = class extends origDate {
      constructor() {
        super()
        return oldDate
      }
      toISOString() { return oldDate.toISOString() }
      static now() { return origDate.now() }
    } as any
    mockDate.parse = origDate.parse
    mockDate.UTC = origDate.UTC
    globalThis.Date = mockDate

    auditLog('info', 'OLD_ENTRY', 'this is old')

    // Restore Date
    globalThis.Date = origDate

    // Verify the old entry is in the buffer
    expect(getAuditLog().length).toBe(1)
    expect(getAuditLog()[0].code).toBe('OLD_ENTRY')

    // Push a new entry — this triggers age pruning
    auditLog('info', 'NEW_ENTRY', 'this is new')

    const log = getAuditLog()
    // The old entry should have been pruned
    const codes = log.map(e => e.code)
    expect(codes).not.toContain('OLD_ENTRY')
    expect(codes).toContain('NEW_ENTRY')
  })

  it('does not prune entries within MAX_AUDIT_AGE_MS', () => {
    auditLog('info', 'RECENT_1', 'recent entry 1')
    auditLog('info', 'RECENT_2', 'recent entry 2')

    // Push another to trigger pruning check
    auditLog('info', 'RECENT_3', 'recent entry 3')

    const log = getAuditLog()
    expect(log.length).toBe(3)
    expect(log.map(e => e.code)).toEqual(['RECENT_1', 'RECENT_2', 'RECENT_3'])
  })
})

// ============================================================================
// §4  JSONL Export — format + schemaVersion
// ============================================================================

describe('exportAuditLogJsonl() — JSONL format', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('returns empty jsonl for empty buffer', () => {
    const { jsonl, truncated } = exportAuditLogJsonl()
    expect(jsonl).toBe('')
    expect(truncated).toBe(false)
  })

  it('produces valid JSONL (one object per line)', () => {
    fillBuffer(5)
    const { jsonl } = exportAuditLogJsonl()
    const lines = jsonl.split('\n').filter(l => l.length > 0)
    expect(lines.length).toBe(5)

    for (const line of lines) {
      const obj = JSON.parse(line)
      expect(obj).toHaveProperty('schemaVersion', 'auditlog-v1')
      expect(obj).toHaveProperty('ts')
      expect(obj).toHaveProperty('level')
      expect(obj).toHaveProperty('code')
      expect(obj).toHaveProperty('message')
      expect(obj).toHaveProperty('domain')
    }
  })

  it('includes meta when present', () => {
    auditLog('info', 'TEST', 'msg', { fieldCount: 7, ha: true })
    const { jsonl } = exportAuditLogJsonl()
    const obj = JSON.parse(jsonl)
    expect(obj.meta).toEqual({ fieldCount: 7, ha: true })
  })

  it('omits meta field when no meta', () => {
    auditLog('info', 'TEST', 'no meta')
    const { jsonl } = exportAuditLogJsonl()
    const obj = JSON.parse(jsonl)
    expect(obj.meta).toBeUndefined()
  })

  it('preserves chronological order', () => {
    auditLog('info', 'FIRST', 'first')
    auditLog('info', 'SECOND', 'second')
    auditLog('info', 'THIRD', 'third')
    const { jsonl } = exportAuditLogJsonl()
    const lines = jsonl.split('\n')
    const codes = lines.map(l => JSON.parse(l).code)
    expect(codes).toEqual(['FIRST', 'SECOND', 'THIRD'])
  })
})

// ============================================================================
// §5  Export byte cap — MAX_EXPORT_BYTES
// ============================================================================

describe('exportAuditLogJsonl() — byte cap', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('returns truncated=false when within MAX_EXPORT_BYTES', () => {
    fillBuffer(5)
    const { truncated } = exportAuditLogJsonl()
    expect(truncated).toBe(false)
  })

  it('returns truncated=true when export would exceed MAX_EXPORT_BYTES', () => {
    // Use space-separated short words to create long messages that won't
    // be redacted by base64/token patterns (which require 20+ consecutive
    // alphanumeric chars without spaces).
    const longMsg = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ') // ~2000 chars
    for (let i = 0; i < MAX_AUDIT_ENTRIES; i++) {
      auditLog('info', `BIG_${i}`, longMsg)
    }

    const { jsonl, truncated } = exportAuditLogJsonl()

    // With ~2100 bytes per entry × 500 = ~1.05 MB > 512 KB → must truncate
    expect(truncated).toBe(true)
    // Output must not exceed the cap
    expect(jsonl.length).toBeLessThanOrEqual(MAX_EXPORT_BYTES)
    // But should contain some entries (newest)
    const lines = jsonl.split('\n').filter(l => l.length > 0)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThan(MAX_AUDIT_ENTRIES)
  })

  it('on truncation, keeps newest entries (not oldest)', () => {
    const longMsg = Array.from({ length: 400 }, (_, i) => `v${i}`).join(' ')
    for (let i = 0; i < MAX_AUDIT_ENTRIES; i++) {
      auditLog('info', `ENT_${i}`, longMsg)
    }

    const { jsonl, truncated } = exportAuditLogJsonl()
    expect(truncated).toBe(true)

    const lines = jsonl.split('\n').filter(l => l.length > 0)
    const lastCode = JSON.parse(lines[lines.length - 1]).code
    // The very last entry in export should be the most recent one
    expect(lastCode).toBe(`ENT_${MAX_AUDIT_ENTRIES - 1}`)

    // The first entry in export should NOT be the overall first (it was truncated)
    const firstCode = JSON.parse(lines[0]).code
    expect(firstCode).not.toBe('ENT_0')
  })
})

// ============================================================================
// §6  Export contains no raw PII — belt-and-suspenders check
// ============================================================================

describe('Export PII safety', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('no raw PII in exported JSONL after toxic entries', () => {
    // Pump toxic data through both message and meta
    auditLog('info', 'T1', `User ${PII.email}`, { reason: PII.email } as any)
    auditLog('warn', 'T2', `Item ${PII.uuid}`, { sessionId: PII.uuid } as any)
    auditLog('error', 'T3', `IBAN: ${PII.iban}`, { reason: PII.iban } as any)
    auditLog('security', 'T4', `Token: ${PII.base64}`, { reason: PII.base64 } as any)
    auditLog('info', 'T5', `JWT: ${PII.jwt}`, { reason: PII.jwt } as any)
    auditLog('warn', 'T6', `password=${PII.password}`, { reason: `pass=${PII.password}` } as any)
    auditLog('info', 'T7', 'clean', { fieldCount: 2, ha: true })
    auditLog('info', 'T8', 'clean', { fullName: 'Oscar Schreyer' } as any)
    auditLog('info', 'T9', PII.email, { tabId: 1 })
    auditLog('info', 'T10', 'test', { reason: `for ${PII.email}` } as any)

    const { jsonl } = exportAuditLogJsonl()

    // Assert NO raw PII in the entire exported string
    expect(jsonl).not.toContain(PII.email)
    expect(jsonl).not.toContain(PII.uuid)
    expect(jsonl).not.toContain(PII.iban)
    expect(jsonl).not.toContain(PII.base64)
    expect(jsonl).not.toContain(PII.password)
    expect(jsonl).not.toContain('eyJhbGciOiJIUzI1NiJ9') // JWT header
    expect(jsonl).not.toContain('Oscar Schreyer') // dropped non-allowlisted key
    // Non-allowlisted keys must not appear
    expect(jsonl).not.toContain('"fullName"')
  })
})

// ============================================================================
// §7  Message redaction + meta sanitization unchanged
// ============================================================================

describe('Existing behavior preserved', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('message is still redacted via redactSecrets', () => {
    auditLog('warn', 'TEST', `User ${PII.email} failed login`)
    const log = getAuditLog()
    expect(log[0].message).not.toContain(PII.email)
    expect(log[0].message).toContain('[EMAIL_REDACTED]')
  })

  it('meta is still sanitized via sanitizeMeta (non-allowlisted keys dropped)', () => {
    auditLog('info', 'TEST', 'ok', {
      fieldCount: 3,
      secret: 'should_not_appear',
    } as any)
    const log = getAuditLog()
    expect(log[0].meta).toEqual({ fieldCount: 3 })
    expect(log[0].meta).not.toHaveProperty('secret')
  })

  it('auditLog never throws on malformed meta', () => {
    expect(() => {
      auditLog('info', 'TEST', 'ok', null as any)
      auditLog('info', 'TEST', 'ok', 42 as any)
      auditLog('info', 'TEST', 'ok', 'string' as any)
    }).not.toThrow()
  })
})

// ============================================================================
// §8  Edge cases
// ============================================================================

describe('Edge cases', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('export after clear returns empty', () => {
    fillBuffer(10)
    clearAuditLog()
    const { jsonl, truncated } = exportAuditLogJsonl()
    expect(jsonl).toBe('')
    expect(truncated).toBe(false)
  })

  it('each exported line is independently parseable', () => {
    fillBuffer(20)
    const { jsonl } = exportAuditLogJsonl()
    const lines = jsonl.split('\n').filter(l => l.length > 0)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('schemaVersion is present on every exported line', () => {
    fillBuffer(10)
    const { jsonl } = exportAuditLogJsonl()
    const lines = jsonl.split('\n').filter(l => l.length > 0)
    for (const line of lines) {
      expect(JSON.parse(line).schemaVersion).toBe('auditlog-v1')
    }
  })
})
