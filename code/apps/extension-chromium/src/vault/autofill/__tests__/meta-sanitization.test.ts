/**
 * Tests: Meta Sanitization for auditLog()
 *
 * Proves that the meta field can NEVER leak PII/secrets into the audit buffer.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  sanitizeMeta,
  auditLog,
  auditLogSafe,
  getAuditLog,
  clearAuditLog,
} from '../hardening'

// ============================================================================
// §1  Sensitive test data
// ============================================================================

const PII = {
  email: 'oscar.schreyer@example.com',
  uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  iban: 'DE89370400440532013000',
  base64: 'dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB0aGF0IHNob3VsZCBub3QgYmUgbG9nZ2Vk',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.rg2e30W3k_Smple_Sig',
  password: 'My$ecretP@ssw0rd!',
  fullName: 'Oscar Schreyer',
  phone: '+49 170 1234567',
}

// ============================================================================
// §2  sanitizeMeta — Key allowlist
// ============================================================================

describe('sanitizeMeta — key allowlist', () => {
  it('drops non-allowlisted keys entirely', () => {
    const result = sanitizeMeta({
      fullName: PII.fullName,
      email: PII.email,
      secretToken: PII.base64,
      internalId: 42,
    })
    // None of these keys are in the allowlist
    expect(result).toBeUndefined()
  })

  it('preserves allowlisted key with safe number value', () => {
    const result = sanitizeMeta({ fieldCount: 3 })
    expect(result).toEqual({ fieldCount: 3 })
  })

  it('preserves allowlisted key with safe boolean value', () => {
    const result = sanitizeMeta({ ha: true, partial: false })
    expect(result).toEqual({ ha: true, partial: false })
  })

  it('preserves allowlisted key with safe short string', () => {
    const result = sanitizeMeta({ reason: 'writes_disabled', state: 'preview' })
    expect(result).toEqual({ reason: 'writes_disabled', state: 'preview' })
  })

  it('preserves multiple allowlisted keys', () => {
    const result = sanitizeMeta({
      fieldCount: 5,
      ha: true,
      durationMs: 42,
      reason: 'timeout',
      partial: false,
    })
    expect(result).toEqual({
      fieldCount: 5,
      ha: true,
      durationMs: 42,
      reason: 'timeout',
      partial: false,
    })
  })

  it('drops non-allowlisted keys while keeping allowlisted ones', () => {
    const result = sanitizeMeta({
      fieldCount: 3,
      fullName: PII.fullName,  // not allowlisted → dropped
      ha: true,
      email: PII.email,        // not allowlisted → dropped
    })
    expect(result).toEqual({ fieldCount: 3, ha: true })
  })

  it('returns undefined for empty object', () => {
    expect(sanitizeMeta({})).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(sanitizeMeta(undefined)).toBeUndefined()
  })

  it('returns undefined for null input', () => {
    expect(sanitizeMeta(null as any)).toBeUndefined()
  })
})

// ============================================================================
// §3  sanitizeMeta — String sanitization
// ============================================================================

describe('sanitizeMeta — string value sanitization', () => {
  it('redacts email in allowlisted key "reason"', () => {
    const result = sanitizeMeta({ reason: `failed for ${PII.email}` })
    expect(result!.reason).not.toContain(PII.email)
  })

  it('redacts UUID in allowlisted key "sessionId"', () => {
    const result = sanitizeMeta({ sessionId: PII.uuid })
    expect(result!.sessionId).toBe('[META_REDACTED]')
  })

  it('redacts IBAN in allowlisted key "reason"', () => {
    const result = sanitizeMeta({ reason: `transfer to ${PII.iban}` })
    expect(result!.reason).not.toContain(PII.iban)
  })

  it('redacts base64 blob in allowlisted key "reason"', () => {
    const result = sanitizeMeta({ reason: `token was ${PII.base64}` })
    expect(result!.reason).not.toContain(PII.base64)
  })

  it('redacts JWT in allowlisted key "reason"', () => {
    const result = sanitizeMeta({ reason: PII.jwt })
    expect(result!.reason).toBe('[META_REDACTED]')
  })

  it('redacts password= key-value pattern in string', () => {
    const result = sanitizeMeta({ reason: `password=${PII.password}` })
    expect(result!.reason).not.toContain(PII.password)
  })

  it('truncates long strings to 80 chars', () => {
    const longStr = 'x'.repeat(200)
    const result = sanitizeMeta({ reason: longStr })
    expect((result!.reason as string).length).toBeLessThanOrEqual(80)
  })

  it('safe short string passes through unchanged', () => {
    const result = sanitizeMeta({ reason: 'element_cap' })
    expect(result!.reason).toBe('element_cap')
  })
})

// ============================================================================
// §4  sanitizeMeta — Non-primitive values
// ============================================================================

describe('sanitizeMeta — non-primitive values', () => {
  it('replaces object value with "[META_REDACTED]"', () => {
    const result = sanitizeMeta({ reason: { nested: 'data' } as any })
    expect(result!.reason).toBe('[META_REDACTED]')
  })

  it('replaces array value with "[META_REDACTED]"', () => {
    const result = sanitizeMeta({ reason: [1, 2, 3] as any })
    expect(result!.reason).toBe('[META_REDACTED]')
  })

  it('replaces function value with "[META_REDACTED]"', () => {
    const result = sanitizeMeta({ reason: (() => 'evil') as any })
    expect(result!.reason).toBe('[META_REDACTED]')
  })

  it('replaces symbol with "[META_REDACTED]"', () => {
    const result = sanitizeMeta({ reason: Symbol('test') as any })
    expect(result!.reason).toBe('[META_REDACTED]')
  })

  it('drops Infinity (non-finite number)', () => {
    const result = sanitizeMeta({ fieldCount: Infinity })
    // Infinity is not finite → sanitizeMetaValue returns null → key is omitted
    expect(result).toBeUndefined()
  })

  it('drops NaN (non-finite number)', () => {
    const result = sanitizeMeta({ fieldCount: NaN })
    expect(result).toBeUndefined()
  })

  it('non-allowlisted key with object is dropped entirely, not redacted', () => {
    const result = sanitizeMeta({ badKey: { evil: true } as any })
    expect(result).toBeUndefined()
  })
})

// ============================================================================
// §5  auditLog integration — meta is sanitized before storage
// ============================================================================

describe('auditLog — meta sanitization integration', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('stores sanitized meta in the audit buffer', () => {
    auditLog('info', 'TEST', 'test message', { fieldCount: 5, ha: true })
    const entries = getAuditLog()
    const last = entries[entries.length - 1]
    expect(last.meta).toEqual({ fieldCount: 5, ha: true })
  })

  it('drops non-allowlisted keys from stored meta', () => {
    auditLog('info', 'TEST', 'test', {
      fieldCount: 3,
      fullName: PII.fullName,
    } as any)
    const entries = getAuditLog()
    const last = entries[entries.length - 1]
    expect(last.meta).toEqual({ fieldCount: 3 })
    expect(last.meta).not.toHaveProperty('fullName')
  })

  it('omits meta entirely if all keys are non-allowlisted', () => {
    auditLog('info', 'TEST', 'test', { secret: PII.password } as any)
    const entries = getAuditLog()
    const last = entries[entries.length - 1]
    expect(last.meta).toBeUndefined()
  })

  it('does not change existing message redaction behavior', () => {
    auditLog('warn', 'TEST', `User ${PII.email} failed`)
    const entries = getAuditLog()
    const last = entries[entries.length - 1]
    expect(last.message).not.toContain(PII.email)
    expect(last.message).toContain('[EMAIL_REDACTED]')
  })

  it('does not throw on bizarre meta input', () => {
    expect(() => {
      auditLog('info', 'TEST', 'ok', null as any)
      auditLog('info', 'TEST', 'ok', undefined)
      auditLog('info', 'TEST', 'ok', 42 as any)
      auditLog('info', 'TEST', 'ok', 'string' as any)
      auditLog('info', 'TEST', 'ok', [1, 2] as any)
    }).not.toThrow()
  })
})

// ============================================================================
// §6  Exhaustive audit buffer scan — no PII anywhere
// ============================================================================

describe('Exhaustive: 10 toxic entries, no PII in buffer', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('no raw PII in any message or meta after 10 toxic entries', () => {
    // Pump 10 entries with PII in both message and meta
    auditLog('info', 'T1', `User ${PII.email}`, { reason: PII.email } as any)
    auditLog('warn', 'T2', `Item ${PII.uuid}`, { sessionId: PII.uuid } as any)
    auditLog('error', 'T3', `IBAN: ${PII.iban}`, { reason: PII.iban } as any)
    auditLog('security', 'T4', `Token: ${PII.base64}`, { reason: PII.base64 } as any)
    auditLog('info', 'T5', `JWT: ${PII.jwt}`, { reason: PII.jwt } as any)
    auditLog('warn', 'T6', `password=${PII.password}`, { reason: `pass=${PII.password}` } as any)
    auditLog('info', 'T7', 'clean', { fullName: PII.fullName } as any)
    auditLog('info', 'T8', 'clean', { phone: PII.phone, fieldCount: 2 } as any)
    auditLog('info', 'T9', PII.fullName, { reason: 'ok', ha: true })
    auditLog('info', 'T10', 'test', {
      fieldCount: 1,
      reason: `for ${PII.email} item ${PII.uuid}`,
    } as any)

    const allEntries = getAuditLog()

    // Collect ALL text: messages + meta values
    const allText: string[] = []
    for (const entry of allEntries) {
      allText.push(entry.message)
      allText.push(entry.code)
      if (entry.meta) {
        for (const v of Object.values(entry.meta)) {
          allText.push(String(v))
        }
        for (const k of Object.keys(entry.meta)) {
          allText.push(k)
        }
      }
    }
    const combined = allText.join('\n')

    // Assert NO raw PII appears anywhere
    expect(combined).not.toContain(PII.email)
    expect(combined).not.toContain(PII.uuid)
    expect(combined).not.toContain(PII.iban)
    expect(combined).not.toContain(PII.base64)
    expect(combined).not.toContain(PII.password)
    // JWT components
    expect(combined).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    // Keys that were not allowlisted must not appear
    expect(combined).not.toContain('fullName')
    expect(combined).not.toContain('phone')
  })
})

// ============================================================================
// §7  sanitizeMeta is exported and testable independently
// ============================================================================

describe('sanitizeMeta — edge cases', () => {
  it('handles getter that throws', () => {
    const evil = {
      get reason(): string { throw new Error('boom') },
      fieldCount: 5,
    }
    // sanitizeMeta must not throw — fail closed
    const result = sanitizeMeta(evil as any)
    // The entire meta may be undefined due to the catch, which is fine (fail-closed)
    // OR if the iteration hits fieldCount first, it might return { fieldCount: 5 }
    // Either outcome is acceptable — the key point is no throw
    expect(result === undefined || typeof result === 'object').toBe(true)
  })

  it('handles meta with prototype pollution attempt', () => {
    const evil = Object.create({ __proto__: { admin: true } })
    evil.fieldCount = 3
    const result = sanitizeMeta(evil)
    expect(result).toEqual({ fieldCount: 3 })
    expect(result).not.toHaveProperty('admin')
    expect(result).not.toHaveProperty('__proto__')
  })

  it('all 20 allowlisted keys are accepted with safe values', () => {
    const allKeys: Record<string, unknown> = {
      sessionId: 'abc',
      tabId: 42,
      fieldCount: 3,
      candidateCount: 2,
      evaluatedCount: 100,
      elementsVisited: 1500,
      durationMs: 55,
      ha: true,
      reason: 'ok',
      code: 'TEST',
      state: 'preview',
      partial: false,
      partialReason: 'element_cap',
      originTier: 'exact',
      matchTier: 'subdomain',
      psl: false,
      action: 'insert',
      channel: 'ipc',
      op: 'fill',
      retryAfterMs: 2000,
    }
    const result = sanitizeMeta(allKeys)!
    expect(Object.keys(result).sort()).toEqual(Object.keys(allKeys).sort())
  })
})

// ============================================================================
// §8  auditLogSafe — strict wrapper
// ============================================================================

describe('auditLogSafe — strict wrapper', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('drops meta entirely if it contains only non-allowlisted keys', () => {
    auditLogSafe('info', 'TEST_SAFE_1', 'test message', {
      fullName: 'Oscar Schreyer',
      secretToken: 'abc123',
    })

    const log = getAuditLog()
    expect(log.length).toBe(1)
    expect(log[0].meta).toBeUndefined()
    expect(log[0].message).toBe('test message')
  })

  it('drops meta if an allowlisted key contains an email', () => {
    auditLogSafe('warn', 'TEST_SAFE_2', 'check email', {
      reason: PII.email,
    })

    const log = getAuditLog()
    expect(log.length).toBe(1)
    // Meta should still exist but the value is redacted
    if (log[0].meta) {
      expect(log[0].meta.reason).toBe('[META_REDACTED]')
    }
    // Raw email must not appear anywhere
    const serialized = JSON.stringify(log[0])
    expect(serialized).not.toContain(PII.email)
  })

  it('drops meta if an allowlisted key contains a UUID', () => {
    auditLogSafe('warn', 'TEST_SAFE_3', 'check uuid', {
      sessionId: PII.uuid,
    })

    const log = getAuditLog()
    expect(log.length).toBe(1)
    if (log[0].meta) {
      expect(log[0].meta.sessionId).toBe('[META_REDACTED]')
    }
    const serialized = JSON.stringify(log[0])
    expect(serialized).not.toContain(PII.uuid)
  })

  it('drops meta if an allowlisted key contains an IBAN', () => {
    auditLogSafe('info', 'TEST_SAFE_4', 'check iban', {
      reason: PII.iban,
    })

    const log = getAuditLog()
    const serialized = JSON.stringify(log[0])
    expect(serialized).not.toContain(PII.iban)
  })

  it('drops meta if an allowlisted key contains a token/base64', () => {
    auditLogSafe('info', 'TEST_SAFE_5', 'check token', {
      reason: PII.base64,
    })

    const log = getAuditLog()
    const serialized = JSON.stringify(log[0])
    expect(serialized).not.toContain(PII.base64)
  })

  it('keeps safe numeric meta unchanged', () => {
    auditLogSafe('info', 'TEST_SAFE_6', 'numeric meta', {
      fieldCount: 3,
      candidateCount: 12,
      ha: true,
      durationMs: 45,
    })

    const log = getAuditLog()
    expect(log.length).toBe(1)
    expect(log[0].meta).toEqual({
      fieldCount: 3,
      candidateCount: 12,
      ha: true,
      durationMs: 45,
    })
  })

  it('keeps safe string meta in allowlisted keys', () => {
    auditLogSafe('info', 'TEST_SAFE_7', 'string meta', {
      partialReason: 'element_cap',
      action: 'insert',
    })

    const log = getAuditLog()
    expect(log[0].meta).toEqual({
      partialReason: 'element_cap',
      action: 'insert',
    })
  })

  it('still logs the message even when meta is fully rejected', () => {
    auditLogSafe('warn', 'TEST_SAFE_8', 'important event', {
      badKey: 'should be dropped',
      anotherBad: 42,
    })

    const log = getAuditLog()
    expect(log.length).toBe(1)
    expect(log[0].code).toBe('TEST_SAFE_8')
    expect(log[0].message).toBe('important event')
    expect(log[0].meta).toBeUndefined()
  })

  it('never throws even with adversarial meta', () => {
    const poison = new Proxy({} as Record<string, unknown>, {
      get() { throw new Error('trap!') },
      ownKeys() { throw new Error('trap!') },
    })

    expect(() => {
      auditLogSafe('error', 'TEST_SAFE_9', 'adversarial', poison)
    }).not.toThrow()

    // Should still have logged the message (without meta)
    const log = getAuditLog()
    expect(log.length).toBe(1)
    expect(log[0].code).toBe('TEST_SAFE_9')
  })

  it('no raw PII appears in buffer after 10 toxic auditLogSafe calls', () => {
    // Use only PII types matched by META_PII_PATTERNS:
    // UUID, email, IBAN, base64 (>20 chars), JWT-ish (a.b.c)
    const toxicMetas: Record<string, unknown>[] = [
      { fullName: PII.fullName, reason: PII.email },
      { sessionId: PII.uuid, code: PII.jwt },
      { reason: PII.iban, tabId: PII.base64 },
      { action: PII.email, ha: PII.uuid },
      { state: PII.email, channel: PII.uuid },
      { reason: `user=${PII.fullName} token=${PII.base64}` },
      { fieldCount: PII.email },  // wrong type for fieldCount
      { evaluatedCount: PII.uuid },
      { op: PII.iban, psl: PII.jwt },
      { reason: PII.base64, partialReason: PII.jwt },
    ]

    for (let i = 0; i < toxicMetas.length; i++) {
      auditLogSafe('warn', `TOXIC_${i}`, `toxic entry ${i}`, toxicMetas[i])
    }

    const log = getAuditLog()
    const serialized = JSON.stringify(log)

    // No raw PII must appear anywhere in the serialized buffer
    expect(serialized).not.toContain(PII.email)
    expect(serialized).not.toContain(PII.uuid)
    expect(serialized).not.toContain(PII.iban)
    expect(serialized).not.toContain(PII.base64)
    expect(serialized).not.toContain(PII.jwt)
  })
})
