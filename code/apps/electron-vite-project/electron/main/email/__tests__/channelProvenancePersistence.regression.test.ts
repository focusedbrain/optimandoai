/**
 * Regression — a Channel Provenance Record [IX.3.1] is produced for EVERY
 * message on BOTH ingest paths, persisted to
 * `inbox_messages.depackaged_metadata` beside `pbeap_trust`, bound into the
 * seal, and retained in the append-only evidence log [IX.11].
 *
 *   • flag OFF — messageRouter.detectAndRouteMessage (inline)
 *   • flag ON  — routeViaDepackageSeam (guest-collected material) for plain
 *                mail, carrier mail, and the quarantine outcome
 *
 * "Every message" is the load-bearing claim: a message with no CPR would be
 * indistinguishable from one that skipped the producer, so the absence of
 * authentication material must still yield a record — an `unverifiable` one.
 *
 * Run under Electron's Node ABI when available: `pnpm test:native-db <thisFile>`.
 */

import { createRequire } from 'module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'crypto'
import {
  bindKeyProvider,
  unbindKeyProvider,
  clearTamperingEvents,
  getTamperingEvents,
  sealedQuery,
} from '../../sealed-storage'
import { readChannelProvenanceMetadata } from '@repo/ingestion-core'
import {
  setEvidenceDbProvider,
  listEvidenceRecords,
  verifyEvidenceChain,
  LOCAL_EVIDENCE_CHAIN,
} from '../../handshake/evidenceChain'

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

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

const h = vi.hoisted(() => ({
  SANDBOX_PUB: 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=',
  sandboxState: { list: [{ handshake_id: 'hs-1', sandbox_keying_complete: true }] },
}))
const SESSION = { sessionId: 'test-session', userId: 'test-user' } as any

vi.mock('../gateway', () => ({ emailGateway: { getProviderSync: () => 'gmail' } }))
vi.mock('../../handshake/internalSandboxesApi', () => ({
  listAvailableInternalSandboxes: () => ({ success: true, sandboxes: h.sandboxState.list }),
  isEligibleActiveInternalHostSandboxRecord: () => true,
}))
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: () => ({ peer_x25519_public_key_b64: h.SANDBOX_PUB }),
}))
vi.mock('../../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: () => ({
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

import { detectAndRouteMessage } from '../messageRouter'

function createTestDb(): import('better-sqlite3').Database {
  const db = new Database!(':memory:')
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

/** Gateway verdict for a message that authenticates: aligned DKIM + DMARC. */
const AUTHENTICATED = 'mx.wr.test; dkim=pass header.d=publisher.test header.b=SIGBYTES; dmarc=pass header.from=publisher.test'
/** Forwarding breaks SPF but not DKIM — the D5 DKIM-only pass. */
const FORWARDED = 'mx.wr.test; spf=fail smtp.mailfrom=list.example.net; dkim=pass header.d=publisher.test'

const PBEAP_PKG = JSON.stringify({
  header: { encoding: 'pBEAP' },
  metadata: {},
  payload: Buffer.from(JSON.stringify({ capsule_type: 'initiate', schema_version: 1 }), 'utf8').toString('base64'),
})

describe.skipIf(!Database)('Channel Provenance Record — produced, persisted, evidenced', () => {
  let db: import('better-sqlite3').Database
  let evidenceDb: import('better-sqlite3').Database

  beforeEach(async () => {
    db = createTestDb()
    evidenceDb = new Database!(':memory:')
    setEvidenceDbProvider(() => evidenceDb)
    bindKeyProvider(() => TEST_DEK, 'inner')
    bindKeyProvider(() => TEST_DEK, 'outer')
    clearTamperingEvents()
    h.sandboxState.list = [{ handshake_id: 'hs-1', sandbox_keying_complete: true }]
    const orchMod = await import('../../validator-process/orchestrator')
    vi.spyOn(orchMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? 'row')
      const canonicalJson = args.plaintext_or_encrypted?.content ?? '{}'
      const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
      const seal_input_json = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
      const seal = createHmac('sha256', TEST_DEK).update(seal_input_json, 'utf8').digest('base64')
      return {
        outcome: {
          ok: true,
          sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at: new Date().toISOString(), validator_version: 'cpr-test' },
        },
      } as any
    })
  })

  afterEach(() => {
    setEvidenceDbProvider(null)
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    vi.restoreAllMocks()
    db?.close()
    evidenceDb?.close()
    delete process.env.WRDESK_ROLE
    delete process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER
  })

  function readCpr(rowId: string) {
    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(rowId) as any
    expect(row, 'inbox row must exist').toBeTruthy()
    expect(row.depackaged_metadata, 'depackaged_metadata must carry the CPR').toBeTruthy()
    const cpr = readChannelProvenanceMetadata(row.depackaged_metadata)
    expect(cpr, 'the CPR must decode fail-closed').toBeTruthy()
    return { row, cpr: cpr! }
  }

  function evidence() {
    return listEvidenceRecords(evidenceDb, LOCAL_EVIDENCE_CHAIN)
      .filter((r) => r.record_type === 'ber')
      .map((r) => JSON.parse(r.payload_json))
      .filter((p) => p.kind === 'channel_provenance')
  }

  // ── flag OFF: the inline path ───────────────────────────────────────────────

  describe('flag OFF — inline path', () => {
    beforeEach(() => {
      delete process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER
    })

    it('plain mail with no authentication material gets an unverifiable CPR', async () => {
      const raw: any = {
        messageId: 'off-1', from: { address: 'sender@publisher.test' }, to: [],
        subject: 's', text: 'body', date: new Date().toISOString(),
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      expect(res.type).toBe('plain')
      const { cpr } = readCpr(res.inboxMessageId)
      expect(cpr.dkim.verdict).toBe('unverifiable')
      expect(cpr.dmarc.verdict).toBe('unverifiable')
      expect(cpr.channel_pass).toBe(false)
      expect(cpr.authenticated_sender_domain).toBeNull()
      expect(cpr.discovery_record).toBe('not_evaluated')
      expect(cpr.content_sha256).toMatch(/^[0-9a-f]{64}$/)
    })

    it('gateway-authenticated mail gets a passing CPR with the authenticated domain', async () => {
      const raw: any = {
        messageId: 'off-2', from: { address: 'sender@publisher.test' }, to: [],
        subject: 's', text: 'body', date: new Date().toISOString(),
        headers: { authenticationResults: [AUTHENTICATED] },
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      const { cpr } = readCpr(res.inboxMessageId)
      expect(cpr.dkim).toEqual({ verdict: 'pass', aligned: true })
      expect(cpr.channel_pass).toBe(true)
      expect(cpr.authenticated_sender_domain).toBe('publisher.test')
    })

    it('D5: forwarding breaks SPF but DKIM-only still passes', async () => {
      const raw: any = {
        messageId: 'off-3', from: { address: 'sender@publisher.test' }, to: [],
        subject: 's', text: 'body', date: new Date().toISOString(),
        headers: { authenticationResults: [FORWARDED] },
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      const { cpr } = readCpr(res.inboxMessageId)
      expect(cpr.spf.verdict).toBe('fail')
      expect(cpr.dkim).toEqual({ verdict: 'pass', aligned: true })
      expect(cpr.channel_pass).toBe(true)
    })

    it('the persisted record carries no raw header material', async () => {
      const raw: any = {
        messageId: 'off-4', from: { address: 'sender@publisher.test' }, to: [],
        subject: 's', text: 'body', date: new Date().toISOString(),
        headers: { authenticationResults: [AUTHENTICATED] },
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      const { row } = readCpr(res.inboxMessageId)
      expect(row.depackaged_metadata).not.toContain('SIGBYTES')
      expect(row.depackaged_metadata).not.toContain('header.b')
      expect(row.depackaged_metadata).not.toContain('mx.wr.test')
      expect(row.depackaged_metadata).not.toContain('dkim=pass')
    })
  })

  // ── flag ON: the guest seam ─────────────────────────────────────────────────

  describe('flag ON — depackage seam', () => {
    beforeEach(() => {
      process.env.WRDESK_ROLE = 'sandbox'
      process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER = '1'
    })

    it('plain mail: the guest collects the header, the host records the verdict', async () => {
      const raw: any = {
        messageId: 'on-1', from: { address: 'ignored@provider.test' }, to: [], subject: 'ignored',
        date: new Date().toISOString(),
        rawRfc822: eml(
          [
            'Subject: Guest Subject',
            'From: Publisher <sender@publisher.test>',
            `Authentication-Results: ${AUTHENTICATED}`,
            'Content-Type: text/plain',
          ],
          'hello',
        ),
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      expect(res.type).toBe('plain')
      const { cpr } = readCpr(res.inboxMessageId)
      expect(cpr.dkim).toEqual({ verdict: 'pass', aligned: true })
      expect(cpr.channel_pass).toBe(true)
      expect(cpr.authenticated_sender_domain).toBe('publisher.test')
    })

    it('plain mail with no Authentication-Results is unverifiable, never a pass', async () => {
      const raw: any = {
        messageId: 'on-2', from: { address: 'a@b.test' }, to: [], subject: 's',
        date: new Date().toISOString(),
        rawRfc822: eml(['Subject: s', 'From: a@b.test', 'Content-Type: text/plain'], 'hello'),
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      const { cpr } = readCpr(res.inboxMessageId)
      expect(cpr.dkim.verdict).toBe('unverifiable')
      expect(cpr.channel_pass).toBe(false)
    })

    it('every Authentication-Results hop is read, not just the first', async () => {
      const raw: any = {
        messageId: 'on-3', from: { address: 'sender@publisher.test' }, to: [], subject: 's',
        date: new Date().toISOString(),
        rawRfc822: eml(
          [
            'Subject: s',
            'From: sender@publisher.test',
            'Authentication-Results: relay-a; spf=none',
            'Authentication-Results: mx.wr.test; dkim=pass header.d=publisher.test',
            'Content-Type: text/plain',
          ],
          'hello',
        ),
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      const { cpr } = readCpr(res.inboxMessageId)
      expect(cpr.spf.verdict).toBe('none')
      expect(cpr.dkim).toEqual({ verdict: 'pass', aligned: true })
      expect(cpr.channel_pass).toBe(true)
    })

    it('carrier mail: the CPR survives the pipeline-2 re-entry, beside pbeap_trust', async () => {
      const raw: any = {
        messageId: 'on-4', from: { address: 'sender@publisher.test' }, to: [], subject: 's',
        date: new Date().toISOString(),
        rawRfc822: eml(
          [
            'Subject: pkg',
            'From: sender@publisher.test',
            `Authentication-Results: ${AUTHENTICATED}`,
            'Content-Type: text/plain',
          ],
          PBEAP_PKG,
        ),
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      expect(res.type).toBe('beap')
      const { row, cpr } = readCpr(res.inboxMessageId)
      expect(row.source_type).toBe('email_beap')
      expect(cpr.channel_pass).toBe(true)
      // Both verdicts coexist in one blob — neither displaces the other.
      expect(JSON.parse(row.depackaged_metadata).pbeap_trust).toBeTruthy()
    })

    it('a quarantined message still gets a CPR in the evidence log', async () => {
      const weird = JSON.stringify({ header: { encoding: 'xBEAP' }, metadata: {}, payload: 'x' })
      const raw: any = {
        messageId: 'on-5', from: { address: 'a@b.test' }, to: [], subject: 's',
        date: new Date().toISOString(),
        rawRfc822: eml(['Subject: w', 'From: a@b.test', 'Content-Type: text/plain'], weird),
      }
      const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
      expect(res.type).toBe('quarantine')
      const records = evidence()
      expect(records).toHaveLength(1)
      expect(records[0].outcome).toBe('quarantine')
      expect(records[0].row_id).toBe(res.inboxMessageId)
      expect(records[0].channel_pass).toBe(false)
    })
  })

  // ── Evidence log [IX.11] ────────────────────────────────────────────────────

  describe('evidence log', () => {
    it('records one metadata-only BER per message and keeps the chain verifiable', async () => {
      delete process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER
      for (const id of ['ev-1', 'ev-2', 'ev-3']) {
        await detectAndRouteMessage(
          db,
          'acc',
          {
            messageId: id, from: { address: 'sender@publisher.test' }, to: [],
            subject: 'secret subject', text: 'secret body', date: new Date().toISOString(),
            headers: { authenticationResults: [AUTHENTICATED] },
          } as any,
          SESSION,
        )
      }
      const records = evidence()
      expect(records).toHaveLength(3)
      expect(verifyEvidenceChain(evidenceDb, LOCAL_EVIDENCE_CHAIN)).toEqual({ valid: true, length: 4 })

      const serialized = JSON.stringify(records)
      expect(serialized).not.toContain('secret subject')
      expect(serialized).not.toContain('secret body')
      expect(serialized).not.toContain('SIGBYTES')
      expect(records[0]).toMatchObject({
        direction: 'ingress',
        channel: 'email',
        ingest_path: 'inline',
        outcome: 'inbox',
        dkim: 'pass',
        dkim_aligned: true,
        channel_pass: true,
        authenticated_sender_domain: 'publisher.test',
        discovery_record: 'not_evaluated',
      })
    })

    it('a carrier message is evidenced exactly once, as seam_carrier', async () => {
      process.env.WRDESK_ROLE = 'sandbox'
      process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER = '1'
      const raw: any = {
        messageId: 'ev-carrier', from: { address: 'sender@publisher.test' }, to: [], subject: 's',
        date: new Date().toISOString(),
        rawRfc822: eml(['Subject: pkg', 'From: sender@publisher.test', 'Content-Type: text/plain'], PBEAP_PKG),
      }
      await detectAndRouteMessage(db, 'acc', raw, SESSION)
      const records = evidence()
      expect(records).toHaveLength(1)
      expect(records[0].ingest_path).toBe('seam_carrier')
    })
  })

  // ── Tamper-evidence ─────────────────────────────────────────────────────────

  it('the verdict is bound into the seal: a post-write upgrade is rejected on read', async () => {
    delete process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER
    const raw: any = {
      messageId: 'tamper-1', from: { address: 'sender@publisher.test' }, to: [],
      subject: 's', text: 'body', date: new Date().toISOString(),
    }
    const res = await detectAndRouteMessage(db, 'acc', raw, SESSION)
    const SEL = 'SELECT * FROM inbox_messages WHERE id = ?'

    clearTamperingEvents()
    expect(sealedQuery(db, SEL, [res.inboxMessageId], 'depackaged_json', { forceKeySource: 'outer' })).toHaveLength(1)
    expect(getTamperingEvents()).toHaveLength(0)

    const forged = JSON.parse(
      (db.prepare('SELECT depackaged_metadata AS m FROM inbox_messages WHERE id=?').get(res.inboxMessageId) as any).m,
    )
    forged.channel_provenance.channel_pass = true
    forged.channel_provenance.dkim = { verdict: 'pass', aligned: true }
    forged.channel_provenance.authenticated_sender_domain = 'publisher.test'
    db.prepare('UPDATE inbox_messages SET depackaged_metadata=? WHERE id=?').run(
      JSON.stringify(forged),
      res.inboxMessageId,
    )

    clearTamperingEvents()
    expect(sealedQuery(db, SEL, [res.inboxMessageId], 'depackaged_json', { forceKeySource: 'outer' })).toHaveLength(0)
    expect(getTamperingEvents().some((e) => e.reason === 'metadata_hash_mismatch')).toBe(true)
  })
})
