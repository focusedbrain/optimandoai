import { describe, test, expect } from 'vitest'
import { authorizeToolInvocation } from '../../enforcement/authorizeToolInvocation'
import type { ToolInvocationRequest } from '../../enforcement/authorizeToolInvocation'

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
      all: (...args: any[]) => {
        if (sql.includes('handshakes')) {
          return Object.values(records)
        }
        return []
      },
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

function makeRequest(overrides?: Partial<ToolInvocationRequest>): ToolInvocationRequest {
  return {
    handshake_id: 'hs-001',
    tool_name: 'read-context',
    parameters: {},
    requested_scope: 'test-scope',
    requested_purpose: 'testing',
    ...overrides,
  }
}

describe('Execution Authorization Gate', () => {
  // Test 15: Handshake inactive → denied
  test('handshake not found → HANDSHAKE_INACTIVE', () => {
    const db = makeMockDb()
    const result = authorizeToolInvocation(db, makeRequest())
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('HANDSHAKE_INACTIVE')
    }
  })

  // Test 16: Handshake revoked → denied
  test('handshake revoked → HANDSHAKE_REVOKED', () => {
    const db = makeMockDb({ 'hs-001': makeHandshakeRow({ state: 'REVOKED' }) })
    const result = authorizeToolInvocation(db, makeRequest())
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('HANDSHAKE_REVOKED')
    }
  })

  // Test 17: Tool not granted → denied
  test('unknown tool → TOOL_NOT_GRANTED', () => {
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = authorizeToolInvocation(db, makeRequest({ tool_name: 'delete-everything' }))
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('TOOL_NOT_GRANTED')
    }
  })

  // Test 18: Scope not allowed → denied
  test('scope not in policy → SCOPE_NOT_ALLOWED', () => {
    const restrictedPolicy = {
      allowedScopes: ['allowed-scope'],
      effectiveTier: 'free',
      allowsCloudEscalation: false,
      allowsExport: false,
      onRevocationDeleteBlocks: false,
      effectiveExternalProcessing: 'none',
      reciprocalAllowed: true,
      effectiveSharingModes: ['receive-only', 'reciprocal'],
    }
    const db = makeMockDb({
      'hs-001': makeHandshakeRow({
        effective_policy_json: JSON.stringify(restrictedPolicy),
      }),
    })
    const result = authorizeToolInvocation(db, makeRequest({ requested_scope: 'forbidden-scope' }))
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('SCOPE_NOT_ALLOWED')
    }
  })

  // Test 19: Parameters out of constraints → denied
  test('oversized parameter → PARAMETER_CONSTRAINT_VIOLATION', () => {
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = authorizeToolInvocation(db, makeRequest({
      parameters: { data: 'x'.repeat(1_000_001) },
    }))
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('PARAMETER_CONSTRAINT_VIOLATION')
    }
  })

  // Test 20: Valid authorization → allowed + audit
  test('valid request → authorized', () => {
    const auditEntries: any[] = []
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() }, auditEntries)
    const result = authorizeToolInvocation(db, makeRequest())
    expect(result.authorized).toBe(true)
  })

  // Additional: Cloud escalation denied
  test('cloud-escalation when policy denies → PURPOSE_MISMATCH', () => {
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = authorizeToolInvocation(db, makeRequest({ tool_name: 'cloud-escalation' }))
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('PURPOSE_MISMATCH')
    }
  })

  // Additional: Export denied
  test('export-context when policy denies → PURPOSE_MISMATCH', () => {
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = authorizeToolInvocation(db, makeRequest({ tool_name: 'export-context' }))
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('PURPOSE_MISMATCH')
    }
  })

  // Additional: Expired handshake
  test('expired handshake → HANDSHAKE_INACTIVE', () => {
    const db = makeMockDb({
      'hs-001': makeHandshakeRow({
        expires_at: new Date(Date.now() - 86400000).toISOString(),
      }),
    })
    const result = authorizeToolInvocation(db, makeRequest())
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('HANDSHAKE_INACTIVE')
    }
  })

  // Additional: PENDING_ACCEPT state
  test('pending handshake → HANDSHAKE_INACTIVE', () => {
    const db = makeMockDb({
      'hs-001': makeHandshakeRow({ state: 'PENDING_ACCEPT' }),
    })
    const result = authorizeToolInvocation(db, makeRequest())
    expect(result.authorized).toBe(false)
    if (!result.authorized) {
      expect(result.reason).toBe('HANDSHAKE_INACTIVE')
    }
  })

  // Additional: Wildcard scope allows any
  test('wildcard scope allows any requested scope', () => {
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = authorizeToolInvocation(db, makeRequest({
      requested_scope: 'any-random-scope',
    }))
    expect(result.authorized).toBe(true)
  })

  // Additional: semantic-search is a granted tool
  test('semantic-search is a granted tool', () => {
    const db = makeMockDb({ 'hs-001': makeHandshakeRow() })
    const result = authorizeToolInvocation(db, makeRequest({ tool_name: 'semantic-search' }))
    expect(result.authorized).toBe(true)
  })
})
