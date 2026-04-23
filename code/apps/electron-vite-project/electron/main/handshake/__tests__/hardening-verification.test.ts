/**
 * Comprehensive Verification of Critical Hardening Fixes
 *
 * Tests for:
 *   - Fix 1: capsule_hash verification
 *   - Fix 2: context_hash verification (capsule context payload) + context_commitment (context_blocks)
 *   - Fix 3: Context-sync enforcement as first post-activation capsule
 *
 * Each test has a clear name, description, and explicit PASS/FAIL assertion.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import os from 'node:os'

// Email gateway reads `app.getPath` at module-load time via `ingestion/ipc` → `emailTransport` →
// `messageRouter` (same pattern as ipc.internal.relayPush.test.ts).
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  BrowserWindow: class {
    webContents = { send: () => undefined }
    static getAllWindows() {
      return []
    }
  },
}))

import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import {
  handleHandshakeRPC,
  setSSOSessionProvider,
  _resetSSOSessionProvider,
} from '../ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import {
  buildInitiateCapsule,
  buildInitiateCapsuleWithKeypair,
  buildAcceptCapsule,
  buildRefreshCapsule,
  buildContextSyncCapsule,
} from '../capsuleBuilder'
import { canonicalRebuild } from '../canonicalRebuild'
import { computeCapsuleHash } from '../capsuleHash'
import { computeContextHash } from '../contextHash'
import { computeBlockHash, computeContextCommitment } from '../contextCommitment'
import { HandshakeState } from '../types'
import type { SSOSession } from '../types'
import { updateHandshakeSigningKeys, updateHandshakeCounterpartyKey } from '../db'

function aliceSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'alice-001',
    email: 'alice@company.com',
    sub: 'alice-001',
  })
}

function bobSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'bob-001',
    email: 'bob@partner.com',
    sub: 'bob-001',
  })
}

/** Setup initiate+accept and return capsules + keypairs for context_sync/refresh. */
async function setupHandshakeWithKeypairs(
  alice: SSOSession,
  bob: SSOSession,
  aliceDb: any,
  bobDb: any,
  initOpts?: { context_blocks?: Array<{ block_id: string; block_hash: string; type: string; content: string }> },
) {
  const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
    receiverUserId: 'bob-001',
    receiverEmail: 'bob@partner.com',
    ...initOpts,
  })
  await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
  const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
    handshake_id: initCapsule.handshake_id,
    initiatorUserId: 'alice-001',
    initiatorEmail: 'alice@company.com',
    sharing_mode: 'reciprocal',
    initiator_capsule_hash: initCapsule.capsule_hash,
  })
  await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
  await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
  await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
  const handshakeId = initCapsule.handshake_id
  updateHandshakeSigningKeys(aliceDb, handshakeId, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
  updateHandshakeSigningKeys(bobDb, handshakeId, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
  // Bob's record gets counterparty_public_key overwritten when accept is processed (sender=bob); restore alice's key
  updateHandshakeCounterpartyKey(bobDb, handshakeId, aliceKeypair.publicKey)
  return { initCapsule, acceptCapsule, aliceKeypair, bobKeypair }
}

async function submitCapsule(capsuleJson: string, db: any, session: SSOSession) {
  return handleIngestionRPC(
    'ingestion.ingest',
    {
      rawInput: {
        body: capsuleJson,
        mime_type: 'application/vnd.beap+json',
      },
      sourceType: 'email',
      transportMeta: { channel_id: 'test', mime_type: 'application/vnd.beap+json' },
    },
    db,
    session,
  )
}

describe('Hardening Verification — Fix 1: capsule_hash', () => {
  let aliceDb: ReturnType<typeof createHandshakeTestDb>
  let bobDb: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    aliceDb = createHandshakeTestDb()
    migrateIngestionTables(aliceDb)
    bobDb = createHandshakeTestDb()
    migrateIngestionTables(bobDb)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }))
  })

  test('A1_valid_hash_initiate: Valid initiate capsule with correct capsule_hash → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test('A2_valid_hash_accept: Valid accept capsule with correct capsule_hash → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const initCapsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    setSSOSessionProvider(() => bob)
    await handleHandshakeRPC('handshake.accept', {
      handshake_id: initCapsule.handshake_id,
      sharing_mode: 'reciprocal',
      fromAccountId: 'acct-bob-1',
    }, bobDb)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    const result = await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    expect(result.success).toBe(true)
  })

  test('A7_tampered_payload: Modify a field after hash computation → HASH_INTEGRITY_FAILURE', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.timestamp = '2020-01-01T00:00:00.000Z' // Tamper after hash
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Capsule rejected')
  })

  test('A8_tampered_sender_id: Change sender_id, keep original hash → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.sender_id = 'attacker-001'
    raw.sender_wrdesk_user_id = 'attacker-001'
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A10_tampered_timestamp: Change timestamp, keep original hash → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.timestamp = '2099-12-31T23:59:59.000Z'
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A11_empty_hash: capsule_hash = "" → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.capsule_hash = ''
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A15_hash_of_different_capsule: Valid hash but from a different capsule → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const cap1 = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const cap2 = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(cap1))
    raw.capsule_hash = cap2.capsule_hash
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A16_hash_case_sensitivity: Uppercase hex vs lowercase → verify lowercase required', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.capsule_hash = raw.capsule_hash.toUpperCase()
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A17_extra_fields_in_capsule: Capsule with unexpected extra fields → hash still computed over correct field set only', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.extra_field = 'ignored'
    const rebuild = canonicalRebuild(raw)
    expect(rebuild.ok).toBe(true)
    if (rebuild.ok) {
      expect((rebuild.capsule as any).extra_field).toBeUndefined()
      const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
      expect(result.success).toBe(true)
    }
  })

  test('A3_valid_hash_context_sync: Valid context-sync capsule with correct hash → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const handshakeId = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, handshakeId, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, handshakeId, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    updateHandshakeCounterpartyKey(bobDb, handshakeId, aliceKeypair.publicKey)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('A4_valid_hash_refresh: Valid refresh capsule with correct hash → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const handshakeId = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, handshakeId, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, handshakeId, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    updateHandshakeCounterpartyKey(bobDb, handshakeId, aliceKeypair.publicKey)
    const aliceContextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    await submitCapsule(JSON.stringify(aliceContextSync), bobDb, bob)
    const bobContextSync = buildContextSyncCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'alice-001',
      counterpartyEmail: 'alice@company.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: bobKeypair.publicKey,
      local_private_key: bobKeypair.privateKey,
    })
    await submitCapsule(JSON.stringify(bobContextSync), aliceDb, alice)
    const aliceRecord = aliceDb.getHandshake(initCapsule.handshake_id)
    const refresh = buildRefreshCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: aliceRecord!.last_seq_received,
      last_capsule_hash_received: aliceContextSync.capsule_hash,
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(refresh), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('A5_valid_hash_minimal: Capsule with only required fields, correct hash → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('A6_valid_hash_max_context_blocks: Capsule with many context_blocks (10+), correct hash → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const blocks = Array.from({ length: 12 }, (_, i) => {
      const content = JSON.stringify({ idx: i })
      return { block_id: `ctx-test-${String(i + 1).padStart(3, '0')}`, block_hash: computeBlockHash(content), type: 'test', content }
    })
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('A9_tampered_context_blocks: Modify context_blocks, keep original capsule_hash → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'test' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'blk_00000001', block_hash: blockHash, type: 'test', content }]
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.context_blocks[0].block_hash = 'a'.repeat(64)
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A12_null_hash: capsule_hash = null → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.capsule_hash = null
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A13_wrong_length_hash: capsule_hash too short → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.capsule_hash = 'abcdef'
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A14_non_hex_hash: capsule_hash 64 chars non-hex → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.capsule_hash = 'z'.repeat(64)
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('A18_reordered_json_fields: Same capsule data, different JSON key order → same hash', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const reordered = { ...capsule, handshake_id: capsule.handshake_id, capsule_type: capsule.capsule_type }
    const result = await submitCapsule(JSON.stringify(reordered), bobDb, bob)
    expect(result.success).toBe(true)
  })
})

describe('Hardening Verification — Fix 2: context_hash and context_commitment', () => {
  let aliceDb: ReturnType<typeof createHandshakeTestDb>
  let bobDb: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    aliceDb = createHandshakeTestDb()
    migrateIngestionTables(aliceDb)
    bobDb = createHandshakeTestDb()
    migrateIngestionTables(bobDb)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }))
  })

  test('B1_valid_sender_context: Sender context_blocks match sender context_commitment → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'test' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'blk-1', block_hash: blockHash, type: 'test', content }]
    const commitment = computeContextCommitment(blocks)
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    expect(capsule.context_commitment).toBe(commitment)
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('B4_no_context_both_sides: No context_blocks, no commitments on either side → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    expect(capsule.context_commitment).toBeNull()
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('B7_tampered_block_hash: Modify one block_hash in context_blocks → CONTEXT_INTEGRITY_FAILURE', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'test' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'blk-1', block_hash: blockHash, type: 'test', content }]
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.context_blocks[0].block_hash = 'b'.repeat(64)
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('B11_blocks_present_no_commitment: context_blocks provided but context_commitment is null → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'test' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'blk-1', block_hash: blockHash, type: 'test', content }]
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.context_commitment = null
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('B12_commitment_present_no_blocks: context_commitment exists but context_blocks is empty → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.context_commitment = 'a'.repeat(64)
    raw.context_blocks = []
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('B2_valid_receiver_context: Acceptor context_blocks match acceptor_context_commitment → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const initCapsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const content = JSON.stringify({ acceptor: 'data' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'ctx-acceptor-001', block_hash: blockHash, type: 'test', content }]
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
      context_blocks: blocks,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    const result = await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    expect(result.success).toBe(true)
  })

  test('B5_single_block: One context_block, correct commitment → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'single' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'ctx-single-001', block_hash: blockHash, type: 'test', content }]
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('B6_multiple_blocks: 5+ context_blocks, correct combined commitment → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const blocks = Array.from({ length: 5 }, (_, i) => {
      const content = JSON.stringify({ n: i })
      return { block_id: `ctx-multi-${String(i + 1).padStart(3, '0')}`, block_hash: computeBlockHash(content), type: 'test', content }
    })
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('B8_extra_block: context_blocks has one extra block not in commitment → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'test' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'ctx-extra-001', block_hash: blockHash, type: 'test', content }]
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.context_blocks.push({ block_id: 'ctx-extra-002', block_hash: 'b'.repeat(64), type: 'test', content: null })
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('B9_missing_block: One committed block missing from context_blocks → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const c1 = JSON.stringify({ a: 1 })
    const c2 = JSON.stringify({ b: 2 })
    const blocks = [
      { block_id: 'ctx-miss-001', block_hash: computeBlockHash(c1), type: 'test', content: c1 },
      { block_id: 'ctx-miss-002', block_hash: computeBlockHash(c2), type: 'test', content: c2 },
    ]
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.context_blocks = raw.context_blocks.slice(0, 1)
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('B15_empty_block_hash: context_block with block_hash="" → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'test' })
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: [{ block_id: 'ctx-empty-001', block_hash: computeBlockHash(content), type: 'test', content }],
    })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.context_blocks[0].block_hash = ''
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('B10_reordered_blocks: context_blocks in different order → commitment normalizes (sorted hashes)', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const c1 = JSON.stringify({ a: 1 })
    const c2 = JSON.stringify({ b: 2 })
    const h1 = computeBlockHash(c1)
    const h2 = computeBlockHash(c2)
    const blocksOrder1 = [
      { block_id: 'ctx-ord-001', block_hash: h1, type: 'test', content: c1 },
      { block_id: 'ctx-ord-002', block_hash: h2, type: 'test', content: c2 },
    ]
    const capsule1 = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocksOrder1,
    })
    const blocksOrder2 = [
      { block_id: 'ctx-ord-002', block_hash: h2, type: 'test', content: c2 },
      { block_id: 'ctx-ord-001', block_hash: h1, type: 'test', content: c1 },
    ]
    const capsule2 = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocksOrder2,
    })
    expect(capsule1.context_commitment).toBe(capsule2.context_commitment)
    const result = await submitCapsule(JSON.stringify(capsule2), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('B16_duplicate_block_ids: Two blocks with same block_id → builder canonicalizes to unique ids', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'test' })
    const blockHash = computeBlockHash(content)
    const capsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: [
        { block_id: 'ctx-dup-001', block_hash: blockHash, type: 'test', content },
        { block_id: 'ctx-dup-001', block_hash: blockHash, type: 'test', content },
      ],
    })
    const uniqueIds = [...new Set(capsule.context_blocks.map((b: any) => b.block_id))]
    expect(uniqueIds.length).toBe(2)
    const result = await submitCapsule(JSON.stringify(capsule), bobDb, bob)
    expect(result.success).toBe(true)
  })
})

describe('Hardening Verification — Fix 3: Context-sync enforcement', () => {
  let aliceDb: ReturnType<typeof createHandshakeTestDb>
  let bobDb: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    aliceDb = createHandshakeTestDb()
    migrateIngestionTables(aliceDb)
    bobDb = createHandshakeTestDb()
    migrateIngestionTables(bobDb)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }))
  })

  test('C1_context_sync_at_seq1: After activation, context-sync capsule at seq 1 → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { initCapsule, acceptCapsule, aliceKeypair } = await setupHandshakeWithKeypairs(alice, bob, aliceDb, bobDb)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('C5_content_at_seq1: After activation, refresh at seq 1 (not context-sync) → CONTEXT_SYNC_REQUIRED', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    setSSOSessionProvider(() => bob)
    await handleHandshakeRPC('handshake.accept', {
      handshake_id: initCapsule.handshake_id,
      sharing_mode: 'reciprocal',
      fromAccountId: 'acct-bob-1',
    }, bobDb)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    const aliceRecord = aliceDb.getHandshake(initCapsule.handshake_id)
    const refresh = buildRefreshCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: aliceRecord?.last_seq_received ?? 0,
      last_capsule_hash_received: aliceRecord?.last_capsule_hash_received ?? '',
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(refresh), bobDb, bob)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Capsule rejected')
  })

  test('C6_skip_to_seq2: Send seq 2 without seq 1 context-sync → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    setSSOSessionProvider(() => bob)
    await handleHandshakeRPC('handshake.accept', {
      handshake_id: initCapsule.handshake_id,
      sharing_mode: 'reciprocal',
      fromAccountId: 'acct-bob-1',
    }, bobDb)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    const refresh = buildRefreshCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 1,
      last_capsule_hash_received: 'fake-hash-for-seq2',
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const raw = JSON.parse(JSON.stringify(refresh))
    raw.seq = 2
    raw.prev_hash = 'fake-hash-for-seq2'
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('C8_context_sync_before_activation: Context-sync while handshake not yet active → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: initCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('C2_normal_message_after_sync: After context-sync at seq 1, send refresh at seq 2 → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { initCapsule, acceptCapsule, aliceKeypair, bobKeypair } = await setupHandshakeWithKeypairs(alice, bob, aliceDb, bobDb)
    const aliceContextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    await submitCapsule(JSON.stringify(aliceContextSync), bobDb, bob)
    const bobContextSync = buildContextSyncCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'alice-001',
      counterpartyEmail: 'alice@company.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: bobKeypair.publicKey,
      local_private_key: bobKeypair.privateKey,
    })
    await submitCapsule(JSON.stringify(bobContextSync), aliceDb, alice)
    const aliceRecord = aliceDb.getHandshake(initCapsule.handshake_id)
    const refresh = buildRefreshCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: aliceRecord!.last_seq_received,
      last_capsule_hash_received: aliceContextSync.capsule_hash,
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(refresh), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('C3_context_sync_from_initiator: Initiator sends context-sync to acceptor → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const handshakeId = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, handshakeId, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, handshakeId, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    updateHandshakeCounterpartyKey(bobDb, handshakeId, aliceKeypair.publicKey)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('C4_context_sync_from_acceptor: Acceptor sends context-sync to initiator → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const contextSync = buildContextSyncCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'alice-001',
      counterpartyEmail: 'alice@company.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: bobKeypair.publicKey,
      local_private_key: bobKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), aliceDb, alice)
    expect(result.success).toBe(true)
  })

  test('C7_second_context_sync: Context-sync at seq 2 after successful seq 1 → INVALID_STATE_TRANSITION', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const firstSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    await submitCapsule(JSON.stringify(firstSync), bobDb, bob)
    const bobRecord = bobDb.getHandshake(initCapsule.handshake_id)
    const secondSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: bobRecord!.last_seq_received,
      last_capsule_hash_received: firstSync.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(secondSync), bobDb, bob)
    expect(result.success).toBe(false)
  })
})

describe('Hardening Verification — Integration: Cross-cutting', () => {
  let aliceDb: ReturnType<typeof createHandshakeTestDb>
  let bobDb: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    aliceDb = createHandshakeTestDb()
    migrateIngestionTables(aliceDb)
    bobDb = createHandshakeTestDb()
    migrateIngestionTables(bobDb)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }))
  })

  test('D7_error_response_no_leak: On rejection, client response contains NO internal details', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const raw = JSON.parse(JSON.stringify(capsule))
    raw.timestamp = '2020-01-01T00:00:00.000Z'
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
    const clientMsg = result.error ?? result.reason
    expect(clientMsg).toBe('Capsule rejected')
    expect(clientMsg).not.toContain('HASH_INTEGRITY')
    expect(clientMsg).not.toContain('handshake_id')
    expect(clientMsg).not.toContain('capsule_hash')
  })

  test('D9_rejection_does_not_alter_state: After rejected capsule, handshake state unchanged', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const initCapsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const before = bobDb.getHandshake(initCapsule.handshake_id)
    const raw = JSON.parse(JSON.stringify(initCapsule))
    raw.capsule_hash = 'wrong'
    await submitCapsule(JSON.stringify(raw), bobDb, bob)
    const after = bobDb.getHandshake(initCapsule.handshake_id)
    expect(before?.state).toBe(after?.state)
    expect(before?.last_seq_received).toBe(after?.last_seq_received)
  })

  test('D1_full_happy_path: initiate → accept → context-sync (both) → refresh → all pass', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { initCapsule, acceptCapsule, aliceKeypair, bobKeypair } = await setupHandshakeWithKeypairs(alice, bob, aliceDb, bobDb)
    const aliceContextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    await submitCapsule(JSON.stringify(aliceContextSync), bobDb, bob)
    const bobContextSync = buildContextSyncCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'alice-001',
      counterpartyEmail: 'alice@company.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: bobKeypair.publicKey,
      local_private_key: bobKeypair.privateKey,
    })
    await submitCapsule(JSON.stringify(bobContextSync), aliceDb, alice)
    const aliceRecord = aliceDb.getHandshake(initCapsule.handshake_id)
    const refresh = buildRefreshCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: aliceRecord!.last_seq_received,
      last_capsule_hash_received: aliceContextSync.capsule_hash,
      context_block_proofs: [
        { block_id: 'blk_aabb00112233', block_hash: 'b'.repeat(64) },
      ],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(refresh), bobDb, bob)
    expect(result.success).toBe(true)
    expect(bobDb.getHandshake(initCapsule.handshake_id)?.state).toBe(HandshakeState.ACTIVE)
  })

  test('D3_valid_hash_wrong_context: Capsule_hash correct but context_blocks dont match stored commitment → CONTEXT_COMMITMENT_MISMATCH', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const origContent = JSON.stringify({ data: 'original' })
    const origBlocks = [{ block_id: 'ctx-d3-001', block_hash: computeBlockHash(origContent), type: 'test', content: origContent }]
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: origBlocks,
    })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const tamperedContent = JSON.stringify({ data: 'tampered' })
    const tamperedBlocks = [{ block_id: 'ctx-d3-002', block_hash: computeBlockHash(tamperedContent), type: 'test', content: tamperedContent }]
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: tamperedBlocks,
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('D2_tampered_hash_in_context_sync: Context-sync with wrong capsule_hash → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const raw = JSON.parse(JSON.stringify(contextSync))
    raw.capsule_hash = 'a'.repeat(64)
    const result = await submitCapsule(JSON.stringify(raw), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('D8_audit_log_on_rejection: On rejection, verify audit log contains handshake_id', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const initCapsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const raw = JSON.parse(JSON.stringify(initCapsule))
    raw.timestamp = '2020-01-01T00:00:00.000Z'
    await submitCapsule(JSON.stringify(raw), bobDb, bob)
    const auditLog = bobDb.getAuditLog()
    const denialEntry = auditLog.find((e: any) => {
      const args = e.args ?? []
      const flat = Array.isArray(args) ? args : Object.values(args)
      return flat.includes(initCapsule.handshake_id) || JSON.stringify(args).includes(initCapsule.handshake_id)
    })
    expect(denialEntry).toBeTruthy()
  })
})

describe('Hardening Verification — Group E: context_commitment DB verification', () => {
  let aliceDb: ReturnType<typeof createHandshakeTestDb>
  let bobDb: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    aliceDb = createHandshakeTestDb()
    migrateIngestionTables(aliceDb)
    bobDb = createHandshakeTestDb()
    migrateIngestionTables(bobDb)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }))
  })

  test('E1_commitment_matches_db: Context-sync with commitment matching stored DB value → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'initiator' })
    const blockHash = computeBlockHash(content)
    const blocks = [{ block_id: 'ctx-e1-001', block_hash: blockHash, type: 'test', content }]
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const handshakeId = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, handshakeId, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, handshakeId, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    updateHandshakeCounterpartyKey(bobDb, handshakeId, aliceKeypair.publicKey)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: blocks,
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(true)
  })

  test('E3_commitment_mismatch_acceptor: Acceptor sends context_blocks different from stored → CONTEXT_COMMITMENT_MISMATCH', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const origContent = JSON.stringify({ data: 'acceptor-original' })
    const origBlocks = [{ block_id: 'ctx-e3-001', block_hash: computeBlockHash(origContent), type: 'test', content: origContent }]
    const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
      context_blocks: origBlocks,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const tamperedContent = JSON.stringify({ data: 'acceptor-tampered' })
    const tamperedBlocks = [{ block_id: 'ctx-e3-002', block_hash: computeBlockHash(tamperedContent), type: 'test', content: tamperedContent }]
    const contextSync = buildContextSyncCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'alice-001',
      counterpartyEmail: 'alice@company.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: tamperedBlocks,
      local_public_key: bobKeypair.publicKey,
      local_private_key: bobKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), aliceDb, alice)
    expect(result.success).toBe(false)
  })

  test('E2_commitment_mismatch_initiator: Initiator sends context_blocks different from stored → CONTEXT_COMMITMENT_MISMATCH', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const origContent = JSON.stringify({ data: 'original' })
    const origBlocks = [{ block_id: 'ctx-e2-001', block_hash: computeBlockHash(origContent), type: 'test', content: origContent }]
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: origBlocks,
    })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const tamperedContent = JSON.stringify({ data: 'tampered' })
    const tamperedBlocks = [{ block_id: 'ctx-e2-002', block_hash: computeBlockHash(tamperedContent), type: 'test', content: tamperedContent }]
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: tamperedBlocks,
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('E4_db_null_capsule_has_blocks: Stored commitment is null, capsule carries context_blocks → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const content = JSON.stringify({ data: 'unexpected' })
    const blocks = [{ block_id: 'ctx-e4-001', block_hash: computeBlockHash(content), type: 'test', content }]
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: blocks,
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('E5_db_set_capsule_no_blocks: Stored commitment exists, capsule has empty context_blocks → rejected', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const content = JSON.stringify({ data: 'initiator' })
    const blocks = [{ block_id: 'ctx-e5-001', block_hash: computeBlockHash(content), type: 'test', content }]
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      context_blocks: blocks,
    })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(false)
  })

  test('E6_both_null: No stored commitment, no blocks in capsule → accepted', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    const { capsule: acceptCapsule, keypair: bobKeypair } = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initCapsule.capsule_hash,
    })
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)
    await submitCapsule(JSON.stringify(acceptCapsule), bobDb, alice)
    const handshakeId = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, handshakeId, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, handshakeId, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    updateHandshakeCounterpartyKey(bobDb, handshakeId, aliceKeypair.publicKey)
    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(true)
  })
})
