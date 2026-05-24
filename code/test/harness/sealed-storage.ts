/**
 * Shared Sealed-Storage Test Harness
 *
 * Provides a standardised, isolated context for tests that exercise sealed
 * storage.  Every test suite that needs to verify sealed-storage behaviour
 * should use `createSealedStorageTestContext()` rather than wiring key
 * providers, DEKs, and seal helpers by hand.
 *
 * Architecture reference: Phase B PR B-8.4d-iii-5b, Decision A.
 *
 * Documentation: docs/phase-b/sealed-storage-test-harness.md
 *
 * Usage
 * -----
 * ```typescript
 * import { createSealedStorageTestContext } from 'test/harness/sealed-storage'
 *
 * describe('SomeFeature', () => {
 *   let ctx: SealedStorageTestContext
 *   beforeEach(() => { ctx = createSealedStorageTestContext() })
 *   afterEach(() => { ctx.cleanup() })
 *
 *   it('reads sealed rows', () => {
 *     const { seal, seal_input_json } = ctx.buildValidSealForRowId('r-1', { data: 'hello' })
 *     // ... insert row with seal / seal_input_json, then call sealedQuery
 *   })
 * })
 * ```
 */

import { hkdfSync } from 'node:crypto'
import { createRequire } from 'node:module'

import {
  bindKeyProvider,
  unbindKeyProvider,
  isKeyProviderBound,
  clearTamperingEvents,
  type SealKeyProvider,
} from '../../apps/electron-vite-project/electron/main/sealed-storage/index.js'
import {
  computeSealForTest,
} from '../../apps/electron-vite-project/electron/main/validator-process/index.js'
import { CONTENT_VALIDATOR_VERSION } from '@repo/ingestion-core'

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic test DEK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synthetic vault master key for tests.  Matches the constant in
 * test-session.ts; committed to the repo intentionally — not a production
 * secret.
 */
const _TEST_VAULT_MASTER_KEY = Buffer.from(
  'beap-test-vault-master-key-v1-B1-do-not-use-in-production-0000000',
  'utf8',
).subarray(0, 32)

/**
 * Deterministic 32-byte test Data Encryption Key.
 * Derived the same way as `deriveTestSealKey()` in test-session.ts so that
 * seals produced by this harness are compatible with the validator subprocess
 * when used in integration tests.
 */
export const TEST_DEK: Buffer = Buffer.from(
  hkdfSync(
    'sha256',
    _TEST_VAULT_MASTER_KEY,
    Buffer.from('beap-application-key-derivation-v1'),
    Buffer.from('validator-seal-key-v1'),
    32,
  ),
)

// ─────────────────────────────────────────────────────────────────────────────
// Optional real in-memory SQLite (better-sqlite3)
// ─────────────────────────────────────────────────────────────────────────────

const _req = createRequire(import.meta.url)
let _BetterSqlite3: typeof import('better-sqlite3').default | null = null
try {
  const D = _req('better-sqlite3') as typeof import('better-sqlite3').default
  const probe = new D(':memory:')
  probe.close()
  _BetterSqlite3 = D
} catch {
  _BetterSqlite3 = null
}

export type HarnessDatabase = import('better-sqlite3').Database | null

/**
 * Create an in-memory SQLite database with the minimal inbox_messages /
 * inbox_attachments schema required by sealedQuery.
 * Returns null if better-sqlite3 is unavailable in this Node environment.
 */
export function createHarnessDb(): HarnessDatabase {
  if (!_BetterSqlite3) return null
  const db = new _BetterSqlite3(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id TEXT PRIMARY KEY,
      handshake_id TEXT,
      subject TEXT,
      body_text TEXT,
      depackaged_json TEXT,
      depackaged_metadata TEXT,
      beap_package_json TEXT,
      received_at TEXT,
      ingested_at TEXT,
      read_status INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      has_attachments INTEGER DEFAULT 0,
      attachment_count INTEGER DEFAULT 0,
      ai_analysis_json TEXT,
      urgency_score INTEGER,
      from_address TEXT,
      from_name TEXT,
      source_type TEXT,
      account_id TEXT,
      seal TEXT,
      seal_input_json TEXT,
      seal_key_source TEXT NOT NULL DEFAULT 'vmk'
    );
    CREATE TABLE IF NOT EXISTS inbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      attachment_id TEXT,
      filename TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      content_sha256 TEXT,
      seal TEXT,
      seal_input_json TEXT
    );
  `)
  return db
}

// ─────────────────────────────────────────────────────────────────────────────
// Seal builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a valid seal for `rowId` over `content`.
 *
 * The produced `seal` and `seal_input_json` will pass `sealedQuery`'s
 * HMAC verification when the TEST_DEK key provider is bound.
 *
 * @param rowId  - The row's `id` column value (bound inside the seal).
 * @param content - The canonical JSON content object.  This MUST match the
 *   value stored in the row's canonical column (e.g. `depackaged_json`).
 * @param canonicalJsonColumn - Optional override for how content is serialised;
 *   defaults to `JSON.stringify(content)`.
 */
export function buildValidSealForRowId(
  rowId: string,
  content: Record<string, unknown> | string,
  key = TEST_DEK,
): { seal: string; seal_input_json: string; canonical_json: string } {
  const canonicalJson = typeof content === 'string' ? content : JSON.stringify(content)
  const { seal, sealInputJson } = computeSealForTest(
    canonicalJson,
    rowId,
    'validated',
    CONTENT_VALIDATOR_VERSION,
    '2024-01-01T00:00:00.000Z',  // fixed timestamp for deterministic test output
    Buffer.from(key),            // copy so caller's key isn't zeroized
  )
  return { seal, seal_input_json: sealInputJson, canonical_json: canonicalJson }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context type & factory
// ─────────────────────────────────────────────────────────────────────────────

export interface SealedStorageTestContext {
  /** The deterministic test DEK (a fresh copy per context). */
  readonly TEST_DEK: Buffer
  /** The synchronous key provider bound at context creation. */
  readonly keyProvider: SealKeyProvider
  /**
   * Optional in-memory SQLite database.  Present when better-sqlite3 is
   * available in the current Node ABI; null otherwise.  Tests that require a
   * real DB should guard with `test.skipIf(!ctx.db)`.
   */
  readonly db: HarnessDatabase
  /**
   * Build a valid seal for a row.  The seal is computed with TEST_DEK so it
   * will pass `sealedQuery` verification as long as the harness context is
   * active (key provider is bound).
   */
  buildValidSealForRowId(
    rowId: string,
    content: Record<string, unknown> | string,
  ): { seal: string; seal_input_json: string; canonical_json: string }
  /**
   * Tear down the context: unbind the key provider, clear tampering events,
   * and close the in-memory DB if one was created.
   */
  cleanup(): void
}

/**
 * Create an isolated sealed-storage test context.
 *
 * Each call produces an independent context with its own key-provider binding.
 * Callers MUST call `ctx.cleanup()` in `afterEach` (or equivalent) to avoid
 * key-provider state leaking between tests.
 *
 * @param options.schemaVersion - Unused by the harness itself; reserved for
 *   future extension where the DB schema version might vary.
 */
export function createSealedStorageTestContext(options?: {
  schemaVersion?: number
}): SealedStorageTestContext {
  // Copy the global TEST_DEK so that cleanup's fill(0) doesn't corrupt it.
  const dek = Buffer.from(TEST_DEK)
  const keyProvider: SealKeyProvider = () => Buffer.from(dek)

  bindKeyProvider(keyProvider, 'inner')
  clearTamperingEvents()

  const db = createHarnessDb()

  return {
    TEST_DEK: dek,
    keyProvider,
    db,

    buildValidSealForRowId(
      rowId: string,
      content: Record<string, unknown> | string,
    ) {
      return buildValidSealForRowId(rowId, content, dek)
    },

    cleanup() {
      unbindKeyProvider('inner')
      unbindKeyProvider('outer')
      clearTamperingEvents()
      if (db) {
        try { db.close() } catch { /* already closed */ }
      }
      dek.fill(0)
    },
  }
}
