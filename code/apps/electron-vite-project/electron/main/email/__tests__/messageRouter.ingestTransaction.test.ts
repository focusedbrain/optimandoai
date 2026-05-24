import { createRequire } from 'module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'crypto'
import { makeInboxAttachmentStorageId } from '../messageRouter'
import { bindKeyProvider, unbindKeyProvider, clearTamperingEvents } from '../../sealed-storage'

const require = createRequire(import.meta.url)

/** Native module must match host Node ABI (Electron vs system Node). */
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:')
  d.close()
  Database = D
} catch {
  Database = null
}

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

function buildValidSealForRowId(canonicalJson: string, rowId: string): { seal: string; seal_input_json: string } {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const sealInputJson = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
  const seal = createHmac('sha256', TEST_DEK).update(sealInputJson, 'utf8').digest('base64')
  return { seal, seal_input_json: sealInputJson }
}

vi.mock('../handshake/db', () => ({
  insertPendingP2PBeap: vi.fn(),
  // insertPendingPlainEmail removed — plain_email_inbox dropped in schema v65 (PR B-3.1).
}))

vi.mock('../gateway', () => ({
  emailGateway: { getProviderSync: () => 'gmail' },
}))

vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({
    storagePath: '/tmp/mock.bin',
    encryptionKeyStored: 'k',
    ivB64: 'i',
    tagB64: 't',
  })),
}))

vi.mock('../pdf-extractor', () => ({
  extractPdfText: vi.fn(async () => ({ text: '', status: 'skipped' })),
  isPdfFile: () => false,
  resolveInboxPdfExtractionStatus: () => ({ status: 'skipped', error: null }),
}))

import { detectAndRouteMessage } from '../messageRouter'

function createTestDb(): import('better-sqlite3').Database {
  if (!Database) throw new Error('better-sqlite3 unavailable')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('direct_beap','email_beap','email_plain')),
      handshake_id TEXT,
      account_id TEXT,
      email_message_id TEXT,
      from_address TEXT,
      from_name TEXT,
      to_addresses TEXT,
      cc_addresses TEXT,
      subject TEXT,
      body_text TEXT,
      body_html TEXT,
      beap_package_json TEXT,
      depackaged_json TEXT,
      depackaged_metadata TEXT,
      has_attachments INTEGER DEFAULT 0,
      attachment_count INTEGER DEFAULT 0,
      received_at TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      imap_remote_mailbox TEXT,
      imap_rfc_message_id TEXT,
      validated_at TEXT,
      validator_version TEXT,
      validation_reason TEXT,
      seal TEXT,
      seal_input_json TEXT
    );
    CREATE TABLE inbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER,
      content_id TEXT,
      storage_path TEXT,
      extracted_text TEXT,
      text_extraction_status TEXT DEFAULT 'pending',
      text_extraction_error TEXT,
      content_sha256 TEXT,
      extracted_text_sha256 TEXT,
      encryption_key TEXT,
      encryption_iv TEXT,
      encryption_tag TEXT,
      storage_encrypted INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER,
      raster_path TEXT,
      embedding_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  return db
}

describe('makeInboxAttachmentStorageId', () => {
  it('scopes provider ids across different inbox message rows', () => {
    const a = 'a1111111-1111-1111-1111-111111111111'
    const b = 'b2222222-2222-2222-2222-222222222222'
    expect(makeInboxAttachmentStorageId(a, 'same-provider-id')).not.toBe(
      makeInboxAttachmentStorageId(b, 'same-provider-id'),
    )
  })
})

describe.skipIf(!Database)('detectAndRouteMessage transaction (requires native better-sqlite3)', () => {
  let db: import('better-sqlite3').Database
  let validateMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    db = createTestDb()
    bindKeyProvider(() => TEST_DEK)
    clearTamperingEvents()

    // Phase B: detectAndRouteMessage calls validatorOrchestrator.validate for all email types.
    // Return a valid HMAC-sealed outcome so runSealedTransaction succeeds.
    const orchMod = await import('../../validator-process/orchestrator')
    validateMock = vi.spyOn(orchMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? 'row-unknown')
      const canonicalJson = args.plaintext_or_encrypted?.content ?? '{}'
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
      return {
        outcome: {
          ok: true,
          sealed: {
            seal,
            seal_input_json,
            canonical_json: canonicalJson,
            validated_at: new Date().toISOString(),
            validator_version: 'msg-router-test',
          },
        },
      } as any
    })
  })

  afterEach(() => {
    unbindKeyProvider()
    vi.restoreAllMocks()
    db?.close()
  })

  it('rolls back inbox_messages when a later attachment insert fails', async () => {
    let inboxAttInsertCalls = 0
    const origPrepare = db.prepare.bind(db)
    db.prepare = function (sql: string) {
      const stmt = origPrepare(sql)
      if (sql.includes('INSERT INTO inbox_attachments')) {
        const origRun = stmt.run.bind(stmt)
        ;(stmt as { run: (...a: unknown[]) => unknown }).run = (...args: unknown[]) => {
          inboxAttInsertCalls++
          if (inboxAttInsertCalls === 2) {
            throw new Error('forced attachment insert failure')
          }
          return origRun(...args)
        }
      }
      return stmt
    }

    const raw = {
      messageId: 'ext-99',
      from: { address: 'x@y.com' },
      to: [],
      subject: 'sub',
      text: 'body',
      date: new Date().toISOString(),
      attachments: [
        {
          id: 'att-a',
          filename: 'a.txt',
          contentType: 'text/plain',
          size: 1,
          content: Buffer.from('a'),
        },
        {
          id: 'att-b',
          filename: 'b.txt',
          contentType: 'text/plain',
          size: 1,
          content: Buffer.from('b'),
        },
      ],
    }

    await expect(detectAndRouteMessage(db, 'acc-1', raw as any)).rejects.toThrow()

    const msgCount = (db.prepare('SELECT COUNT(*) AS c FROM inbox_messages').get() as { c: number }).c
    const attCount = (db.prepare('SELECT COUNT(*) AS c FROM inbox_attachments').get() as { c: number }).c
    expect(msgCount).toBe(0)
    expect(attCount).toBe(0)
  })

  it('ingests two attachments with the same provider id when they belong to different inbox rows', async () => {
    const db1 = createTestDb()
    const raw1 = {
      messageId: 'ext-1',
      from: { address: 'a@b.com' },
      to: [],
      subject: 's',
      text: 't',
      date: new Date().toISOString(),
      attachments: [
        {
          id: 'dup',
          filename: 'f.txt',
          contentType: 'text/plain',
          size: 1,
          content: Buffer.from('x'),
        },
      ],
    }
    await detectAndRouteMessage(db1, 'acc', raw1 as any)

    const raw2 = {
      messageId: 'ext-2',
      from: { address: 'a@b.com' },
      to: [],
      subject: 's2',
      text: 't2',
      date: new Date().toISOString(),
      attachments: [
        {
          id: 'dup',
          filename: 'f.txt',
          contentType: 'text/plain',
          size: 1,
          content: Buffer.from('y'),
        },
      ],
    }
    await detectAndRouteMessage(db1, 'acc', raw2 as any)

    const n = (db1.prepare('SELECT COUNT(*) AS c FROM inbox_attachments').get() as { c: number }).c
    expect(n).toBe(2)
  })
})
