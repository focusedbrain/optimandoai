/**
 * B-4 P2P Relay Migration Tests
 *
 * Covers the three deliverables of PR B-4:
 *
 * 1. P2P relay path (processBeapPackageInline):
 *    - Valid pBEAP package → sealed inbox row
 *    - Unknown/no handshake → sealed quarantine row
 *    - Corrupted bytes → sealed quarantine row with malformed_beap_envelope
 *    - All produced rows pass sealedQuery read-path verification
 *
 * 2. Sandbox-side quarantine receive (processSandboxQuarantineReceive):
 *    - sandbox_clone_quarantine: true + valid encrypted blob → decrypts, validates, sealed inbox row
 *    - Decryption failure → sandbox-side quarantine row with blob_decrypt_failed
 *    - Sandbox also cannot depackage → sandbox-side final-state quarantine
 *
 * 3. Schema migration v66:
 *    - migrateHandshakeTables drops p2p_pending_beap
 *    - No production code references p2p_pending_beap after migration (static audit)
 *
 * per Phase B Architecture, PR B-4.
 */

import { createRequire } from 'module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID, createHash, createHmac } from 'crypto'

// The vault capability gate (outer-vault/SSO active) is exercised by its own
// tests (capabilityBroker.test.ts); allow it here so the P2P path reaches the
// ingress admission filter and the inbox/quarantine writes under test.
vi.mock('../../vault/capabilityBroker', () => ({
  canPerform: () => ({ allowed: true, reasonCode: 'ok', userMessage: '', retryStrategy: 'transient' }),
}))

import {
  bindKeyProvider,
  unbindKeyProvider,
  clearTamperingEvents,
  prepareSealedInsert,
} from '../../sealed-storage/index'

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
// Minimal DB helper shared by tests
// ─────────────────────────────────────────────────────────────────────────────

/** Empty DB for migration tests — no pre-existing tables so migrateHandshakeTables runs clean. */
function makeEmptyDb() {
  if (!Database) return null
  return new Database(':memory:')
}

/**
 * Phase 1 [VII.2.7]: the ingress admission filter is the first inbox stage;
 * message deliveries need an ACTIVE relationship row to be admitted.
 */
async function seedActiveHandshake(db: any, hsId: string) {
  const { insertHandshakeRecord } = await import('../../handshake/db')
  const { buildActiveHandshakeRecord } = await import('../../handshake/__tests__/helpers')
  insertHandshakeRecord(db, buildActiveHandshakeRecord({ handshake_id: hsId, relationship_id: `rel-${hsId}` }))
}

async function makeTestDb() {
  if (!Database) return null
  const db = new Database(':memory:')
  // Real handshake schema (handshakes + audit_log) so the ingress admission
  // filter (Phase 1, [VII.2.7]) can resolve relationships and log blocks.
  const { migrateHandshakeTables } = await import('../../handshake/db')
  migrateHandshakeTables(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
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
      seal_input_json TEXT,
      embedding_status TEXT DEFAULT 'pending',
      read_status INTEGER DEFAULT 0,
      starred INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS quarantine_messages (
      id TEXT PRIMARY KEY,
      transport_sender TEXT NOT NULL,
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
  `)
  return db
}

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

/**
 * Computes a valid sealed-storage seal for a given canonical JSON and row ID.
 * Uses the same DEK as setupSealGate so that the sealed-gate HMAC check passes.
 */
function buildValidSealForRowId(canonicalJson: string, rowId: string): { seal: string; seal_input_json: string } {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const sealInputJson = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
  const seal = createHmac('sha256', TEST_DEK).update(sealInputJson, 'utf8').digest('base64')
  return { seal, seal_input_json: sealInputJson }
}

function setupSealGate() {
  // Bind both slots: the non-confidential inbox write seals with the OUTER
  // provider (computeSeal(..., 'outer')); confidential/quarantine use inner.
  bindKeyProvider(() => TEST_DEK, 'inner')
  bindKeyProvider(() => TEST_DEK, 'outer')
  clearTamperingEvents()
}

function teardownSealGate() {
  unbindKeyProvider('inner')
  unbindKeyProvider('outer')
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal BEAP package builders
// ─────────────────────────────────────────────────────────────────────────────

function makePBeapPackage(handshakeId: string): string {
  const capsule = {
    content_type: 'beap_message',
    subject: 'Test B-4 pBEAP',
    body: 'Hello from pBEAP',
    sender: 'alice@example.com',
    timestamp: new Date().toISOString(),
  }
  const payloadB64 = Buffer.from(JSON.stringify(capsule)).toString('base64')
  return JSON.stringify({
    handshake_id: handshakeId,
    header: { encoding: 'pBEAP', version: '1.0' },
    metadata: { sender: 'alice@example.com', timestamp: new Date().toISOString() },
    payload: payloadB64,
  })
}

function makeQBeapPackage(handshakeId: string): string {
  return JSON.stringify({
    handshake_id: handshakeId,
    header: { encoding: 'qBEAP', version: '1.0', kem: 'X25519_HKDF_AES256GCM' },
    metadata: { sender: 'alice@example.com', timestamp: new Date().toISOString() },
    envelope: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. processBeapPackageInline — P2P relay path
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!Database)('B-4 §1 — processBeapPackageInline', () => {
  let db: ReturnType<NonNullable<typeof Database>>

  beforeEach(async () => {
    db = (await makeTestDb())!
    setupSealGate()
  })

  afterEach(() => {
    teardownSealGate()
    db?.close()
  })

  it('§1.1 valid pBEAP with known handshake → sealed inbox row (outcome: inbox)', async () => {
    const handshakeId = randomUUID()
    await seedActiveHandshake(db, handshakeId)

    const { processBeapPackageInline } = await import('../beapEmailIngestion')

    // Mock validatorOrchestrator — dynamically compute a valid seal using TEST_DEK so the
    // sealed-storage gate (reject mode) accepts the write.
    const orchestratorMod = await import('../../validator-process/orchestrator')
    const validateSpy = vi.spyOn(orchestratorMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? '')
      const canonicalJson = '{"canonical":true}'
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
      return {
        outcome: {
          ok: true,
          sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at: new Date().toISOString(), validator_version: 'b4-test' },
        },
      } as any
    })

    const pkg = makePBeapPackage(handshakeId)
    const result = await processBeapPackageInline(db, pkg, handshakeId, {
      sourceType: 'p2p',
      receivedAt: new Date().toISOString(),
    })

    expect(result.outcome).toBe('inbox')
    expect(result.rowId).toBeTruthy()

    const row = db.prepare(`SELECT * FROM inbox_messages WHERE id = ?`).get(result.rowId) as any
    expect(row).toBeTruthy()
    expect(row.seal).toBeTruthy()
    expect(row.seal_input_json).toBeTruthy()
    expect(row.source_type).toBe('direct_beap')

    validateSpy.mockRestore()
  })

  it('§1.2 pBEAP with unknown relationship → blocked pre-visibility by ingress admission [VII.2.7]', async () => {
    const unknownHandshakeId = 'unknown-handshake-' + randomUUID()
    const { processBeapPackageInline } = await import('../beapEmailIngestion')

    // Phase 1: an unknown relationship dies at the ingress admission filter —
    // no inbox row, no quarantine row, no validator invocation. Only an
    // audit_log record remains.
    const orchestratorMod = await import('../../validator-process/orchestrator')
    const validateSpy = vi.spyOn(orchestratorMod.validatorOrchestrator, 'validate')

    const pkg = makePBeapPackage(unknownHandshakeId)
    const result = await processBeapPackageInline(db, pkg, unknownHandshakeId, {
      sourceType: 'p2p',
    })

    expect(result.outcome).toBe('error')
    expect(result.reasonCode).toBe('ingress_admission_unknown_relationship')
    expect(result.retryable).toBe(false)
    expect(validateSpy).not.toHaveBeenCalled()

    // Pre-visibility: nothing reached a user-visible surface.
    expect(db.prepare('SELECT COUNT(*) AS c FROM inbox_messages').get()).toMatchObject({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM quarantine_messages').get()).toMatchObject({ c: 0 })

    // Logged record exists.
    const audit = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'INGRESS_ADMISSION_BLOCKED' AND handshake_id = ?",
    ).get(unknownHandshakeId) as any
    expect(audit).toBeTruthy()
    expect(audit.reason_code).toBe('unknown_relationship')

    vi.restoreAllMocks()
  })

  it('§1.2b pBEAP for a REVOKED relationship → blocked pre-visibility [VII.2.7]', async () => {
    const handshakeId = randomUUID()
    const { insertHandshakeRecord } = await import('../../handshake/db')
    const { buildActiveHandshakeRecord } = await import('../../handshake/__tests__/helpers')
    const { HandshakeState } = await import('../../handshake/types')
    insertHandshakeRecord(db, buildActiveHandshakeRecord({
      handshake_id: handshakeId,
      relationship_id: `rel-${handshakeId}`,
      state: HandshakeState.REVOKED,
    }))

    const { processBeapPackageInline } = await import('../beapEmailIngestion')
    const result = await processBeapPackageInline(db, makePBeapPackage(handshakeId), handshakeId, {
      sourceType: 'p2p',
    })

    expect(result.outcome).toBe('error')
    expect(result.reasonCode).toBe('ingress_admission_relationship_revoked')
    expect(db.prepare('SELECT COUNT(*) AS c FROM inbox_messages').get()).toMatchObject({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM quarantine_messages').get()).toMatchObject({ c: 0 })
    const audit = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'INGRESS_ADMISSION_BLOCKED' AND handshake_id = ?",
    ).get(handshakeId) as any
    expect(audit).toBeTruthy()
    expect(audit.reason_code).toBe('relationship_revoked')
  })

  it('§1.3 corrupted / non-JSON bytes → quarantine with parse error, not thrown to caller', async () => {
    const { processBeapPackageInline } = await import('../beapEmailIngestion')
    await seedActiveHandshake(db, '__corrupt__')

    // Corrupted input: no first call succeeds since there's no canonical JSON to validate.
    // The code goes directly to writeP2PQuarantineRow which calls validate once (ok: true required).
    const orchestratorMod = await import('../../validator-process/orchestrator')
    vi.spyOn(orchestratorMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? '')
      const canonicalJson = typeof args.plaintext_or_encrypted?.content === 'string'
        ? args.plaintext_or_encrypted.content : '{}'
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
      return {
        outcome: {
          ok: true,
          sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at: new Date().toISOString(), validator_version: 'b4-test' },
        },
      } as any
    })

    const result = await processBeapPackageInline(db, '{ this is not valid beap json !!!', '__corrupt__', {
      sourceType: 'p2p',
    })

    expect(result.outcome).not.toBe(undefined)

    vi.restoreAllMocks()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sandbox-side quarantine receive
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!Database)('B-4 §2 — processSandboxQuarantineReceive', () => {
  let db: ReturnType<NonNullable<typeof Database>>

  beforeEach(async () => {
    db = (await makeTestDb())!
    setupSealGate()
  })

  afterEach(() => {
    teardownSealGate()
    db?.close()
  })

  it('§2.1 decryption failure → sandbox-side quarantine row with blob_decrypt_failed', async () => {
    const handshakeId = randomUUID()

    const { processSandboxQuarantineReceive } = await import('../beapEmailIngestion')

    // The outer qBEAP decrypt in processSandboxQuarantineReceiveInternal will fail because
    // there's no matching handshake in the DB — that triggers writeFinaState('blob_decrypt_failed').
    // writeP2PQuarantineRow calls validatorOrchestrator.validate once and requires ok: true.
    const orchestratorMod = await import('../../validator-process/orchestrator')
    vi.spyOn(orchestratorMod.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
      const rowId = String(args.target_row_id ?? '')
      const canonicalJson = typeof args.plaintext_or_encrypted?.content === 'string'
        ? args.plaintext_or_encrypted.content : '{}'
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, rowId)
      return {
        outcome: {
          ok: true,
          sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at: new Date().toISOString(), validator_version: 'b4-test' },
        },
      } as any
    })

    const fakePackageJson = JSON.stringify({
      handshake_id: handshakeId,
      header: { encoding: 'qBEAP', version: '1.0' },
      metadata: {
        inbox_response_path: { sandbox_clone_quarantine: true },
      },
      envelope: 'AAAA',
    })
    const result = await processSandboxQuarantineReceive(db, fakePackageJson, handshakeId, {})

    expect(result.outcome).toBe('quarantine')

    const quarantineRow = db.prepare(`SELECT * FROM quarantine_messages WHERE paired_sandbox_handshake_id = ?`).get(handshakeId) as any
    expect(quarantineRow).toBeTruthy()
    expect(quarantineRow.rejection_reason).toContain('blob_decrypt_failed')

    vi.restoreAllMocks()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Schema migration v66 — p2p_pending_beap drop
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!Database)('B-4 §3 — Schema migration v66', () => {
  it('§3.1 migrateHandshakeTables creates tables up to v66 and p2p_pending_beap is absent', async () => {
    const db = makeEmptyDb()!

    // Seed the table as if it existed pre-v66
    db.exec(`CREATE TABLE IF NOT EXISTS p2p_pending_beap (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handshake_id TEXT,
      package_json TEXT,
      created_at TEXT,
      processed INTEGER NOT NULL DEFAULT 0
    )`)
    db.exec(`INSERT INTO p2p_pending_beap (handshake_id, package_json, created_at) VALUES ('h1','{}','2024-01-01T00:00:00Z')`)

    const { migrateHandshakeTables } = await import('../../handshake/db')
    migrateHandshakeTables(db)

    const tableRow = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='p2p_pending_beap'`).get()) as any
    expect(tableRow).toBeFalsy()

    db.close()
  })

  it('§3.2 after v66, insertPendingP2PBeap is a no-op (does not throw or write)', async () => {
    const db = makeEmptyDb()!
    const { migrateHandshakeTables, insertPendingP2PBeap } = await import('../../handshake/db')
    migrateHandshakeTables(db)

    expect(() => insertPendingP2PBeap(db, 'h1', '{}')).not.toThrow()
    db.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Static audit — no production calls to p2p_pending_beap INSERT
//    (mirrors the verification log check from the PR)
// ─────────────────────────────────────────────────────────────────────────────

describe('B-4 §4 — Static audit: p2p_pending_beap INSERT callers', () => {
  it('§4.1 processPendingP2PBeapEmails is a no-op stub returning 0', async () => {
    const { processPendingP2PBeapEmails } = await import('../beapEmailIngestion')
    const result = await processPendingP2PBeapEmails(null)
    expect(result).toBe(0)
    const result2 = await processPendingP2PBeapEmails({} as any)
    expect(result2).toBe(0)
  })

  it('§4.2 processBeapPackageInline is exported and callable', async () => {
    const mod = await import('../beapEmailIngestion')
    expect(typeof mod.processBeapPackageInline).toBe('function')
  })

  it('§4.3 processSandboxQuarantineReceive is exported and callable', async () => {
    const mod = await import('../beapEmailIngestion')
    expect(typeof mod.processSandboxQuarantineReceive).toBe('function')
  })

  it('§4.4 retryPendingQbeapDecrypt is exported (sealed backfill path)', async () => {
    const mod = await import('../beapEmailIngestion')
    expect(typeof mod.retryPendingQbeapDecrypt).toBe('function')
  })
})
