/**
 * Test Session Bootstrap — Phase B, PR B-1
 *
 * Provides a real validator subprocess backed by a synthetic test vault for
 * use in lifecycle tests (L1–L10).  This module MUST NOT be imported in
 * production code.  Its presence in a non-test bundle is a build defect.
 *
 * Usage:
 *   const handle = await startTestValidator()
 *   // Use handle.orchestrator to submit ValidateRequests and get real seals.
 *   await stopTestValidator(handle)
 *
 * Architecture constraints (Phase B, Decision 5):
 *   - Tests use a real subprocess; there is no "test seal mode."
 *   - The test vault path must never coincide with the production vault path.
 *   - If the environment cannot fork a subprocess, tests fail loudly (they do
 *     not silently produce fake seals).
 *   - The test vault uses a fixed synthetic secret, stable across test runs
 *     within the same repo checkout, but never present in production builds.
 */

import { fork, type ChildProcess } from 'child_process'
import { createRequire } from 'module'
import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { hkdfSync, randomBytes } from 'crypto'

import { ValidatorOrchestrator, setValidatorWorkerPath } from './orchestrator.js'
import type { ValidateRequest, ValidateResponse } from '@repo/ingestion-core'
import { CONTENT_VALIDATOR_VERSION } from '@repo/ingestion-core'

const _require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─────────────────────────────────────────────────────────────────────────────
// Production vault path guard
// ─────────────────────────────────────────────────────────────────────────────

// The vault/db.ts getVaultPath() returns a path based on the user's app data
// directory (e.g. ~/.opengiraffe/electron-data/vault.db on macOS/Linux or
// %APPDATA%\opengiraffe\electron-data\vault.db on Windows).  We guard against
// the test vault path accidentally pointing at that OS-level data directory.
// Source-code paths (which DO contain 'electron-vite-project') are fine.
const PRODUCTION_VAULT_PATH_MARKERS = [
  '.opengiraffe',
  'opengiraffe\\electron-data',
  'opengiraffe/electron-data',
  'AppData\\Roaming\\opengiraffe',
  '.config/opengiraffe',
]

/**
 * Verify that the test vault path does not overlap with the production vault.
 * Throws loudly if overlap is detected.
 */
function assertNotProductionVaultPath(testPath: string): void {
  for (const marker of PRODUCTION_VAULT_PATH_MARKERS) {
    if (testPath.includes(marker)) {
      throw new Error(
        `[TEST_SESSION] FATAL: test vault path "${testPath}" contains production marker "${marker}". ` +
        'Test vault must not overlap with production vault path.',
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic test vault secret
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic 32-byte synthetic vault master key for tests.
 * This is NOT a real vault — it is a fixed secret used only to derive the
 * test seal key.  It is committed to the repo intentionally: it is not a
 * secret, it is a test fixture.
 */
const TEST_VAULT_MASTER_KEY = Buffer.from(
  'beap-test-vault-master-key-v1-B1-do-not-use-in-production-0000000',
  'utf8',
).subarray(0, 32)

/**
 * Derive the test seal key from the synthetic vault master key using the same
 * HKDF parameters as the production path.
 *
 * This mirrors VaultService.deriveApplicationKey('validator-seal-key-v1') which
 * calls deriveFieldKey(vmk, 'beap-application-key-derivation-v1', info).
 * deriveFieldKey uses: hkdfSync('sha256', dek, context, info, 32)
 */
export function deriveTestSealKey(): Buffer {
  const result = hkdfSync(
    'sha256',
    TEST_VAULT_MASTER_KEY,
    Buffer.from('beap-application-key-derivation-v1'),
    Buffer.from('validator-seal-key-v1'),
    32,
  )
  return Buffer.from(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Subprocess entry path (TypeScript via tsx)
// ─────────────────────────────────────────────────────────────────────────────

const SUBPROCESS_ENTRY_TS = resolve(__dirname, './index.ts')

/**
 * Resolve the tsx ESM loader path for use as --import execArgv.
 * Throws loudly if tsx is not installed (tests cannot run without it).
 *
 * On Windows, Node.js 18+ requires --import specifiers to be valid file://
 * URLs (not raw Win32 paths like C:\...) when using the default ESM loader.
 * We convert the resolved path to a file:// URL to handle this.
 */
function resolveTsxLoader(): string {
  try {
    const resolved = _require.resolve('tsx/esm')
    // pathToFileURL handles Windows drive letters: C:\... → file:///C:/...
    return pathToFileURL(resolved).href
  } catch {
    throw new Error(
      '[TEST_SESSION] tsx not found.  Lifecycle tests require tsx to be installed ' +
      '(devDependency in root package.json).  Run: pnpm install',
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test vault mock — satisfies VaultService interface for orchestrator.start()
// ─────────────────────────────────────────────────────────────────────────────

class TestVaultServiceMock {
  private readonly _sealKey: Buffer

  constructor() {
    this._sealKey = deriveTestSealKey()
  }

  deriveApplicationKey(_info: string): Buffer | null {
    // Return a copy so the orchestrator's zeroize doesn't affect the stored key.
    return Buffer.from(this._sealKey)
  }

  /** Expose the test seal key for test assertions (seal verification). */
  testSealKey(): Buffer {
    return Buffer.from(this._sealKey)
  }

  destroy(): void {
    this._sealKey.fill(0)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TestValidatorHandle
// ─────────────────────────────────────────────────────────────────────────────

export interface TestValidatorHandle {
  /** The orchestrator, pre-started against the test vault. */
  readonly orchestrator: ValidatorOrchestrator
  /**
   * The test seal key — use this to verify seals returned by the subprocess.
   * This is the key derived from the test vault; it matches what the subprocess
   * uses internally.
   */
  readonly testSealKey: Buffer
  /** Tear down the subprocess and free resources. */
  stop(): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start a real validator subprocess backed by the synthetic test vault.
 * Returns a handle with the running orchestrator and the test seal key for
 * assertion.
 *
 * Throws loudly if:
 *   - tsx is not installed.
 *   - The subprocess entry path overlaps with production vault paths.
 *   - The subprocess fails to start within STARTUP_TIMEOUT_MS.
 */
export async function startTestValidator(): Promise<TestValidatorHandle> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[TEST_SESSION] startTestValidator() called in a production build — this is a defect.')
  }

  assertNotProductionVaultPath(SUBPROCESS_ENTRY_TS)

  const tsxLoader = resolveTsxLoader()
  const orchestrator = new ValidatorOrchestrator()

  // Override the worker path to use the TypeScript source directly.
  // The tsx loader will handle TypeScript resolution at runtime.
  const savedWorkerPath = SUBPROCESS_ENTRY_TS

  // Temporarily override the global worker path so the orchestrator forks
  // the .ts file via tsx.
  setValidatorWorkerPath(savedWorkerPath)

  const vault = new TestVaultServiceMock()
  const testSealKey = vault.testSealKey()

  await orchestrator.start(vault as unknown as import('../vault/service.js').VaultService, [
    '--import',
    tsxLoader,
  ])

  return {
    orchestrator,
    testSealKey,
    async stop() {
      await orchestrator.stop()
      vault.destroy()
      testSealKey.fill(0)
    },
  }
}

/**
 * Build a minimal ValidateRequest for testing.
 */
export function makeTestValidateRequest(
  overrides?: Partial<Omit<ValidateRequest, 'request_id'>>,
): Omit<ValidateRequest, 'request_id'> {
  return {
    envelope: { _test: true },
    plaintext_or_encrypted: {
      kind: 'plaintext',
      content: overrides?.plaintext_or_encrypted?.kind === 'plaintext'
        ? (overrides.plaintext_or_encrypted as { kind: 'plaintext'; content: unknown }).content
        : { capsule_type: 'internal_draft', schema_version: 1, timestamp: new Date().toISOString() },
    },
    provenance: {
      source_type: 'internal',
      origin_classification: 'internal',
      ingested_at: new Date().toISOString(),
      transport_metadata: {},
      input_classification: 'beap_capsule_present',
      raw_input_hash: 'a'.repeat(64),
      ingestor_version: '1.0.0',
    },
    target_row_id: 'test-row-001',
    ...overrides,
  }
}
