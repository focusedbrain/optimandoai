/**
 * Clone prepare seal gate — real sealedQuery (no mock), outer vs inner key routing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  bindKeyProvider,
  unbindKeyProvider,
  computeSeal,
} from '../../sealed-storage/index'
import { deriveLedgerSealKey } from '../../sealed-storage/ledgerSealKey'
import { prepareBeapInboxSandboxClone } from '../beapInboxClonePrepare'
import type { InternalSandboxListEntry } from '../../handshake/internalSandboxesApi'
import { HandshakeState, type HandshakeRecord, type SSOSession } from '../../handshake/types'
import {
  createSealedStorageTestContext,
  type SealedStorageTestContext,
} from 'test/harness/sealed-storage'

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

const OUTER_KEY = deriveLedgerSealKey('clone-prepare-outer-session')

function makeSession(): SSOSession {
  return {
    wrdesk_user_id: 'u-clone-gate',
    email: 'host@example.com',
    sub: 'sub-gate',
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
    relationship_id: 'rel-gate',
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'http://127.0.0.1:51249/beap/ingest',
    local_x25519_public_key_b64: 'bG9jYWx4MjU1MTk=',
    peer_x25519_public_key_b64: 'cGVlcngyNTUxOQ==',
    peer_mlkem768_public_key_b64: 'bWxrZW0xMjM=',
    initiator: { wrdesk_user_id: 'u-clone-gate', email: 'host@example.com' },
    acceptor: { wrdesk_user_id: 'u-clone-gate', email: 'host@example.com' },
    internal_peer_pairing_code: '123456',
  } as HandshakeRecord
}

function makeEligibleEntry(id = 'hs-sbx-gate'): InternalSandboxListEntry {
  return {
    handshake_id: id,
    relationship_id: 'rel-gate',
    state: 'ACTIVE',
    peer_role: 'sandbox',
    peer_label: 'Sandbox',
    peer_device_id: 'dev-sb',
    peer_device_name: 'Gate Sandbox',
    peer_pairing_code_six: '123456',
    internal_coordination_identity_complete: true,
    p2p_endpoint_set: true,
    last_known_delivery_status: 'idle',
    live_status_optional: 'relay_connected',
    sandbox_keying_complete: true,
    beap_clone_eligible: true,
  }
}

function mockHappyList(entries: InternalSandboxListEntry[]) {
  listAvailableInternalSandboxes.mockReturnValue({
    success: true,
    sandboxes: entries,
    incomplete: [],
    sandbox_availability: {
      status: 'connected',
      relay_connected: true,
      use_coordination: true,
    },
    authoritative_device_internal_role: 'host',
  })
}

function insertDirectBeapRow(
  ctx: SealedStorageTestContext,
  opts: { sealKeySource: 'ledger' | 'vmk'; useOuterSeal: boolean },
): { msgId: string; canonical: string } {
  if (!ctx.db) throw new Error('no db')

  const msgId = randomUUID()
  const canonical = JSON.stringify({
    id: msgId,
    subject: 'Clone gate test',
    body: { text: 'clone me' },
    format: 'beap_qbeap_decrypted',
  })

  let seal: string
  let seal_input_json: string
  if (opts.useOuterSeal) {
    const s = computeSeal(canonical, msgId, 'outer')
    seal = s.seal
    seal_input_json = s.seal_input_json
  } else {
    const s = ctx.buildValidSealForRowId(msgId, canonical)
    seal = s.seal
    seal_input_json = s.seal_input_json
  }

  ctx.db
    .prepare(
      `INSERT INTO inbox_messages
         (id, source_type, handshake_id, subject, body_text, depackaged_json,
          has_attachments, from_address, account_id, received_at, ingested_at,
          seal, seal_input_json, seal_key_source)
       VALUES (?, 'direct_beap', 'hs-orig', 'Clone gate test', 'clone me', ?,
               0, 'from@test', 'acc', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
               ?, ?, ?)`,
    )
    .run(msgId, canonical, seal, seal_input_json, opts.sealKeySource)

  return { msgId, canonical }
}

describe('prepareBeapInboxSandboxClone — seal provider routing', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    listAvailableInternalSandboxes.mockReset()
    getHandshakeRecord.mockReset()
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('ledger row + outer-only provider → prepare succeeds', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    mockHappyList([entry])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(entry.handshake_id))

    const { msgId } = insertDirectBeapRow(ctx, { sealKeySource: 'ledger', useOuterSeal: true })

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, undefined, 'tag')

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.target_handshake_id).toBe(entry.handshake_id)
      expect(r.encrypted_text).toContain('clone me')
    }
  })

  it('native direct_beap vmk row + outer-only → MESSAGE_NOT_FOUND (no trusted read for native)', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    mockHappyList([entry])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(entry.handshake_id))

    const { msgId } = insertDirectBeapRow(ctx, { sealKeySource: 'vmk', useOuterSeal: false })

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, entry.handshake_id, 'tag')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('MESSAGE_NOT_FOUND')
    }
  })

  it('email_plain vmk row + outer-only + conformant validation → prepare succeeds', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry()
    mockHappyList([entry])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(entry.handshake_id))

    const msgId = randomUUID()
    const canonical = JSON.stringify({
      id: msgId,
      subject: 'XING newsletter',
      body: { text: 'depackaged email body' },
      format: 'email_plain',
    })
    const s = ctx.buildValidSealForRowId(msgId, canonical)
    ctx.db
      .prepare(
        `INSERT INTO inbox_messages
           (id, source_type, handshake_id, subject, body_text, depackaged_json,
            has_attachments, from_address, account_id, received_at, ingested_at,
            validated_at, validation_reason, seal, seal_input_json, seal_key_source)
         VALUES (?, 'email_plain', 'hs-orig', 'XING newsletter', 'depackaged email body', ?,
                 0, 'news@xing.com', 'acc', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
                 '2025-01-01T00:00:00.000Z', 'plain_email_no_validation_required',
                 ?, ?, 'vmk')`,
      )
      .run(msgId, canonical, s.seal, s.seal_input_json)

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, entry.handshake_id, 'tag')

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source_type).toBe('email_plain')
      expect(r.encrypted_text).toContain('depackaged email body')
    }
  })

  it('targetHandshakeId=auto picks sole sendable sandbox', () => {
    if (!ctx.db) return

    const entry = makeEligibleEntry('hs-auto-only')
    mockHappyList([entry])
    getHandshakeRecord.mockReturnValue(makeHandshakeRecord(entry.handshake_id))

    const { msgId } = insertDirectBeapRow(ctx, { sealKeySource: 'ledger', useOuterSeal: true })

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, undefined, 'tag')

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.target_handshake_id).toBe('hs-auto-only')
    }
  })

  it('targetHandshakeId=auto with two sendable sandboxes → TARGET_HANDSHAKE_REQUIRED', () => {
    if (!ctx.db) return

    mockHappyList([makeEligibleEntry('hs-a'), makeEligibleEntry('hs-b')])
    const { msgId } = insertDirectBeapRow(ctx, { sealKeySource: 'ledger', useOuterSeal: true })

    const r = prepareBeapInboxSandboxClone(ctx.db as any, makeSession(), msgId, undefined, 'tag')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('TARGET_HANDSHAKE_REQUIRED')
    }
  })
})
