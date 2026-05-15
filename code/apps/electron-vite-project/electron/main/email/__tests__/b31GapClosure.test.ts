/**
 * B-3.1 Gap Closure Tests
 *
 * Covers the three gaps closed by PR B-3.1:
 *
 * Gap 1 — Attachment sealing (Att-2):
 *   - Validator correctly validates attachments_canonical field.
 *   - runSealedTransaction writes parent row + child rows atomically.
 *   - A sealed parent row's canonical_json includes attachment SHA-256s
 *     so post-write content_sha256 tampering in inbox_attachments is
 *     detectable (for plain_email source type).
 *
 * Gap 2 — Dead staging caller removal:
 *   - plain_email_inbox is not referenced in any live code path
 *     (static verification via source grep).
 *
 * Gap 3 — beapEmailIngestion legacy path narrowing:
 *   - retryPendingQbeapDecrypt skips rows that already have a seal.
 *
 * per Phase B Architecture, PR B-3.1.
 */

import { createRequire } from 'module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateDecryptedBeapContent } from '@repo/ingestion-core'
import {
  bindKeyProvider,
  unbindKeyProvider,
  clearTamperingEvents,
  getTamperingEvents,
  prepareSealedInsert,
  runSealedTransaction,
  SealVerificationError,
} from '../../sealed-storage/index'
import { createHmac, createHash, randomUUID } from 'crypto'

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

// ─────────────────────────────────────────────────────────────────────────────
// Gap 1a — attachments_canonical validation in contentValidator
// ─────────────────────────────────────────────────────────────────────────────

describe('Gap 1 — Att-2: contentValidator accepts attachments_canonical', () => {
  it('plain_email with no attachments_canonical passes', () => {
    const result = validateDecryptedBeapContent({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
    })
    expect(result.validation_reason).toBeNull()
  })

  it('plain_email with empty attachments_canonical passes', () => {
    const result = validateDecryptedBeapContent({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: [],
    })
    expect(result.validation_reason).toBeNull()
  })

  it('plain_email with valid attachments_canonical passes', () => {
    const result = validateDecryptedBeapContent({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: [
        {
          attachment_id: 'att-0001-0001-0001-0001-000000000001',
          filename: 'report.pdf',
          content_type: 'application/pdf',
          size_bytes: 2048,
          content_sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        },
      ],
    })
    expect(result.validation_reason).toBeNull()
  })

  it('plain_email with attachments_canonical entry missing attachment_id is rejected', () => {
    const result = validateDecryptedBeapContent({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: [
        {
          filename: 'report.pdf',
          content_type: 'application/pdf',
          size_bytes: 2048,
          content_sha256: 'abcdef',
        },
      ],
    })
    expect(result.validation_reason).toBe('MISSING_REQUIRED_FIELD')
    expect(result.validation_details).toMatch(/attachment_id/)
  })

  it('plain_email with non-array attachments_canonical is rejected', () => {
    const result = validateDecryptedBeapContent({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: 'not-an-array',
    })
    expect(result.validation_reason).toBe('MISSING_REQUIRED_FIELD')
    expect(result.validation_details).toMatch(/must be an array/)
  })

  it('plain_email with invalid content_sha256 (empty string) is rejected', () => {
    const result = validateDecryptedBeapContent({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: [
        {
          attachment_id: 'att-0001',
          filename: 'f.txt',
          content_type: 'text/plain',
          size_bytes: 5,
          content_sha256: '',
        },
      ],
    })
    expect(result.validation_reason).toBe('MISSING_REQUIRED_FIELD')
    expect(result.validation_details).toMatch(/content_sha256/)
  })

  it('plain_email with null content_sha256 passes (no bytes = no hash)', () => {
    const result = validateDecryptedBeapContent({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: [
        {
          attachment_id: 'att-0001',
          filename: 'stub.pdf',
          content_type: 'application/pdf',
          size_bytes: 0,
          content_sha256: null,
        },
      ],
    })
    expect(result.validation_reason).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gap 1b — runSealedTransaction atomicity
// ─────────────────────────────────────────────────────────────────────────────

const SEAL_KEY = Buffer.from('test-seal-key-for-b31-tests'.padEnd(32, 'x').slice(0, 32), 'utf8')

function makeSeal(sealInputJson: string): string {
  return createHmac('sha256', SEAL_KEY).update(sealInputJson, 'utf8').digest('base64')
}

function buildSealParams(rowId: string, canonicalJson: string) {
  const contentSha = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const sealInputJson = JSON.stringify({
    row_id: rowId,
    content_sha256: contentSha,
    nonce: randomUUID(),
    outcome_class: 'ok',
    validator_version: '1.0.0',
    validated_at: new Date().toISOString(),
  })
  return {
    seal: makeSeal(sealInputJson),
    seal_input_json: sealInputJson,
    canonical_json: canonicalJson,
    row_id: rowId,
  }
}

const INBOX_SQL = `
  INSERT INTO inbox_messages (id, source_type, account_id, email_message_id,
    from_address, to_addresses, cc_addresses, subject, body_text, body_html,
    beap_package_json, depackaged_json, has_attachments, attachment_count,
    received_at, ingested_at, imap_remote_mailbox, imap_rfc_message_id,
    validated_at, validator_version, validation_reason, seal, seal_input_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

function createTestDb(): import('better-sqlite3').Database {
  if (!Database) throw new Error('better-sqlite3 unavailable')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      source_type TEXT,
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
      received_at TEXT,
      ingested_at TEXT,
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
      message_id TEXT NOT NULL,
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
      storage_encrypted INTEGER DEFAULT 0,
      page_count INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  return db
}

describe.skipIf(!Database)('Gap 1 — Att-2: runSealedTransaction atomicity', () => {
  beforeEach(() => {
    clearTamperingEvents()
    bindKeyProvider(() => Buffer.from(SEAL_KEY))
  })

  afterEach(() => {
    unbindKeyProvider()
    clearTamperingEvents()
  })

  it('writes parent inbox row + child attachment rows in a single transaction', () => {
    const db = createTestDb()
    const rowId = randomUUID()
    const canonicalJson = JSON.stringify({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: [
        { attachment_id: 'att-1', filename: 'a.txt', content_type: 'text/plain', size_bytes: 5, content_sha256: 'sha1' },
        { attachment_id: 'att-2', filename: 'b.txt', content_type: 'text/plain', size_bytes: 5, content_sha256: 'sha2' },
      ],
    })
    const sealParams = buildSealParams(rowId, canonicalJson)
    const sealedInbox = prepareSealedInsert(db, INBOX_SQL)
    const insertAtt = db.prepare(`INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    const now = new Date().toISOString()

    const bindArgs = [rowId, 'email_plain', 'acc', 'email-1', 'alice@example.com', '[]', '[]', 'subject', 'body', null, null, canonicalJson, 0, 0, now, now, null, null, now, '1.0.0', 'plain_email_no_validation_required', sealParams.seal, sealParams.seal_input_json]

    runSealedTransaction(db, sealedInbox, bindArgs, sealParams, [
      () => insertAtt.run('att-1', rowId, 'a.txt', 'text/plain', 5, now),
      () => insertAtt.run('att-2', rowId, 'b.txt', 'text/plain', 5, now),
    ])

    const msgCount = (db.prepare('SELECT COUNT(*) AS c FROM inbox_messages').get() as any).c
    const attCount = (db.prepare('SELECT COUNT(*) AS c FROM inbox_attachments').get() as any).c
    expect(msgCount).toBe(1)
    expect(attCount).toBe(2)
    expect(getTamperingEvents()).toHaveLength(0)
  })

  it('rolls back parent AND child writes atomically when a child write throws', () => {
    const db = createTestDb()
    const rowId = randomUUID()
    const canonicalJson = JSON.stringify({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
    })
    const sealParams = buildSealParams(rowId, canonicalJson)
    const sealedInbox = prepareSealedInsert(db, INBOX_SQL)
    const now = new Date().toISOString()
    const bindArgs = [rowId, 'email_plain', 'acc', 'email-2', 'alice@example.com', '[]', '[]', 'subject', 'body', null, null, canonicalJson, 0, 0, now, now, null, null, now, '1.0.0', null, sealParams.seal, sealParams.seal_input_json]

    expect(() =>
      runSealedTransaction(db, sealedInbox, bindArgs, sealParams, [
        () => { throw new Error('forced child write failure') },
      ])
    ).toThrow('forced child write failure')

    const msgCount = (db.prepare('SELECT COUNT(*) AS c FROM inbox_messages').get() as any).c
    expect(msgCount).toBe(0)
  })

  it('throws SealVerificationError when seal is invalid (reject mode)', () => {
    const db = createTestDb()
    const rowId = randomUUID()
    const canonicalJson = JSON.stringify({ content_type: 'plain_email', transport_sender: 'x@y.com', transport_received_at: new Date().toISOString() })
    const sealParams = buildSealParams(rowId, canonicalJson)
    const tampered = { ...sealParams, seal: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }
    const sealedInbox = prepareSealedInsert(db, INBOX_SQL)
    const now = new Date().toISOString()
    const bindArgs = [rowId, 'email_plain', 'acc', 'email-3', 'x@y.com', '[]', '[]', 'subject', 'body', null, null, canonicalJson, 0, 0, now, now, null, null, now, '1.0.0', null, tampered.seal, tampered.seal_input_json]

    expect(() =>
      runSealedTransaction(db, sealedInbox, bindArgs, tampered, [])
    ).toThrow(SealVerificationError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gap 1c — Att-2 seal covers attachment content_sha256 (tampering detection)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!Database)('Gap 1 — Att-2: attachment SHA-256 is bound by parent seal', () => {
  beforeEach(() => {
    clearTamperingEvents()
    bindKeyProvider(() => Buffer.from(SEAL_KEY))
  })

  afterEach(() => {
    unbindKeyProvider()
    clearTamperingEvents()
  })

  it('parent canonical_json includes attachment content_sha256', () => {
    const db = createTestDb()
    const rowId = randomUUID()
    const attSha256 = 'a'.repeat(64)
    const canonicalJson = JSON.stringify({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
      attachments_canonical: [
        { attachment_id: 'att-99', filename: 'doc.pdf', content_type: 'application/pdf', size_bytes: 1024, content_sha256: attSha256 },
      ],
    })
    const sealParams = buildSealParams(rowId, canonicalJson)
    const sealedInbox = prepareSealedInsert(db, INBOX_SQL)
    const insertAtt = db.prepare(`INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    const updateSha = db.prepare(`UPDATE inbox_attachments SET content_sha256 = ? WHERE id = ?`)
    const now = new Date().toISOString()
    const bindArgs = [rowId, 'email_plain', 'acc', 'email-4', 'alice@example.com', '[]', '[]', 'subject', 'body', null, null, canonicalJson, 1, 1, now, now, null, null, now, '1.0.0', 'plain_email_no_validation_required', sealParams.seal, sealParams.seal_input_json]

    runSealedTransaction(db, sealedInbox, bindArgs, sealParams, [
      () => insertAtt.run('att-99', rowId, 'doc.pdf', 'application/pdf', 1024, attSha256, now),
    ])

    // Tamper: update the attachment's content_sha256 to a different value.
    updateSha.run('b'.repeat(64), 'att-99')

    const storedAtt = db.prepare(`SELECT content_sha256 FROM inbox_attachments WHERE id = ?`).get('att-99') as { content_sha256: string }
    expect(storedAtt.content_sha256).toBe('b'.repeat(64))

    // The parent message row's depackaged_json still contains the ORIGINAL sha256 ('a'*64).
    // A read-path verifying the parent seal would detect the mismatch because the
    // seal binds sha256(canonical_json), and canonical_json includes 'a'*64, not 'b'*64.
    const storedRow = db.prepare(`SELECT depackaged_json, seal, seal_input_json FROM inbox_messages WHERE id = ?`).get(rowId) as any
    const parsedCanonical = JSON.parse(storedRow.depackaged_json)
    const originalSha = parsedCanonical.attachments_canonical?.[0]?.content_sha256
    expect(originalSha).toBe(attSha256)
    expect(storedAtt.content_sha256).not.toBe(originalSha)
    // Confirming: the seal binds the original hash, so the tampering is detectable.
    const parsedSealInput = JSON.parse(storedRow.seal_input_json)
    const expectedContentHash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
    expect(parsedSealInput.content_sha256).toBe(expectedContentHash)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gap 2 — plain_email_inbox dead callers removed
// ─────────────────────────────────────────────────────────────────────────────

describe('Gap 2 — plain_email_inbox staging callers removed', () => {
  it('insertPendingPlainEmail is not exported from handshake/db', async () => {
    const db = await import('../../handshake/db')
    expect('insertPendingPlainEmail' in db).toBe(false)
  })

  it('getPendingPlainEmails is not exported from handshake/db', async () => {
    const db = await import('../../handshake/db')
    expect('getPendingPlainEmails' in db).toBe(false)
  })

  it('markPlainEmailProcessed is not exported from handshake/db', async () => {
    const db = await import('../../handshake/db')
    expect('markPlainEmailProcessed' in db).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gap 3 — resealWithDecryptedContent refuses already-sealed rows (PR B-7.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase B, PR B-7.2: `tryQbeapDecryptInbox` was removed (dead production code;
// it had no production callers after `retryPendingQbeapDecrypt` was migrated in
// B-4).  The equivalent sealed-row guard is now in `resealWithDecryptedContent`.
// This test verifies the guard holds: a row that already carries a valid seal
// must NOT be overwritten by `resealWithDecryptedContent`.

describe.skipIf(!Database)('Gap 3 — sealed row guard in resealWithDecryptedContent (PR B-7.2)', () => {
  it('returns ok=false without touching depackaged_json for an already-sealed row', async () => {
    const db = createTestDb()
    const msgId = randomUUID()
    const now = new Date().toISOString()

    // Insert a sealed inbox_messages row (simulates B-3+ sealed write).
    db.prepare(`
      INSERT INTO inbox_messages (id, source_type, account_id, email_message_id,
        from_address, to_addresses, cc_addresses, subject, body_text, has_attachments,
        attachment_count, received_at, ingested_at,
        depackaged_metadata, beap_package_json, handshake_id,
        validated_at, validator_version, validation_reason, seal, seal_input_json)
      VALUES (?, 'direct_beap', '__p2p_beap__', ?, 'sender@x.com', '[]', '[]',
        'subj', 'body', 0, 0, ?, ?,
        '{"format":"beap_qbeap_outbound"}',
        '{"header":{"encoding":"qBEAP"},"metadata":{}}',
        'hs-123', ?, '1.0.0', null, 'EXISTING_SEAL_VALUE', '{"sealed":true}')
    `).run(msgId, 'ext-sealed', now, now, now)

    const { resealWithDecryptedContent } = await import('../sealedContentUpdate')

    const result = await resealWithDecryptedContent(db as any, {
      rowId: msgId,
      rawCapsuleJson: '{"content_type":"beap_message","subject":"new"}',
      bodyText: 'new body',
      subject: 'new subject',
      depackagedMetadata: { format: 'beap_qbeap_decrypted' },
      provenance: {
        source_type: 'p2p',
        origin_classification: 'external',
        ingested_at: now,
        transport_metadata: { message_id: 'hs-123' },
        input_classification: 'beap_capsule_present',
        raw_input_hash: 'aabbcc',
        ingestor_version: '1.0.0',
      },
      attachmentCount: 0,
    })

    // The sealed row guard must fire: ok=false, depackaged_json unchanged.
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already carries a seal/)
    const row = db.prepare(`SELECT depackaged_json FROM inbox_messages WHERE id = ?`).get(msgId) as any
    // depackaged_json was NULL (we never set it in the INSERT above)
    expect(row.depackaged_json).toBeNull()
  })
})

