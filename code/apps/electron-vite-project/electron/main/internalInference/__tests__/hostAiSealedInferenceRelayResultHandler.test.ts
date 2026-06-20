/**
 * Sealed Host AI inference RESULT handler — ledger-authoritative sandbox gate (Fix 1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { sealServiceRpcPayload } from '../../serviceRpc/sealedServiceRpc'
import { buildSealedServiceRpcRelayCapsule } from '../../email/ingestionPollTrigger/relaySend'
import {
  _resetPendingForTests,
  registerInternalInferenceRequest,
} from '../pendingRequests'
import { HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION } from '../hostAiSealedInferenceRelayWire'
import { tryHandleHostAiSealedInferenceResultRelayCapsule } from '../hostAiSealedInferenceRelayResultHandler'

const getInstanceId = vi.hoisted(() => vi.fn(() => 'dev-sand-1'))
const getOrchestratorMode = vi.hoisted(() => vi.fn(() => ({ mode: 'host' as string })))
const isEffectiveSandboxNode = vi.hoisted(() => vi.fn((_db: unknown) => false))
const getHandshakeRecord = vi.hoisted(() => vi.fn((_db: unknown, _hid: string) => null as HandshakeRecord | null))
const consoleLog = vi.hoisted(() => vi.fn())
const consoleWarn = vi.hoisted(() => vi.fn())

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (db: unknown, hid: string) => getHandshakeRecord(db, hid),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceId(),
  getOrchestratorMode: () => getOrchestratorMode(),
  isSandboxMode: () => getOrchestratorMode().mode === 'sandbox',
}))

vi.mock('../../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: (db: unknown) => isEffectiveSandboxNode(db),
}))

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
const handshakeId = 'hs-infer-result-ledger'

function party(uid: string) {
  return { email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

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

function sealHostInferenceResult(
  requestId: string,
  output = 'analysis json output',
): Record<string, unknown> {
  const inner = {
    type: 'host_ai_inference_result_v1',
    schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
    request_id: requestId,
    handshake_id: handshakeId,
    sender_device_id: 'dev-ws-1',
    receiver_device_id: 'dev-sand-1',
    model: 'llama3',
    output,
    duration_ms: 42,
  }
  const sealed = sealServiceRpcPayload(hostRecord, {
    handshake_id: handshakeId,
    sender_device_id: 'dev-ws-1',
    receiver_device_id: 'dev-sand-1',
    plaintextJson: inner,
  })
  if (!sealed.ok) throw new Error(sealed.message)
  return buildSealedServiceRpcRelayCapsule(sealed.envelope)
}

describe('tryHandleHostAiSealedInferenceResultRelayCapsule', () => {
  const sendAck = vi.fn()
  const dbStub = { ledger: 'stub' }

  beforeEach(() => {
    sendAck.mockReset()
    consoleLog.mockReset()
    consoleWarn.mockReset()
    getInstanceId.mockReturnValue('dev-sand-1')
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
    isEffectiveSandboxNode.mockReturnValue(false)
    getHandshakeRecord.mockImplementation((_db, hid) => (hid === handshakeId ? sandboxRecord : null))
    _resetPendingForTests()
    vi.spyOn(console, 'log').mockImplementation(consoleLog)
    vi.spyOn(console, 'warn').mockImplementation(consoleWarn)
  })

  it('resolves pending when orchestrator file=host but ledger proves sandbox (mode/ledger mismatch)', async () => {
    isEffectiveSandboxNode.mockReturnValue(true)
    const requestId = 'req-ledger-sandbox-result-1'
    const pending = registerInternalInferenceRequest(requestId, 60_000)
    const capsule = sealHostInferenceResult(requestId)

    const handled = await tryHandleHostAiSealedInferenceResultRelayCapsule({
      relayMessageId: 'relay-infer-resolved',
      capsule,
      db: dbStub,
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    })

    expect(handled).toBe(true)
    expect(sendAck).toHaveBeenCalledWith(['relay-infer-resolved'])
    await expect(pending).resolves.toMatchObject({
      kind: 'result',
      output: 'analysis json output',
      model: 'llama3',
    })
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('[HOST_AI_SEALED_INFERENCE_RESULT_RELAY] resolved request_id=req-ledger-sandbox-result-1'),
    )
    expect(consoleLog).not.toHaveBeenCalledWith(
      expect.stringContaining('skipped reason=not_sandbox_receiver'),
    )
  })

  it('skips with reason when node is not the ledger-authoritative sandbox receiver', async () => {
    isEffectiveSandboxNode.mockReturnValue(false)
    const capsule = sealHostInferenceResult('req-not-sandbox')

    const handled = await tryHandleHostAiSealedInferenceResultRelayCapsule({
      relayMessageId: 'relay-skip',
      capsule,
      db: dbStub,
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    })

    expect(handled).toBe(false)
    expect(sendAck).not.toHaveBeenCalled()
    expect(consoleLog).toHaveBeenCalledWith(
      '[HOST_AI_SEALED_INFERENCE_RESULT_RELAY] skipped reason=not_sandbox_receiver',
    )
  })

  it('logs no_pending when wire request_id has no registered waiter', async () => {
    isEffectiveSandboxNode.mockReturnValue(true)
    const capsule = sealHostInferenceResult('req-no-pending-map')

    const handled = await tryHandleHostAiSealedInferenceResultRelayCapsule({
      relayMessageId: 'relay-no-pending',
      capsule,
      db: dbStub,
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    })

    expect(handled).toBe(true)
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('[HOST_AI_SEALED_INFERENCE_RESULT_RELAY] no_pending request_id=req-no-pending-map'),
    )
  })
})
