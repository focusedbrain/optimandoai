/**
 * Integration tests — mergeExtensionDepackaged + content validation (PR 2/7)
 *
 * Phase B, PR B-5: updated for async merge function.
 * The content validator is now called via validatorOrchestrator (subprocess), mocked
 * here.  The sealed-storage gate requires a key provider; tests bind one via
 * bindKeyProvider / unbindKeyProvider.
 *
 * Tests continue to cover:
 *   TEST-INT-1: merge with no artefact → validated, sealed row in DB
 *   TEST-INT-2: merge with valid session_import_artefact → sealed row in DB
 *   TEST-INT-3: merge with malformed artefact → validator returns failure → ok: false
 *   TEST-INT-4: re-merge (update path) — second call re-seals row with new content
 */

import { createRequire } from 'module'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID, createHash, createHmac } from 'crypto'

// Mock Electron modules before any import that transitively requires them.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
}))

vi.mock('../messageRouter', () => ({
  makeInboxAttachmentStorageId: (msgId: string, attId: string) => `${msgId}/${attId}`,
  buildQuarantineCanonicalJson: (fields: Record<string, string>) =>
    JSON.stringify({ content_type: 'host_quarantine', ...fields }),
  findPairedSandboxHandshake: () => null,
}))

vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({
    storagePath: '/tmp/mock.bin',
    encryptionKeyStored: 'k',
    ivB64: 'i',
    tagB64: 't',
  })),
}))

vi.mock('../gateway', () => ({
  emailGateway: { getProviderSync: () => 'gmail' },
}))

vi.mock('../../quarantine-encrypt/index', () => ({
  encryptForQuarantine: vi.fn(() => ({
    ciphertext: 'mock-ciphertext',
    nonce: 'mock-nonce',
    ephemeralPublicKey: 'mock-epk',
  })),
}))

vi.mock('../../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: vi.fn(() => ({
    storageId: 'mock-blob-id',
    sha256: 'a'.repeat(64),
  })),
}))

const require = createRequire(import.meta.url)

let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:')
  d.close()
  Database = D
} catch {
  Database = null
}

import { mergeExtensionDepackaged } from '../mergeExtensionDepackaged'
import { bindKeyProvider, unbindKeyProvider, clearTamperingEvents } from '../../sealed-storage/index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

function buildValidSealForRowId(canonicalJson: string, rowId: string): { seal: string; seal_input_json: string } {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const sealInputJson = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
  const seal = createHmac('sha256', TEST_DEK).update(sealInputJson, 'utf8').digest('base64')
  return { seal, seal_input_json: sealInputJson }
}

function makeDb() {
  if (!Database) throw new Error('better-sqlite3 unavailable')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL DEFAULT 'direct_beap',
      handshake_id TEXT,
      account_id TEXT,
      beap_package_json TEXT,
      depackaged_json TEXT,
      depackaged_metadata TEXT,
      body_text TEXT,
      has_attachments INTEGER DEFAULT 0,
      attachment_count INTEGER DEFAULT 0,
      embedding_status TEXT DEFAULT 'pending',
      validated_at TEXT,
      validator_version TEXT,
      validation_reason TEXT,
      seal TEXT,
      seal_input_json TEXT
    );
    CREATE TABLE inbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      filename TEXT,
      content_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      content_id TEXT,
      storage_path TEXT,
      content_sha256 TEXT,
      extracted_text TEXT,
      text_extraction_status TEXT,
      text_extraction_error TEXT,
      extracted_text_sha256 TEXT,
      encryption_key TEXT,
      encryption_iv TEXT,
      encryption_tag TEXT,
      storage_encrypted INTEGER DEFAULT 0,
      created_at TEXT
    )
  `)
  return db
}

function insertRow(db: any, id: string, packageJson: string) {
  db.prepare(
    `INSERT INTO inbox_messages (id, source_type, beap_package_json, depackaged_json)
     VALUES (?, 'direct_beap', ?, NULL)`,
  ).run(id, packageJson)
}

function getRow(db: any, id: string) {
  return db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(id) as any
}

const PACKAGE_JSON = JSON.stringify({ header: { encoding: 'qBEAP' }, payload: 'test' })

function makeSealedOutcome(canonicalJson: string = '{"canonical":true}', rowId: string = 'msg-1') {
  // Use the actual rowId so the sealed-gate HMAC check passes in reject mode.
  const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
  return {
    outcome: {
      ok: true,
      sealed: {
        seal,
        seal_input_json,
        canonical_json: canonicalJson,
        validated_at: new Date().toISOString(),
        validator_version: 'b5-test',
      },
    },
  } as any
}

function makeRejectedOutcome(reason: string) {
  return {
    outcome: {
      ok: false,
      sealed_quarantine: {
        rejection_reason: reason,
        validator_version: 'b5-test',
        validated_at: new Date().toISOString(),
        seal: 'mock-q-seal',
        seal_input_json: '{"q":true}',
        canonical_json: '{"q":true}',
      },
    },
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!Database)('mergeExtensionDepackaged — content validation (PR B-5)', () => {
  let db: any
  let validateMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = makeDb()
    insertRow(db, 'msg-1', PACKAGE_JSON)
    bindKeyProvider(() => TEST_DEK)
    clearTamperingEvents()

    // Mock validator orchestrator via spyOn (dynamic import to avoid hoisting issues)
    const orchMod = await import('../../validator-process/orchestrator')
    validateMock = vi.spyOn(orchMod.validatorOrchestrator, 'validate') as any
    validateMock.mockResolvedValue(makeSealedOutcome())
  })

  afterEach(() => {
    unbindKeyProvider()
    vi.restoreAllMocks()
    db?.close()
  })

  it('TEST-INT-1. merge with no artefact → sealed row written, seal present', async () => {
    const depackagedJson = JSON.stringify({
      schema_version: '1.0.0',
      format: 'beap_qbeap_decrypted',
      body: { text: 'hello' },
      attachments_canonical: [],
    })
    validateMock.mockResolvedValue(makeSealedOutcome(depackagedJson))

    const result = await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: depackagedJson,
    })

    expect(result.ok).toBe(true)
    const row = getRow(db, 'msg-1')
    expect(row.seal).toBeTruthy()
    expect(row.seal_input_json).toBeTruthy()
    expect(row.depackaged_json).toContain('attachments_canonical')
  })

  it('TEST-INT-2. merge with valid session_import_artefact → sealed row', async () => {
    const depackagedJson = JSON.stringify({
      schema_version: '1.0.0',
      session_import_artefact: { schema_version: '1.0.0', artefact_id: randomUUID() },
      attachments_canonical: [],
    })
    validateMock.mockResolvedValue(makeSealedOutcome(depackagedJson))

    const result = await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: depackagedJson,
    })

    expect(result.ok).toBe(true)
    const row = getRow(db, 'msg-1')
    expect(row.seal).toBeTruthy()
  })

  it('TEST-INT-3. merge with malformed artefact → validator rejects → ok: false', async () => {
    validateMock.mockResolvedValue(makeRejectedOutcome('ARTEFACT_UNKNOWN_KEY'))

    const result = await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: JSON.stringify({ bad_key: 'injected' }),
    })

    // PR B-5.1 Decision A: no write to inbox tables on failure — shell row stays in pre-merge state
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ARTEFACT_UNKNOWN_KEY')
    const row = getRow(db, 'msg-1')
    // validation_reason is NOT written on failure (B-5.1 removed the unseal write path)
    expect(row.validation_reason).toBeFalsy()
    // seal must remain unset (failure path does not seal)
    expect(row.seal).toBeFalsy()
  })

  it('TEST-INT-4. re-merge updates sealed row with new content', async () => {
    // First merge: valid → sealed row
    const first = JSON.stringify({ format: 'v1', attachments_canonical: [] })
    validateMock.mockResolvedValue(makeSealedOutcome(first))
    await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: first,
    })
    const afterFirst = getRow(db, 'msg-1')
    expect(afterFirst.seal).toBeTruthy()

    // Second merge: different content → re-sealed row
    const second = JSON.stringify({ format: 'v2', attachments_canonical: [] })
    validateMock.mockResolvedValue(makeSealedOutcome(second))
    await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: second,
    })
    const afterSecond = getRow(db, 'msg-1')
    expect(afterSecond.seal).toBeTruthy()
  })
})
