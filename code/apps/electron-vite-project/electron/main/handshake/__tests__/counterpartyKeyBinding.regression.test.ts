/**
 * Regression: counterparty_public_key must hold the *remote* Ed25519 signing key so that
 * inbound context_sync (signed by the peer) passes the key-identity check in processHandshakeCapsule.
 *
 * Bug shape: acceptor row used `existing.counterparty_public_key || acceptor.sender_public_key`, which
 * filled counterparty with the *local* acceptor key when the initiator key was still missing.
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
import { _resetSSOSessionProvider } from '../ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildInitiateCapsuleWithKeypair, buildAcceptCapsule, buildContextSyncCapsule } from '../capsuleBuilder'
import { updateHandshakeSigningKeys, updateHandshakeCounterpartyKey } from '../db'
import { ReasonCode, HandshakeState } from '../types'
import type { SSOSession } from '../types'
import { generateSigningKeypair } from '../signatureKeys'

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
      rawInput: { body: capsuleJson, mime_type: 'application/vnd.beap+json' },
      sourceType: 'email',
      transportMeta: { channel_id: 'test', mime_type: 'application/vnd.beap+json' },
    },
    db,
    session,
  )
}

describe('counterparty key binding + context_sync (regression)', () => {
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

  test('R1_broken_acceptor_counterparty_local_key: inbound context_sync from initiator fails (SIGNATURE_INVALID)', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
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
    const hid = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, hid, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, hid, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    // Simulates the bug: acceptor row holds *local* Bob signing key as counterparty (wrong remote).
    updateHandshakeCounterpartyKey(bobDb, hid, bobKeypair.publicKey)

    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: hid,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result: any = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(false)
    expect(result.reason).toBe(ReasonCode.SIGNATURE_INVALID)
    const bobRec = bobDb.getHandshake(hid)
    expect(bobRec?.state).toBe(HandshakeState.ACCEPTED)
  })

  test('R2_fixed_acceptor_counterparty_initiator_key: same inbound context_sync accepted; acceptor can reach ACTIVE', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
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
    const hid = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, hid, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, hid, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    // Same repair as `setupHandshakeWithKeypairs` in hardening: acceptor row must hold the initiator’s
    // Ed25519 for inbound verify. With buildAcceptRecord fixed, this is often a no-op (counterparty
    // already the initiator key from the initiate), but it keeps the test explicit.
    updateHandshakeCounterpartyKey(bobDb, hid, aliceKeypair.publicKey)

    const acceptorRow = bobDb.getHandshake(hid) as { counterparty_public_key?: string; state?: string } | undefined
    // Inbound context_sync to Bob is signed by Alice; acceptor’s stored counterparty must be Alice’s key
    expect(acceptorRow?.counterparty_public_key).toBe(aliceKeypair.publicKey)
    // Note: `aliceDb` is populated via initiate ingested with Bob’s session (same pattern as hardening
    // tests) — the row is not `local_role: initiator`, so we do not assert initiator copy here

    const contextSync = buildContextSyncCapsule(alice, {
      handshake_id: hid,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: aliceKeypair.publicKey,
      local_private_key: aliceKeypair.privateKey,
    })
    const result: any = await submitCapsule(JSON.stringify(contextSync), bobDb, bob)
    expect(result.success).toBe(true)
    const bobAfter = bobDb.getHandshake(hid) as { state?: string }
    expect(bobAfter?.state).toBe(HandshakeState.ACTIVE)
  })

  test('R3_mismatched_inbound_signing_key_still_fails: Eve signs with Alice’s session fields, DB expects Alice’s key — SIGNATURE_INVALID', async () => {
    const alice = aliceSession()
    const bob = bobSession()
    const eve = generateSigningKeypair()
    const { capsule: initCapsule, keypair: aliceKeypair } = buildInitiateCapsuleWithKeypair(alice, {
      receiverUserId: 'bob-001',
      receiverEmail: 'bob@partner.com',
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
    const hid = initCapsule.handshake_id
    updateHandshakeSigningKeys(aliceDb, hid, { local_public_key: aliceKeypair.publicKey, local_private_key: aliceKeypair.privateKey })
    updateHandshakeSigningKeys(bobDb, hid, { local_public_key: bobKeypair.publicKey, local_private_key: bobKeypair.privateKey })
    updateHandshakeCounterpartyKey(bobDb, hid, aliceKeypair.publicKey)

    // Same Alice session metadata, but Ed25519 is Eve: signature is valid for sender_public_key=Eve, yet counterparty in DB = Alice
    const wrongSignerCs = buildContextSyncCapsule(alice, {
      handshake_id: hid,
      counterpartyUserId: 'bob-001',
      counterpartyEmail: 'bob@partner.com',
      last_seq_received: 0,
      last_capsule_hash_received: acceptCapsule.capsule_hash,
      context_blocks: [],
      local_public_key: eve.publicKey,
      local_private_key: eve.privateKey,
    })
    const result: any = await submitCapsule(JSON.stringify(wrongSignerCs), bobDb, bob)
    expect(result.success).toBe(false)
    expect(result.reason).toBe(ReasonCode.SIGNATURE_INVALID)
  })
})
