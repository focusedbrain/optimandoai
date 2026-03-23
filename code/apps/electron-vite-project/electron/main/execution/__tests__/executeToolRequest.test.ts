/**
 * executeToolRequest() — Authorization wiring, hardening, and audit tests.
 *
 * Tests verify:
 *   - Authorization gate is mandatory and non-bypassable
 *   - Request validation catches malformed input
 *   - Tool handlers only execute after successful authorization
 *   - Parameter hardening (size, poisoned keys, timeout)
 *   - Audit records created for both allow and deny decisions
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { executeToolRequest } from '../executeToolRequest'
import { registerTool, _resetRegistryForTesting } from '../toolRegistry'

// ── Mock DB ──

function makeMockDb(records: Record<string, any> = {}, auditEntries: any[] = []) {
  return {
    prepare: (sql: string) => ({
      run: (...args: any[]) => { auditEntries.push({ sql, args }) },
      get: (...args: any[]) => {
        if (sql.includes('handshakes') && sql.includes('handshake_id') && args.length > 0) {
          return records[args[0]] ?? undefined
        }
        return undefined
      },
      all: () => [],
    }),
    transaction: (fn: any) => fn,
  }
}

function makeHandshakeRow(overrides?: any) {
  return {
    handshake_id: 'hs-001',
    relationship_id: 'rel-001',
    state: 'ACTIVE',
    initiator_json: JSON.stringify({ email: 'a@b.com', wrdesk_user_id: 'u-1', iss: 'i', sub: 's' }),
    acceptor_json: JSON.stringify({ email: 'c@d.com', wrdesk_user_id: 'u-2', iss: 'i', sub: 's' }),
    local_role: 'acceptor',
    sharing_mode: 'reciprocal',
    reciprocal_allowed: 1,
    tier_snapshot_json: JSON.stringify({ claimedTier: null, computedTier: 'free', effectiveTier: 'free', signals: { plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null }, downgraded: false }),
    current_tier_signals_json: JSON.stringify({ plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null }),
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: 'a'.repeat(64),
    effective_policy_json: JSON.stringify({
      allowedScopes: ['*'],
      effectiveTier: 'free',
      allowsCloudEscalation: false,
      allowsExport: false,
      onRevocationDeleteBlocks: false,
      effectiveExternalProcessing: 'none',
      reciprocalAllowed: true,
      effectiveSharingModes: ['receive-only', 'reciprocal'],
    }),
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: 'a'.repeat(64),
    initiator_wrdesk_policy_version: '1.0',
    acceptor_wrdesk_policy_hash: 'b'.repeat(64),
    acceptor_wrdesk_policy_version: '1.0',
    ...overrides,
  }
}

function makeToolRequest(overrides?: any) {
  return {
    request_id: 'req-001',
    handshake_id: 'hs-001',
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

beforeEach(() => {
  _resetRegistryForTesting()
})

// ═══════════════════════════════════════════════════════════════════════
// Authorization Wiring Tests
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Authorization Wiring', () => {
  // Test 1: Revoked handshake → denied, handler NOT called
  test('1: revoked handshake → denied, tool handler NOT called', async () => {
    let handlerCalled = false
    registerTool('read-context', async () => { handlerCalled = true; return 'ok' })

    const db = makeMockDb({ 'hs-001': makeHandshakeRow({ state: 'REVOKED' }) })
    const result = await executeToolRequest(db, makeToolRequest())

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('HANDSHAKE_REVOKED')
    }
    expect(handlerCalled).toBe(false)
  })

  // Test 2: Tool not granted → denied, handler NOT called
  test('2: tool not granted → denied, tool handler NOT called', async () => {
    let handlerCalled = false
    registerTool('delete-everything', async () => { handlerCalled = true; return 'ok' })

    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = await executeToolRequest(db, makeToolRequest({ tool_name: 'delete-everything' }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('TOOL_NOT_GRANTED')
    }
    expect(handlerCalled).toBe(false)
  })

  // Test 3: Scope disallowed → denied
  test('3: scope disallowed → denied', async () => {
    registerTool('read-context', async () => 'ok')

    const restrictedPolicy = {
      allowedScopes: ['allowed-scope-only'],
      effectiveTier: 'free',
      allowsCloudEscalation: false,
      allowsExport: false,
      onRevocationDeleteBlocks: false,
      effectiveExternalProcessing: 'none',
      reciprocalAllowed: true,
      effectiveSharingModes: ['receive-only'],
    }
    const db = makeMockDb({
      'hs-001': makeHandshakeRow({ effective_policy_json: JSON.stringify(restrictedPolicy) }),
    })
    const result = await executeToolRequest(db, makeToolRequest({ scope_id: 'forbidden-scope' }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('SCOPE_NOT_ALLOWED')
    }
  })

  // Test 4: Parameter constraint violation → denied
  test('4: parameter constraint violation → denied at authorization', async () => {
    registerTool('read-context', async () => 'ok')

    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = await executeToolRequest(db, makeToolRequest({
      parameters: { data: 'x'.repeat(1_000_001) },
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('PARAMETER_CONSTRAINT_VIOLATION')
    }
  })

  // Test 5: Valid authorization → tool executes, returns success
  test('5: valid authorization → tool executes, returns success', async () => {
    registerTool('read-context', async (params) => {
      return { blocks: ['block-1', 'block-2'], query: params.query }
    })

    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = await executeToolRequest(db, makeToolRequest({
      parameters: { query: 'test' },
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.result).toEqual({ blocks: ['block-1', 'block-2'], query: 'test' })
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Hardening Tests
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Hardening', () => {
  // Test 6: Oversized parameters → rejected early
  test('6: oversized parameters → rejected before authorization', async () => {
    registerTool('read-context', async () => 'ok')
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })

    const result = await executeToolRequest(db, makeToolRequest({
      parameters: { data: 'x'.repeat(6 * 1024 * 1024) },
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('PARAMETER_SIZE_EXCEEDED')
    }
  })

  // Test 7: __proto__ in parameters → rejected
  test('7: __proto__ in parameters → rejected', async () => {
    registerTool('read-context', async () => 'ok')
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })

    const poisoned = Object.create(null)
    poisoned.__proto__ = { malicious: true }
    poisoned.safe_key = 'value'

    const result = await executeToolRequest(db, makeToolRequest({
      parameters: poisoned,
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('POISONED_PARAMETERS')
    }
  })

  // Test 8: Tool timeout exceeded → fail-closed
  test('8: tool timeout exceeded → fail-closed', async () => {
    registerTool('read-context', async () => {
      await new Promise(resolve => setTimeout(resolve, 60_000))
      return 'should never reach'
    })

    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })

    // Temporarily override timeout for test speed
    const { EXECUTION_CONSTANTS } = await import('../types')
    const originalTimeout = EXECUTION_CONSTANTS.TOOL_TIMEOUT_MS
    ;(EXECUTION_CONSTANTS as any).TOOL_TIMEOUT_MS = 50

    try {
      const result = await executeToolRequest(db, makeToolRequest())
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toBe('TOOL_TIMEOUT')
      }
    } finally {
      ;(EXECUTION_CONSTANTS as any).TOOL_TIMEOUT_MS = originalTimeout
    }
  })

  test('nested __proto__ in parameters → rejected', async () => {
    registerTool('read-context', async () => 'ok')
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })

    // Must use Object.create(null) to keep __proto__ as an own key
    const inner = Object.create(null)
    inner.__proto__ = {}
    inner.safe = 'value'

    const result = await executeToolRequest(db, makeToolRequest({
      parameters: { nested: inner },
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('POISONED_PARAMETERS')
    }
  })

  test('constructor key in parameters → rejected', async () => {
    registerTool('read-context', async () => 'ok')
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })

    const params = Object.create(null)
    params.constructor = 'malicious'
    params.valid = 'data'

    const result = await executeToolRequest(db, makeToolRequest({
      parameters: params,
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('POISONED_PARAMETERS')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Audit Tests
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Audit', () => {
  // Test 9: Allow decision → audit record created
  test('9: allow decision → execution audit record created', async () => {
    registerTool('read-context', async () => ({ data: 'test' }))

    const auditEntries: any[] = []
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() }, auditEntries)
    const result = await executeToolRequest(db, makeToolRequest())

    expect(result.success).toBe(true)

    // Authorization audit + execution audit
    const executionAudits = auditEntries.filter(e =>
      e.sql.includes('audit_log') && e.sql.includes('INSERT'),
    )
    expect(executionAudits.length).toBeGreaterThanOrEqual(1)
  })

  // Test 10: Deny decision → audit record created
  test('10: deny decision → audit record created', async () => {
    const auditEntries: any[] = []
    const db = makeMockDb({}, auditEntries)
    const result = await executeToolRequest(db, makeToolRequest())

    expect(result.success).toBe(false)

    const auditInserts = auditEntries.filter(e =>
      e.sql.includes('audit_log') && e.sql.includes('INSERT'),
    )
    expect(auditInserts.length).toBeGreaterThanOrEqual(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Request Validation Tests
// ═══════════════════════════════════════════════════════════════════════

describe('executeToolRequest — Request Validation', () => {
  test('null request → rejected', async () => {
    const db = makeMockDb()
    const result = await executeToolRequest(db, null)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('missing request_id → rejected', async () => {
    const db = makeMockDb()
    const result = await executeToolRequest(db, { ...makeToolRequest(), request_id: '' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('missing tool_name → rejected', async () => {
    const db = makeMockDb()
    const result = await executeToolRequest(db, { ...makeToolRequest(), tool_name: '' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('invalid origin → rejected', async () => {
    const db = makeMockDb()
    const result = await executeToolRequest(db, { ...makeToolRequest(), origin: 'hacker' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('invalid requested_at (not ISO 8601) → rejected', async () => {
    const db = makeMockDb()
    const result = await executeToolRequest(db, { ...makeToolRequest(), requested_at: 'not-a-date' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('INVALID_REQUEST')
  })

  test('missing handshake_id → rejected with MISSING_HANDSHAKE', async () => {
    registerTool('read-context', async () => 'ok')
    const db = makeMockDb()
    const result = await executeToolRequest(db, { ...makeToolRequest(), handshake_id: undefined })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('MISSING_HANDSHAKE')
  })

  test('tool not found in registry → TOOL_NOT_FOUND after auth', async () => {
    // Don't register any tool — but grant the tool in authorization
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = await executeToolRequest(db, makeToolRequest())
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('TOOL_NOT_FOUND')
  })
})
