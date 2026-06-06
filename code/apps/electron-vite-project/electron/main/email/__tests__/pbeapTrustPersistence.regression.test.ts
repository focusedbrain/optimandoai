/**
 * Regression — the explicit pBEAP trust verdict is PERSISTED to
 * `inbox_messages.depackaged_metadata` on BOTH live ingest paths:
 *
 *   • P2P relay path    — beapEmailIngestion.processBeapPackageInline
 *   • email-sync path    — messageRouter.detectAndRouteMessageInline
 *
 * Before this build the verdict was computed (`classifyLivePbeapTrust`) and only
 * logged; the column stayed NULL. This proves both a `verified_bound` and a
 * lesser (`unverified_public`) verdict land in the column end-to-end on each path.
 *
 * Why mock the classifier: the live call sites pass `signingBytes: null` /
 * `knownCounterparties: []` (Gate-5 canonicalization is deferred), so the real
 * classifier can only return `unverified_public` today. The classifier's own
 * verdict logic is unit-covered in `pbeapTrust` tests; here we mock it to prove
 * the PERSISTENCE WIRING carries whatever verdict it returns — including the
 * not-yet-reachable `verified_bound`.
 *
 * Routing-preservation note (Option A): the email path stores a verdict-only
 * payload (no `format` key), so `depackagedFormatFromJson` still falls through to
 * `depackaged_json` exactly as before. This is asserted explicitly.
 *
 * Run under Electron's Node ABI when available: `pnpm test:native-db <thisFile>`.
 */

import { createRequire } from 'module'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac, randomUUID } from 'crypto'

import {
  bindKeyProvider,
  unbindKeyProvider,
  clearTamperingEvents,
  getTamperingEvents,
  sealedQuery,
} from '../../sealed-storage'
import type { PbeapTrustResult } from '../../depackaging-microvm/pbeapTrust'

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

// ── Control the trust verdict while keeping pbeapTrustMetadata() real ──────────
// Both messageRouter and beapEmailIngestion import classifyLivePbeapTrust from
// this module; mocking it here drives the verdict on both paths.
vi.mock('../../depackaging-microvm/livePbeapTrust', async (importActual) => {
  const actual = await importActual<typeof import('../../depackaging-microvm/livePbeapTrust')>()
  return { ...actual, classifyLivePbeapTrust: vi.fn(actual.classifyLivePbeapTrust) }
})

// The vault capability gate (outer-vault/SSO active) is orthogonal to verdict
// persistence and is exercised by its own tests; allow it here so the P2P path
// reaches the inbox write.
vi.mock('../../vault/capabilityBroker', () => ({
  canPerform: () => ({ allowed: true, reasonCode: 'ok', userMessage: '', retryStrategy: 'transient' }),
}))

// messageRouter import-time / no-attachment-path deps (harmless to the P2P path).
vi.mock('../gateway', () => ({ emailGateway: { getProviderSync: () => 'gmail' } }))
vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({ storagePath: '/tmp/m.bin', encryptionKeyStored: 'k', ivB64: 'i', tagB64: 't' })),
}))
vi.mock('../pdf-extractor', () => ({
  extractPdfText: vi.fn(async () => ({ text: '', status: 'skipped' })),
  isPdfFile: () => false,
  resolveInboxPdfExtractionStatus: () => ({ status: 'skipped', error: null }),
}))

import { classifyLivePbeapTrust } from '../../depackaging-microvm/livePbeapTrust'
import { processBeapPackageInline } from '../beapEmailIngestion'
import { detectAndRouteMessageInline } from '../messageRouter'
import { depackagedFormatFromJson } from '../../../../src/lib/inboxBeapRowEligibility'
import { migrateHandshakeTables } from '../../handshake/db'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

const VERIFIED_BOUND = (hsId: string): PbeapTrustResult => ({
  level: 'verified_bound',
  boundHandshakeId: hsId,
  reason: 'bound_to_known_counterparty',
})
const LESSER: PbeapTrustResult = {
  level: 'unverified_public',
  boundHandshakeId: null,
  reason: 'signing_bytes_unavailable',
}

function makeTestDb() {
  const db = new Database!(':memory:')
  db.pragma('foreign_keys = ON')
  // Real production schema (handshakes + inbox_messages/attachments/quarantine),
  // so finalizeDirectBeapInboxPersistence and classification queries resolve.
  migrateHandshakeTables(db)
  migrateIngestionTables(db)
  return db
}

function makePBeapPackage(handshakeId: string): string {
  const capsule = { content_type: 'beap_message', subject: 'pBEAP trust', body: 'hi', sender: 'a@dev.test' }
  return JSON.stringify({
    handshake_id: handshakeId,
    header: { encoding: 'pBEAP', version: '1.0' },
    metadata: { sender: 'a@dev.test', timestamp: new Date().toISOString() },
    payload: Buffer.from(JSON.stringify(capsule)).toString('base64'),
  })
}

/** Validator mock that returns a valid HMAC seal for whatever canonical content it is given. */
async function mockValidator() {
  const orch = await import('../../validator-process/orchestrator')
  return vi.spyOn(orch.validatorOrchestrator, 'validate').mockImplementation(async (args: any) => {
    const rowId = String(args.target_row_id ?? 'row')
    const canonicalJson = args.plaintext_or_encrypted?.content ?? '{}'
    const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
    const seal_input_json = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
    const seal = createHmac('sha256', TEST_DEK).update(seal_input_json, 'utf8').digest('base64')
    return {
      outcome: { ok: true, sealed: { seal, seal_input_json, canonical_json: canonicalJson, validated_at: new Date().toISOString(), validator_version: 'pbeap-trust-test' } },
    } as any
  })
}

describe.skipIf(!Database)('pBEAP trust verdict persists to inbox_messages.depackaged_metadata', () => {
  let db: ReturnType<NonNullable<typeof Database>>
  let validateSpy: Awaited<ReturnType<typeof mockValidator>>

  beforeEach(async () => {
    db = makeTestDb()
    // Both ingest paths seal non-confidential rows with the OUTER provider; bind both.
    bindKeyProvider(() => TEST_DEK, 'inner')
    bindKeyProvider(() => TEST_DEK, 'outer')
    clearTamperingEvents()
    validateSpy = await mockValidator()
    vi.mocked(classifyLivePbeapTrust).mockReset()
  })

  afterEach(() => {
    validateSpy.mockRestore()
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    db?.close()
  })

  function readMeta(rowId: string): { row: any; trust: PbeapTrustResult } {
    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(rowId) as any
    expect(row, 'inbox row must exist').toBeTruthy()
    expect(row.depackaged_metadata, 'depackaged_metadata must be persisted (not NULL)').toBeTruthy()
    const parsed = JSON.parse(row.depackaged_metadata)
    return { row, trust: parsed.pbeap_trust }
  }

  // ── P2P relay path (processBeapPackageInline → writeP2PInboxRow) ────────────
  describe('P2P relay path', () => {
    it('persists a verified_bound verdict', async () => {
      const hsId = randomUUID()
      vi.mocked(classifyLivePbeapTrust).mockReturnValue(VERIFIED_BOUND(hsId))
      const result = await processBeapPackageInline(db, makePBeapPackage(hsId), hsId, { sourceType: 'p2p', receivedAt: new Date().toISOString() })
      expect(result.outcome).toBe('inbox')
      const { trust } = readMeta(result.rowId!)
      expect(trust.level).toBe('verified_bound')
      expect(trust.bound_handshake_id).toBe(hsId)
    })

    it('persists a lesser (unverified_public) verdict', async () => {
      const hsId = randomUUID()
      vi.mocked(classifyLivePbeapTrust).mockReturnValue(LESSER)
      const result = await processBeapPackageInline(db, makePBeapPackage(hsId), hsId, { sourceType: 'p2p', receivedAt: new Date().toISOString() })
      expect(result.outcome).toBe('inbox')
      const { trust } = readMeta(result.rowId!)
      expect(trust.level).toBe('unverified_public')
      expect(trust.bound_handshake_id).toBeNull()
    })
  })

  // ── email-sync path (detectAndRouteMessageInline) ───────────────────────────
  describe('email-sync path', () => {
    async function ingestEmail(hsId: string) {
      const raw = {
        messageId: `mail-${hsId}`,
        from: { address: 'a@dev.test' },
        to: [],
        subject: 'pBEAP',
        text: makePBeapPackage(hsId),
        date: new Date().toISOString(),
        attachments: [],
      }
      return detectAndRouteMessageInline(db, 'acc', raw as any, null, true)
    }

    it('persists a verified_bound verdict and preserves format routing', async () => {
      const hsId = randomUUID()
      vi.mocked(classifyLivePbeapTrust).mockReturnValue(VERIFIED_BOUND(hsId))
      const res = await ingestEmail(hsId)
      expect(res.type).toBe('beap')
      const { row, trust } = readMeta(res.inboxMessageId)
      expect(trust.level).toBe('verified_bound')
      expect(trust.bound_handshake_id).toBe(hsId)
      // Verdict-only payload (no `format`) → format readers still fall through to
      // depackaged_json, so populating the column changes no routing/eligibility.
      expect(depackagedFormatFromJson(row.depackaged_json, row.depackaged_metadata)).toBe(
        depackagedFormatFromJson(row.depackaged_json, null),
      )
    })

    it('persists a lesser (unverified_public) verdict', async () => {
      const hsId = randomUUID()
      vi.mocked(classifyLivePbeapTrust).mockReturnValue(LESSER)
      const res = await ingestEmail(hsId)
      expect(res.type).toBe('beap')
      const { trust } = readMeta(res.inboxMessageId)
      expect(trust.level).toBe('unverified_public')
      expect(trust.bound_handshake_id).toBeNull()
    })
  })

  // ── Tamper-evidence: the verdict is BOUND into the seal, not just stored ─────
  // An attacker with DB write access who flips unverified_public → verified_bound
  // (or edits depackaged_metadata any other way) must be caught at read time.
  describe('verdict is tamper-evident (sealed read rejects post-write edits)', () => {
    const SEL = 'SELECT * FROM inbox_messages WHERE id = ?'

    it('P2P: an unaltered row verifies; editing depackaged_metadata is rejected', async () => {
      const hsId = randomUUID()
      vi.mocked(classifyLivePbeapTrust).mockReturnValue(LESSER)
      const result = await processBeapPackageInline(db, makePBeapPackage(hsId), hsId, { sourceType: 'p2p', receivedAt: new Date().toISOString() })
      expect(result.outcome).toBe('inbox')

      // Positive control: the legitimately-sealed row reads back.
      clearTamperingEvents()
      expect(sealedQuery(db, SEL, [result.rowId!], 'depackaged_json', { forceKeySource: 'outer' })).toHaveLength(1)
      expect(getTamperingEvents()).toHaveLength(0)

      // Attacker upgrades the verdict directly in the DB.
      const forged = JSON.parse(db.prepare('SELECT depackaged_metadata AS m FROM inbox_messages WHERE id=?').get(result.rowId!).m)
      forged.pbeap_trust = { level: 'verified_bound', reason: 'forged', bound_handshake_id: hsId }
      db.prepare('UPDATE inbox_messages SET depackaged_metadata=? WHERE id=?').run(JSON.stringify(forged), result.rowId!)

      // Sealed read now refuses the row and records the tamper.
      clearTamperingEvents()
      expect(sealedQuery(db, SEL, [result.rowId!], 'depackaged_json', { forceKeySource: 'outer' })).toHaveLength(0)
      expect(getTamperingEvents().some((e) => e.reason === 'metadata_hash_mismatch')).toBe(true)
    })

    it('email: an unaltered row verifies; editing depackaged_metadata is rejected', async () => {
      const hsId = randomUUID()
      vi.mocked(classifyLivePbeapTrust).mockReturnValue(LESSER)
      const raw = {
        messageId: `mail-tamper-${hsId}`, from: { address: 'a@dev.test' }, to: [], subject: 'pBEAP',
        text: makePBeapPackage(hsId), date: new Date().toISOString(), attachments: [],
      }
      const res = await detectAndRouteMessageInline(db, 'acc', raw as any, null, true)
      expect(res.type).toBe('beap')

      clearTamperingEvents()
      expect(sealedQuery(db, SEL, [res.inboxMessageId], 'depackaged_json', { forceKeySource: 'outer' })).toHaveLength(1)
      expect(getTamperingEvents()).toHaveLength(0)

      const forged = JSON.parse(db.prepare('SELECT depackaged_metadata AS m FROM inbox_messages WHERE id=?').get(res.inboxMessageId).m)
      forged.pbeap_trust = { level: 'verified_bound', reason: 'forged', bound_handshake_id: hsId }
      db.prepare('UPDATE inbox_messages SET depackaged_metadata=? WHERE id=?').run(JSON.stringify(forged), res.inboxMessageId)

      clearTamperingEvents()
      expect(sealedQuery(db, SEL, [res.inboxMessageId], 'depackaged_json', { forceKeySource: 'outer' })).toHaveLength(0)
      expect(getTamperingEvents().some((e) => e.reason === 'metadata_hash_mismatch')).toBe(true)
    })
  })
})
