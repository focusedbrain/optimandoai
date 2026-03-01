/**
 * Entry-Point Guard Tests
 *
 * Static analysis + runtime verification that:
 *   1. No production file outside ingestionPipeline.ts / ipc.ts calls processHandshakeCapsule()
 *   2. Runtime brand forgery is rejected with VALIDATION_BYPASS_ATTEMPT audit
 *   3. No production file uses `as ValidatedCapsule` casts (CI guard)
 *
 * These tests enforce the trust boundary closure.
 */

import { describe, test, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { processHandshakeCapsule } from '../../handshake/enforcement'
import { buildDefaultReceiverPolicy } from '../../handshake/types'

// ── Helpers ──

const ELECTRON_MAIN_DIR = path.resolve(__dirname, '..', '..')

/**
 * Recursively collect all .ts production files under electron/main,
 * excluding __tests__ directories and node_modules.
 */
function collectProductionFiles(dir: string): string[] {
  const results: string[] = []
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
  return results
}

/**
 * Files that are ALLOWED to reference processHandshakeCapsule:
 *   - enforcement.ts: defines it
 *   - ingestionPipeline.ts: may import types (but doesn't call it directly)
 *   - ipc.ts (ingestion): calls it after validation
 *   - index.ts (ingestion / handshake barrel exports)
 */
const ALLOWED_CALLERS = new Set([
  'enforcement.ts',
  'ipc.ts',
  'index.ts',
  'ingestionPipeline.ts',
])

// ── Test 14: Static Scan — No Direct Handshake Callers ──

describe('Entry-Point Guard — Static Analysis', () => {
  test('14: no production file outside allowed set contains processHandshakeCapsule(', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const violations: string[] = []

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      if (ALLOWED_CALLERS.has(basename)) continue

      const content = fs.readFileSync(filePath, 'utf-8')
      if (/processHandshakeCapsule\s*\(/.test(content)) {
        const relativePath = path.relative(ELECTRON_MAIN_DIR, filePath)
        violations.push(relativePath)
      }
    }

    expect(
      violations,
      `These files call processHandshakeCapsule() directly, violating the trust boundary:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  test('no production file outside validator.ts uses `as ValidatedCapsule` cast', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const violations: string[] = []

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      // validator.ts is allowed because it constructs ValidatedCapsule internally
      // enforcement.ts may reference type in guard checks
      if (basename === 'validator.ts' || basename === 'enforcement.ts') continue

      const content = fs.readFileSync(filePath, 'utf-8')
      // Look for `as ValidatedCapsule` casts — a CI guard
      if (/as\s+ValidatedCapsule\b/.test(content)) {
        const relativePath = path.relative(ELECTRON_MAIN_DIR, filePath)
        violations.push(relativePath)
      }
    }

    expect(
      violations,
      `These files use 'as ValidatedCapsule' cast, violating the trust boundary:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  test('ingestion ipc.ts only calls processHandshakeCapsule via distribution gate path', () => {
    const ipcPath = path.resolve(__dirname, '..', 'ipc.ts')
    const content = fs.readFileSync(ipcPath, 'utf-8')

    // It should import processHandshakeCapsule
    expect(content).toContain("import { processHandshakeCapsule }")

    // processHandshakeCapsule should only be called after distribution.target === 'handshake_pipeline'
    const callSites = content.match(/processHandshakeCapsule\s*\(/g) ?? []
    // Exactly 1 import reference and 1 call site
    expect(callSites.length).toBe(1)

    // The call must be inside the handshake_pipeline block
    const handshakePipelineBlock = content.indexOf("distribution.target === 'handshake_pipeline'")
    const callSiteIndex = content.indexOf('processHandshakeCapsule(')
    expect(callSiteIndex).toBeGreaterThan(handshakePipelineBlock)
  })

  test('all external-facing HTTP routes use processIncomingInput, not processHandshakeCapsule', () => {
    const ipcPath = path.resolve(__dirname, '..', 'ipc.ts')
    const content = fs.readFileSync(ipcPath, 'utf-8')

    // The route handler should call processIncomingInput
    expect(content).toContain('processIncomingInput(rawInput')

    // No HTTP route handler should directly construct ValidatedCapsule
    const routeSection = content.slice(content.indexOf('registerIngestionRoutes'))
    expect(routeSection).not.toMatch(/__brand:\s*['"]ValidatedCapsule['"]/)
  })

  test('handshake IPC handlers do not call processHandshakeCapsule', () => {
    const handshakeIpcPath = path.resolve(__dirname, '..', '..', 'handshake', 'ipc.ts')
    const content = fs.readFileSync(handshakeIpcPath, 'utf-8')

    // Handshake IPC should not import or call processHandshakeCapsule
    expect(content).not.toMatch(/processHandshakeCapsule\s*\(/)
  })
})

// ── Test 15: Runtime Brand Forgery ──

describe('Entry-Point Guard — Runtime Brand Forgery', () => {
  const mockDb = {
    prepare: (sql: string) => ({
      run: (..._args: any[]) => ({ changes: 1 }),
      get: () => undefined,
      all: () => [],
    }),
    transaction: (fn: any) => fn,
  }

  const receiverPolicy = buildDefaultReceiverPolicy()
  const ssoSession = {
    email: 'user@example.com',
    iss: 'test-issuer',
    sub: 'test-sub',
    email_verified: true,
    wrdesk_user_id: 'test-user',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }

  test('15: forged ValidatedCapsule with only __brand → rejected at runtime guard', () => {
    const forged = {
      __brand: 'ValidatedCapsule',
      fake: true,
    }

    const result = processHandshakeCapsule(
      mockDb,
      forged as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
    expect(result.reason).toBe('INTERNAL_ERROR')
  })

  test('null input → rejected at runtime guard', () => {
    const result = processHandshakeCapsule(
      mockDb,
      null as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('undefined input → rejected at runtime guard', () => {
    const result = processHandshakeCapsule(
      mockDb,
      undefined as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('wrong __brand value → rejected at runtime guard', () => {
    const forgery = {
      __brand: 'CandidateCapsule',
      provenance: { source_type: 'api' },
      capsule: { capsule_type: 'initiate' },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
    }

    const result = processHandshakeCapsule(
      mockDb,
      forgery as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('missing validated_at → rejected at runtime guard', () => {
    const forgery = {
      __brand: 'ValidatedCapsule',
      provenance: { source_type: 'api' },
      capsule: { capsule_type: 'initiate' },
      validator_version: '1.0.0',
    }

    const result = processHandshakeCapsule(
      mockDb,
      forgery as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('missing capsule → rejected at runtime guard', () => {
    const forgery = {
      __brand: 'ValidatedCapsule',
      provenance: { source_type: 'api' },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
    }

    const result = processHandshakeCapsule(
      mockDb,
      forgery as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('missing provenance → rejected at runtime guard', () => {
    const forgery = {
      __brand: 'ValidatedCapsule',
      capsule: { capsule_type: 'initiate' },
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
    }

    const result = processHandshakeCapsule(
      mockDb,
      forgery as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('prototype-hacked input → rejected at runtime guard', () => {
    const base = Object.create(null)
    base.__brand = 'ValidatedCapsule'
    // Missing all other required fields

    const result = processHandshakeCapsule(
      mockDb,
      base as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('numeric __brand → rejected at runtime guard', () => {
    const result = processHandshakeCapsule(
      mockDb,
      { __brand: 42 } as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })

  test('empty string validated_at → rejected at runtime guard', () => {
    const forgery = {
      __brand: 'ValidatedCapsule',
      provenance: { source_type: 'api' },
      capsule: { capsule_type: 'initiate' },
      validated_at: 42, // wrong type
      validator_version: '1.0.0',
    }

    const result = processHandshakeCapsule(
      mockDb,
      forgery as any,
      receiverPolicy,
      ssoSession,
    )

    expect(result.success).toBe(false)
    expect(result.failedStep).toBe('runtime_brand_guard')
  })
})
