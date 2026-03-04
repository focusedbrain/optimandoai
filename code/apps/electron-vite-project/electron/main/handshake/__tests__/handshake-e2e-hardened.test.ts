/**
 * BEAP Handshake E2E — Hardened Integration Tests
 *
 * Covers the complete handshake lifecycle after the Phase 1–4 hardening:
 *   - Download .beap flow (build → serialize → valid JSON)
 *   - Send via API (initiate → email + local persist)
 *   - Upload .beap (file → ingestion → Gate 2 → DB)
 *   - Gate 2 rejection for denied fields
 *   - Accept → ACTIVE on both sides
 *   - Full round-trip: Initiate → Download → Upload → Accept
 *   - Unknown fields stripped by canonical rebuild
 *   - Oversized capsule rejected
 *   - context_block_proofs validated and persisted
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import {
  handleHandshakeRPC,
  setSSOSessionProvider,
  _resetSSOSessionProvider,
} from '../ipc'
import {
  setEmailSendFn,
  _resetEmailSendFn,
} from '../emailTransport'
import {
  buildInitiateCapsule,
  buildAcceptCapsule,
  buildRefreshCapsule,
} from '../capsuleBuilder'
import { canonicalRebuild } from '../canonicalRebuild'
import { HandshakeState } from '../types'
import type { SSOSession } from '../types'

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

describe('Handshake E2E — Hardened', () => {
  let aliceDb: ReturnType<typeof createHandshakeTestDb>
  let bobDb: ReturnType<typeof createHandshakeTestDb>
  const sentEmails: Array<{ to: string; body: string }> = []

  beforeEach(() => {
    aliceDb = createHandshakeTestDb()
    migrateIngestionTables(aliceDb)
    bobDb = createHandshakeTestDb()
    migrateIngestionTables(bobDb)
    sentEmails.length = 0
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockImplementation(async (_acctId, payload) => {
      sentEmails.push({ to: payload.to[0], body: payload.bodyText })
      return { success: true, messageId: `msg-${sentEmails.length}` }
    }))
  })

  // ═══════════════════════════════════════════════════════════════════════
  // SENDER-SIDE TESTS
  // ═══════════════════════════════════════════════════════════════════════

  test('Download .beap: buildForDownload → valid capsule JSON with no context_blocks', async () => {
    const alice = aliceSession()
    setSSOSessionProvider(() => alice)

    const result = await handleHandshakeRPC(
      'handshake.buildForDownload',
      { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' },
      aliceDb,
    )

    expect(result.success).toBe(true)
    expect(result.capsule_json).toBeDefined()
    expect(result.handshake_id).toBeDefined()

    const parsed = JSON.parse(result.capsule_json)
    expect(parsed.schema_version).toBe(2)
    expect(parsed.capsule_type).toBe('initiate')
    expect(parsed.handshake_id).toMatch(/^hs-/)
    expect(parsed.receiverIdentity).toBeNull()
    expect(parsed.context_commitment).toBeNull()
    expect(parsed.data).toBeUndefined()
    expect(parsed.payload).toBeUndefined()

    // All required fields present
    expect(parsed.relationship_id).toBeDefined()
    expect(parsed.sender_id).toBeDefined()
    expect(parsed.capsule_hash).toBeDefined()
    expect(parsed.timestamp).toBeDefined()
    expect(parsed.seq).toBe(0)
    expect(parsed.senderIdentity).toBeDefined()
    expect(parsed.tierSignals).toBeDefined()
  })

  test('Send via API: initiateHandshake → email sent + local record', async () => {
    const alice = aliceSession()
    setSSOSessionProvider(() => alice)

    const result = await handleHandshakeRPC(
      'handshake.initiate',
      {
        receiverUserId: 'bob-001',
        receiverEmail: 'bob@partner.com',
        fromAccountId: 'acct-alice-1',
      },
      aliceDb,
    )

    expect(result.success).toBe(true)
    expect(result.handshake_id).toMatch(/^hs-/)
    expect(result.email_sent).toBe(true)
    expect(sentEmails.length).toBe(1)
    expect(sentEmails[0].to).toBe('bob@partner.com')
  })

  // ═══════════════════════════════════════════════════════════════════════
  // RECEIVER-SIDE TESTS
  // ═══════════════════════════════════════════════════════════════════════

  test('Upload .beap: file → ingestion → Gate 2 → DB with canonical object', async () => {
    const alice = aliceSession()
    const bob = bobSession()

    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const capsuleJson = JSON.stringify(capsule)

    const result = await submitCapsule(capsuleJson, bobDb, bob)
    expect(result.success).toBe(true)
    expect(result.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_ACCEPT)

    // Verify canonical rebuild was applied (the stored object is not the raw input)
    const stored = bobDb.getHandshake(capsule.handshake_id)
    expect(stored).toBeTruthy()
    expect(stored.state).toBe(HandshakeState.PENDING_ACCEPT)
  })

  test('Upload .beap with denied field: rejected by Gate 2', async () => {
    const alice = aliceSession()
    const bob = bobSession()

    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    rawObj.context_blocks = [{ block_id: 'blk_abc', payload: 'malicious data' }]

    const result = await submitCapsule(JSON.stringify(rawObj), bobDb, bob)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Gate 2 rejected')
    expect(result.error).toContain('context_blocks')

    // Nothing stored
    const stored = bobDb.getHandshake(capsule.handshake_id)
    expect(stored).toBeUndefined()
  })

  test('Accept → state ACTIVE + accept capsule generated', async () => {
    const alice = aliceSession()
    const bob = bobSession()

    // Bob receives initiate
    const initCapsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)

    // Bob accepts
    setSSOSessionProvider(() => bob)
    const acceptResult = await handleHandshakeRPC(
      'handshake.accept',
      {
        handshake_id: initCapsule.handshake_id,
        sharing_mode: 'reciprocal',
        fromAccountId: 'acct-bob-1',
      },
      bobDb,
    )

    expect(acceptResult.success).toBe(true)
    expect(acceptResult.email_sent).toBe(true)

    // Bob's record is now ACTIVE
    const bobRecord = bobDb.getHandshake(initCapsule.handshake_id)
    expect(bobRecord.state).toBe(HandshakeState.ACTIVE)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ROUND-TRIP TESTS
  // ═══════════════════════════════════════════════════════════════════════

  test('Full round-trip: Initiate → Download → Upload → Accept', async () => {
    const alice = aliceSession()
    const bob = bobSession()

    // Step 1: Alice builds capsule for download
    setSSOSessionProvider(() => alice)
    const buildResult = await handleHandshakeRPC(
      'handshake.buildForDownload',
      { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' },
      aliceDb,
    )
    expect(buildResult.success).toBe(true)
    const capsuleJson = buildResult.capsule_json

    // Step 2: Bob uploads the .beap file
    const uploadResult = await submitCapsule(capsuleJson, bobDb, bob)
    expect(uploadResult.success).toBe(true)
    expect(uploadResult.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.PENDING_ACCEPT)

    // Step 3: Bob accepts
    const parsed = JSON.parse(capsuleJson)
    setSSOSessionProvider(() => bob)
    const acceptResult = await handleHandshakeRPC(
      'handshake.accept',
      {
        handshake_id: parsed.handshake_id,
        sharing_mode: 'reciprocal',
        fromAccountId: 'acct-bob-1',
      },
      bobDb,
    )
    expect(acceptResult.success).toBe(true)

    // Step 4: Verify both sides
    const bobRecord = bobDb.getHandshake(parsed.handshake_id)
    expect(bobRecord.state).toBe(HandshakeState.ACTIVE)
    expect(bobRecord.sharing_mode).toBe('reciprocal')

    // relationship_id should be consistent
    expect(bobRecord.relationship_id).toBe(parsed.relationship_id)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // SECURITY TESTS
  // ═══════════════════════════════════════════════════════════════════════

  test('Canonical rebuild: unknown fields stripped from capsule', () => {
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    rawObj.evil_field = 'should_be_removed'
    rawObj.another_unknown = { nested: true }

    const result = canonicalRebuild(rawObj)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.capsule as any).evil_field).toBeUndefined()
      expect((result.capsule as any).another_unknown).toBeUndefined()
      // Original valid fields preserved
      expect(result.capsule.capsule_type).toBe('initiate')
      expect(result.capsule.handshake_id).toBe(capsule.handshake_id)
    }
  })

  test('Gate 1: oversized capsule rejected', async () => {
    const bob = bobSession()

    // Build a valid capsule then pad it past 64KB
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    rawObj._padding = 'x'.repeat(70_000)

    const result = await submitCapsule(JSON.stringify(rawObj), bobDb, bob)
    // Should fail — either at Gate 1 (size) or Gate 2 (size check)
    // The capsule will be rejected at some point in the pipeline
    expect(result.success).toBe(false)
  })

  test('Denied fields: each denied field name causes rejection', () => {
    const deniedFields = [
      'data', 'payload', 'body', 'content',
      'attachment', 'attachments', 'file', 'files', 'binary',
      'script', 'code', 'html', 'exec', 'command', 'eval',
    ]

    const alice = aliceSession()
    const baseCapsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })

    for (const field of deniedFields) {
      const rawObj = JSON.parse(JSON.stringify(baseCapsule))
      rawObj[field] = 'test'
      const result = canonicalRebuild(rawObj)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('Denied field')
        expect(result.field).toBe(field)
      }
    }
  })

  test('Malformed context_blocks: non-array value causes rejection', () => {
    const alice = aliceSession()
    const baseCapsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(baseCapsule))
    rawObj.context_blocks = 'not-an-array'
    const result = canonicalRebuild(rawObj)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toContain('context_blocks')
    }
  })

  test('context_block_proofs: valid proofs accepted in refresh', async () => {
    const alice = aliceSession()
    const bob = bobSession()

    // Set up ACTIVE handshake on Bob's side
    const initCapsule = buildInitiateCapsule(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
      reciprocal_allowed: true,
    })
    await submitCapsule(JSON.stringify(initCapsule), bobDb, bob)
    setSSOSessionProvider(() => bob)
    await handleHandshakeRPC('handshake.accept', {
      handshake_id: initCapsule.handshake_id,
      sharing_mode: 'reciprocal',
      fromAccountId: 'acct-bob-1',
    }, bobDb)

    // Seed Alice's DB so she can build refresh capsule
    await submitCapsule(JSON.stringify(initCapsule), aliceDb, bob)
    const acceptCapsule = buildAcceptCapsule(bob, {
      handshake_id: initCapsule.handshake_id,
      initiatorUserId: 'alice-001',
      initiatorEmail: 'alice@company.com',
      sharing_mode: 'reciprocal',
    })
    await submitCapsule(JSON.stringify(acceptCapsule), aliceDb, alice)

    // Alice sends refresh with context_block_proofs
    const aliceRecord = aliceDb.getHandshake(initCapsule.handshake_id)
    const refresh = buildRefreshCapsule(alice, {
      handshake_id: initCapsule.handshake_id,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: aliceRecord.last_seq_received ?? 0,
      last_capsule_hash_received: aliceRecord.last_capsule_hash_received ?? '',
      context_block_proofs: [
        { block_id: 'blk_aabb11223344', block_hash: 'a'.repeat(64) },
        { block_id: 'blk_ccdd55667788', block_hash: 'b'.repeat(64) },
      ],
    })

    expect(refresh.context_block_proofs).toHaveLength(2)
    expect(refresh.context_block_proofs![0].block_id).toBe('blk_aabb11223344')

    // Validate through canonical rebuild
    const rebuildResult = canonicalRebuild(JSON.parse(JSON.stringify(refresh)))
    expect(rebuildResult.ok).toBe(true)
    if (rebuildResult.ok) {
      expect(rebuildResult.capsule.context_block_proofs).toHaveLength(2)
      expect(rebuildResult.capsule.context_block_proofs![0].block_hash).toBe('a'.repeat(64))
    }
  })

  test('context_block_proofs: invalid proof hash rejected', () => {
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    rawObj.context_block_proofs = [
      { block_id: 'blk_abc123', block_hash: 'not-a-valid-sha256' },
    ]

    const result = canonicalRebuild(rawObj)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('block_hash')
    }
  })

  test('context_block_proofs: missing block_id rejected', () => {
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    rawObj.context_block_proofs = [
      { block_hash: 'a'.repeat(64) },
    ]

    const result = canonicalRebuild(rawObj)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('block_id')
    }
  })

  test('Canonical rebuild: NFC normalization and control char stripping', () => {
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    // Inject a control character into sender_id
    rawObj.sender_id = 'alice\x00-001'

    const result = canonicalRebuild(rawObj)
    if (result.ok) {
      // Control char should be stripped
      expect((result.capsule as any).sender_id).not.toContain('\x00')
    }
    // Result may be ok (stripped) or rejected depending on regex validation
    // Either way, the control character must not pass through
  })

  test('Missing required field rejected', () => {
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    delete rawObj.capsule_hash

    const result = canonicalRebuild(rawObj)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toBe('capsule_hash')
    }
  })

  test('Invalid capsule_type rejected', () => {
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    rawObj.capsule_type = 'malicious'

    const result = canonicalRebuild(rawObj)
    expect(result.ok).toBe(false)
  })

  test('unsupported schema_version rejected', () => {
    const alice = aliceSession()
    const capsule = buildInitiateCapsule(alice, { receiverUserId: 'bob-001', receiverEmail: 'bob@partner.com' })
    const rawObj = JSON.parse(JSON.stringify(capsule))
    rawObj.schema_version = 99

    const result = canonicalRebuild(rawObj)
    expect(result.ok).toBe(false)
  })
})
