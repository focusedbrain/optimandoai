/**
 * A5 — host sealed relay result: open, match pending, ack, async UI notify.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../../handshake/types'
import { sealServiceRpcPayload } from '../../../serviceRpc/sealedServiceRpc'
import { buildSealedServiceRpcRelayCapsule } from '../relaySend'
import { makeIngestionPollRequestWire } from '../receiver'
import { INGESTION_POLL_SCHEMA_VERSION } from '../wire'
import {
  _resetHostIngestionPollAcksForTests,
  getLastHostIngestionPollAck,
} from '../hostAckStore'
import {
  _resetHostIngestionPollPendingForTests,
  registerHostIngestionPollPending,
} from '../hostPendingStore'
import {
  _resetHostIngestionPollCompletionForTests,
  waitForHostIngestionPollResult,
} from '../hostIngestionPollCompletion'
import {
  _setIngestionPollResultRelayHandlerDepsForTests,
  mapIngestionPollWireToHostAck,
  tryHandleIngestionPollResultRelayCapsule,
} from '../relayResultCapsuleHandler'
import type { IngestionPollErrorWire, IngestionPollResultWire } from '../wire'

const getInstanceId = vi.hoisted(() => vi.fn(() => 'dev-ws-1'))
const isEffectiveSandboxNode = vi.hoisted(() => vi.fn((_db: unknown) => false))
const webContentsSend = vi.hoisted(() => vi.fn())

vi.mock('../../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceId(),
}))

vi.mock('../../../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: (db: unknown) => isEffectiveSandboxNode(db),
}))

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>()
  return {
    ...actual,
    BrowserWindow: {
      getAllWindows: () => [
        {
          isDestroyed: () => false,
          webContents: { send: webContentsSend },
        },
      ],
    },
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
const handshakeId = 'hs-a5-relay'

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

function sealSandboxResult(inner: IngestionPollResultWire | IngestionPollErrorWire): Record<string, unknown> {
  const sealed = sealServiceRpcPayload(sandboxRecord, {
    handshake_id: handshakeId,
    sender_device_id: 'dev-sand-1',
    receiver_device_id: 'dev-ws-1',
    plaintextJson: inner,
  })
  if (!sealed.ok) throw new Error(sealed.message)
  return buildSealedServiceRpcRelayCapsule(sealed.envelope)
}

function makeResultWire(requestId: string, overrides: Partial<IngestionPollResultWire> = {}): IngestionPollResultWire {
  const req = makeIngestionPollRequestWire({
    handshake_id: handshakeId,
    account_id: 'acc-a5',
    sender_device_id: 'dev-ws-1',
    target_device_id: 'dev-sand-1',
    request_id: requestId,
  })
  return {
    type: 'ingestion_poll_result',
    schema_version: INGESTION_POLL_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: handshakeId,
    sender_device_id: 'dev-sand-1',
    target_device_id: 'dev-ws-1',
    created_at: new Date().toISOString(),
    account_id: req.account_id,
    poll_status: 'ok',
    fetched: 3,
    depackaged: 3,
    delivered: 2,
    held: 0,
    ...overrides,
  }
}

describe('tryHandleIngestionPollResultRelayCapsule (A5)', () => {
  const sendAck = vi.fn()

  beforeEach(() => {
    sendAck.mockReset()
    webContentsSend.mockReset()
    getInstanceId.mockReturnValue('dev-ws-1')
    isEffectiveSandboxNode.mockReturnValue(false)
    _resetHostIngestionPollAcksForTests()
    _resetHostIngestionPollPendingForTests()
    _resetHostIngestionPollCompletionForTests()
    _setIngestionPollResultRelayHandlerDepsForTests(null)
  })

  it('opens sealed result, matches pending, records ack, resolves waiter, notifies UI', async () => {
    const requestId = 'req-a5-ok'
    registerHostIngestionPollPending({ requestId, accountId: 'acc-a5', timeoutMs: 60_000 })
    const waiter = waitForHostIngestionPollResult(requestId, 60_000)
    const capsule = sealSandboxResult(makeResultWire(requestId))

    const handled = await tryHandleIngestionPollResultRelayCapsule(
      {
        relayMessageId: 'relay-a5-1',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      { getRecord: () => hostRecord },
    )

    expect(handled).toBe(true)
    expect(sendAck).toHaveBeenCalledWith(['relay-a5-1'])

    const ack = getLastHostIngestionPollAck('acc-a5')
    expect(ack?.requestId).toBe(requestId)
    expect(ack?.pollStatus).toBe('ok')
    expect(ack?.delivered).toBe(2)

    await expect(waiter).resolves.toMatchObject({ requestId, delivered: 2, pollStatus: 'ok' })
    expect(webContentsSend).toHaveBeenCalledWith(
      'email:hostIngestionPollComplete',
      expect.objectContaining({ accountId: 'acc-a5', requestId, delivered: 2 }),
    )
  })

  it('HELD poll_status maps to loud failure ack shape', async () => {
    const requestId = 'req-a5-held'
    registerHostIngestionPollPending({ requestId, accountId: 'acc-held', timeoutMs: 60_000 })
    const wire = makeResultWire(requestId, {
      poll_status: 'held_read_consent_missing',
      fetched: 0,
      delivered: 0,
      held: 1,
    })
    const ack = mapIngestionPollWireToHostAck('acc-held', wire)
    expect(ack.pollStatus).toBe('held_read_consent_missing')
    expect(ack.held).toBe(1)

    await tryHandleIngestionPollResultRelayCapsule(
      {
        relayMessageId: 'relay-held',
        capsule: sealSandboxResult(wire),
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      { getRecord: () => hostRecord },
    )

    expect(getLastHostIngestionPollAck('acc-held')?.pollStatus).toBe('held_read_consent_missing')
  })

  it('ingestion_poll_error maps to trigger_unreachable / held_fetch_failed', async () => {
    const requestId = 'req-a5-err'
    registerHostIngestionPollPending({ requestId, accountId: 'acc-err', timeoutMs: 60_000 })
    const errorWire: IngestionPollErrorWire = {
      type: 'ingestion_poll_error',
      schema_version: INGESTION_POLL_SCHEMA_VERSION,
      request_id: requestId,
      handshake_id: handshakeId,
      sender_device_id: 'dev-sand-1',
      target_device_id: 'dev-ws-1',
      created_at: new Date().toISOString(),
      code: 'E_INGESTION_POLL_LINK_DOWN',
      message: 'link down',
    }
    await tryHandleIngestionPollResultRelayCapsule(
      {
        relayMessageId: 'relay-err',
        capsule: sealSandboxResult(errorWire),
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      { getRecord: () => hostRecord },
    )
    expect(getLastHostIngestionPollAck('acc-err')?.pollStatus).toBe('trigger_unreachable')
  })

  it('unmatched or duplicate result is ignored idempotently', async () => {
    const requestId = 'req-a5-dup'
    registerHostIngestionPollPending({ requestId, accountId: 'acc-dup', timeoutMs: 60_000 })
    const capsule = sealSandboxResult(makeResultWire(requestId))
    const ctx = {
      relayMessageId: 'relay-dup-1',
      capsule,
      db: {},
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    }

    await tryHandleIngestionPollResultRelayCapsule(ctx, { getRecord: () => hostRecord })
    webContentsSend.mockClear()
    sendAck.mockClear()

    const handled = await tryHandleIngestionPollResultRelayCapsule(
      { ...ctx, relayMessageId: 'relay-dup-2' },
      { getRecord: () => hostRecord },
    )

    expect(handled).toBe(true)
    expect(sendAck).toHaveBeenCalledWith(['relay-dup-2'])
    expect(webContentsSend).not.toHaveBeenCalled()
  })

  it('declines a sealed host_ai_inference_request_v1 (no ack) so dispatch falls through to the inference handler', async () => {
    // Regression: the inference REQUEST must NOT be claimed by the poll-result handler.
    // It is addressed to this host (receiver=dev-ws-1) and opens fine, but its inner type is
    // not a poll result/error — the handler must return false WITHOUT acking so the shared
    // dispatch reaches tryHandleHostAiSealedInferenceRequestRelayCapsule. (Previously this was
    // swallowed as "invalid poll wire envelope".)
    const inferenceRequestInner = {
      type: 'host_ai_inference_request_v1',
      schema_version: 1,
      request_id: 'req-infer-1',
      handshake_id: handshakeId,
      sender_device_id: 'dev-sand-1',
      receiver_device_id: 'dev-ws-1',
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }
    const sealed = sealServiceRpcPayload(sandboxRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'dev-sand-1',
      receiver_device_id: 'dev-ws-1',
      plaintextJson: inferenceRequestInner,
    })
    if (!sealed.ok) throw new Error(sealed.message)
    const capsule = buildSealedServiceRpcRelayCapsule(sealed.envelope)

    const handled = await tryHandleIngestionPollResultRelayCapsule(
      {
        relayMessageId: 'relay-infer-1',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      { getRecord: () => hostRecord },
    )

    expect(handled).toBe(false)
    expect(sendAck).not.toHaveBeenCalled()
  })

  it('returns false when receiver_device_id is not this host', async () => {
    const inner = makeResultWire('req-other-dev')
    const sealed = sealServiceRpcPayload(sandboxRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'dev-sand-1',
      receiver_device_id: 'dev-other-host',
      plaintextJson: inner,
    })
    if (!sealed.ok) throw new Error(sealed.message)
    const capsule = buildSealedServiceRpcRelayCapsule(sealed.envelope)

    const handled = await tryHandleIngestionPollResultRelayCapsule(
      {
        relayMessageId: 'relay-other',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      { getRecord: () => hostRecord },
    )
    expect(handled).toBe(false)
    expect(sendAck).not.toHaveBeenCalled()
  })

  it('returns false on ledger-proven sandbox without ack so Host AI inference results reach their handler', async () => {
    isEffectiveSandboxNode.mockReturnValue(true)
    const inner = makeResultWire('req-sbx-no-poll-pending')
    const sealed = sealServiceRpcPayload(sandboxRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'dev-sand-1',
      receiver_device_id: 'dev-ws-1',
      plaintextJson: inner,
    })
    if (!sealed.ok) throw new Error(sealed.message)
    const capsule = buildSealedServiceRpcRelayCapsule(sealed.envelope)

    const handled = await tryHandleIngestionPollResultRelayCapsule(
      {
        relayMessageId: 'relay-sbx-decline',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      { getRecord: () => hostRecord },
    )

    expect(handled).toBe(false)
    expect(sendAck).not.toHaveBeenCalled()
    isEffectiveSandboxNode.mockReturnValue(false)
  })

  it('declines host_ai_inference_result_v1 (no ack) so dispatch reaches the inference result handler', async () => {
    const inferenceResultInner = {
      type: 'host_ai_inference_result_v1',
      schema_version: 1,
      request_id: 'req-infer-result-1',
      handshake_id: handshakeId,
      sender_device_id: 'dev-ws-1',
      receiver_device_id: 'dev-sand-1',
      model: 'llama3',
      output: 'hello',
      duration_ms: 12,
    }
    const sealed = sealServiceRpcPayload(sandboxRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'dev-sand-1',
      receiver_device_id: 'dev-ws-1',
      plaintextJson: inferenceResultInner,
    })
    if (!sealed.ok) throw new Error(sealed.message)
    const capsule = buildSealedServiceRpcRelayCapsule(sealed.envelope)

    const handled = await tryHandleIngestionPollResultRelayCapsule(
      {
        relayMessageId: 'relay-infer-result-1',
        capsule,
        db: {},
        ssoSession: { wrdesk_user_id: 'u1' } as never,
        sendAck,
        getOidcToken: async () => 'tok',
      },
      { getRecord: () => hostRecord },
    )

    expect(handled).toBe(false)
    expect(sendAck).not.toHaveBeenCalled()
  })
})
