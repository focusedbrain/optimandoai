/**
 * Prompt 3 — SANDBOX-side ingestion poll (A2 multi-machine relocation).
 *
 * Two layers of proof:
 *
 *  1. Worker contract (pure DI): the sandbox owner fetches with its READ client,
 *     depackages each blob locally, and delivers BEAP to the host; every expected
 *     failure FAILS CLOSED (HELD) with a typed status and NEVER hands the work
 *     back to the host (INV-3). A non-owner node no-ops.
 *
 *  2. End-to-end (reusing the depackage-seam DB harness): a crafted message is
 *     fetched by the (mock) read client as OPAQUE bytes, depackaged LOCALLY by the
 *     real in-process guest (sandbox role), and the resulting BEAP is written to
 *     the host inbox via the PROVEN host write — the host never parsed raw bytes.
 */

import { createRequire } from 'module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'crypto'
import type { IngestionOwnership } from '../ingestionOwnership'
import type { OAuthTokens } from '../secure-storage'
import type { SandboxFetchedMessage } from '../sandboxIngestion'

const require = createRequire(import.meta.url)
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:'); d.close(); Database = D
} catch { Database = null }

const SANDBOX_OWNER: IngestionOwnership = {
  owner: 'sandbox',
  thisNodeRole: 'sandbox',
  hostShouldReadPoll: false,
  sandboxShouldReadPoll: true,
  reason: 'test: sandbox owns ingestion',
}
const HOST_NODE: IngestionOwnership = {
  owner: 'sandbox',
  thisNodeRole: 'host',
  hostShouldReadPoll: false,
  sandboxShouldReadPoll: false,
  reason: 'test: host node, sandbox owns ingestion',
}

const FAKE_TOKENS: OAuthTokens = { accessToken: 'a', refreshToken: 'r' } as unknown as OAuthTokens
const CUSTODY_PUB = 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=' // pub of priv=0x11*32

import { runSandboxIngestionPoll } from '../sandboxIngestion'

describe('runSandboxIngestionPoll — worker contract (DI)', () => {
  it('sandbox owner: fetches with READ client, depackages each, delivers BEAP to host', async () => {
    const fetched: SandboxFetchedMessage[] = [
      { id: 'm1', opaqueBytes: Buffer.from('Subject: a\r\n\r\nbody-a') },
      { id: 'm2', opaqueBytes: Buffer.from('Subject: b\r\n\r\nbody-b') },
    ]
    const depackageSeen: Buffer[] = []
    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: {
        ownership: SANDBOX_OWNER,
        loadReadToken: () => ({ accountId: 'acc', role: 'read', tokens: FAKE_TOKENS, savedAt: 0 }),
        custodyPubKeyB64: CUSTODY_PUB,
        fetchOpaque: async (_id, token) => {
          // INV-2: the read token is used LOCALLY for fetch only.
          expect(token).toBe(FAKE_TOKENS)
          return fetched
        },
        depackage: async (bytes) => {
          depackageSeen.push(bytes)
          return { ok: true, result: { ok: true, type: 'plain', safeText: { subject: 's', body_text: 't', attachment_refs: [] }, artifacts: [], displayEnvelope: { from: undefined, to: [], cc: [], subject: 's', date: '' }, threadingHints: undefined } as any }
        },
        deliverToHost: async (msg) => ({ delivered: true, inboxMessageId: `inbox-${msg.id}` }),
      },
    })
    expect(r.ok).toBe(true)
    expect(r.status).toBe('ok')
    expect(r.fetched).toBe(2)
    expect(r.depackaged).toBe(2)
    expect(r.delivered).toBe(2)
    expect(r.held).toBe(0)
    expect(r.inboxMessageIds).toEqual(['inbox-m1', 'inbox-m2'])
    // Depackage received OPAQUE bytes (the sandbox is inside the boundary).
    expect(depackageSeen.map((b) => b.toString())).toEqual(['Subject: a\r\n\r\nbody-a', 'Subject: b\r\n\r\nbody-b'])
  })

  it('non-owner node (host) → no-op, never fetches', async () => {
    const fetchOpaque = vi.fn()
    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: { ownership: HOST_NODE, fetchOpaque, custodyPubKeyB64: CUSTODY_PUB, loadReadToken: () => ({ accountId: 'acc', role: 'read', tokens: FAKE_TOKENS, savedAt: 0 }) },
    })
    expect(r.status).toBe('not_owner')
    expect(r.ok).toBe(true)
    expect(fetchOpaque).not.toHaveBeenCalled()
  })

  it('FAIL CLOSED: read consent missing → HELD, never fetches, never hands back to host', async () => {
    const fetchOpaque = vi.fn()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await runSandboxIngestionPoll({
      accountId: 'host-acc-id',
      deps: {
        ownership: SANDBOX_OWNER,
        loadReadToken: () => null,
        listReadScopedAccountIds: () => ['sandbox-local-acc'],
        custodyPubKeyB64: CUSTODY_PUB,
        fetchOpaque,
      },
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('held_read_consent_missing')
    expect(fetchOpaque).not.toHaveBeenCalled()
    const line = logSpy.mock.calls.map((c) => String(c[1] ?? '')).find((s) => s.includes('read-token lookup:'))
    expect(line).toContain('trigger_account=host-acc-id')
    expect(line).toContain('available_read_accounts=[sandbox-local-acc]')
    expect(line).toContain('match=false')
    logSpy.mockRestore()
  })

  it('FAIL CLOSED: sandbox offline / provider error → HELD, no delivery, no host fallback', async () => {
    const deliverToHost = vi.fn()
    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: {
        ownership: SANDBOX_OWNER,
        loadReadToken: () => ({ accountId: 'acc', role: 'read', tokens: FAKE_TOKENS, savedAt: 0 }),
        custodyPubKeyB64: CUSTODY_PUB,
        fetchOpaque: async () => { throw new Error('ETIMEDOUT provider offline') },
        deliverToHost,
      },
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('held_fetch_failed')
    expect(r.errors[0]).toContain('ETIMEDOUT')
    expect(deliverToHost).not.toHaveBeenCalled()
  })

  it('FAIL CLOSED: no custody key → HELD (cannot seal artifacts)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: {
        ownership: SANDBOX_OWNER,
        loadReadToken: () => ({ accountId: 'acc', role: 'read', tokens: FAKE_TOKENS, savedAt: 0 }),
        listReadScopedAccountIds: () => ['acc'],
      },
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('held_no_custody_key')
    const line = logSpy.mock.calls.map((c) => String(c[1] ?? '')).find((s) => s.includes('no custody key'))
    expect(line).toContain('re-pair')
    logSpy.mockRestore()
  })

  it('per-message HELD: a depackage worker failure holds that message (retry), never host-parses', async () => {
    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: {
        ownership: SANDBOX_OWNER,
        loadReadToken: () => ({ accountId: 'acc', role: 'read', tokens: FAKE_TOKENS, savedAt: 0 }),
        custodyPubKeyB64: CUSTODY_PUB,
        fetchOpaque: async () => [{ id: 'bad', opaqueBytes: Buffer.from('x') }],
        depackage: async () => ({ ok: true, result: { ok: false, code: 'E_MALFORMED_MIME' } as any }),
        deliverToHost: async () => ({ delivered: true }),
      },
    })
    expect(r.status).toBe('ok')
    expect(r.fetched).toBe(1)
    expect(r.depackaged).toBe(0)
    expect(r.delivered).toBe(0)
    expect(r.held).toBe(1)
    expect(r.errors[0]).toContain('E_MALFORMED_MIME')
  })
})

// ── End-to-end: sandbox fetch → real local depackage → proven host inbox write ──

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')
const SESSION = { sessionId: 'test-session', userId: 'test-user' } as any
const h = vi.hoisted(() => ({ SANDBOX_PUB: 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=' }))

vi.mock('../gateway', () => ({ emailGateway: { getProviderSync: () => 'gmail' } }))
vi.mock('../../handshake/internalSandboxesApi', () => ({
  listAvailableInternalSandboxes: () => ({ success: true, sandboxes: [{ handshake_id: 'hs-1', sandbox_keying_complete: true }] }),
  isEligibleActiveInternalHostSandboxRecord: () => true,
}))
vi.mock('../../handshake/db', () => ({ getHandshakeRecord: () => ({ peer_x25519_public_key_b64: h.SANDBOX_PUB }) }))
vi.mock('../../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: () => ({ storage_id: 'blob-x', blob_sha256: 'a'.repeat(64), blob_size_bytes: 123 }),
}))
vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({ storagePath: '/tmp/m.bin', encryptionKeyStored: 'k', ivB64: 'i', tagB64: 't' })),
}))
vi.mock('../pdf-extractor', () => ({
  extractPdfText: vi.fn(async () => ({ text: '', status: 'skipped' })),
  isPdfFile: () => false,
  resolveInboxPdfExtractionStatus: () => ({ status: 'skipped', error: null }),
}))

function buildValidSealForRowId(canonicalJson: string, rowId: string) {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const seal_input_json = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
  const seal = createHmac('sha256', TEST_DEK).update(seal_input_json, 'utf8').digest('base64')
  return { seal, seal_input_json }
}

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

describe.skipIf(!Database)('A2 end-to-end: sandbox fetch+depackage → BEAP at host inbox', () => {
  let db: import('better-sqlite3').Database
  let bindKeyProvider: any
  let unbindKeyProvider: any
  let detectAndRouteMessageInline: any
  let resetOpaque: any

  beforeEach(async () => {
    db = createTestDb()
    const sealed = await import('../../sealed-storage')
    bindKeyProvider = sealed.bindKeyProvider
    unbindKeyProvider = sealed.unbindKeyProvider
    bindKeyProvider(() => TEST_DEK, 'inner')
    bindKeyProvider(() => TEST_DEK, 'outer')
    sealed.clearTamperingEvents()

    const mr = await import('../messageRouter')
    detectAndRouteMessageInline = mr.detectAndRouteMessageInline
    const oi = await import('../opaqueIngestion')
    resetOpaque = oi.__resetOpaqueIngestionCacheForTests

    // Sandbox role + linked topology so dispatchDepackageEmail resolves to the
    // in-process guest (local depackage), exactly like the real sandbox node.
    process.env.WRDESK_ROLE = 'sandbox'
    process.env.WRDESK_TOPOLOGY_LINKED = JSON.stringify([{ role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['depackage-email'] }])
    resetOpaque()

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
    delete process.env.WRDESK_TOPOLOGY_LINKED
    resetOpaque?.()
  })

  it('crafted message: read client fetches OPAQUE → local depackage → proven host inbox row (guest-derived)', async () => {
    const opaque = eml(['Subject: Guest Derived Subject', 'Content-Type: text/plain'], 'fetched-and-depackaged-on-sandbox')
    let hostParsedRaw = false

    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: {
        ownership: SANDBOX_OWNER,
        loadReadToken: () => ({ accountId: 'acc', role: 'read', tokens: FAKE_TOKENS, savedAt: 0 }),
        custodyPubKeyB64: CUSTODY_PUB,
        // Read client returns the message as OPAQUE bytes — never pre-parsed.
        fetchOpaque: async () => [{ id: 'ext-1', opaqueBytes: opaque, form: { inputForm: 'rfc822' } }],
        // depackage uses the REAL in-process guest (default dispatchDepackageEmail).
        // Deliver the guest-derived BEAP to the host inbox via the proven write.
        deliverToHost: async (_msg, outcome) => {
          if (!outcome.ok || !outcome.result.ok) return { delivered: false }
          const res = outcome.result
          if (res.type !== 'plain') return { delivered: false }
          const env = res.displayEnvelope
          // The host receives only the GUEST-derived safe content — never the raw bytes.
          if (Buffer.isBuffer((res as any).rawRfc822)) hostParsedRaw = true
          const rawForHost: any = {
            messageId: 'ext-1',
            from: env.from ? { address: env.from.email, name: env.from.name } : { address: 'sender@unknown' },
            to: env.to.map((a: any) => ({ address: a.email, name: a.name })),
            subject: res.safeText.subject,
            text: res.safeText.body_text,
            date: new Date().toISOString(),
          }
          const written = await detectAndRouteMessageInline(db, 'acc', rawForHost, SESSION, true)
          return { delivered: true, inboxMessageId: written.inboxMessageId }
        },
      },
    })

    expect(r.ok).toBe(true)
    expect(r.fetched).toBe(1)
    expect(r.depackaged).toBe(1)
    expect(r.delivered).toBe(1)
    expect(hostParsedRaw).toBe(false)

    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(r.inboxMessageIds[0]) as any
    expect(row).toBeTruthy()
    expect(row.source_type).toBe('email_plain')
    expect(row.subject).toBe('Guest Derived Subject') // guest-derived, proves local depackage
    expect(row.body_text).toContain('fetched-and-depackaged-on-sandbox')
  })
})
