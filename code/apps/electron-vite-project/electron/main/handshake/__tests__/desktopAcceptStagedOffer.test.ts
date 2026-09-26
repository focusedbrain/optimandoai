/**
 * Desktop accept of a staged Connect offer, pinned to the rendered preview (HC5).
 *
 * Since Phase 4 an inbound initiate is staged and has no relationship record
 * until consent. The desktop `handshake:accept` must therefore reach the
 * consent path for a staged offer, and it must consent only against the
 * preview the dialog showed: the pending list carries the preview and its
 * hash, the accept returns the hash, consent refuses any other preview.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { handleHandshakeRPC, setSSOSessionProvider, _resetSSOSessionProvider } from '../ipc'
import { setEmailSendFn, _resetEmailSendFn } from '../emailTransport'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import { buildInitiateCapsule } from '../capsuleBuilder'
import { handleIngestionRPC } from '../../ingestion/ipc'
import { getHandshakeRecord } from '../db'
import { buildConnectOfferPreview } from '../connectOfferStaging'
import { pendingOfferForHandshake } from '../formationPipeline'
import { resolveDesktopAcceptTarget, desktopAcceptPreviewPinError } from '../desktopAcceptTarget'
import { installInMemoryConnectOffers, uninstallInMemoryConnectOffers, submitCapsuleThroughConsentGate } from './connectOfferConsentTestKit'
import { MOCK_EXTENSION_X25519_PUBLIC_B64 } from './mockKeypair'
import type { SSOSession } from '../types'

const here = dirname(fileURLToPath(import.meta.url))

function senderSession(): SSOSession {
  return buildTestSession({ wrdesk_user_id: 'sender-001', email: 'sender@test.com', sub: 'sender-001' })
}

function receiverSession(): SSOSession {
  return buildTestSession({ wrdesk_user_id: 'receiver-001', email: 'receiver@test.com', sub: 'receiver-001' })
}

function initiateJson(): { handshakeId: string; json: string } {
  const receiver = receiverSession()
  const capsule = buildInitiateCapsule(senderSession(), {
    receiverUserId: receiver.wrdesk_user_id,
    receiverEmail: receiver.email,
  })
  return { handshakeId: capsule.handshake_id, json: JSON.stringify(capsule) }
}

describe('desktop accept of a staged Connect offer (HC5)', () => {
  let db: ReturnType<typeof createHandshakeTestDb>
  const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: 'email-hc5' })

  beforeEach(() => {
    installInMemoryConnectOffers()
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetSSOSessionProvider()
    _resetEmailSendFn()
    setEmailSendFn(mockSend)
    mockSend.mockClear()
    setSSOSessionProvider(() => receiverSession())
  })

  afterEach(() => uninstallInMemoryConnectOffers())

  async function stageInbound(): Promise<string> {
    const { handshakeId, json } = initiateJson()
    const staged = await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput: { body: json, mime_type: 'application/vnd.beap+json' },
        sourceType: 'internal',
        transportMeta: { channel_id: 'test-hc5' },
      },
      db,
      receiverSession(),
    )
    expect(staged?.handshake_result?.staged).toBe(true)
    expect(getHandshakeRecord(db, handshakeId)).toBeNull()
    return handshakeId
  }

  async function listedOffer(handshakeId: string): Promise<any> {
    const listed = await handleHandshakeRPC('handshake.list', {}, db)
    return (listed.records as any[]).find((r) => r.handshake_id === handshakeId)
  }

  test('a staged offer resolves as an accept target instead of "not found"', async () => {
    const handshakeId = await stageInbound()
    expect(resolveDesktopAcceptTarget(db, handshakeId)).toEqual({
      kind: 'staged_offer',
      samePrincipal: false,
      localRole: 'acceptor',
    })
    expect(resolveDesktopAcceptTarget(db, 'hs-nonexistent')).toBeNull()
  })

  test('an existing record resolves as a record target', async () => {
    const { handshakeId, json } = initiateJson()
    const formed = await submitCapsuleThroughConsentGate(json, db, receiverSession(), { sourceType: 'internal' })
    expect(formed?.success).toBe(true)
    expect(resolveDesktopAcceptTarget(db, handshakeId)).toMatchObject({ kind: 'record', samePrincipal: false })
  })

  test('the desktop path requires the preview hash for staged offers only', () => {
    const staged = { kind: 'staged_offer', samePrincipal: false, localRole: 'acceptor' } as const
    const record = { kind: 'record', samePrincipal: false, localRole: 'acceptor' } as const
    expect(desktopAcceptPreviewPinError(staged, undefined)).toBe('PREVIEW_HASH_REQUIRED')
    expect(desktopAcceptPreviewPinError(staged, 'deadbeef')).toBe('PREVIEW_HASH_REQUIRED')
    expect(desktopAcceptPreviewPinError(staged, 'AB'.repeat(32))).toBe('PREVIEW_HASH_REQUIRED')
    expect(desktopAcceptPreviewPinError(staged, 'ab'.repeat(32))).toBeNull()
    expect(desktopAcceptPreviewPinError(record, undefined)).toBeNull()
  })

  test('the pending list carries the preview the consent recomputes', async () => {
    const handshakeId = await stageInbound()
    const row = await listedOffer(handshakeId)
    expect(row?.connect_offer_id).toBeTruthy()
    const offer = pendingOfferForHandshake(handshakeId)!
    const expected = buildConnectOfferPreview(offer as any)
    expect(row.connect_offer_preview).toEqual({ preview: expected.preview, preview_hash: expected.preview_hash })
    expect(row.connect_offer_preview.preview.bound_definition.sender_email).toBe('sender@test.com')
  })

  test('accept with the listed preview hash forms the relationship', async () => {
    const handshakeId = await stageInbound()
    const row = await listedOffer(handshakeId)
    const result = await handleHandshakeRPC(
      'handshake.accept',
      {
        handshake_id: handshakeId,
        sharing_mode: 'reciprocal',
        fromAccountId: '',
        senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
        expected_preview_hash: row.connect_offer_preview.preview_hash,
      },
      db,
    )
    expect(result.success).toBe(true)
    expect(getHandshakeRecord(db, handshakeId)).not.toBeNull()
    expect(pendingOfferForHandshake(handshakeId)).toBeNull()
  })

  test('accept against a different preview is refused and forms nothing', async () => {
    const handshakeId = await stageInbound()
    const result = await handleHandshakeRPC(
      'handshake.accept',
      {
        handshake_id: handshakeId,
        sharing_mode: 'reciprocal',
        fromAccountId: '',
        senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64,
        expected_preview_hash: '0'.repeat(64),
      },
      db,
    )
    expect(result.success).toBe(false)
    expect(result.reason).toBe('PREVIEW_HASH_MISMATCH')
    expect(getHandshakeRecord(db, handshakeId)).toBeNull()
    // The offer stays pending: the user can reopen it and review the current preview.
    expect(pendingOfferForHandshake(handshakeId)).not.toBeNull()
    expect((await listedOffer(handshakeId))?.connect_offer_id).toBeTruthy()
  })
})

describe('main-process handshake:accept handler (source guard)', () => {
  const mainSource = readFileSync(join(here, '..', '..', '..', 'main.ts'), 'utf8')
  const start = mainSource.indexOf("ipcMain.handle('handshake:accept'")
  const handler = mainSource.slice(start, mainSource.indexOf('ipcMain.handle(', start + 1))

  test('resolves staged offers and enforces the preview pin before accepting', () => {
    expect(start).toBeGreaterThan(-1)
    expect(handler).toContain('resolveDesktopAcceptTarget(db, id)')
    expect(handler).toContain('desktopAcceptPreviewPinError(acceptTarget, contextOpts?.expected_preview_hash)')
    expect(handler).toContain('params.expected_preview_hash = contextOpts.expected_preview_hash')
    expect(handler.indexOf('desktopAcceptPreviewPinError(')).toBeLessThan(handler.indexOf("handleHandshakeRPC('handshake.accept'"))
  })

  test('does not answer "not found" from the relationship store alone', () => {
    expect(handler).not.toMatch(/getHandshakeRecord\(db,\s*id\)/)
  })
})
