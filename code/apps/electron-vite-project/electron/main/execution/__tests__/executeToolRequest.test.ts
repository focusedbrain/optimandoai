/**
 * executeToolRequest() — Per-tap consent authorization (Phase 5, V4),
 * hardening, and audit tests.
 *
 * Tests verify:
 *   - No execution without a fresh, tapped, Intent-Hash-bound consent record
 *   - Consent is single-use; divergence between executed and presented
 *     action invalidates the consent (deviation) [IX.19.2]
 *   - Executions produce PoAE evidence records with intent hash + consent ref
 *   - Request validation catches malformed input
 *   - Parameter hardening (size, poisoned keys, timeout)
 *   - Audit records created for both allow and deny decisions
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { executeToolRequest } from '../executeToolRequest'
import { registerTool, _resetRegistryForTesting } from '../toolRegistry'
import {
  prepareExecutionConsent,
  confirmExecutionConsent,
} from '../executionConsent'
import { setEvidenceDbProvider, listEvidenceRecords, verifyEvidenceChain } from '../../handshake/evidenceChain'
import { migrateHandshakeTables, insertHandshakeRecord } from '../../handshake/db'
import { HandshakeState } from '../../handshake/types'
import { buildActiveHandshakeRecord } from '../../handshake/__tests__/helpers'

const HS = 'hs-001'

let db: InstanceType<typeof Database>

function makeToolRequest(overrides?: any) {
  return {
    request_id: 'req-001',
    handshake_id: HS,
    relationship_id: 'rel-001',
    tool_name: 'read-context',
    scope_id: 'test-scope',
    purpose_id: 'testing',
    parameters: {},
    requested_at: new Date().toISOString(),
    origin: 'extension' as const,
    ...overrides,
  }
}

/** Prepare + tap a consent for the given request; returns request with consent_ref. */
function withConsent(req: ReturnType<typeof makeToolRequest>) {
  const prep = prepareExecutionConsent(db, {
    request_id: req.request_id,
    handshake_id: req.handshake_id,
    tool_name: req.tool_name,
    scope_id: req.scope_id,
    purpose_id: req.purpose_id,
    parameters: req.parameters,
    origin: req.origin,
  })
  const tap = confirmExecutionConsent(db, prep.consent_id, 'local-user-001')
  expect(tap.ok).toBe(true)
  return { ...req, consent_ref: prep.consent_id, __intent_hash: prep.intent_hash }
}

beforeEach(() => {
  _resetRegistryForTesting()
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  insertHandshakeRecord(db, buildActiveHandshakeRecord())
  setEvidenceDbProvider(() => db)
})

afterEach(() => {
  setEvidenceDbProvider(null)
  try { db.close() } catch { /* noop */ }
})

// ═══════════════════════════════════════════════════════════════════════
// Per-Tap Consent Authorization (V4)
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Per-Tap Consent Authorization', () => {
  test('no consent reference → refused, tool handler NOT called', async () => {
    let handlerCalled = false
    registerTool('read-context', async () => { handlerCalled = true; return 'ok' })

    const result = await executeToolRequest(db, makeToolRequest())

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('CONSENT_REQUIRED')
    expect(handlerCalled).toBe(false)
  })

  test('prepared-but-untapped consent → refused (no auto-accept)', async () => {
    let handlerCalled = false
    registerTool('read-context', async () => { handlerCalled = true; return 'ok' })

    const req = makeToolRequest()
    const prep = prepareExecutionConsent(db, {
      request_id: req.request_id,
      handshake_id: req.handshake_id,
      tool_name: req.tool_name,
      scope_id: req.scope_id,
      purpose_id: req.purpose_id,
      parameters: req.parameters,
      origin: req.origin,
    })
    // No confirmExecutionConsent — the human never tapped.
    const result = await executeToolRequest(db, { ...req, consent_ref: prep.consent_id })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('CONSENT_NOT_TAPPED')
    expect(handlerCalled).toBe(false)
  })

  test('revoked handshake → denied even with a tapped consent', async () => {
    let handlerCalled = false
    registerTool('read-context', async () => { handlerCalled = true; return 'ok' })

    const req = withConsent(makeToolRequest())
    db.prepare(`UPDATE handshakes SET state = ? WHERE handshake_id = ?`).run(HandshakeState.REVOKED, HS)

    const result = await executeToolRequest(db, req)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('HANDSHAKE_REVOKED')
    expect(handlerCalled).toBe(false)
  })

  test('valid consented request → tool executes, PoAE record with intent hash + consent ref', async () => {
    registerTool('read-context', async (params) => ({ blocks: ['block-1'], query: params.query }))

    const req = withConsent(makeToolRequest({ parameters: { query: 'test' } }))
    const result = await executeToolRequest(db, req)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.result).toEqual({ blocks: ['block-1'], query: 'test' })
    }

    const records = listEvidenceRecords(db, HS)
    const poae = records.filter((r) => r.record_type === 'poae')
    expect(poae.length).toBe(1)
    const payload = JSON.parse(poae[0].payload_json)
    expect(payload.kind).toBe('execution')
    expect(payload.intent_hash).toBe(req.__intent_hash)
    expect(payload.consent_id).toBe(req.consent_ref)
    expect(payload.outcome).toBe('success')
    expect(verifyEvidenceChain(db, HS).valid).toBe(true)
  })

  test('consent is single-use: replaying the same consent → refused', async () => {
    let calls = 0
    registerTool('read-context', async () => { calls += 1; return 'ok' })

    const req = withConsent(makeToolRequest())
    const first = await executeToolRequest(db, req)
    expect(first.success).toBe(true)

    const second = await executeToolRequest(db, req)
    expect(second.success).toBe(false)
    if (!second.success) expect(second.reason).toBe('CONSENT_CONSUMED')
    expect(calls).toBe(1)
  })

  test('mutating the proposal after preview → INTENT_HASH_MISMATCH, deviation PoAE, no execution [IX.19.2]', async () => {
    let handlerCalled = false
    registerTool('read-context', async () => { handlerCalled = true; return 'ok' })

    const req = withConsent(makeToolRequest({ parameters: { path: '/safe' } }))
    // The action about to execute differs from the presented preview.
    const tampered = { ...req, parameters: { path: '/etc/shadow' } }
    const result = await executeToolRequest(db, tampered)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INTENT_HASH_MISMATCH')
    expect(handlerCalled).toBe(false)

    const poae = listEvidenceRecords(db, HS).filter((r) => r.record_type === 'poae')
    expect(poae.length).toBe(1)
    expect(JSON.parse(poae[0].payload_json).outcome).toBe('refused_deviation')
  })

  test('kill switch (WRDESK_EXECUTION_CONSENT_TAP=0) refuses ALL execution — never a consent-free path', async () => {
    let handlerCalled = false
    registerTool('read-context', async () => { handlerCalled = true; return 'ok' })

    process.env.WRDESK_EXECUTION_CONSENT_TAP = '0'
    try {
      const req = withConsent(makeToolRequest())
      const result = await executeToolRequest(db, req)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toBe('EXECUTION_DISABLED')
      expect(handlerCalled).toBe(false)
    } finally {
      delete process.env.WRDESK_EXECUTION_CONSENT_TAP
    }
  })

  test('parameter constraint violation → denied at authorization', async () => {
    registerTool('read-context', async () => 'ok')

    const req = withConsent(makeToolRequest({ parameters: { data: 'x'.repeat(1_000_001) } }))
    const result = await executeToolRequest(db, req)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('PARAMETER_CONSTRAINT_VIOLATION')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Hardening Tests
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Hardening', () => {
  test('oversized parameters → rejected before authorization', async () => {
    registerTool('read-context', async () => 'ok')

    const result = await executeToolRequest(db, makeToolRequest({
      parameters: { data: 'x'.repeat(6 * 1024 * 1024) },
    }))

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('PARAMETER_SIZE_EXCEEDED')
  })

  test('__proto__ in parameters → rejected', async () => {
    registerTool('read-context', async () => 'ok')

    const poisoned = Object.create(null)
    poisoned.__proto__ = { malicious: true }
    poisoned.safe_key = 'value'

    const result = await executeToolRequest(db, makeToolRequest({ parameters: poisoned }))

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('POISONED_PARAMETERS')
  })

  test('tool timeout exceeded → fail-closed, failure PoAE recorded', async () => {
    registerTool('read-context', async () => {
      await new Promise(resolve => setTimeout(resolve, 60_000))
      return 'should never reach'
    })

    const { EXECUTION_CONSTANTS } = await import('../types')
    const originalTimeout = EXECUTION_CONSTANTS.TOOL_TIMEOUT_MS
    ;(EXECUTION_CONSTANTS as any).TOOL_TIMEOUT_MS = 50

    try {
      const req = withConsent(makeToolRequest())
      const result = await executeToolRequest(db, req)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toBe('TOOL_TIMEOUT')

      const poae = listEvidenceRecords(db, HS).filter((r) => r.record_type === 'poae')
      expect(poae.length).toBe(1)
      expect(JSON.parse(poae[0].payload_json).outcome).toBe('failure')
    } finally {
      ;(EXECUTION_CONSTANTS as any).TOOL_TIMEOUT_MS = originalTimeout
    }
  })

  test('nested __proto__ in parameters → rejected', async () => {
    registerTool('read-context', async () => 'ok')

    const inner = Object.create(null)
    inner.__proto__ = {}
    inner.safe = 'value'

    const result = await executeToolRequest(db, makeToolRequest({ parameters: { nested: inner } }))

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('POISONED_PARAMETERS')
  })

  test('constructor key in parameters → rejected', async () => {
    registerTool('read-context', async () => 'ok')

    const params = Object.create(null)
    params.constructor = 'malicious'
    params.valid = 'data'

    const result = await executeToolRequest(db, makeToolRequest({ parameters: params }))

    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('POISONED_PARAMETERS')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Audit Tests
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Audit', () => {
  test('allow decision → authorization + execution audit records created', async () => {
    registerTool('read-context', async () => ({ data: 'test' }))

    const req = withConsent(makeToolRequest())
    const result = await executeToolRequest(db, req)
    expect(result.success).toBe(true)

    const rows = db.prepare(`SELECT action FROM audit_log WHERE handshake_id = ?`).all(HS) as Array<{ action: string }>
    expect(rows.some((r) => r.action === 'TOOL_AUTHORIZED')).toBe(true)
    expect(rows.some((r) => r.action === 'TOOL_EXECUTION_SUCCESS')).toBe(true)
  })

  test('deny decision → audit record created', async () => {
    const result = await executeToolRequest(db, makeToolRequest())
    expect(result.success).toBe(false)

    const rows = db.prepare(`SELECT action FROM audit_log WHERE handshake_id = ?`).all(HS) as Array<{ action: string }>
    expect(rows.some((r) => r.action === 'TOOL_DENIED')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Request Validation Tests
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Request Validation', () => {
  test('null request → rejected', async () => {
    const result = await executeToolRequest(db, null)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('missing request_id → rejected', async () => {
    const result = await executeToolRequest(db, { ...makeToolRequest(), request_id: '' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('missing tool_name → rejected', async () => {
    const result = await executeToolRequest(db, { ...makeToolRequest(), tool_name: '' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('invalid origin → rejected', async () => {
    const result = await executeToolRequest(db, { ...makeToolRequest(), origin: 'hacker' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('invalid requested_at (not ISO 8601) → rejected', async () => {
    const result = await executeToolRequest(db, { ...makeToolRequest(), requested_at: 'not-a-date' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('missing handshake_id → rejected with MISSING_HANDSHAKE', async () => {
    registerTool('read-context', async () => 'ok')
    const result = await executeToolRequest(db, { ...makeToolRequest(), handshake_id: undefined })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_HANDSHAKE')
  })

  test('tool not found in registry → TOOL_NOT_FOUND after auth', async () => {
    // Consent granted, but no handler registered.
    const req = withConsent(makeToolRequest())
    const result = await executeToolRequest(db, req)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('TOOL_NOT_FOUND')
  })
})
