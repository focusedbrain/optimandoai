import { describe, test, expect } from 'vitest'
import { ReasonCode } from '../types'

describe('Revocation', () => {
  test('revokeHandshake function is exported', async () => {
    const { revokeHandshake } = await import('../revocation')
    expect(typeof revokeHandshake).toBe('function')
  })
})

describe('Audit Log', () => {
  test('buildSuccessAuditEntry includes sharing_mode', async () => {
    const { buildSuccessAuditEntry } = await import('../auditLog')
    const { buildVerifiedCapsuleInput, buildActiveHandshakeRecord } = await import('./helpers')
    const entry = buildSuccessAuditEntry(buildVerifiedCapsuleInput(), buildActiveHandshakeRecord(), 100, 5)
    expect(entry.action).toBe('handshake_pipeline_success')
    expect(entry.reason_code).toBe('OK')
    expect((entry.metadata as any).sharing_mode).toBeDefined()
  })

  test('buildDenialAuditEntry includes reason', async () => {
    const { buildDenialAuditEntry } = await import('../auditLog')
    const { buildVerifiedCapsuleInput } = await import('./helpers')
    const entry = buildDenialAuditEntry(buildVerifiedCapsuleInput(), ReasonCode.INVALID_CHAIN, 'verify_chain_integrity', 50)
    expect(entry.action).toBe('handshake_pipeline_denial')
    expect(entry.reason_code).toBe(ReasonCode.INVALID_CHAIN)
    expect(entry.failed_step).toBe('verify_chain_integrity')
  })

  test('no PII in audit log', async () => {
    const { buildSuccessAuditEntry } = await import('../auditLog')
    const { buildVerifiedCapsuleInput, buildActiveHandshakeRecord } = await import('./helpers')
    const entry = buildSuccessAuditEntry(buildVerifiedCapsuleInput(), buildActiveHandshakeRecord(), 100, 5)
    const json = JSON.stringify(entry)
    expect(json).not.toContain('sender@example.com')
    expect(json).not.toContain('local@wrdesk.com')
  })
})
