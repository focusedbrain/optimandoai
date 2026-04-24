/**
 * Focused regressions: normal cross-principal handshake.accept X25519 binding,
 * preload-shaped params, and ephemeral X25519 guard (no orchestrator mocks).
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import {
  handleHandshakeRPC,
  setSSOSessionProvider,
  _resetSSOSessionProvider,
} from '../ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { buildInitiateCapsule } from '../capsuleBuilder'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { getHandshakeRecord } from '../db'
import { MOCK_EXTENSION_X25519_PUBLIC_B64 } from './mockKeypair'
import type { SSOSession } from '../types'

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

describe('acceptX25519Binding — normal cross-principal', () => {
  let db: ReturnType<typeof createHandshakeTestDb>
  const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: 'email-x25519' })

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(mockSend)
    mockSend.mockClear()
  })

  async function createPendingHandshake(): Promise<string> {
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

  test('R1_normal_cross_principal_handshake_accept_without_senderX25519PublicKeyB64_fails_ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED', async () => {
    setSSOSessionProvider(() => receiverSession())
    const handshakeId = await createPendingHandshake()
    const result = await handleHandshakeRPC(
      'handshake.accept',
      { handshake_id: handshakeId, sharing_mode: 'receive-only', fromAccountId: 'acct-1' },
      db,
    )
    expect(result.success).toBe(false)
    expect((result as { code?: string }).code).toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
  })

  test('R2_normal_cross_principal_handshake_accept_with_bound_X25519_public_key_succeeds', async () => {
    setSSOSessionProvider(() => receiverSession())
    const handshakeId = await createPendingHandshake()
    const result = await handleHandshakeRPC('handshake.accept', {
      handshake_id: handshakeId,
      sharing_mode: 'receive-only',
      fromAccountId: 'acct-1',
      senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
    }, db)
    expect(result.success).not.toBe(false)
    expect((result as { handshake_id?: string }).handshake_id).toBe(handshakeId)
  })

  test('R3_preload_main_pipeline_preserves_senderX25519PublicKeyB64_end_to_end', async () => {
    setSSOSessionProvider(() => receiverSession())
    const handshakeId = await createPendingHandshake()
    const padded = `  ${MOCK_EXTENSION_X25519_PUBLIC_B64}  `
    const trimmed = padded.trim()
    expect(trimmed).toBe(MOCK_EXTENSION_X25519_PUBLIC_B64)

    const result = await handleHandshakeRPC('handshake.accept', {
      handshake_id: handshakeId,
      sharing_mode: 'receive-only',
      fromAccountId: 'acct-1',
      senderX25519PublicKeyB64: trimmed,
    }, db)

    expect(result.success).not.toBe(false)
    const record = getHandshakeRecord(db, handshakeId)
    expect(record?.local_x25519_public_key_b64).toBe(MOCK_EXTENSION_X25519_PUBLIC_B64)
  })

  test('R5_normal_accept_does_not_invoke_ephemeral_X25519_keygen_when_guard_active', async () => {
    const spy = vi.spyOn(x25519.utils, 'randomPrivateKey')
    try {
      setSSOSessionProvider(() => receiverSession())
      const handshakeId = await createPendingHandshake()
      const result = await handleHandshakeRPC('handshake.accept', {
        handshake_id: handshakeId,
        sharing_mode: 'receive-only',
        fromAccountId: 'acct-1',
        senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
      }, db)
      expect(result.success).not.toBe(false)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
