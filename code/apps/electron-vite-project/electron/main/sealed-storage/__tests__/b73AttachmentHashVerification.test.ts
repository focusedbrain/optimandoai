/**
 * B-7.3 Attachment Hash Verification Tests
 *
 * Verifies the read-time attachment integrity check added to sealedQuery() in
 * PR B-7.3.  After a parent row's seal passes, sealedQuery() now cross-verifies
 * every attachment's `content_sha256` column in `inbox_attachments` against the
 * parent's `attachments_canonical[i].content_sha256` that was bound by the seal.
 *
 * Test inventory:
 *
 *   §1 — Happy paths (structural property holds)
 *     §1.1  Sealed message with zero attachments → no extra DB work; row returned
 *     §1.2  Sealed message with one attachment, hash matches → row returned
 *     §1.3  Sealed message with multiple attachments, all hashes match → row returned
 *     §1.4  Old-shape row (no attachments_canonical in canonical JSON) → passes through
 *     §1.5  Attachment count = 10 → all verified; row returned
 *
 *   §2 — Tampering detected (structural property enforced)
 *     §2.1  attachment content_sha256 changed directly in inbox_attachments → parent filtered
 *     §2.2  Extra attachment row inserted not in canonical array → parent filtered
 *     §2.3  Attachment row deleted that was in canonical array → parent filtered
 *     §2.4  Multiple attachments, one tampered → parent filtered; specific attachment logged
 *
 *   §3 — Graceful degradation
 *     §3.1  DB without inbox_attachments table → row returned (graceful skip)
 *     §3.2  Row without id column in query result → attachment verification skipped; row returned
 *
 *   §4 — Tampering event structure
 *     §4.1  Tamper event has type 'attachment_hash_mismatch'
 *     §4.2  Tamper event detail includes the attachment_id that mismatched
 *
 * per Phase B Architecture, PR B-7.3, Decisions A–D.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// better-sqlite3 availability guard
// ─────────────────────────────────────────────────────────────────────────────

const _req = createRequire(import.meta.url)
let BetterSqlite3: typeof import('better-sqlite3').default | null = null
try {
  const D = _req('better-sqlite3') as typeof import('better-sqlite3').default
  const probe = new D(':memory:')
  probe.close()
  BetterSqlite3 = D
} catch {
  BetterSqlite3 = null
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate imports
// ─────────────────────────────────────────────────────────────────────────────

import {
  sealedQuery,
  bindKeyProvider,
  unbindKeyProvider,
  clearTamperingEvents,
  getTamperingEvents,
} from '../index'

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

const TEST_KEY = Buffer.from('b73-attachment-test-key-32bytes!')

/** Create a test DB with the full inbox_messages + inbox_attachments schema. */
function makeDb() {
  if (!BetterSqlite3) throw new Error('better-sqlite3 unavailable')
  const db = new BetterSqlite3(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      source_type TEXT DEFAULT 'direct_beap',
      depackaged_json TEXT,
      seal TEXT,
      seal_input_json TEXT
    );
    CREATE TABLE inbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      filename TEXT,
      content_type TEXT,
      attachment_id TEXT,
      content_sha256 TEXT
    );
  `)
  return db
}
type Db = ReturnType<typeof makeDb>

/**
 * Build a seal (seal_input_json + seal HMAC) for a given canonical JSON string.
 * Mirrors the production prepareSealedInsert pattern.
 */
function buildSeal(canonicalJson: string, rowId: string, key = TEST_KEY) {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const sealInputJson = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
  const seal = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64')
  return { seal, sealInputJson, contentSha256 }
}

/**
 * Insert a sealed inbox_messages row with the given canonical content.
 */
function insertSealedMessage(
  db: Db,
  id: string,
  canonicalContent: Record<string, unknown>,
) {
  const canonicalJson = JSON.stringify(canonicalContent)
  const { seal, sealInputJson } = buildSeal(canonicalJson, id)
  db.prepare(`
    INSERT INTO inbox_messages (id, source_type, depackaged_json, seal, seal_input_json)
    VALUES (?, 'direct_beap', ?, ?, ?)
  `).run(id, canonicalJson, seal, sealInputJson)
  return { canonicalJson, seal, sealInputJson }
}

/**
 * Insert a row into inbox_attachments.
 * `attachment_id` is the logical ID (matches attachments_canonical[i].attachment_id).
 * `id` is the storage row PK (makeInboxAttachmentStorageId pattern).
 */
function insertAttachment(
  db: Db,
  messageId: string,
  attachmentId: string,
  contentSha256: string | null,
) {
  const rowId = `${messageId}-att-${attachmentId}`
  db.prepare(`
    INSERT INTO inbox_attachments (id, message_id, attachment_id, content_sha256)
    VALUES (?, ?, ?, ?)
  `).run(rowId, messageId, attachmentId, contentSha256)
  return rowId
}

/** Read a sealed row via sealedQuery. Returns the row array. */
function readMessage(db: Db, id: string) {
  return sealedQuery(db, 'SELECT * FROM inbox_messages WHERE id = ?', [id], 'depackaged_json')
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  bindKeyProvider(() => Buffer.from(TEST_KEY))
  clearTamperingEvents()
})

afterEach(() => {
  unbindKeyProvider()
  clearTamperingEvents()
})

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!BetterSqlite3)('B-7.3 §1 — Happy paths: structural property holds', () => {
  it('§1.1 sealed message with zero attachments → row returned', () => {
    const db = makeDb()
    const id = randomUUID()
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [],
    })
    // No inbox_attachments rows inserted.
    const rows = readMessage(db, id)
    expect(rows).toHaveLength(1)
    db.close()
  })

  it('§1.2 sealed message with one attachment, hash matches → row returned', () => {
    const db = makeDb()
    const id = randomUUID()
    const attId = 'att-1'
    const hash = 'aaaa1111'
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [{ attachment_id: attId, content_sha256: hash }],
    })
    insertAttachment(db, id, attId, hash)

    const rows = readMessage(db, id)
    expect(rows).toHaveLength(1)
    db.close()
  })

  it('§1.3 sealed message with multiple attachments, all hashes match → row returned', () => {
    const db = makeDb()
    const id = randomUUID()
    const attachments = [
      { attachment_id: 'att-a', content_sha256: 'hash_a' },
      { attachment_id: 'att-b', content_sha256: 'hash_b' },
      { attachment_id: 'att-c', content_sha256: 'hash_c' },
    ]
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: attachments,
    })
    for (const att of attachments) {
      insertAttachment(db, id, att.attachment_id, att.content_sha256)
    }

    const rows = readMessage(db, id)
    expect(rows).toHaveLength(1)
    db.close()
  })

  it('§1.4 old-shape row (no attachments_canonical in canonical JSON) → passes through', () => {
    const db = makeDb()
    const id = randomUUID()
    // Pre-B-5 style: no attachments_canonical field at all.
    insertSealedMessage(db, id, {
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
    })
    // No inbox_attachments rows — attachment verification is skipped for old-shape rows.
    const rows = readMessage(db, id)
    expect(rows).toHaveLength(1)
    db.close()
  })

  it('§1.5 attachment count = 10 → all verified; row returned', () => {
    const db = makeDb()
    const id = randomUUID()
    const attachments = Array.from({ length: 10 }, (_, i) => ({
      attachment_id: `att-${i}`,
      content_sha256: `hash_${i.toString().padStart(4, '0')}`,
    }))
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: attachments,
    })
    for (const att of attachments) {
      insertAttachment(db, id, att.attachment_id, att.content_sha256)
    }

    const rows = readMessage(db, id)
    expect(rows).toHaveLength(1)
    db.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Tampering detected
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!BetterSqlite3)('B-7.3 §2 — Tampering detected: parent row filtered', () => {
  it('§2.1 attachment content_sha256 changed directly → parent row filtered', () => {
    const db = makeDb()
    const id = randomUUID()
    const attId = 'att-1'
    const originalHash = 'original_hash_aaaa'
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [{ attachment_id: attId, content_sha256: originalHash }],
    })
    insertAttachment(db, id, attId, originalHash)

    // Tamper: change the stored hash directly (bypassing the gate).
    db.prepare('UPDATE inbox_attachments SET content_sha256 = ? WHERE attachment_id = ?')
      .run('tampered_hash_bbbb', attId)

    const rows = readMessage(db, id)
    expect(rows).toHaveLength(0)
    db.close()
  })

  it('§2.2 extra attachment row inserted not in canonical array → parent filtered', () => {
    const db = makeDb()
    const id = randomUUID()
    const attId = 'att-canonical'
    const hash = 'canonical_hash'
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [{ attachment_id: attId, content_sha256: hash }],
    })
    insertAttachment(db, id, attId, hash)

    // Inject an extra attachment row that isn't in the canonical array.
    insertAttachment(db, id, 'att-injected', 'injected_hash')

    const rows = readMessage(db, id)
    expect(rows).toHaveLength(0)
    db.close()
  })

  it('§2.3 attachment row deleted that was in canonical array → parent filtered', () => {
    const db = makeDb()
    const id = randomUUID()
    const attA = { attachment_id: 'att-a', content_sha256: 'hash_a' }
    const attB = { attachment_id: 'att-b', content_sha256: 'hash_b' }
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [attA, attB],
    })
    insertAttachment(db, id, attA.attachment_id, attA.content_sha256)
    insertAttachment(db, id, attB.attachment_id, attB.content_sha256)

    // Delete one attachment row — the canonical array still references it.
    db.prepare('DELETE FROM inbox_attachments WHERE attachment_id = ?').run(attB.attachment_id)

    const rows = readMessage(db, id)
    expect(rows).toHaveLength(0)
    db.close()
  })

  it('§2.4 one of multiple attachments tampered → parent filtered', () => {
    const db = makeDb()
    const id = randomUUID()
    const attachments = [
      { attachment_id: 'att-ok-1', content_sha256: 'hash_ok_1' },
      { attachment_id: 'att-tampered', content_sha256: 'hash_original' },
      { attachment_id: 'att-ok-2', content_sha256: 'hash_ok_2' },
    ]
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: attachments,
    })
    for (const att of attachments) {
      insertAttachment(db, id, att.attachment_id, att.content_sha256)
    }
    // Tamper only the middle attachment.
    db.prepare('UPDATE inbox_attachments SET content_sha256 = ? WHERE attachment_id = ?')
      .run('hash_forged', 'att-tampered')

    const rows = readMessage(db, id)
    expect(rows).toHaveLength(0)
    db.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Graceful degradation
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!BetterSqlite3)('B-7.3 §3 — Graceful degradation', () => {
  it('§3.1 DB without inbox_attachments table → row returned (attachment verification skipped)', () => {
    if (!BetterSqlite3) return
    // Create a DB without the inbox_attachments table.
    const db = new BetterSqlite3(':memory:')
    db.exec(`
      CREATE TABLE inbox_messages (
        id TEXT PRIMARY KEY,
        depackaged_json TEXT,
        seal TEXT,
        seal_input_json TEXT
      );
    `)
    const id = randomUUID()
    const canonicalJson = JSON.stringify({
      content_type: 'beap_message',
      attachments_canonical: [{ attachment_id: 'att-1', content_sha256: 'abc' }],
    })
    const { seal, sealInputJson } = buildSeal(canonicalJson, id)
    db.prepare('INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json) VALUES (?, ?, ?, ?)')
      .run(id, canonicalJson, seal, sealInputJson)

    // sealedQuery should return the row (graceful degradation: no inbox_attachments table → skip attachment check)
    const rows = sealedQuery(db, 'SELECT * FROM inbox_messages WHERE id = ?', [id], 'depackaged_json')
    expect(rows).toHaveLength(1)
    db.close()
  })

  it('§3.2 query result without id column → attachment verification skipped; row returned', () => {
    const db = makeDb()
    const id = randomUUID()
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [{ attachment_id: 'att-1', content_sha256: 'abc' }],
    })
    insertAttachment(db, id, 'att-1', 'abc')

    // Query that excludes the id column.
    const rows = sealedQuery(
      db,
      'SELECT depackaged_json, seal, seal_input_json FROM inbox_messages WHERE id = ?',
      [id],
      'depackaged_json',
    )
    // Without an id column the attachment check is skipped; the seal is still verified.
    expect(rows).toHaveLength(1)
    db.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Tampering event structure
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!BetterSqlite3)('B-7.3 §4 — Tampering event structure', () => {
  it('§4.1 tamper event type is attachment_hash_mismatch', () => {
    const db = makeDb()
    const id = randomUUID()
    const attId = 'att-1'
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [{ attachment_id: attId, content_sha256: 'original' }],
    })
    insertAttachment(db, id, attId, 'original')
    db.prepare('UPDATE inbox_attachments SET content_sha256 = ? WHERE attachment_id = ?')
      .run('tampered', attId)

    clearTamperingEvents()
    readMessage(db, id)

    const events = getTamperingEvents()
    expect(events.some((e) => e.reason === 'attachment_hash_mismatch')).toBe(true)
    db.close()
  })

  it('§4.2 tamper event detail includes the attachment_id that mismatched', () => {
    const db = makeDb()
    const id = randomUUID()
    const attId = 'att-specific-abc123'
    insertSealedMessage(db, id, {
      content_type: 'beap_message',
      attachments_canonical: [{ attachment_id: attId, content_sha256: 'original' }],
    })
    insertAttachment(db, id, attId, 'original')
    db.prepare('UPDATE inbox_attachments SET content_sha256 = ? WHERE attachment_id = ?')
      .run('tampered', attId)

    clearTamperingEvents()
    readMessage(db, id)

    const events = getTamperingEvents()
    const attEvent = events.find((e) => e.reason === 'attachment_hash_mismatch')
    expect(attEvent).toBeDefined()
    // The detail should contain the specific attachment_id for forensic logging.
    expect(attEvent?.detail ?? '').toContain(attId)
    db.close()
  })
})
