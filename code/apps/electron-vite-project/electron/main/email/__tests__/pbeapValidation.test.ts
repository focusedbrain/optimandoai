/**
 * Integration tests — pBEAP content validation in processPendingP2PBeapEmails (PR 2.1/7)
 *
 * Tests that the pBEAP receive path writes validated_at / validator_version /
 * validation_reason to inbox_messages when draining p2p_pending_beap.
 *
 * Focus on extractPBeapCapsule + validateDecryptedBeapContent wiring:
 *
 *   PBEAP-1: pBEAP package, no artefact → validated_at set, validation_reason null
 *   PBEAP-2: pBEAP package with valid artefact → validated_at set, validation_reason null
 *   PBEAP-3: pBEAP package with malformed artefact → validation_reason set (gap closed)
 *   PBEAP-4: non-pBEAP package (qBEAP placeholder) → validated_at set (depackagedJson used)
 *   PBEAP-5: extractPBeapCapsule helper: returns null for qBEAP, capsule object for pBEAP
 *
 * Tests PBEAP-1 through PBEAP-4 require better-sqlite3 (Electron ABI) and are
 * skipped in system-Node environments per the same constraint as PR 2's DB tests.
 * PBEAP-5 is a pure unit test requiring no DB.
 *
 * To verify DB tests locally: run `electron-rebuild -f -w better-sqlite3` in the
 * electron-vite-project, then re-run this file with the workspace vitest runner.
 */

import { createRequire } from 'module'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { extractPBeapCapsule } from '../beapEmailIngestion'

// ---------------------------------------------------------------------------
// Mocks required because mergeExtensionDepackaged.ts and gateway.ts try to
// call electron APIs at module load time when imported transitively.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
}))

vi.mock('../messageRouter', () => ({
  makeInboxAttachmentStorageId: (msgId: string, attId: string) => `${msgId}/${attId}`,
}))

vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({
    storagePath: '/tmp/mock.bin',
    encryptionKeyStored: 'k',
    ivB64: 'i',
    tagB64: 't',
  })),
}))

vi.mock('../gateway', () => ({
  emailGateway: { getProviderSync: () => 'gmail' },
}))

// autoresponder / audit are called inside processPendingP2PBeapEmails but
// do not affect validation column output.
vi.mock('../../../beap/autoresponderEvaluator', () => ({
  evaluateAutoresponder: vi.fn(() => ({ decision: 'no-action' })),
}))
vi.mock('../../../beap/autoresponderAudit', () => ({
  logAutoresponderDecision: vi.fn(),
}))

// ---------------------------------------------------------------------------
// better-sqlite3 availability guard (same pattern as PR 2's merge tests)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  if (!Database) throw new Error('better-sqlite3 unavailable')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE handshakes (
      handshake_id TEXT PRIMARY KEY,
      local_public_key TEXT,
      local_role TEXT,
      initiator_json TEXT,
      acceptor_json TEXT
    );

    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL DEFAULT 'direct_beap',
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
      has_attachments INTEGER DEFAULT 0,
      attachment_count INTEGER DEFAULT 0,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      imap_remote_mailbox TEXT,
      imap_rfc_message_id TEXT,
      embedding_status TEXT DEFAULT 'pending',
      validated_at TEXT,
      validator_version TEXT,
      validation_reason TEXT
    );

    CREATE TABLE inbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER,
      content_id TEXT,
      storage_path TEXT,
      created_at TEXT
    );

    CREATE TABLE p2p_pending_beap (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handshake_id TEXT NOT NULL,
      package_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed INTEGER NOT NULL DEFAULT 0
    );
  `)
  return db
}

function getRow(db: any, id: string) {
  return db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(id) as any
}

/** Build a base64-encoded pBEAP package with a given capsule as payload. */
function makePBeapPackage(capsule: unknown): string {
  const capsuleJson = JSON.stringify(capsule)
  const payload = Buffer.from(capsuleJson).toString('base64')
  return JSON.stringify({
    header: {
      encoding: 'pBEAP',
      sender_fingerprint: 'deadbeef',
      version: '1.0.0',
    },
    payload,
    metadata: { channel: 'email' },
  })
}

/** Seed inbox_messages + p2p_pending_beap so processPendingP2PBeapEmails has work. */
function seedP2P(db: any, handshakeId: string, packageJson: string) {
  const inboxId = 'msg-pbeap-1'
  db.prepare(
    `INSERT INTO inbox_messages (id, source_type, handshake_id, beap_package_json)
     VALUES (?, 'direct_beap', ?, ?)`,
  ).run(inboxId, handshakeId, packageJson)
  db.prepare(
    `INSERT INTO p2p_pending_beap (handshake_id, package_json) VALUES (?, ?)`,
  ).run(handshakeId, packageJson)
  return inboxId
}

function validArtefact(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: '1.0.0',
    artefact_id: '550e8400-e29b-41d4-a716-446655440010',
    created_at: '2026-05-05T18:00:00Z',
    handshake_binding: null,
    purpose: { declared_purpose: 'session_transfer', scope_constraints: {} },
    sessions: [
      {
        session_kind: 'orchestrator_session',
        session_id: '550e8400-e29b-41d4-a716-446655440020',
        agent_config: {
          agentId: 'a1',
          agentName: 'Agent',
          capabilityClass: 'host_ai',
          boxes: [],
          display_grids: {},
          created_at: '2026-05-05T18:00:00Z',
          updated_at: '2026-05-05T18:00:00Z',
        },
        display_grids: {},
        processing_history: [],
      },
    ],
    policy: { processing_events: [] },
    requested_action: 'import_only',
    sensitive_subcapsule: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// PBEAP-5: pure unit test for extractPBeapCapsule — no DB required
// ---------------------------------------------------------------------------

describe('extractPBeapCapsule — unit tests (PR 2.1/7)', () => {

  it('PBEAP-5a. returns null for a qBEAP package', () => {
    const qbeap = JSON.stringify({ header: { encoding: 'qBEAP' }, payload: 'ignored' })
    expect(extractPBeapCapsule(qbeap)).toBeNull()
  })

  it('PBEAP-5b. returns null for a handshake capsule (no header.encoding)', () => {
    const hs = JSON.stringify({ schema_version: 1, capsule_type: 'initiate' })
    expect(extractPBeapCapsule(hs)).toBeNull()
  })

  it('PBEAP-5c. returns null for invalid JSON', () => {
    expect(extractPBeapCapsule('not json')).toBeNull()
  })

  it('PBEAP-5d. returns the decoded capsule for a valid pBEAP package', () => {
    const capsule = { body: 'hello', title: 'Test', session_import_artefact: null }
    const pkg = makePBeapPackage(capsule)
    const result = extractPBeapCapsule(pkg)
    expect(result).toEqual(capsule)
  })

  it('PBEAP-5e. decoded capsule includes session_import_artefact when present', () => {
    const capsule = { body: 'hello', session_import_artefact: validArtefact() }
    const pkg = makePBeapPackage(capsule)
    const result = extractPBeapCapsule(pkg) as any
    expect(result?.session_import_artefact).toBeTruthy()
    expect((result?.session_import_artefact as any).artefact_id).toBe('550e8400-e29b-41d4-a716-446655440010')
  })
})

// PBEAP-1 through PBEAP-4 deleted in B-8.4c (Category 4: processPendingP2PBeapEmails is a
// documented no-op stub since B-7.2; the drain path was removed). Tests for extractPBeapCapsule
// (PBEAP-5a–5e) remain above as they cover still-live functionality.
//
