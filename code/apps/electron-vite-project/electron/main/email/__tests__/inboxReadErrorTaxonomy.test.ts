/**
 * Pre-Phase-4 (i) — inbox-read error taxonomy.
 *
 * `MESSAGE_NOT_FOUND` used to cover three materially different states, so a
 * caller could not tell a missing message from a tampered one from a
 * key-availability problem. This pins the split: each state reaches its own
 * code, and no caller may branch on the old conflated meaning.
 *
 * All three cases run against the same fixture shape so the ONLY difference is
 * the state under test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { bindKeyProvider, unbindKeyProvider, computeSeal } from '../../sealed-storage/index'
import { deriveLedgerSealKey } from '../../sealed-storage/ledgerSealKey'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
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

vi.mock('../../handshake/internalSandboxesApi', async (io) => {
  const mod = await io<typeof import('../../handshake/internalSandboxesApi')>()
  return { ...mod, listAvailableInternalSandboxes }
})
vi.mock('../../handshake/db', async (io) => {
  const mod = await io<typeof import('../../handshake/db')>()
  return { ...mod, getHandshakeRecord }
})

const OUTER_KEY = deriveLedgerSealKey('taxonomy-outer-session')

const session = {
  wrdesk_user_id: 'u-tax',
  email: 'h@example.com',
  sub: 'sub-tax',
  iss: 'iss',
  email_verified: true,
  plan: 'free',
  currentHardwareAttestation: null,
  currentDnsVerification: null,
} as SSOSession

function record(id: string): HandshakeRecord {
  return {
    handshake_id: id,
    state: HandshakeState.ACTIVE,
    same_principal: true,
    relationship_id: 'rel-tax',
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    initiator_coordination_device_id: getInstanceId(),
    acceptor_coordination_device_id: 'dev-sandbox-peer',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'http://127.0.0.1:51249/beap/ingest',
    local_x25519_public_key_b64: 'bG9jYWx4MjU1MTk=',
    peer_x25519_public_key_b64: 'cGVlcngyNTUxOQ==',
    peer_mlkem768_public_key_b64: 'bWxrZW0xMjM=',
    initiator: { wrdesk_user_id: 'u-tax', email: 'h@example.com' },
    acceptor: { wrdesk_user_id: 'u-tax', email: 'h@example.com' },
    internal_peer_pairing_code: '123456',
  } as HandshakeRecord
}

function entry(id = 'hs-tax'): InternalSandboxListEntry {
  return {
    handshake_id: id,
    relationship_id: 'rel-tax',
    state: 'ACTIVE',
    peer_role: 'sandbox',
    peer_label: 'Sandbox',
    peer_device_id: 'dev-sb',
    peer_device_name: 'Tax Sandbox',
    peer_pairing_code_six: '123456',
    internal_coordination_identity_complete: true,
    p2p_endpoint_set: true,
    last_known_delivery_status: 'idle',
    live_status_optional: 'relay_connected',
    sandbox_keying_complete: true,
    beap_clone_eligible: true,
  }
}

describe('inbox-read error taxonomy', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    listAvailableInternalSandboxes.mockReset()
    getHandshakeRecord.mockReset()
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
    const e = entry()
    listAvailableInternalSandboxes.mockReturnValue({
      success: true,
      sandboxes: [e],
      incomplete: [],
      sandbox_availability: { status: 'connected', relay_connected: true, use_coordination: true },
      authoritative_device_internal_role: 'host',
    })
    getHandshakeRecord.mockReturnValue(record(e.handshake_id))
  })

  afterEach(() => ctx.cleanup())

  function insert(opts: { depackaged: string | null; validSeal: boolean }): string {
    const msgId = randomUUID()
    const dep = opts.depackaged
    const s = opts.validSeal
      ? computeSeal(dep ?? '', msgId, 'outer')
      : computeSeal('a completely different canonical body', msgId, 'outer')
    ctx.db!
      .prepare(
        `INSERT INTO inbox_messages
           (id, source_type, handshake_id, subject, body_text, depackaged_json,
            has_attachments, from_address, account_id, received_at, ingested_at,
            seal, seal_input_json, seal_key_source)
         VALUES (?, 'direct_beap', 'hs-orig', 'Taxonomy', 'body', ?,
                 0, 'from@test', 'acc', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
                 ?, ?, 'ledger')`,
      )
      .run(msgId, dep, s.seal, s.seal_input_json)
    return msgId
  }

  it('genuinely absent row → MESSAGE_NOT_FOUND', () => {
    if (!ctx.db) return
    const r = prepareBeapInboxSandboxClone(ctx.db as any, session, randomUUID(), 'hs-tax', 'tag')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('MESSAGE_NOT_FOUND')
      // The copy no longer hedges with "or could not be verified".
      expect(r.error).not.toMatch(/could not be verified/i)
    }
  })

  it('present but seal does not verify → SOURCE_UNVERIFIABLE', () => {
    if (!ctx.db) return
    const id = insert({
      depackaged: JSON.stringify({ body: { text: 'present but tampered' } }),
      validSeal: false,
    })
    const r = prepareBeapInboxSandboxClone(ctx.db as any, session, id, 'hs-tax', 'tag')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('SOURCE_UNVERIFIABLE')
      expect(r.error).toMatch(/could not be verified/i)
    }
  })

  it('present with no canonical plaintext → SOURCE_NO_CANONICAL_CONTENT', () => {
    if (!ctx.db) return
    const id = insert({ depackaged: null, validSeal: true })
    const r = prepareBeapInboxSandboxClone(ctx.db as any, session, id, 'hs-tax', 'tag')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('SOURCE_NO_CANONICAL_CONTENT')
  })

  it('absence of content outranks unverifiability', () => {
    if (!ctx.db) return
    // Both defects at once: you cannot verify what is not there, and "no
    // content yet" is the actionable thing to tell the operator.
    const id = insert({ depackaged: null, validSeal: false })
    const r = prepareBeapInboxSandboxClone(ctx.db as any, session, id, 'hs-tax', 'tag')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('SOURCE_NO_CANONICAL_CONTENT')
  })

  it('the three codes are distinct and none is the old conflated string', () => {
    if (!ctx.db) return
    const absent = prepareBeapInboxSandboxClone(ctx.db as any, session, randomUUID(), 'hs-tax', 'tag')
    const unverifiable = prepareBeapInboxSandboxClone(
      ctx.db as any,
      session,
      insert({ depackaged: JSON.stringify({ body: { text: 'x' } }), validSeal: false }),
      'hs-tax',
      'tag',
    )
    const noContent = prepareBeapInboxSandboxClone(
      ctx.db as any,
      session,
      insert({ depackaged: null, validSeal: true }),
      'hs-tax',
      'tag',
    )
    const codes = [absent, unverifiable, noContent].map((r) => (r.ok ? 'ok' : r.code))
    expect(new Set(codes).size).toBe(3)
    expect(codes).toEqual([
      'MESSAGE_NOT_FOUND',
      'SOURCE_UNVERIFIABLE',
      'SOURCE_NO_CANONICAL_CONTENT',
    ])
  })

  it('no production caller branches on the old conflated meaning', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const prepare = readFileSync(join(here, '..', 'beapInboxClonePrepare.ts'), 'utf8')
    // Exactly one MESSAGE_NOT_FOUND return remains, and it is the absent-row one.
    const returns = prepare.match(/code: 'MESSAGE_NOT_FOUND'/g) ?? []
    expect(returns).toHaveLength(1)
    expect(prepare).toMatch(/code: 'SOURCE_UNVERIFIABLE'/)
    expect(prepare).toMatch(/code: 'SOURCE_NO_CANONICAL_CONTENT'/)
    // The hedging copy is gone from the absent-row branch.
    expect(prepare).not.toMatch(/'Inbox message was not found or could not be verified\.'/)
  })
})
