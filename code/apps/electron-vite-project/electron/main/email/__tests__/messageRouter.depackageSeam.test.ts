/**
 * B2 Phase 3.2/3.3 — flag-on `detectAndRouteMessage` consumer of the depackage
 * seam. Proves: flag-off is untouched; flag-on routes opaque bytes through the
 * isolated guest (in-process here) and CONSUMES the typed union — plain → sealed
 * inbox row from guest SafeText; carrier → proven pipeline-2; worker/dispatch
 * failure → quarantine (mapping table); missing opaque/sandbox → HELD (INV-7,
 * never inline-parsed).
 */

import { createRequire } from 'module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'crypto'
import { bindKeyProvider, unbindKeyProvider, clearTamperingEvents } from '../../sealed-storage'

const require = createRequire(import.meta.url)

let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:'); d.close(); Database = D
} catch { Database = null }

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

// HOISTED state for the module mocks below. `vi.mock` is hoisted ABOVE module
// top-level consts, and the mocked handshake modules are imported transitively
// during the (ESM-hoisted) `import` of messageRouter — i.e. BEFORE plain consts
// initialize. Referencing plain consts in those factories is a TDZ bug (it was
// latent only because this suite was perpetually skipped). `vi.hoisted` makes
// the values exist at hoist time. SANDBOX_PUB is a fixed VALID x25519 public key
// (pub of priv=0x11*32) so the in-guest artifact sealing works.
const h = vi.hoisted(() => ({
  SANDBOX_PUB: 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=',
  // Mutable so individual tests can simulate "no paired sandbox".
  sandboxState: {
    list: [{ handshake_id: 'hs-1', sandbox_keying_complete: true }] as Array<{
      handshake_id: string
      sandbox_keying_complete: boolean
    }>,
  },
}))
const SANDBOX_PUB = h.SANDBOX_PUB
const sandboxState = h.sandboxState
// `findPairedSandboxHandshake` short-circuits to null on a falsy session; the
// flag-on seam needs a paired sandbox to obtain the custody key. A truthy stub
// suffices — the internalSandboxesApi/handshake lookups are mocked below.
const SESSION = { sessionId: 'test-session', userId: 'test-user' } as any

function buildValidSealForRowId(canonicalJson: string, rowId: string) {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const seal_input_json = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
  const seal = createHmac('sha256', TEST_DEK).update(seal_input_json, 'utf8').digest('base64')
  return { seal, seal_input_json }
}

// NOTE on mock paths: `vi.mock` specifiers resolve relative to THIS test file
// (email/__tests__/), NOT relative to messageRouter (email/). email-local modules
// are `../X`; main-level modules are `../../X`. messageRouter imports the latter
// as `../X` (correct for ITS location) — mirroring that here silently no-ops the
// mock, which is why the real handshake/quarantine modules ran before.
vi.mock('../gateway', () => ({ emailGateway: { getProviderSync: () => 'gmail' } }))
vi.mock('../../handshake/internalSandboxesApi', () => ({
  // Current API shape: { success, sandboxes }. `findPairedSandboxHandshake`
  // returns null on a falsy `success`, which previously masqueraded as
  // "no paired sandbox" when this mock omitted the field.
  listAvailableInternalSandboxes: () => ({ success: true, sandboxes: h.sandboxState.list }),
  isEligibleActiveInternalHostSandboxRecord: () => true,
}))
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: () => ({ peer_x25519_public_key_b64: h.SANDBOX_PUB }),
}))
vi.mock('../../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: (_blob: unknown) => ({
    storage_id: 'blob-' + Math.random().toString(16).slice(2),
    blob_sha256: 'a'.repeat(64),
    blob_size_bytes: 123,
  }),
}))
vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({ storagePath: '/tmp/m.bin', encryptionKeyStored: 'k', ivB64: 'i', tagB64: 't' })),
}))
vi.mock('../pdf-extractor', () => ({
  extractPdfText: vi.fn(async () => ({ text: '', status: 'skipped' })),
  isPdfFile: () => false,
  resolveInboxPdfExtractionStatus: () => ({ status: 'skipped', error: null }),
}))

import { detectAndRouteMessage, DepackageCutoverHeldError } from '../messageRouter'

function createTestDb(): import('better-sqlite3').Database {
  if (!Database) throw new Error('better-sqlite3 unavailable')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('direct_beap','email_beap','email_plain')),
      handshake_id TEXT, account_id TEXT, email_message_id TEXT,
      from_address TEXT, from_name TEXT, to_addresses TEXT, cc_addresses TEXT,
      subject TEXT, body_text TEXT, body_html TEXT, beap_package_json TEXT,
      depackaged_json TEXT, depackaged_metadata TEXT,
      has_attachments INTEGER DEFAULT 0, attachment_count INTEGER DEFAULT 0,
      received_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
      imap_remote_mailbox TEXT, imap_rfc_message_id TEXT,
      validated_at TEXT, validator_version TEXT, validation_reason TEXT,
      seal TEXT, seal_input_json TEXT, seal_key_source TEXT
    );
    CREATE TABLE inbox_attachments (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, filename TEXT NOT NULL,
      content_type TEXT, size_bytes INTEGER, content_id TEXT, storage_path TEXT,
      extracted_text TEXT, text_extraction_status TEXT, text_extraction_error TEXT,
      content_sha256 TEXT, extracted_text_sha256 TEXT, encryption_key TEXT,
      encryption_iv TEXT, encryption_tag TEXT, storage_encrypted INTEGER DEFAULT 0,
      page_count INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE quarantine_messages (
      id TEXT PRIMARY KEY, transport_sender TEXT, transport_received_at TEXT,
      transport_folder TEXT, blob_size_bytes INTEGER, blob_storage_id TEXT,
      blob_sha256 TEXT, rejection_reason TEXT, paired_sandbox_handshake_id TEXT,
      seal TEXT, seal_input_json TEXT, cloned_to_sandbox_at TEXT
    );
  `)
  return db
}

function eml(headers: string[], body: string): Buffer {
  return Buffer.from([...headers, '', body].join('\r\n'), 'utf8')
}
const PBEAP_PKG = JSON.stringify({
  header: { encoding: 'pBEAP' },
  metadata: {},
  payload: Buffer.from(JSON.stringify({ capsule_type: 'initiate', schema_version: 1 }), 'utf8').toString('base64'),
})

describe.skipIf(!Database)('B2 depackage-seam consumer (flag-on, in-process)', () => {
  let db: import('better-sqlite3').Database

  beforeEach(async () => {
    db = createTestDb()
    // Plain-mail rows seal with the 'outer' provider; sealed validator output
    // uses 'inner'. Bind BOTH (the API is source-aware now).
    bindKeyProvider(() => TEST_DEK, 'inner')
    bindKeyProvider(() => TEST_DEK, 'outer')
    clearTamperingEvents()
    sandboxState.list = [{ handshake_id: 'hs-1', sandbox_keying_complete: true }]
    process.env.WRDESK_ROLE = 'sandbox'
    process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER = '1'
    const orchMod = await import('../../validator-process/orchestrator')
    vi.spyOn(orchMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? 'row')
      const canonicalJson = args.plaintext_or_encrypted?.content ?? '{}'
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
      return { outcome: { ok: true, sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at: new Date().toISOString(), validator_version: 'test' } } } as any
    })
  })
  afterEach(() => {
    unbindKeyProvider('inner'); unbindKeyProvider('outer'); vi.restoreAllMocks(); db?.close()
    delete process.env.WRDESK_ROLE
    delete process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER
  })

  it('plain mail → sealed inbox row built from guest SafeText', async () => {
    const raw: any = {
      messageId: 'ext-1', from: { address: 'a@b.com' }, to: [], subject: 'ignored-by-seam',
      date: new Date().toISOString(),
      rawRfc822: eml(['Subject: Real Subject', 'Content-Type: text/plain'], 'hello from the guest'),
    }
    const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
    expect(res.type).toBe('plain')
    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(res.inboxMessageId) as any
    expect(row.source_type).toBe('email_plain')
    expect(row.subject).toBe('Real Subject')           // guest-derived, not provider envelope
    expect(row.body_text).toContain('hello from the guest')
    expect(row.body_html).toBeNull()
  })

  it('HTML-only plain mail → body derived in-guest, HTML preserved as sealed artifact (ref counted)', async () => {
    const raw: any = {
      messageId: 'ext-2', from: { address: 'a@b.com' }, to: [], subject: 's',
      date: new Date().toISOString(),
      rawRfc822: eml(['Subject: H', 'Content-Type: text/html'], '<p>Hi <b>there</b></p>'),
    }
    const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
    expect(res.type).toBe('plain')
    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(res.inboxMessageId) as any
    expect(row.body_text).toContain('Hi')
    expect(row.has_attachments).toBe(1)   // sealed HTML original preserved
    expect(row.attachment_count).toBe(1)
  })

  it('carrier mail → routed through proven pipeline-2 (email_beap row)', async () => {
    const raw: any = {
      messageId: 'ext-3', from: { address: 'a@b.com' }, to: [], subject: 's',
      date: new Date().toISOString(),
      rawRfc822: eml(['Subject: pkg', 'Content-Type: text/plain'], PBEAP_PKG),
    }
    const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
    expect(res.type).toBe('beap')
    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(res.inboxMessageId) as any
    expect(row.source_type).toBe('email_beap')
  })

  it('INV-7: ambiguous classification → quarantine with mapped reason', async () => {
    const weird = JSON.stringify({ header: { encoding: 'xBEAP' }, metadata: {}, payload: 'x' })
    const raw: any = {
      messageId: 'ext-4', from: { address: 'a@b.com' }, to: [], subject: 's',
      date: new Date().toISOString(),
      rawRfc822: eml(['Subject: w', 'Content-Type: text/plain'], weird),
    }
    const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
    expect(res.type).toBe('quarantine')
    const q = db.prepare('SELECT * FROM quarantine_messages WHERE id = ?').get(res.inboxMessageId) as any
    expect(q.rejection_reason).toBe('email_depackage_ambiguous')
    // inbox got nothing
    expect((db.prepare('SELECT COUNT(*) c FROM inbox_messages').get() as any).c).toBe(0)
  })

  it('INV-7: no opaque payload while flag-on → HELD (never inline-parsed)', async () => {
    const raw: any = {
      messageId: 'ext-5', from: { address: 'a@b.com' }, to: [], subject: 's',
      text: 'this body must NOT be parsed inline', date: new Date().toISOString(),
      // no rawRfc822
    }
    await expect(detectAndRouteMessage(db, 'acc', raw, SESSION)).rejects.toBeInstanceOf(DepackageCutoverHeldError)
    expect((db.prepare('SELECT COUNT(*) c FROM inbox_messages').get() as any).c).toBe(0)
  })

  it('INV-7: no paired sandbox → HELD (cannot seal, never downgrade)', async () => {
    sandboxState.list = []
    const raw: any = {
      messageId: 'ext-6', from: { address: 'a@b.com' }, to: [], subject: 's',
      date: new Date().toISOString(),
      rawRfc822: eml(['Subject: x', 'Content-Type: text/plain'], 'hi'),
    }
    await expect(detectAndRouteMessage(db, 'acc', raw, SESSION)).rejects.toBeInstanceOf(DepackageCutoverHeldError)
  })
})

describe.skipIf(!Database)('B2 flag-off parity (inline path untouched)', () => {
  let db: import('better-sqlite3').Database
  beforeEach(async () => {
    db = createTestDb()
    bindKeyProvider(() => TEST_DEK, 'inner')
    bindKeyProvider(() => TEST_DEK, 'outer')
    clearTamperingEvents()
    delete process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER
    const orchMod = await import('../../validator-process/orchestrator')
    vi.spyOn(orchMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? 'row')
      const canonicalJson = args.plaintext_or_encrypted?.content ?? '{}'
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
      return { outcome: { ok: true, sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at: new Date().toISOString(), validator_version: 'test' } } } as any
    })
  })
  afterEach(() => { unbindKeyProvider('inner'); unbindKeyProvider('outer'); vi.restoreAllMocks(); db?.close() })

  it('flag OFF: plain mail ingests via the inline text path (rawRfc822 ignored)', async () => {
    const raw: any = {
      messageId: 'ext-off', from: { address: 'a@b.com' }, to: [], subject: 'inline-sub',
      text: 'inline body', date: new Date().toISOString(),
      rawRfc822: eml(['Subject: SEAM', 'Content-Type: text/plain'], 'seam body'),
    }
    const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
    expect(res.type).toBe('plain')
    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(res.inboxMessageId) as any
    expect(row.subject).toBe('inline-sub')        // provider envelope, NOT seam
    expect(row.body_text).toBe('inline body')     // inline text, NOT guest-derived
  })
})
