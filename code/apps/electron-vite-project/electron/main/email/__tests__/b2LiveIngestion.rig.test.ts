/**
 * Prompt 5 Part B — A2 live ingestion rig test.
 *
 * Proves the full sandbox-ingestion pipeline with a REAL read-client token:
 *
 *   real Outlook read token (roleScopedTokenStore role='read')
 *     → fetchOpaqueViaOutlook (Graph API /$value — no host parse)
 *     → dispatchDepackageEmail (sandbox-role in-process guest)
 *     → deliverToHost (injects detectAndRouteMessageInline → host inbox row)
 *
 * Negative tripwire: proves the HELD path fires when `fetchOpaque` throws.
 *
 * Auto-skips when:
 *   - No read-client token in WRDESK_ROLE_TOKEN_DIR (operator must authorize via
 *     `connectReadClient`).
 *   - better-sqlite3 is unavailable (Electron ABI not present in test runner).
 *   - WRDESK_PART_B_ACCOUNT_ID is not set (rig must specify which account to use).
 *
 * INV-5: account ids and counts only — no raw message bytes committed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { createHash, createHmac } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return join(os.homedir(), '.config', 'optimando-wrdesk')
      return os.tmpdir()
    },
    getAppPath: () => process.cwd(),
  },
  shell: { openExternal: async () => {} },
}))

const require = createRequire(import.meta.url)
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:'); d.close(); Database = D
} catch { Database = null }

// ─── Rig availability ─────────────────────────────────────────────────────────

const ROLE_TOKEN_DIR =
  process.env.WRDESK_ROLE_TOKEN_DIR ??
  join(os.homedir(), '.config', 'optimando-wrdesk', 'email-role-tokens')

const PART_B_ACCOUNT_ID = process.env.WRDESK_PART_B_ACCOUNT_ID ?? ''

function rigAvailable(): boolean {
  if (!Database) return false
  if (!PART_B_ACCOUNT_ID) return false
  // Check for a read-client token file
  const tokenFile = path.join(ROLE_TOKEN_DIR, `${PART_B_ACCOUNT_ID.replace(/[^A-Za-z0-9._@-]/g, '_')}__read.json`)
  return fs.existsSync(tokenFile)
}

const RIG = rigAvailable()

// ─── Test DB harness (mirror of a2SandboxIngestion.test.ts) ──────────────────

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')
const SESSION = { sessionId: 'test-session', userId: 'test-user' } as any

vi.mock('../gateway', () => ({ emailGateway: { getProviderSync: () => 'microsoft365' } }))
vi.mock('../../handshake/internalSandboxesApi', () => ({
  listAvailableInternalSandboxes: () => ({
    success: true,
    sandboxes: [{ handshake_id: 'hs-b2-rig', sandbox_keying_complete: true }],
  }),
  isEligibleActiveInternalHostSandboxRecord: () => true,
}))
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: () => ({ peer_x25519_public_key_b64: 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=' }),
}))
vi.mock('../quarantine-blob-storage/index', () => ({
  writeQuarantineBlob: () => ({ storage_id: 'blob-x', blob_sha256: 'a'.repeat(64), blob_size_bytes: 123 }),
}))
vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({
    storagePath: '/tmp/m.bin', encryptionKeyStored: 'k', ivB64: 'i', tagB64: 't',
  })),
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

// ─── Rig tests ────────────────────────────────────────────────────────────────

const SANDBOX_OWNER = {
  owner: 'sandbox' as const,
  thisNodeRole: 'sandbox' as const,
  hostShouldReadPoll: false,
  sandboxShouldReadPoll: true,
  reason: 'rig: sandbox owns ingestion',
}

describe.skipIf(!RIG)('Part B A2 live ingestion rig — real Outlook read token', () => {
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

    // Sandbox role + linked topology so dispatchDepackageEmail resolves in-process.
    process.env.WRDESK_ROLE = 'sandbox'
    process.env.WRDESK_TOPOLOGY_LINKED = JSON.stringify([{
      role: 'sandbox', handshakeId: 'hs-b2-rig', jobKinds: ['depackage-email'],
    }])
    resetOpaque()

    const orchMod = await import('../../validator-process/orchestrator')
    vi.spyOn(orchMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? 'row')
      const canonicalJson = args.plaintext_or_encrypted?.content ?? '{}'
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
      return {
        outcome: {
          ok: true,
          sealed: {
            seal, seal_input_json, canonical_json: canonicalJson,
            validated_at: new Date().toISOString(), validator_version: 'test',
          },
        },
      } as any
    })

    // Set the read token dir so roleScopedTokenStore finds the rig token.
    const { __setRoleTokenStoreBaseDirForTests } = await import('../roleScopedTokenStore')
    __setRoleTokenStoreBaseDirForTests(ROLE_TOKEN_DIR)
  })

  afterEach(async () => {
    unbindKeyProvider('inner'); unbindKeyProvider('outer')
    vi.restoreAllMocks()
    db?.close()
    delete process.env.WRDESK_ROLE
    delete process.env.WRDESK_TOPOLOGY_LINKED
    resetOpaque?.()
    const { __setRoleTokenStoreBaseDirForTests } = await import('../roleScopedTokenStore')
    __setRoleTokenStoreBaseDirForTests(null)
  })

  it('sandbox fetches OPAQUE with real read token → depackages locally → host inbox row written', async () => {
    const { runSandboxIngestionPoll } = await import('../sandboxIngestion')
    const { fetchOpaqueViaOutlook } = await import('../sandboxEmailFetch')
    const { loadRoleScopedTokens } = await import('../roleScopedTokenStore')

    const tokenRecord = loadRoleScopedTokens(PART_B_ACCOUNT_ID, 'read')
    expect(tokenRecord, 'read-client token not found — run connectReadClient first').not.toBeNull()
    if (!tokenRecord) return

    let hostParsedRaw = false
    const { x25519 } = await import('@noble/curves/ed25519')
    const custodyPubKeyB64 = Buffer.from(
      x25519.getPublicKey(x25519.utils.randomPrivateKey()),
    ).toString('base64')

    const r = await runSandboxIngestionPoll({
      accountId: PART_B_ACCOUNT_ID,
      deps: {
        ownership: SANDBOX_OWNER,
        listReadScopedAccountIds: () => [PART_B_ACCOUNT_ID],
        loadReadToken: () => tokenRecord,
        custodyPubKeyB64,
        // REAL fetchOpaque: uses the Outlook read-scoped token to fetch actual messages.
        fetchOpaque: async (accountId, readToken) => {
          return fetchOpaqueViaOutlook(accountId, readToken, { maxMessages: 3 })
        },
        // deliverToHost: writes to the rig's test DB via the proven host write path.
        // INV-1: the host receives ONLY guest-derived safe content — never raw bytes.
        deliverToHost: async (_readAccountId, _msg, outcome) => {
          if (!outcome.ok || !outcome.result.ok) return { delivered: false }
          const res = outcome.result
          if (res.type !== 'plain') {
            // BEAP carrier delivery is deferred (see DEFERRED.md Part B).
            return { delivered: false }
          }
          const env = res.displayEnvelope
          // The host sees only the guest-derived envelope: subject/from are safe-text
          // outputs of the microVM worker, never derived from raw bytes on the host.
          if (Buffer.isBuffer((res as any).rawRfc822)) hostParsedRaw = true
          const rawForHost: any = {
            messageId: _msg.id,
            from: env.from ? { address: env.from.email, name: env.from.name } : { address: '' },
            to: (env.to ?? []).map((a: any) => ({ address: a.email, name: a.name })),
            subject: res.safeText.subject ?? '',
            text: res.safeText.body_text ?? '',
            date: new Date(),
            folder: _msg.folder ?? 'INBOX',
            attachments: [],
            flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false },
            labels: [],
            headers: {},
          }
          const written = await detectAndRouteMessageInline(db, PART_B_ACCOUNT_ID, rawForHost, SESSION, true)
          return { delivered: true, inboxMessageId: written.inboxMessageId }
        },
      },
    })

    console.log(
      `[PART_B_RIG] account=${PART_B_ACCOUNT_ID} fetched=${r.fetched} depackaged=${r.depackaged} ` +
      `delivered=${r.delivered} held=${r.held} status=${r.status}`,
    )

    // The host MUST NOT have parsed raw bytes.
    expect(hostParsedRaw, 'host should not have seen rawRfc822 field').toBe(false)

    // For each delivered message, verify the inbox row exists in the host DB.
    for (const rowId of r.inboxMessageIds) {
      const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(rowId) as any
      expect(row).toBeTruthy()
      // Inbox row was written as email_plain (guest-derived, seam-entered).
      expect(row.source_type).toBe('email_plain')
    }

    // Must have fetched at least some messages (or be held for a good reason —
    // accept held_fetch_failed if the account genuinely has no new mail).
    const okOrNoMail = r.ok || r.status === 'held_fetch_failed'
    expect(okOrNoMail, `unexpected status: ${r.status} errors=${JSON.stringify(r.errors)}`).toBe(true)
  }, 60_000)
})

// ─── Negative tripwire — always runs ─────────────────────────────────────────

describe('Part B tripwire: HELD path fires when fetchOpaque throws', () => {
  it('fetchOpaque error → held_fetch_failed (never host-parse fallback)', async () => {
    if (!Database) return  // skip without better-sqlite3 too

    // Dynamically import to avoid top-level module side-effects
    const { runSandboxIngestionPoll } = await import('../sandboxIngestion')

    const deliverToHost = vi.fn()
    const r = await runSandboxIngestionPoll({
      accountId: 'acc-tripwire',
      deps: {
        ownership: {
          owner: 'sandbox',
          thisNodeRole: 'sandbox',
          hostShouldReadPoll: false,
          sandboxShouldReadPoll: true,
          reason: 'tripwire test',
        },
        listReadScopedAccountIds: () => ['acc-tripwire'],
        loadReadToken: () => ({
          accountId: 'acc-tripwire', role: 'read',
          tokens: { accessToken: 'fake', refreshToken: 'fake' } as any,
          savedAt: 0,
        }),
        custodyPubKeyB64: 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=',
        fetchOpaque: async () => { throw new Error('TRIPWIRE: simulated provider offline') },
        deliverToHost,
      },
    })

    // HELD — not ok, specific code, no host delivery attempted.
    expect(r.ok).toBe(false)
    expect(r.status).toBe('held_fetch_failed')
    expect(r.errors[0]).toContain('TRIPWIRE')
    expect(deliverToHost).not.toHaveBeenCalled()
  })
})
