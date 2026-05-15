/**
 * B-5.1 Extension Stage-5 Failure-Path Bypass Closure Tests
 *
 * Covers the three deliverables of PR B-5.1:
 *
 * §1 — Bypass classification:
 *   MERGE_FAILURE_UPDATE_SQL written only operational fields (no content bypass).
 *   Classified per investigation step; documented here.
 *
 * §2 — No inbox writes under failure without sandbox:
 *   §2.1  Validation fails, no sandbox → shell row UNCHANGED (no write)
 *   §2.2  Validation fails, no sandbox → entry added to retry buffer
 *   §2.3  Validation fails, no sandbox → UI notification emitted with pendingCount > 0
 *   §2.4  Validation fails, sandbox available → quarantine row written (existing B-5 behavior)
 *
 * §3 — Retry buffer:
 *   §3.1  drainExtensionMergeBuffer: no sandbox still → retryCount incremented, not removed
 *   §3.2  drainExtensionMergeBuffer: sandbox available → entry removed after quarantine write
 *   §3.3  drainExtensionMergeBuffer: retryCount >= MAX → entry dropped, logged
 *   §3.4  drainExtensionMergeBuffer: buffer empty → returns 0, no side effects
 *
 * §4 — Buffer module unit tests:
 *   §4.1  addPendingMerge / getPendingMergeCount / getAllPendingMerges / removePendingMerge
 *   §4.2  clearPendingMergeBuffer clears all entries
 *   §4.3  retryCount is mutable (drain increments it in place)
 *
 * per Phase B Architecture, PR B-5.1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { randomUUID, createHash, createHmac } from 'crypto'
import {
  addPendingMerge,
  removePendingMerge,
  getAllPendingMerges,
  getPendingMergeCount,
  clearPendingMergeBuffer,
  MAX_EXTENSION_MERGE_RETRY,
} from '../extensionMergeRetryBuffer'

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
}))

const mockFindPairedSandboxHandshake = vi.fn()

vi.mock('../messageRouter', () => ({
  makeInboxAttachmentStorageId: (msgId: string, cid: string) => `${msgId}/${cid}`,
  buildQuarantineCanonicalJson: (fields: Record<string, string>) =>
    JSON.stringify({ content_type: 'host_quarantine', ...fields }),
  findPairedSandboxHandshake: (...args: unknown[]) => mockFindPairedSandboxHandshake(...args),
}))

vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({
    storagePath: '/tmp/mock.bin',
    encryptionKeyStored: 'k',
    ivB64: 'i',
    tagB64: 't',
  })),
}))

vi.mock('../../quarantine-encrypt/index', () => ({
  encryptForQuarantine: vi.fn(() => ({
    ok: true,
    blob: {
      version: 'quarantine-v1' as const,
      sender_ephemeral_x25519_pub_b64: 'bW9jay1lcGhlbWVyYWwtcHViLWI2NA==',
      salt_b64: 'bW9jay1zYWx0AAAAAAAAAA==',
      nonce_b64: 'bW9jay1ub25jZQ==',
      ciphertext_b64: 'bW9jay1jaXBoZXJ0ZXh0',
    },
  })),
}))

vi.mock('../../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: vi.fn(() => ({
    storage_id: 'mock-storage-id',
    storage_path: '/tmp/inbox-quarantine-blobs/mock-storage-id',
    blob_sha256: 'a'.repeat(64),
    blob_size_bytes: 100,
  })),
}))

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

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

import { bindKeyProvider, unbindKeyProvider, clearTamperingEvents } from '../../sealed-storage/index'
import { mergeExtensionDepackaged, drainExtensionMergeBuffer } from '../mergeExtensionDepackaged'

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

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
      created_at TEXT,
      encryption_key TEXT,
      encryption_iv TEXT,
      encryption_tag TEXT,
      storage_encrypted INTEGER DEFAULT 0,
      content_sha256 TEXT
    );
    CREATE TABLE quarantine_messages (
      id TEXT PRIMARY KEY,
      transport_sender TEXT,
      transport_received_at TEXT NOT NULL,
      transport_folder TEXT NOT NULL,
      blob_size_bytes INTEGER NOT NULL,
      blob_storage_id TEXT NOT NULL,
      blob_sha256 TEXT NOT NULL,
      rejection_reason TEXT NOT NULL,
      paired_sandbox_handshake_id TEXT NOT NULL,
      cloned_to_sandbox_at TEXT,
      seal TEXT NOT NULL,
      seal_input_json TEXT NOT NULL
    );
    CREATE TABLE handshakes (
      id TEXT PRIMARY KEY, state TEXT, local_email TEXT, counterparty_email TEXT,
      peer_x25519_public_key_b64 TEXT, local_x25519_private_key_b64 TEXT
    );
  `)
  return db
}

function insertShellRow(db: any, id: string, packageJson: string) {
  db.prepare(
    `INSERT INTO inbox_messages (id, source_type, beap_package_json) VALUES (?, 'direct_beap', ?)`,
  ).run(id, packageJson)
}

function getShellRow(db: any, id: string) {
  return db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(id) as any
}

const PACKAGE_JSON = JSON.stringify({ header: { encoding: 'pBEAP' }, payload: Buffer.from('{}').toString('base64') })

function makeSuccessOutcome(canonicalJson = '{"x":1}') {
  return {
    outcome: {
      ok: true,
      sealed: {
        seal: 'seal-' + randomUUID(),
        seal_input_json: JSON.stringify({ content_sha256: 'x', row_id: 'r', validated_at: '' }),
        canonical_json: canonicalJson,
        validated_at: new Date().toISOString(),
        validator_version: 'b51-test',
      },
    },
  } as any
}

function makeRejectionOutcome(reason = 'MISSING_REQUIRED_FIELD') {
  return {
    outcome: {
      ok: false,
      sealed_quarantine: {
        rejection_reason: reason,
        validator_version: 'b51-test',
        validated_at: new Date().toISOString(),
        seal: 'q-seal',
        seal_input_json: '{"q":1}',
        canonical_json: '{"q":1}',
      },
    },
  } as any
}

/**
 * Builds a validator success outcome for the quarantine-write path.
 * Computes a real HMAC using TEST_DEK so the sealed gate (reject mode) accepts it.
 * Must be called with the exact canonicalJson and target_row_id the production
 * code will pass to validatorOrchestrator.validate — use mockImplementation so
 * those values are captured from the live call arguments.
 */
function makeQuarantineSuccessOutcome(canonicalJson: string, rowId: string) {
  const content_sha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const validated_at = new Date().toISOString()
  const seal_input_json = JSON.stringify({ content_sha256, row_id: rowId, validated_at })
  const seal = createHmac('sha256', TEST_DEK).update(seal_input_json, 'utf8').digest('base64')
  return {
    outcome: {
      ok: true,
      sealed: {
        seal,
        seal_input_json,
        canonical_json: canonicalJson,
        validated_at,
        validator_version: 'b51-test',
      },
    },
  } as any
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Buffer module unit tests (no DB, no mocking needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('B-5.1 §4 — extensionMergeRetryBuffer module', () => {
  beforeEach(() => clearPendingMergeBuffer())
  afterEach(() => clearPendingMergeBuffer())

  it('§4.1 add / count / getAll / remove lifecycle', () => {
    expect(getPendingMergeCount()).toBe(0)

    addPendingMerge({
      rowId: 'r1', packageJson: '{}', depackagedJson: '{}', depackagedMetadata: null,
      bodyText: null, attachments: [], rejectionReason: 'TEST', retryCount: 0,
      firstAttemptAt: new Date().toISOString(),
    })
    expect(getPendingMergeCount()).toBe(1)
    expect(getAllPendingMerges()[0]!.rowId).toBe('r1')

    removePendingMerge('r1')
    expect(getPendingMergeCount()).toBe(0)
  })

  it('§4.2 clearPendingMergeBuffer removes all entries', () => {
    for (let i = 0; i < 5; i++) {
      addPendingMerge({
        rowId: `r${i}`, packageJson: '{}', depackagedJson: '{}', depackagedMetadata: null,
        bodyText: null, attachments: [], rejectionReason: 'TEST', retryCount: 0,
        firstAttemptAt: new Date().toISOString(),
      })
    }
    expect(getPendingMergeCount()).toBe(5)
    clearPendingMergeBuffer()
    expect(getPendingMergeCount()).toBe(0)
  })

  it('§4.3 retryCount is mutable on the entry object', () => {
    addPendingMerge({
      rowId: 'r-mut', packageJson: '{}', depackagedJson: '{}', depackagedMetadata: null,
      bodyText: null, attachments: [], rejectionReason: 'R', retryCount: 0,
      firstAttemptAt: new Date().toISOString(),
    })
    const entry = getAllPendingMerges()[0]!
    entry.retryCount++
    expect(getAllPendingMerges()[0]!.retryCount).toBe(1)
  })

  it('§4.4 MAX_EXTENSION_MERGE_RETRY is 3', () => {
    expect(MAX_EXTENSION_MERGE_RETRY).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 — No inbox writes under failure without sandbox
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!Database)('B-5.1 §2 — No inbox writes on failure path (no sandbox)', () => {
  let db: any
  let validateMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = makeDb()
    insertShellRow(db, 'msg-1', PACKAGE_JSON)
    bindKeyProvider(() => TEST_DEK)
    clearTamperingEvents()
    clearPendingMergeBuffer()
    mockFindPairedSandboxHandshake.mockReturnValue(null)

    const orchMod = await import('../../validator-process/orchestrator')
    validateMock = vi.spyOn(orchMod.validatorOrchestrator, 'validate') as any
    validateMock.mockResolvedValue(makeRejectionOutcome('MISSING_REQUIRED_FIELD'))
  })

  afterEach(() => {
    unbindKeyProvider()
    vi.restoreAllMocks()
    clearPendingMergeBuffer()
    db?.close()
  })

  it('§2.1 Validation fails, no sandbox → shell row is UNCHANGED (no DB write)', async () => {
    const before = getShellRow(db, 'msg-1')

    await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: JSON.stringify({ subject: 'test' }),
    })

    const after = getShellRow(db, 'msg-1')
    // Row must be bit-for-bit identical to before the merge attempt
    expect(after.depackaged_json).toBe(before.depackaged_json)
    expect(after.validated_at).toBe(before.validated_at)
    expect(after.validator_version).toBe(before.validator_version)
    expect(after.validation_reason).toBe(before.validation_reason)
    expect(after.seal).toBe(before.seal)
  })

  it('§2.2 Validation fails, no sandbox → entry added to retry buffer', async () => {
    await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: JSON.stringify({ subject: 'test' }),
    })

    expect(getPendingMergeCount()).toBe(1)
    const entry = getAllPendingMerges()[0]!
    expect(entry.rowId).toBe('msg-1')
    expect(entry.rejectionReason).toBe('MISSING_REQUIRED_FIELD')
    expect(entry.retryCount).toBe(0)
  })

  it('§2.3 Validation fails, no sandbox → UI notification emitted (inbox:mergePendingNoSandbox)', async () => {
    const sentEvents: unknown[] = []
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: (ch: string, data: unknown) => sentEvents.push({ ch, data }) },
    }
    const { BrowserWindow } = await import('electron')
    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([mockWindow as any])

    await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: JSON.stringify({ subject: 'test' }),
    })

    const notify = sentEvents.find((e: any) => e.ch === 'inbox:mergePendingNoSandbox') as any
    expect(notify).toBeTruthy()
    expect(notify.data.pendingCount).toBeGreaterThan(0)
  })

  it('§2.4 Validation fails, sandbox available → quarantine row written, no retry buffer entry', async () => {
    mockFindPairedSandboxHandshake.mockReturnValue({
      handshake_id: 'hid-sandbox',
      peer_x25519_public_key_b64: 'a'.repeat(44),
    })
    // First call: initial merge validation → reject.
    // Second call: quarantine content validation → success with live-computed seal.
    validateMock
      .mockResolvedValueOnce(makeRejectionOutcome('MISSING_REQUIRED_FIELD'))
      .mockImplementation(async ({ plaintext_or_encrypted, target_row_id }: any) =>
        makeQuarantineSuccessOutcome(plaintext_or_encrypted.content as string, target_row_id as string),
      )

    await mergeExtensionDepackaged(db, {
      beap_package_json: PACKAGE_JSON,
      depackaged_json: JSON.stringify({ subject: 'test' }),
    })

    // Quarantine row must be present
    const qRows = db.prepare('SELECT * FROM quarantine_messages').all() as any[]
    expect(qRows.length).toBe(1)
    expect(qRows[0].rejection_reason).toBe('MISSING_REQUIRED_FIELD')
    expect(qRows[0].seal).toBeTruthy()

    // Retry buffer must be empty (quarantine path handled it)
    expect(getPendingMergeCount()).toBe(0)

    // Shell inbox row still has no content written (only quarantine row exists)
    const shellRow = getShellRow(db, 'msg-1')
    expect(shellRow.seal).toBeFalsy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Retry buffer drain
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!Database)('B-5.1 §3 — drainExtensionMergeBuffer', () => {
  let db: any
  let validateMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = makeDb()
    insertShellRow(db, 'msg-2', PACKAGE_JSON)
    bindKeyProvider(() => TEST_DEK)
    clearTamperingEvents()
    clearPendingMergeBuffer()
    mockFindPairedSandboxHandshake.mockReturnValue(null)

    const orchMod = await import('../../validator-process/orchestrator')
    validateMock = vi.spyOn(orchMod.validatorOrchestrator, 'validate') as any
  })

  afterEach(() => {
    unbindKeyProvider()
    vi.restoreAllMocks()
    clearPendingMergeBuffer()
    db?.close()
  })

  function seedBuffer(rowId = 'msg-2', retryCount = 0) {
    addPendingMerge({
      rowId,
      packageJson: PACKAGE_JSON,
      depackagedJson: JSON.stringify({ subject: 'test' }),
      depackagedMetadata: null,
      bodyText: null,
      attachments: [],
      rejectionReason: 'MISSING_REQUIRED_FIELD',
      retryCount,
      firstAttemptAt: new Date().toISOString(),
    })
  }

  it('§3.1 No sandbox → retryCount incremented, entry NOT removed', async () => {
    seedBuffer('msg-2', 0)
    await drainExtensionMergeBuffer(db, null)
    expect(getPendingMergeCount()).toBe(1)
    expect(getAllPendingMerges()[0]!.retryCount).toBe(1)
  })

  it('§3.2 Sandbox becomes available → quarantine row written, entry removed', async () => {
    seedBuffer('msg-2', 0)
    mockFindPairedSandboxHandshake.mockReturnValue({
      handshake_id: 'hid-sb',
      peer_x25519_public_key_b64: 'a'.repeat(44),
    })
    validateMock.mockImplementation(async ({ plaintext_or_encrypted, target_row_id }: any) =>
      makeQuarantineSuccessOutcome(plaintext_or_encrypted.content as string, target_row_id as string),
    )

    const processed = await drainExtensionMergeBuffer(db, null)

    expect(processed).toBe(1)
    expect(getPendingMergeCount()).toBe(0)

    const qRows = db.prepare('SELECT * FROM quarantine_messages').all() as any[]
    expect(qRows.length).toBe(1)
  })

  it('§3.3 retryCount >= MAX → entry dropped with log, not written to DB', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedBuffer('msg-2', MAX_EXTENSION_MERGE_RETRY)

    const processed = await drainExtensionMergeBuffer(db, null)

    expect(processed).toBe(1)
    expect(getPendingMergeCount()).toBe(0)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('retry limit'))

    const qRows = db.prepare('SELECT * FROM quarantine_messages').all() as any[]
    expect(qRows.length).toBe(0)

    consoleSpy.mockRestore()
  })

  it('§3.4 Empty buffer → returns 0, no side effects', async () => {
    const processed = await drainExtensionMergeBuffer(db, null)
    expect(processed).toBe(0)
  })

  it('§3.5 Buffer drains and UI cleared when all entries processed', async () => {
    const sentEvents: unknown[] = []
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: (ch: string, data: unknown) => sentEvents.push({ ch, data }) },
    }
    const { BrowserWindow } = await import('electron')
    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([mockWindow as any])

    seedBuffer('msg-2', 0)
    mockFindPairedSandboxHandshake.mockReturnValue({
      handshake_id: 'hid-sb2',
      peer_x25519_public_key_b64: 'b'.repeat(44),
    })
    validateMock.mockImplementation(async ({ plaintext_or_encrypted, target_row_id }: any) =>
      makeQuarantineSuccessOutcome(plaintext_or_encrypted.content as string, target_row_id as string),
    )

    await drainExtensionMergeBuffer(db, null)

    const notifies = sentEvents.filter((e: any) => e.ch === 'inbox:mergePendingNoSandbox') as any[]
    expect(notifies.length).toBeGreaterThan(0)
    const last = notifies[notifies.length - 1]!
    expect(last.data.pendingCount).toBe(0)
  })
})
