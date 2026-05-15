/**
 * B-9 Outbound Clone Integrity Tests
 *
 * Verifies the structural properties introduced by PR B-9/11:
 *
 * §1 — Source read uses sealedQuery (Decision B)
 *   §1.1  Valid sealed row → prepare succeeds (seal passes verification)
 *   §1.2  Tampered row (content hash mismatch) → MESSAGE_NOT_FOUND
 *         (sealedQuery filters the row before content extraction)
 *   §1.3  Row with missing seal → MESSAGE_NOT_FOUND (reject mode filters)
 *   §1.4  Row missing from DB entirely → MESSAGE_NOT_FOUND
 *
 * §2 — No DB writes on the outbound path (Decision C / D)
 *   §2.1  Successful prepare produces zero DB writes
 *   §2.2  Failed prepare (MESSAGE_NOT_FOUND) produces zero DB writes
 *
 * §3 — Failure-path matrix (Decision A / E)
 *   §3.1  Tampered row: quarantine row unchanged after clone attempt
 *   §3.2  No partial state: prepare is atomic read-only
 *
 * Phase B Architecture, PR B-9/11, Decisions A–F.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createSealedStorageTestContext, type SealedStorageTestContext } from 'test/harness/sealed-storage'
import { prepareBeapInboxSandboxClone } from '../beapInboxClonePrepare'
import type { HandshakeRecord, SSOSession } from '../../handshake/types'
import { HandshakeState } from '../../handshake/types'
import type { InternalSandboxListEntry } from '../../handshake/internalSandboxesApi'

// ── Mock external dependencies ────────────────────────────────────────────────
const { listAvailableInternalSandboxes, getHandshakeRecord } = vi.hoisted(() => ({
  listAvailableInternalSandboxes: vi.fn(),
  getHandshakeRecord: vi.fn(),
}))

vi.mock('../../handshake/internalSandboxesApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../handshake/internalSandboxesApi')>()
  return { ...mod, listAvailableInternalSandboxes }
})

vi.mock('../../handshake/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../handshake/db')>()
  return { ...mod, getHandshakeRecord }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(): SSOSession {
  return {
    wrdesk_user_id: 'u-b9',
    email: 'host@example.com',
    sub: 'sub-b9',
    iss: 'iss',
    email_verified: true,
    plan: 'free',
    currentHardwareAttestation: null,
    currentDnsVerification: null,
  } as SSOSession
}

function makeHandshakeRecord(id: string): HandshakeRecord {
  return {
    handshake_id: id,
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
    relationship_id: 'rel-b9',
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'p2p://sandbox-b9',
    local_x25519_public_key_b64: 'bG9jYWx4MjU1MTk=',
    peer_x25519_public_key_b64: 'cGVlcngyNTUxOQ==',
    peer_mlkem768_public_key_b64: 'bWxrZW0xMjM=',
    initiator: { wrdesk_user_id: 'u-b9', email: 'host@example.com' },
    acceptor: { wrdesk_user_id: 'u-b9', email: 'host@example.com' },
    internal_peer_pairing_code: '654321',
  } as HandshakeRecord
}

function makeEligibleEntry(id = 'hs-sbx-b9'): InternalSandboxListEntry {
  return {
    handshake_id: id,
    relationship_id: 'rel-b9',
    state: 'ACTIVE',
    peer_role: 'sandbox',
    peer_label: 'Sandbox',
    peer_device_id: 'dev-sb-b9',
    peer_device_name: 'B9 Sandbox',
    peer_pairing_code_six: '654321',
    internal_coordination_identity_complete: true,
    p2p_endpoint_set: true,
    last_known_delivery_status: 'idle',
    live_status_optional: 'relay_connected',
    sandbox_keying_complete: true,
    beap_clone_eligible: true,
  }
}

function mockHappyList(entry: InternalSandboxListEntry) {
  listAvailableInternalSandboxes.mockReturnValue({
    success: true,
    sandboxes: [entry],
    incomplete: [],
    sandbox_availability: {
      status: 'connected',
      relay_connected: true,
      use_coordination: true,
    },
    authoritative_device_internal_role: 'host',
  })
}

/** Minimal canonical content for an inbox row. */
function makeContent(msgId: string) {
  return { id: msgId, subject: 'B9 test', body: 'test body for B9 clone integrity' }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('B-9 §1 — source read uses sealedQuery (Decision B)', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    listAvailableInternalSandboxes.mockReset()
    getHandshakeRecord.mockReset()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('§1.1 valid sealed row passes seal verification → prepare succeeds', () => {
    if (!ctx.db) return // Skip if better-sqlite3 unavailable

    const entry = makeEligibleEntry()
    const hsId = entry.handshake_id
    mockHappyList(entry)
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(hsId))

    const msgId = randomUUID()
    const content = makeContent(msgId)
    const { seal, seal_input_json } = ctx.buildValidSealForRowId(msgId, content)

    ctx.db.prepare(`
      INSERT INTO inbox_messages
        (id, source_type, handshake_id, subject, body_text,
         depackaged_json, has_attachments, from_address,
         account_id, received_at, ingested_at, seal, seal_input_json)
      VALUES (?, 'direct_beap', 'hs-orig', 'B9 test', 'test body for B9 clone integrity',
              ?, 0, 'from@b9.test', 'acc-b9',
              '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?, ?)
    `).run(msgId, JSON.stringify(content), seal, seal_input_json)

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, hsId, 'tag')

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.encrypted_text).toBeTruthy()
    }
  })

  it('§1.2 tampered row (content hash mismatch) → MESSAGE_NOT_FOUND; no data extracted', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    const hsId = entry.handshake_id
    mockHappyList(entry)
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(hsId))

    const msgId = randomUUID()
    const content = makeContent(msgId)
    const { seal, seal_input_json } = ctx.buildValidSealForRowId(msgId, content)

    // Insert the row with a valid seal, then TAMPER the canonical JSON column
    // without updating the seal — simulates a storage-layer integrity violation.
    ctx.db.prepare(`
      INSERT INTO inbox_messages
        (id, source_type, handshake_id, subject, body_text,
         depackaged_json, has_attachments, from_address,
         account_id, received_at, ingested_at, seal, seal_input_json)
      VALUES (?, 'direct_beap', 'hs-orig', 'B9 tamper test', 'test body',
              ?, 0, 'from@b9.test', 'acc-b9',
              '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?, ?)
    `).run(msgId, JSON.stringify(content), seal, seal_input_json)

    // Tamper: overwrite depackaged_json without updating the seal.
    ctx.db.prepare(
      `UPDATE inbox_messages SET depackaged_json = ? WHERE id = ?`,
    ).run(JSON.stringify({ ...content, tampered: true }), msgId)

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, hsId, 'tag')

    // sealedQuery filters the tampered row → MESSAGE_NOT_FOUND, not the tampered content.
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('MESSAGE_NOT_FOUND')
    }
  })

  it('§1.3 row with missing seal → MESSAGE_NOT_FOUND (reject mode)', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    const hsId = entry.handshake_id
    mockHappyList(entry)
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(hsId))

    const msgId = randomUUID()

    ctx.db.prepare(`
      INSERT INTO inbox_messages
        (id, source_type, handshake_id, subject, body_text,
         depackaged_json, has_attachments, from_address,
         account_id, received_at, ingested_at, seal, seal_input_json)
      VALUES (?, 'direct_beap', 'hs-orig', 'No seal', 'body',
              '{"id":"no-seal"}', 0, 'from@b9.test', 'acc-b9',
              '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '', '')
    `).run(msgId)

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, hsId, 'tag')

    // In reject mode, rows with missing seals are filtered out.
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('MESSAGE_NOT_FOUND')
    }
  })

  it('§1.4 row absent from DB entirely → MESSAGE_NOT_FOUND', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    const hsId = entry.handshake_id
    mockHappyList(entry)
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(hsId))

    const r = prepareBeapInboxSandboxClone(
      ctx.db as any, makeSession(), 'nonexistent-id', hsId, 'tag',
    )

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('MESSAGE_NOT_FOUND')
    }
  })
})

describe('B-9 §2 — no DB writes on the outbound prepare path (Decisions C / D)', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    listAvailableInternalSandboxes.mockReset()
    getHandshakeRecord.mockReset()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('§2.1 successful prepare writes nothing to inbox_messages', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    const hsId = entry.handshake_id
    mockHappyList(entry)
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(hsId))

    const msgId = randomUUID()
    const content = makeContent(msgId)
    const { seal, seal_input_json } = ctx.buildValidSealForRowId(msgId, content)

    ctx.db.prepare(`
      INSERT INTO inbox_messages
        (id, source_type, handshake_id, subject, body_text,
         depackaged_json, has_attachments, from_address,
         account_id, received_at, ingested_at, seal, seal_input_json)
      VALUES (?, 'direct_beap', 'hs-orig', 'Write test', 'body',
              ?, 0, 'from@b9.test', 'acc-b9',
              '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?, ?)
    `).run(msgId, JSON.stringify(content), seal, seal_input_json)

    // Capture row state before
    const before = ctx.db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(msgId) as Record<string, unknown>

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, hsId, 'tag')
    expect(r.ok).toBe(true)

    // Row state must be identical after prepare
    const after = ctx.db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(msgId) as Record<string, unknown>
    expect(after).toEqual(before)
  })

  it('§2.2 failed prepare (MESSAGE_NOT_FOUND) writes nothing to inbox_messages', () => {
    if (!ctx.db) return

    // No mock setup — just verify no write on failure
    listAvailableInternalSandboxes.mockReturnValue({
      success: true,
      sandboxes: [],
      incomplete: [],
      sandbox_availability: { status: 'not_configured', relay_connected: false, use_coordination: false },
      authoritative_device_internal_role: 'host',
    })

    const countBefore = (ctx.db.prepare('SELECT COUNT(*) as n FROM inbox_messages').get() as { n: number }).n

    prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), 'ghost-id', undefined, null)

    const countAfter = (ctx.db.prepare('SELECT COUNT(*) as n FROM inbox_messages').get() as { n: number }).n
    expect(countAfter).toBe(countBefore)
  })
})

describe('B-9 §3 — failure-path matrix (Decisions A / E)', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    listAvailableInternalSandboxes.mockReset()
    getHandshakeRecord.mockReset()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('§3.1 tampered row: prepare returns error; source seal/seal_input_json unchanged', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    const hsId = entry.handshake_id
    mockHappyList(entry)
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(hsId))

    const msgId = randomUUID()
    const content = makeContent(msgId)
    const { seal, seal_input_json } = ctx.buildValidSealForRowId(msgId, content)

    ctx.db.prepare(`
      INSERT INTO inbox_messages
        (id, source_type, handshake_id, subject, body_text,
         depackaged_json, has_attachments, from_address,
         account_id, received_at, ingested_at, seal, seal_input_json)
      VALUES (?, 'direct_beap', 'hs-orig', 'Tamper test', 'body',
              ?, 0, 'f@b9.test', 'acc-b9',
              '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?, ?)
    `).run(msgId, JSON.stringify(content), seal, seal_input_json)

    // Tamper without touching seal
    ctx.db.prepare(`UPDATE inbox_messages SET depackaged_json = '{"tampered":true}' WHERE id = ?`).run(msgId)

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, hsId, 'tag')

    // Prepare must fail — no partial state (no content returned, row unchanged)
    expect(r.ok).toBe(false)

    // Seal columns must be unchanged (no write attempted by prepare)
    const row = ctx.db.prepare('SELECT seal, seal_input_json FROM inbox_messages WHERE id = ?').get(msgId) as
      | { seal: string; seal_input_json: string }
      | undefined
    expect(row?.seal).toBe(seal)
    expect(row?.seal_input_json).toBe(seal_input_json)
  })

  it('§3.2 prepare endpoint is atomic read-only: no write occurs before or after any error', () => {
    if (!ctx.db) return

    // Test that even when the sandbox list returns an error, no DB writes happen.
    listAvailableInternalSandboxes.mockReturnValue({ success: false, error: 'list failed' })

    const msgId = randomUUID()
    const content = makeContent(msgId)
    const { seal, seal_input_json } = ctx.buildValidSealForRowId(msgId, content)

    ctx.db.prepare(`
      INSERT INTO inbox_messages
        (id, source_type, handshake_id, subject, body_text,
         depackaged_json, has_attachments, from_address,
         account_id, received_at, ingested_at, seal, seal_input_json)
      VALUES (?, 'direct_beap', 'hs-orig', 'No sandbox', 'body',
              ?, 0, 'f@b9.test', 'acc-b9',
              '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', ?, ?)
    `).run(msgId, JSON.stringify(content), seal, seal_input_json)

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, undefined, null)
    expect(r.ok).toBe(false)

    // Row unchanged
    const row = ctx.db.prepare('SELECT depackaged_json FROM inbox_messages WHERE id = ?').get(msgId) as
      | { depackaged_json: string }
      | undefined
    expect(row?.depackaged_json).toBe(JSON.stringify(content))
  })
})
