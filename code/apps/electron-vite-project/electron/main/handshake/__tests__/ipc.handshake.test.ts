/**
 * Handshake IPC Method Tests
 *
 * Verifies the new handshake.initiate / handshake.accept / handshake.refresh
 * IPC methods work correctly with mocked email transport and local pipeline.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  handleHandshakeRPC,
  setSSOSessionProvider,
  _resetSSOSessionProvider,
} from '../ipc'
import {
  setEmailSendFn,
  _resetEmailSendFn,
} from '../emailTransport'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { buildInitiateCapsule, buildAcceptCapsule } from '../capsuleBuilder'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { updateHandshakeSigningKeys, updateHandshakeRecord, getHandshakeRecord } from '../db'
import { mockKeypairFields, MOCK_EXTENSION_X25519_PUBLIC_B64 } from './mockKeypair'
import type { SSOSession } from '../types'
import { HandshakeState } from '../types'

function senderSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'sender-001',
    email: 'sender@test.com',
    sub: 'sender-001',
  })
}

function receiverSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'receiver-001',
    email: 'receiver@test.com',
    sub: 'receiver-001',
  })
}

describe('Handshake IPC — handshake.initiate', () => {
  let db: ReturnType<typeof createHandshakeTestDb>
  const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: 'email-001' })

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(mockSend)
    mockSend.mockClear()
  })

  test('T4: initiate builds capsule, sends email, submits to local pipeline', async () => {
    const sender = senderSession()
    setSSOSessionProvider(() => sender)

    const result = await handleHandshakeRPC('handshake.initiate', {
      receiverUserId: 'receiver-001',
      receiverEmail: 'receiver@test.com',
      fromAccountId: 'acct-1',
    }, db)

    expect(result.success).toBeDefined()
    expect(result.handshake_id).toBeTruthy()
    expect(result.email_sent).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  test('T7: initiate without SSO session → rejected', async () => {
    _resetSSOSessionProvider()

    const result = await handleHandshakeRPC('handshake.initiate', {
      receiverUserId: 'receiver-001',
      receiverEmail: 'receiver@test.com',
      fromAccountId: 'acct-1',
    }, db)

    expect(result.success).toBe(false)
    expect(result.error).toContain('SSO session')
  })

  test('initiate without receiverUserId → rejected', async () => {
    setSSOSessionProvider(() => senderSession())

    const result = await handleHandshakeRPC('handshake.initiate', {
      receiverUserId: '',
      receiverEmail: 'receiver@test.com',
      fromAccountId: 'acct-1',
    }, db)

    expect(result.success).toBe(false)
    expect(result.error).toContain('required')
  })

  test('initiate with policy_selections persists policy and uses it for block governance', async () => {
    const sender = senderSession()
    setSSOSessionProvider(() => sender)

    const result = await handleHandshakeRPC('handshake.initiate', {
      receiverUserId: 'receiver-001',
      receiverEmail: 'receiver@test.com',
      fromAccountId: 'acct-1',
      message: 'Hello',
      policy_selections: { cloud_ai: true, internal_ai: true },
    }, db)

    expect(result.success).toBe(true)
    expect(result.handshake_id).toBeTruthy()

    const record = getHandshakeRecord(db, result.handshake_id)
    expect(record).toBeDefined()
    expect(record!.policy_selections).toEqual({ cloud_ai: true, internal_ai: true })
  })

  test('initiate without policy_selections uses fallback (no crash)', async () => {
    const sender = senderSession()
    setSSOSessionProvider(() => sender)

    const result = await handleHandshakeRPC('handshake.initiate', {
      receiverUserId: 'receiver-001',
      receiverEmail: 'receiver@test.com',
      fromAccountId: 'acct-1',
    }, db)

    expect(result.success).toBe(true)
    expect(result.handshake_id).toBeTruthy()
  })

  test('initiate with context_blocks + per-item policy_mode override uses item policy for governance', async () => {
    const sender = senderSession()
    setSSOSessionProvider(() => sender)

    const { computeBlockHash } = await import('../contextCommitment')
    const content = 'adhoc-initiate-override-test'
    const blockHash = computeBlockHash(content)

    const result = await handleHandshakeRPC('handshake.initiate', {
      receiverUserId: 'receiver-001',
      receiverEmail: 'receiver@test.com',
      fromAccountId: 'acct-1',
      policy_selections: { cloud_ai: false, internal_ai: false },
      context_blocks: [{
        block_id: 'ctx-msg-pending',
        block_hash: blockHash,
        type: 'plaintext',
        content,
        scope_id: 'initiator',
        policy_mode: 'override',
        policy: { cloud_ai: true, internal_ai: true },
      }],
    }, db)

    expect(result.success).toBe(true)
    expect(result.handshake_id).toBeTruthy()

    const { getContextStoreByHandshake } = await import('../db')
    const pending = getContextStoreByHandshake(db, result.handshake_id, 'pending_delivery')
    const adhocBlock = pending.find((b: any) => b.content === content)
    expect(adhocBlock).toBeDefined()
    expect(adhocBlock.governance_json).toBeTruthy()
    const gov = JSON.parse(adhocBlock.governance_json)
    expect(gov.usage_policy?.cloud_ai_allowed).toBe(true)
    expect(gov.usage_policy?.local_ai_allowed).toBe(true)
  })

  test('initiate with only policy_selections (legacy, no per-item) remains stable', async () => {
    const sender = senderSession()
    setSSOSessionProvider(() => sender)

    const result = await handleHandshakeRPC('handshake.initiate', {
      receiverUserId: 'receiver-001',
      receiverEmail: 'receiver@test.com',
      fromAccountId: 'acct-1',
      message: 'Legacy message',
      policy_selections: { cloud_ai: true, internal_ai: false },
    }, db)

    expect(result.success).toBe(true)
    expect(result.handshake_id).toBeTruthy()
    const record = getHandshakeRecord(db, result.handshake_id)
    expect(record?.policy_selections).toEqual({ cloud_ai: true, internal_ai: false })
  })
})

describe('Handshake IPC — handshake.accept', () => {
  let db: ReturnType<typeof createHandshakeTestDb>
  const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: 'email-002' })

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(mockSend)
    mockSend.mockClear()
  })

  async function createPendingHandshake() {
    const sender = senderSession()
    const receiver = receiverSession()
    const capsule = buildInitiateCapsule(sender, { receiverUserId: receiver.wrdesk_user_id, receiverEmail: receiver.email })
    await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: JSON.stringify(capsule), mime_type: 'application/vnd.beap+json' },
        sourceType: 'internal',
        transportMeta: { channel_id: 'test' },
      },
      db,
      receiver,
    )
    return capsule.handshake_id
  }

  test('T5: accept loads pending record, builds accept, sends email', async () => {
    const receiver = receiverSession()
    setSSOSessionProvider(() => receiver)

    const handshakeId = await createPendingHandshake()

    const result = await handleHandshakeRPC('handshake.accept', {
      handshake_id: handshakeId,
      sharing_mode: 'receive-only',
      fromAccountId: 'acct-1',
      senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
    }, db)

    expect(result.success).toBeDefined()
    expect(result.handshake_id).toBe(handshakeId)
    expect(result.email_sent).toBe(true)
  })

  test('T8: accept on non-existent handshake → rejected', async () => {
    setSSOSessionProvider(() => receiverSession())

    const result = await handleHandshakeRPC('handshake.accept', {
      handshake_id: 'hs-nonexistent',
      sharing_mode: 'receive-only',
      fromAccountId: 'acct-1',
    }, db)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('accept with policy_selections persists policy for block governance', async () => {
    const receiver = receiverSession()
    setSSOSessionProvider(() => receiver)

    const handshakeId = await createPendingHandshake()

    const result = await handleHandshakeRPC('handshake.accept', {
      handshake_id: handshakeId,
      sharing_mode: 'receive-only',
      fromAccountId: 'acct-1',
      senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
      policy_selections: { cloud_ai: false, internal_ai: true },
    }, db)

    expect(result.success).toBe(true)

    const record = getHandshakeRecord(db, handshakeId)
    expect(record).toBeDefined()
    expect(record!.policy_selections).toEqual({ cloud_ai: false, internal_ai: true })
  })

  test('accept with context_blocks + per-item policy_mode override uses item policy for governance', async () => {
    const receiver = receiverSession()
    setSSOSessionProvider(() => receiver)

    const handshakeId = await createPendingHandshake()

    const { computeBlockHash } = await import('../contextCommitment')
    const content = 'adhoc-override-test'
    const blockHash = computeBlockHash(content)

    const result = await handleHandshakeRPC('handshake.accept', {
      handshake_id: handshakeId,
      sharing_mode: 'receive-only',
      fromAccountId: 'acct-1',
      senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
      policy_selections: { cloud_ai: false, internal_ai: false },
      context_blocks: [{
        block_id: 'blk-adhoc-1',
        block_hash: blockHash,
        type: 'plaintext',
        content,
        scope_id: 'acceptor',
        policy_mode: 'override',
        policy: { cloud_ai: true, internal_ai: true },
      }],
    }, db)

    expect(result.success).toBe(true)

    const { getContextStoreByHandshake } = await import('../db')
    const pending = getContextStoreByHandshake(db, handshakeId, 'pending_delivery')
    const adhocBlock = pending.find((b: any) => b.block_id === 'blk-adhoc-1')
    expect(adhocBlock).toBeDefined()
    expect(adhocBlock.governance_json).toBeTruthy()
    const gov = JSON.parse(adhocBlock.governance_json)
    expect(gov.usage_policy?.cloud_ai_allowed).toBe(true)
    expect(gov.usage_policy?.local_ai_allowed).toBe(true)
  })

  test('normal accept without acceptor X25519 fails fast with ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED', async () => {
    const receiver = receiverSession()
    setSSOSessionProvider(() => receiver)
    const handshakeId = await createPendingHandshake()
    const result = await handleHandshakeRPC(
      'handshake.accept',
      { handshake_id: handshakeId, sharing_mode: 'receive-only', fromAccountId: 'acct-1' },
      db,
    )
    expect(result.success).toBe(false)
    expect((result as { code?: string }).code).toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
    expect(String((result as { error?: string }).error ?? '')).toMatch(/senderX25519PublicKeyB64|key_agreement\.x25519_public_key_b64/)
  })

  test('normal accept accepts key_agreement.x25519_public_key_b64', async () => {
    const receiver = receiverSession()
    setSSOSessionProvider(() => receiver)
    const handshakeId = await createPendingHandshake()
    const result = await handleHandshakeRPC('handshake.accept', {
      handshake_id: handshakeId,
      sharing_mode: 'receive-only',
      fromAccountId: 'acct-1',
      key_agreement: { x25519_public_key_b64: MOCK_EXTENSION_X25519_PUBLIC_B64 },
    }, db)
    expect(result.success).toBe(true)
  })
})

describe('Handshake IPC — handshake.refresh', () => {
  let db: ReturnType<typeof createHandshakeTestDb>
  const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: 'email-003' })

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(mockSend)
    mockSend.mockClear()
  })

  async function createActiveHandshake(): Promise<string> {
    const sender = senderSession()
    const receiver = receiverSession()

    const initiate = buildInitiateCapsule(sender, {
      receiverUserId: receiver.wrdesk_user_id,
      receiverEmail: receiver.email,
      reciprocal_allowed: true,
    })
    await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: JSON.stringify(initiate), mime_type: 'application/vnd.beap+json' },
        sourceType: 'internal',
        transportMeta: { channel_id: 'test' },
      },
      db,
      receiver,
    )

    const { capsule: accept } = buildAcceptCapsule(receiver, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: sender.wrdesk_user_id,
      initiatorEmail: sender.email,
      sharing_mode: 'reciprocal',
      initiator_capsule_hash: initiate.capsule_hash,
    })
    await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: JSON.stringify(accept), mime_type: 'application/vnd.beap+json' },
        sourceType: 'internal',
        transportMeta: { channel_id: 'test' },
      },
      db,
      sender,
    )

    // Per design: ACCEPTED → ACTIVE requires context_sync roundtrip.
    // For this unit test we bypass by directly setting ACTIVE so handshake.refresh can run.
    const record = getHandshakeRecord(db, initiate.handshake_id)
    if (record && record.state === HandshakeState.ACCEPTED) {
      updateHandshakeRecord(db, { ...record, state: HandshakeState.ACTIVE, last_seq_received: 1 })
    }

    return initiate.handshake_id
  }

  test('T6: refresh loads active record, builds refresh with blocks, sends email', async () => {
    const sender = senderSession()
    setSSOSessionProvider(() => sender)
    const handshakeId = await createActiveHandshake()
    updateHandshakeSigningKeys(db, handshakeId, mockKeypairFields())

    const result = await handleHandshakeRPC('handshake.refresh', {
      handshake_id: handshakeId,
      context_blocks: [{
        block_id: 'blk-001',
        block_hash: 'h'.repeat(64),
        relationship_id: 'rel:test',
        handshake_id: handshakeId,
        type: 'text-message',
        data_classification: 'public',
        version: 1,
        payload: 'Hello, world!',
      }],
      fromAccountId: 'acct-1',
    }, db)

    expect(result.handshake_id).toBe(handshakeId)
    expect(result.capsule_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.email_sent).toBe(true)
  })

  test('T9: refresh on revoked handshake → rejected', async () => {
    const sender = senderSession()
    setSSOSessionProvider(() => sender)
    const handshakeId = await createActiveHandshake()
    updateHandshakeSigningKeys(db, handshakeId, mockKeypairFields())

    // Manually update the record state to REVOKED
    const record = db.getHandshake(handshakeId)
    if (record) {
      db.prepare('UPDATE handshakes SET state = @state WHERE handshake_id = @handshake_id').run({
        ...record,
        state: 'REVOKED',
      })
    }

    const result = await handleHandshakeRPC('handshake.refresh', {
      handshake_id: handshakeId,
      context_blocks: [],
      fromAccountId: 'acct-1',
    }, db)

    expect(result.success).toBe(false)
    expect(result.error).toContain('REVOKED')
  })

  test('refresh without handshake_id → rejected', async () => {
    setSSOSessionProvider(() => senderSession())

    const result = await handleHandshakeRPC('handshake.refresh', {
      handshake_id: '',
      context_blocks: [],
      fromAccountId: 'acct-1',
    }, db)

    expect(result.success).toBe(false)
  })
})
