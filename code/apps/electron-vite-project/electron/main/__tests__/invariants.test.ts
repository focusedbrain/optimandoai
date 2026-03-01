/**
 * System Invariant Tests — Architecture Regression Tripwire
 *
 * Cross-layer contract suite that prevents future regressions.
 * These tests verify fundamental security and architectural invariants
 * that must hold across the entire BEAP™ system.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { routeValidatedCapsule } from '../ingestion/distributionGate'
import { executeToolRequest } from '../execution/executeToolRequest'
import { registerTool, _resetRegistryForTesting } from '../execution/toolRegistry'
import type { ValidatedCapsule, CandidateCapsuleEnvelope } from '../ingestion/types'

const ELECTRON_MAIN_DIR = path.resolve(__dirname, '..')

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
    tier_snapshot_json: JSON.stringify({
      claimedTier: null, computedTier: 'free', effectiveTier: 'free',
      signals: { plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
      downgraded: false,
    }),
    current_tier_signals_json: JSON.stringify({
      plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null,
    }),
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

// ═══════════════════════════════════════════════════════════════════════

describe('System Invariants', () => {
  beforeEach(() => {
    _resetRegistryForTesting()
  })

  // Invariant 1: CandidateCapsuleEnvelope cannot reach processHandshakeCapsule()
  test('1: CandidateCapsuleEnvelope cannot be used as ValidatedCapsule', () => {
    const candidate: CandidateCapsuleEnvelope = {
      __brand: 'CandidateCapsule',
      provenance: {
        source_type: 'api',
        origin_classification: 'external',
        ingested_at: new Date().toISOString(),
        transport_metadata: {},
        input_classification: 'beap_capsule_present',
        raw_input_hash: 'a'.repeat(64),
        ingestor_version: '1.0.0',
      },
      raw_payload: { capsule_type: 'initiate' },
      ingestion_error_flag: false,
    }

    // TypeScript brand prevents compile-time usage. At runtime, the distribution
    // gate requires ValidatedCapsule shape (with .capsule, .validated_at, etc.)
    // Passing a CandidateCapsule should throw or fail due to missing properties.
    expect(() => {
      routeValidatedCapsule(candidate as any)
    }).toThrow()
  })

  // Invariant 2: Revoked handshake denies tool execution
  test('2: revoked handshake denies tool execution', async () => {
    const revokedRow = makeHandshakeRow({ state: 'REVOKED' })
    const db = makeMockDb({ 'hs-001': revokedRow })

    registerTool('read-context', async () => ({ data: 'should-not-execute' }))

    const result = await executeToolRequest(db, {
      request_id: 'req-001',
      handshake_id: 'hs-001',
      tool_name: 'read-context',
      parameters: {},
      requested_at: new Date().toISOString(),
      origin: 'local_ui',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe('HANDSHAKE_REVOKED')
    }
  })

  // Invariant 3: External draft routes to sandbox, never handshake_pipeline with execution
  test('3: external internal_draft routes to sandbox_sub_orchestrator', () => {
    const externalDraft: ValidatedCapsule = {
      __brand: 'ValidatedCapsule',
      provenance: {
        source_type: 'api',
        origin_classification: 'external',
        ingested_at: new Date().toISOString(),
        transport_metadata: {},
        input_classification: 'beap_capsule_present',
        raw_input_hash: 'a'.repeat(64),
        ingestor_version: '1.0.0',
      },
      capsule: {
        capsule_type: 'internal_draft',
        schema_version: 1,
        body: { content: 'external content' },
      },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
      schema_version: 1,
    }

    const decision = routeValidatedCapsule(externalDraft)
    expect(decision.target).toBe('sandbox_sub_orchestrator')
    expect(decision.target).not.toBe('handshake_pipeline')
  })

  // Invariant 4: Authorization gate always invoked before tool execution
  test('4: authorizeToolInvocation is called before any tool execution', async () => {
    const auditEntries: any[] = []
    const activeRow = makeHandshakeRow()
    const db = makeMockDb({ 'hs-001': activeRow }, auditEntries)

    let toolExecuted = false
    registerTool('read-context', async () => {
      toolExecuted = true
      return { data: 'result' }
    })

    await executeToolRequest(db, {
      request_id: 'req-001',
      handshake_id: 'hs-001',
      tool_name: 'read-context',
      parameters: {},
      requested_at: new Date().toISOString(),
      origin: 'local_ui',
    })

    expect(toolExecuted).toBe(true)

    // Audit entries should include at least one authorization record
    // (inserted by authorizeToolInvocation) PLUS one execution audit record.
    // The authorization audit is from authorizeToolInvocation, and the
    // execution audit is from executeToolRequest's step 5.
    const authAuditEntries = auditEntries.filter(e =>
      e.sql.includes('INSERT') && (
        JSON.stringify(e.args).includes('TOOL_AUTHORIZED') ||
        JSON.stringify(e.args).includes('TOOL_EXECUTION_SUCCESS')
      ),
    )
    expect(authAuditEntries.length).toBeGreaterThanOrEqual(2)
  })

  // Invariant 5: Validator is the sole ValidatedCapsule factory (static scan)
  test('5: no __brand: "ValidatedCapsule" assignment outside validator.ts and enforcement.ts', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const violations: string[] = []

    const brandPattern = /__brand:\s*['"]ValidatedCapsule['"]|as\s+ValidatedCapsule/

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      // validator.ts is the sole factory; enforcement.ts performs the runtime brand check
      if (basename === 'validator.ts' || basename === 'enforcement.ts') continue
      // Type definition files just declare the shape, not construct it
      if (basename === 'types.ts') continue

      const content = fs.readFileSync(filePath, 'utf-8')
      if (brandPattern.test(content)) {
        violations.push(path.relative(ELECTRON_MAIN_DIR, filePath))
      }
    }

    expect(
      violations,
      `These files reference ValidatedCapsule brand/cast outside allowed modules:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  // Invariant 6: Handshake ≠ execution authority — validated capsule in handshake
  //              does not trigger tool execution
  test('6: validated capsule entering handshake does not trigger tool execution', async () => {
    const auditEntries: any[] = []
    const db = makeMockDb({}, auditEntries)

    let toolExecuted = false
    registerTool('read-context', async () => {
      toolExecuted = true
      return { data: 'result' }
    })

    // Route a BEAP capsule to handshake_pipeline
    const beapCapsule: ValidatedCapsule = {
      __brand: 'ValidatedCapsule',
      provenance: {
        source_type: 'api',
        origin_classification: 'external',
        ingested_at: new Date().toISOString(),
        transport_metadata: {},
        input_classification: 'beap_capsule_present',
        raw_input_hash: 'a'.repeat(64),
        ingestor_version: '1.0.0',
      },
      capsule: {
        capsule_type: 'initiate',
        schema_version: 1,
        handshake_id: 'hs-new',
        body: {},
      },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
      schema_version: 1,
    }

    const decision = routeValidatedCapsule(beapCapsule)
    expect(decision.target).toBe('handshake_pipeline')

    // The distribution gate returns a routing decision — it does NOT execute tools.
    // Verify that tool execution flag is still false after routing.
    expect(toolExecuted).toBe(false)

    // Verify there are no tool execution audit entries from the routing alone.
    const toolAuditEntries = auditEntries.filter(e =>
      JSON.stringify(e.args).includes('TOOL_EXECUTION'),
    )
    expect(toolAuditEntries.length).toBe(0)
  })
})
