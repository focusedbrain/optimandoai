/**
 * Execution Authorization Gate — Phase 5 (V4) per-tap consent model.
 *
 * Execution grants are deleted: no standing GRANTED_TOOLS set, no
 * ACTIVE-handshake blanket authorization. Authorization requires a fresh,
 * single-use, Intent-Hash-bound human consent record [VII.10.1, IX.19.2].
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { authorizeToolInvocation } from '../../enforcement/authorizeToolInvocation'
import type { ToolInvocationRequest } from '../../enforcement/authorizeToolInvocation'
import {
  prepareExecutionConsent,
  confirmExecutionConsent,
} from '../../execution/executionConsent'
import { setEvidenceDbProvider } from '../../handshake/evidenceChain'
import { migrateHandshakeTables, insertHandshakeRecord } from '../../handshake/db'
import { HandshakeState } from '../../handshake/types'
import { buildActiveHandshakeRecord } from '../../handshake/__tests__/helpers'

const HS = 'hs-001'

let db: InstanceType<typeof Database>

beforeEach(() => {
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

function makeRequest(overrides?: Partial<ToolInvocationRequest>): ToolInvocationRequest {
  return {
    request_id: 'req-001',
    handshake_id: HS,
    tool_name: 'read-context',
    parameters: {},
    requested_scope: 'test-scope',
    requested_purpose: 'testing',
    origin: 'extension',
    ...overrides,
  }
}

/** Prepare + tap a consent for the exact request; returns the consent id. */
function consentFor(req: ToolInvocationRequest): string {
  const prep = prepareExecutionConsent(db, {
    request_id: req.request_id,
    handshake_id: req.handshake_id,
    tool_name: req.tool_name,
    scope_id: req.requested_scope,
    purpose_id: req.requested_purpose,
    parameters: req.parameters,
    origin: req.origin,
  })
  const tap = confirmExecutionConsent(db, prep.consent_id, 'local-user-001')
  expect(tap.ok).toBe(true)
  return prep.consent_id
}

describe('Execution Authorization Gate (per-tap consent)', () => {
  test('handshake not found → HANDSHAKE_INACTIVE', () => {
    const req = makeRequest({ handshake_id: 'hs-missing' })
    const result = authorizeToolInvocation(db, req)
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.reason).toBe('HANDSHAKE_INACTIVE')
  })

  test('handshake revoked → HANDSHAKE_REVOKED (even with tapped consent)', () => {
    const req = makeRequest()
    const consentId = consentFor(req)
    db.prepare(`UPDATE handshakes SET state = ? WHERE handshake_id = ?`).run(HandshakeState.REVOKED, HS)
    const result = authorizeToolInvocation(db, { ...req, consent_ref: consentId })
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.reason).toBe('HANDSHAKE_REVOKED')
  })

  test('no consent reference → CONSENT_REQUIRED (ACTIVE handshake is never sufficient)', () => {
    const result = authorizeToolInvocation(db, makeRequest())
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.reason).toBe('CONSENT_REQUIRED')
  })

  test('prepared but untapped consent → CONSENT_NOT_TAPPED (no auto-accept)', () => {
    const req = makeRequest()
    const prep = prepareExecutionConsent(db, {
      request_id: req.request_id,
      handshake_id: req.handshake_id,
      tool_name: req.tool_name,
      scope_id: req.requested_scope,
      purpose_id: req.requested_purpose,
      parameters: req.parameters,
      origin: req.origin,
    })
    const result = authorizeToolInvocation(db, { ...req, consent_ref: prep.consent_id })
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.reason).toBe('CONSENT_NOT_TAPPED')
  })

  test('valid tapped consent → authorized, consent returned', () => {
    const req = makeRequest()
    const consentId = consentFor(req)
    const result = authorizeToolInvocation(db, { ...req, consent_ref: consentId })
    expect(result.authorized).toBe(true)
    if (result.authorized) {
      expect(result.consent.consent_id).toBe(consentId)
      expect(result.consent.intent_hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('request diverging from presented preview → INTENT_HASH_MISMATCH deviation [IX.19.2]', () => {
    const req = makeRequest({ parameters: { path: '/safe' } })
    const consentId = consentFor(req)
    const result = authorizeToolInvocation(db, {
      ...req,
      parameters: { path: '/etc/shadow' },
      consent_ref: consentId,
    })
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('INTENT_HASH_MISMATCH')
      expect(result.deviation).toBe(true)
    }
  })

  test('any tool name is consentable — there is no standing granted-tools set', () => {
    // The old GRANTED_TOOLS allowlist is gone; the consent tap names the exact
    // action and is the sole authorization.
    const req = makeRequest({ tool_name: 'some-future-tool' })
    const consentId = consentFor(req)
    const result = authorizeToolInvocation(db, { ...req, consent_ref: consentId })
    expect(result.authorized).toBe(true)
  })

  test('oversized parameter → PARAMETER_CONSTRAINT_VIOLATION', () => {
    const req = makeRequest({ parameters: { data: 'x'.repeat(1_000_001) } })
    const consentId = consentFor(req)
    const result = authorizeToolInvocation(db, { ...req, consent_ref: consentId })
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.reason).toBe('PARAMETER_CONSTRAINT_VIOLATION')
  })

  test('expired handshake → HANDSHAKE_INACTIVE (defense-in-depth)', () => {
    db.prepare(`UPDATE handshakes SET expires_at = ? WHERE handshake_id = ?`).run(
      new Date(Date.now() - 86400000).toISOString(),
      HS,
    )
    const req = makeRequest()
    const consentId = consentFor(req)
    const result = authorizeToolInvocation(db, { ...req, consent_ref: consentId })
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.reason).toBe('HANDSHAKE_INACTIVE')
  })

  test('pending handshake → HANDSHAKE_INACTIVE', () => {
    db.prepare(`UPDATE handshakes SET state = ? WHERE handshake_id = ?`).run(HandshakeState.PENDING_ACCEPT, HS)
    const req = makeRequest()
    const consentId = consentFor(req)
    const result = authorizeToolInvocation(db, { ...req, consent_ref: consentId })
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.reason).toBe('HANDSHAKE_INACTIVE')
  })

  test('kill switch refuses everything — never restores a consent-free path', () => {
    process.env.WRDESK_EXECUTION_CONSENT_TAP = '0'
    try {
      const req = makeRequest()
      const consentId = consentFor(req)
      const result = authorizeToolInvocation(db, { ...req, consent_ref: consentId })
      expect(result.authorized).toBe(false)
      if (!result.authorized) expect(result.reason).toBe('EXECUTION_DISABLED')
    } finally {
      delete process.env.WRDESK_EXECUTION_CONSENT_TAP
    }
  })
})
