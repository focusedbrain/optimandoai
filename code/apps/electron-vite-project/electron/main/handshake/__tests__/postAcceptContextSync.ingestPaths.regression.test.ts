/**
 * Regression: inbound accept → ACCEPTED on the initiator must trigger the shared
 * `maybeEnqueueInitialContextSyncAfterInboundAccept` / `tryEnqueueContextSync` path from
 * every ingest transport (coordination WS, ingestion RPC, relay pull, P2P HTTP).
 *
 * Avoid `import from 'node:os'` — in this package Vitest can resolve `os` to
 * `vite-electron-renderer` shims that use `require` and break collection.
 * Use `process.env.TEMP` / `TMPDIR` in the Electron mock instead (same goal as
 * counterpartyKeyBinding.regression.test.ts).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP ?? process.env.TMPDIR ?? '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  BrowserWindow: class {
    webContents = { send: () => undefined }
    static getAllWindows() {
      return []
    }
  },
}))

import { buildInitiateCapsuleWithKeypair, buildAcceptCapsule } from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { getHandshakeRecord } from '../db'
import { persistInitiatorHandshakeRecord } from '../initiatorPersist'
import { processCoordinationInboundCapsuleForTest } from '../../p2p/coordinationWs'
import { getNextStateAfterInboundContextSync } from '../contextSyncActiveGate'
import type { SSOSession } from '../types'
import { HandshakeState, type HandshakeRecord } from '../types'
import { vaultService } from '../../vault/rpc'

function senderSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'sender-001',
    email: 'sender@example.com',
    sub: 'sender-001',
  })
}

function receiverSession(): SSOSession {
  return buildTestSession({
    wrdesk_user_id: 'receiver-001',
    email: 'receiver@example.com',
    sub: 'receiver-001',
  })
}

async function submitCapsuleJson(
  body: string,
  db: any,
  session: SSOSession,
  sourceType: 'internal' | 'relay_pull' = 'internal',
) {
  return handleIngestionRPC(
    'ingestion.ingest',
    {
      rawInput: { body, mime_type: 'application/vnd.beap+json' },
      sourceType: sourceType as any,
      transportMeta: { channel_id: 'test', mime_type: 'application/vnd.beap+json' },
    },
    db,
    session,
  )
}

describe('post-accept initial context_sync — ingest path regressions', () => {
  let senderDb: ReturnType<typeof createHandshakeTestDb>
  let receiverDb: ReturnType<typeof createHandshakeTestDb>
  let vaultStatusSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    senderDb = createHandshakeTestDb()
    receiverDb = createHandshakeTestDb()
    migrateIngestionTables(senderDb)
    migrateIngestionTables(receiverDb)
    vaultStatusSpy = vi.spyOn(vaultService, 'getStatus').mockReturnValue({ isUnlocked: true } as any)
  })

  afterEach(() => {
    vaultStatusSpy.mockRestore()
  })

  /** Two machines: initiator row on senderDb via persistInitiatorHandshakeRecord; receiver ingests initiate on receiverDb. */
  async function seedCrossPrincipalInitiate(sender: SSOSession, receiver: SSOSession) {
    const { capsule: initiate, keypair } = buildInitiateCapsuleWithKeypair(sender, {
      receiverUserId: receiver.wrdesk_user_id,
      receiverEmail: receiver.email,
    })
    const persisted = persistInitiatorHandshakeRecord(senderDb, initiate, sender, [], keypair)
    expect(persisted.success).toBe(true)

    const recvRes = await submitCapsuleJson(JSON.stringify(initiate), receiverDb, receiver)
    expect(recvRes.success).toBe(true)
    return { initiate, keypair }
  }

  /**
   * `tryEnqueueContextSync` is invoked inside `maybeEnqueueInitialContextSyncAfterInboundAccept` (same module);
   * spying the export does not see those calls. Durable `last_seq_sent` / `last_capsule_hash_sent` on the row
   * prove the enqueue path ran (see `updateHandshakeContextSyncEnqueued` in production).
   */
  function assertDurableInitialContextSyncEnqueued(db: ReturnType<typeof createHandshakeTestDb>, handshakeId: string) {
    const row = getHandshakeRecord(db, handshakeId)
    expect(row?.last_seq_sent).toBeGreaterThanOrEqual(1)
    expect(row?.last_capsule_hash_sent).toMatch(/^[0-9a-f]{64}$/)
  }

  /**
   * Coordination WS push path: `processCapsuleInternal` → successful accept on initiator → shared hook.
   */
  test('postAccept_coordination_ws_inbound_push_calls_tryEnqueueContextSync_and_enqueues_context_sync', async () => {
    const sender = senderSession()
    const receiver = receiverSession()
    const { initiate } = await seedCrossPrincipalInitiate(sender, receiver)

    const { capsule: accept } = buildAcceptCapsule(receiver, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: sender.wrdesk_user_id,
      initiatorEmail: sender.email,
      sharing_mode: 'receive-only',
      initiator_capsule_hash: initiate.capsule_hash,
    })

    await processCoordinationInboundCapsuleForTest('coord-ws-msg-1', accept, senderDb, sender)

    assertDurableInitialContextSyncEnqueued(senderDb, initiate.handshake_id)
  })

  /**
   * Normal cross-principal path via `handleIngestionRPC` (internal sourceType).
   */
  test('postAccept_ingestion_rpc_calls_tryEnqueueContextSync_after_initiator_inbound_accept', async () => {
    const sender = senderSession()
    const receiver = receiverSession()
    const { initiate } = await seedCrossPrincipalInitiate(sender, receiver)

    const { capsule: accept } = buildAcceptCapsule(receiver, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: sender.wrdesk_user_id,
      initiatorEmail: sender.email,
      sharing_mode: 'receive-only',
      initiator_capsule_hash: initiate.capsule_hash,
    })

    const acceptRes = await submitCapsuleJson(JSON.stringify(accept), senderDb, sender)

    expect(acceptRes.success).toBe(true)
    expect(acceptRes.handshake_result?.handshakeRecord?.state).toBe(HandshakeState.ACCEPTED)
    expect(acceptRes.handshake_result?.handshakeRecord?.local_role).toBe('initiator')

    assertDurableInitialContextSyncEnqueued(senderDb, initiate.handshake_id)
  })

  /**
   * Relay pull uses `sourceType: 'relay_pull'` through the same `handleIngestionRPC` gate.
   */
  test('postAccept_relay_pull_source_ingest_calls_tryEnqueueContextSync_after_inbound_accept', async () => {
    const sender = senderSession()
    const receiver = receiverSession()
    const { initiate } = await seedCrossPrincipalInitiate(sender, receiver)

    const { capsule: accept } = buildAcceptCapsule(receiver, {
      handshake_id: initiate.handshake_id,
      initiatorUserId: sender.wrdesk_user_id,
      initiatorEmail: sender.email,
      sharing_mode: 'receive-only',
      initiator_capsule_hash: initiate.capsule_hash,
    })

    const acceptRes = await submitCapsuleJson(JSON.stringify(accept), senderDb, sender, 'relay_pull')

    expect(acceptRes.success).toBe(true)
    assertDurableInitialContextSyncEnqueued(senderDb, initiate.handshake_id)
  })

  /**
   * End-to-end gate (transport-agnostic): acceptor has durably sent its own context_sync but
   * has not yet ingested the initiator’s; remains ACCEPTED until peer seq 1 is applied.
   */
  test('postAccept_e2e_acceptor_stays_accepted_until_peer_context_sync_then_active', () => {
    const acceptor: HandshakeRecord = {
      handshake_id: 'hs-e2e',
      relationship_id: 'rel-e2e',
      state: HandshakeState.ACCEPTED,
      initiator: {
        email: 'alice@example.com',
        wrdesk_user_id: 'alice',
        iss: 'i',
        sub: 'alice',
      },
      acceptor: { email: 'bob@example.com', wrdesk_user_id: 'bob', iss: 'i', sub: 'bob' },
      local_role: 'acceptor',
      sharing_mode: 'receive-only',
      reciprocal_allowed: false,
      tier_snapshot: { plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
      current_tier_signals: { plan: 'free', hardwareAttestation: null, dnsVerification: null, wrStampStatus: null },
      last_seq_sent: 1,
      last_seq_received: 0,
      last_capsule_hash_sent: 'a'.repeat(64),
      last_capsule_hash_received: 'b'.repeat(64),
      effective_policy: {
        allowedScopes: ['*'],
        allowsCloudEscalation: false,
        allowsExport: false,
        effectiveExternalProcessing: 'none',
      },
      external_processing: 'none',
      created_at: new Date().toISOString(),
      activated_at: new Date().toISOString(),
      expires_at: null,
      revoked_at: null,
      revocation_source: null,
      initiator_wrdesk_policy_hash: '',
      initiator_wrdesk_policy_version: '',
      acceptor_wrdesk_policy_hash: '',
      acceptor_wrdesk_policy_version: '',
      initiator_context_commitment: null,
      acceptor_context_commitment: null,
      p2p_endpoint: null,
      counterparty_p2p_token: null,
      local_public_key: '00'.repeat(32),
      local_private_key: '11'.repeat(32),
      counterparty_public_key: '22'.repeat(32),
      receiver_email: null,
    } as HandshakeRecord

    expect(acceptor.state).toBe(HandshakeState.ACCEPTED)
    expect(getNextStateAfterInboundContextSync(acceptor, 0)).toBe(HandshakeState.ACCEPTED)
    expect(getNextStateAfterInboundContextSync(acceptor, 1)).toBe(HandshakeState.ACTIVE)
  })
})
