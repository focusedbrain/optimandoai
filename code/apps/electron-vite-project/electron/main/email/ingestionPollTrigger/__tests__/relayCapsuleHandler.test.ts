/**
 * A4 — sandbox sealed relay receive: open, idempotent poll, seal result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../../handshake/types'
import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'
import {
  openServiceRpcPayload,
  sealServiceRpcPayload,
} from '../../../serviceRpc/sealedServiceRpc'
import { buildSealedServiceRpcRelayCapsule } from '../relaySend'
import { makeIngestionPollRequestWire } from '../receiver'
import {
  _resetPollIdempotencyCacheForTests,
} from '../pollIdempotencyCache'
import {
  _setIngestionPollRelayHandlerDepsForTests,
  handleIngestionPollRelayCapsule,
  tryHandleIngestionPollRelayCapsule,
} from '../relayCapsuleHandler'
import { INGESTION_POLL_SCHEMA_VERSION } from '../wire'

const getInstanceId = vi.hoisted(() => vi.fn(() => 'dev-sand-1'))
const sendSealedRelay = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })))

vi.mock('../../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceId(),
}))

vi.mock('../relaySend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relaySend')>()
  return {
    ...actual,
    sendSealedServiceRpcViaCoordinationRelay: (...args: unknown[]) => sendSealedRelay(...args),
  }
})

function makeX25519Pair() {
  const priv = x25519.utils.randomPrivateKey()
  const pub = x25519.getPublicKey(priv)
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(pub).toString('base64'),
  }
}

const hostKeys = makeX25519Pair()
const sandboxKeys = makeX25519Pair()
const handshakeId = 'hs-a4-relay'

function party(uid: string) {
  return { email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

const hostRecord = {
  handshake_id: handshakeId,
  handshake_type: 'internal',
  state: HandshakeState.ACTIVE,
  local_role: 'initiator',
  initiator: party('u1'),
  acceptor: party('u1'),
  internal_coordination_identity_complete: true,
  internal_coordination_repair_needed: false,
  initiator_coordination_device_id: 'dev-ws-1',
  acceptor_coordination_device_id: 'dev-sand-1',
  initiator_device_role: 'host',
  acceptor_device_role: 'sandbox',
  peer_x25519_public_key_b64: sandboxKeys.pubB64,
  local_x25519_private_key_b64: hostKeys.privB64,
  local_x25519_public_key_b64: hostKeys.pubB64,
} as HandshakeRecord

const sandboxRecord = {
  handshake_id: handshakeId,
  handshake_type: 'internal',
  state: HandshakeState.ACTIVE,
  local_role: 'acceptor',
  initiator: party('u1'),
  acceptor: party('u1'),
  internal_coordination_identity_complete: true,
  internal_coordination_repair_needed: false,
  initiator_coordination_device_id: 'dev-ws-1',
  acceptor_coordination_device_id: 'dev-sand-1',
  initiator_device_role: 'host',
  acceptor_device_role: 'sandbox',
  peer_x25519_public_key_b64: hostKeys.pubB64,
  local_x25519_private_key_b64: sandboxKeys.privB64,
  local_x25519_public_key_b64: sandboxKeys.pubB64,
} as HandshakeRecord

function sealHostRequest(req: ReturnType<typeof makeIngestionPollRequestWire>): Record<string, unknown> {
  const sealed = sealServiceRpcPayload(hostRecord, {
    handshake_id: handshakeId,
    sender_device_id: 'dev-ws-1',
    receiver_device_id: 'dev-sand-1',
    plaintextJson: req,
  })
  if (!sealed.ok) throw new Error(sealed.message)
  return buildSealedServiceRpcRelayCapsule(sealed.envelope)
}

describe('handleIngestionPollRelayCapsule (A4)', () => {
  const runPoll = vi.fn()
  const sendAck = vi.fn()

  beforeEach(() => {
    runPoll.mockReset()
    sendAck.mockReset()
    sendSealedRelay.mockReset()
    sendSealedRelay.mockResolvedValue({ ok: true })
    _resetPollIdempotencyCacheForTests()
    _setIngestionPollRelayHandlerDepsForTests(null)
    getInstanceId.mockReturnValue('dev-sand-1')
    runPoll.mockResolvedValue({
      status: 'ok',
      fetched: 2,
      depackaged: 2,
      delivered: 1,
      held: 0,
    })
  })

  it('opens sealed request, runs poll once, sends sealed result (no plaintext on wire)', async () => {
    const req = makeIngestionPollRequestWire({
      handshake_id: handshakeId,
      account_id: 'acc-a4',
      sender_device_id: 'dev-ws-1',
      target_device_id: 'dev-sand-1',
      request_id: 'req-a4-1',
    })
    const capsule = sealHostRequest(req)

    await handleIngestionPollRelayCapsule(
      {
        relayMessageId: 'relay-1',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      {
        getRecord: () => sandboxRecord,
        receiverDeps: { runPoll, db: {}, buildDeps: () => ({}) },
        sendSealedRelay: async (...args) => sendSealedRelay(...args),
      },
    )

    expect(runPoll).toHaveBeenCalledTimes(1)
    expect(sendAck).toHaveBeenCalledWith(['relay-1'])
    expect(sendSealedRelay).toHaveBeenCalledTimes(1)

    const [, , responseEnvelope] = sendSealedRelay.mock.calls[0] as [
      unknown,
      HandshakeRecord,
      ReturnType<typeof sealServiceRpcPayload> extends { ok: true; envelope: infer E } ? E : never,
    ]
    expect(responseEnvelope.envelope_type).toBe(SEALED_SERVICE_RPC_CAPSULE_TYPE)
    expect(responseEnvelope).not.toHaveProperty('type')

    const opened = openServiceRpcPayload(hostRecord, responseEnvelope)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const inner = JSON.parse(opened.plaintextJson) as Record<string, unknown>
    expect(inner.type).toBe('ingestion_poll_result')
    expect(inner.request_id).toBe('req-a4-1')
    expect(inner.fetched).toBe(2)
    expect(inner.delivered).toBe(1)
  })

  it('duplicate request_id returns cached outcome without re-running provider fetch', async () => {
    const req = makeIngestionPollRequestWire({
      handshake_id: handshakeId,
      account_id: 'acc-dup',
      sender_device_id: 'dev-ws-1',
      target_device_id: 'dev-sand-1',
      request_id: 'req-dup-1',
    })
    const capsule = sealHostRequest(req)
    const ctx = {
      relayMessageId: 'relay-dup',
      capsule,
      db: {},
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck: vi.fn(),
      getOidcToken: async () => 'tok',
    }
    const deps = {
      getRecord: () => sandboxRecord,
      receiverDeps: { runPoll, db: {}, buildDeps: () => ({}) },
      sendSealedRelay: async (...args: unknown[]) => sendSealedRelay(...args),
    }

    await handleIngestionPollRelayCapsule(ctx, deps)
    await handleIngestionPollRelayCapsule({ ...ctx, relayMessageId: 'relay-dup-2', sendAck: vi.fn() }, deps)

    expect(runPoll).toHaveBeenCalledTimes(1)
    expect(sendSealedRelay).toHaveBeenCalledTimes(2)
  })

  it('forbidden inner type is rejected without running poll', async () => {
    const forbidden = {
      type: 'ingestion_poll_result',
      schema_version: INGESTION_POLL_SCHEMA_VERSION,
      request_id: 'req-bad-inner',
      handshake_id: handshakeId,
      sender_device_id: 'dev-ws-1',
      target_device_id: 'dev-sand-1',
      created_at: new Date().toISOString(),
      account_id: 'acc-x',
      poll_status: 'ok',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
    }
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'dev-ws-1',
      receiver_device_id: 'dev-sand-1',
      plaintextJson: forbidden,
    })
    if (!sealed.ok) throw new Error(sealed.message)
    const capsule = buildSealedServiceRpcRelayCapsule(sealed.envelope)

    await handleIngestionPollRelayCapsule(
      {
        relayMessageId: 'relay-bad',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      {
        getRecord: () => sandboxRecord,
        receiverDeps: { runPoll, db: {}, buildDeps: () => ({}) },
        sendSealedRelay: async (...args: unknown[]) => sendSealedRelay(...args),
      },
    )

    expect(runPoll).not.toHaveBeenCalled()
    expect(sendSealedRelay).toHaveBeenCalledTimes(1)
    const [, , responseEnvelope] = sendSealedRelay.mock.calls[0] as [unknown, HandshakeRecord, { ciphertext_b64: string }]
    const opened = openServiceRpcPayload(hostRecord, {
      ...responseEnvelope,
      envelope_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
      schema_version: 1,
      handshake_id: handshakeId,
      sender_device_id: 'dev-sand-1',
      receiver_device_id: 'dev-ws-1',
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(JSON.parse(opened.plaintextJson).type).toBe('ingestion_poll_error')
  })

  it('unopenable capsule is rejected without running poll or sending response', async () => {
    const req = makeIngestionPollRequestWire({
      handshake_id: handshakeId,
      account_id: 'acc-bad-cipher',
      sender_device_id: 'dev-ws-1',
      target_device_id: 'dev-sand-1',
    })
    const capsule = sealHostRequest(req)
    capsule.ciphertext_b64 = Buffer.from('bad').toString('base64')

    await handleIngestionPollRelayCapsule(
      {
        relayMessageId: 'relay-unopen',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      {
        getRecord: () => sandboxRecord,
        receiverDeps: { runPoll, db: {}, buildDeps: () => ({}) },
      },
    )

    expect(runPoll).not.toHaveBeenCalled()
    expect(sendSealedRelay).not.toHaveBeenCalled()
    expect(sendAck).toHaveBeenCalledWith(['relay-unopen'])
  })

  it('tryHandleIngestionPollRelayCapsule returns false for non-sealed capsules', async () => {
    const handled = await tryHandleIngestionPollRelayCapsule({
      relayMessageId: 'relay-other',
      capsule: { capsule_type: 'context_sync', handshake_id: handshakeId },
      db: {},
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    })
    expect(handled).toBe(false)
    expect(sendAck).not.toHaveBeenCalled()
  })
})
