/**
 * Phase C — parallel Host AI control-plane sealed relay (flag OFF = legacy path).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import { resetUnifiedServiceRpcRelayFlagsForTests } from '../unifiedServiceRpcRelayFlags'
import {
  _setHostAiUnifiedRelaySendDepsForTests,
  trySendHostAiP2pSignalViaUnifiedRelay,
} from '../hostAiUnifiedServiceRpcRelay'
import {
  HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE,
  buildHostAiP2pSignalUnifiedRelayWire,
} from '../hostAiUnifiedServiceRpcRelayWire'
import { openServiceRpcPayload, sealServiceRpcPayload } from '../../serviceRpc/sealedServiceRpc'
import { P2P_SIGNAL_WIRE_SCHEMA_VERSION } from '../p2pSignalWireSchemaVersion'

vi.mock('../../email/ingestionPollTrigger/relaySend', async () => {
  const { sealServiceRpcPayload } = await import('../../serviceRpc/sealedServiceRpc')
  return {
    sealServiceRpcForRelay: (record: unknown, input: unknown) =>
      sealServiceRpcPayload(record as never, input as never),
    sendSealedServiceRpcViaCoordinationRelay: vi.fn(),
  }
})

vi.mock('../policy', () => ({
  assertRecordForServiceRpc: (r: unknown) =>
    r
      ? { ok: true as const, record: r }
      : { ok: false as const, code: 'E_NO_RECORD', message: 'no record' },
}))

vi.mock('../sandbox/sandboxOutboundPolicy', () => ({
  isEffectiveSandboxNode: () => false,
  assertSandboxMaySealServiceRpcInnerType: () => ({ ok: true }),
}))

function makeX25519Pair() {
  const priv = x25519.utils.randomPrivateKey()
  const pub = x25519.getPublicKey(priv)
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(pub).toString('base64'),
  }
}

function makeRecord(partial: {
  localRole: 'host' | 'sandbox'
  local: ReturnType<typeof makeX25519Pair>
  peer: ReturnType<typeof makeX25519Pair>
  localDeviceId: string
}): HandshakeRecord {
  return {
    handshake_id: 'hs-c1',
    handshake_type: 'internal',
    state: HandshakeState.ACTIVE,
    local_role: partial.localRole,
    peer_x25519_public_key_b64: partial.peer.pubB64,
    local_x25519_private_key_b64: partial.local.privB64,
    local_x25519_public_key_b64: partial.local.pubB64,
    initiator_coordination_device_id: partial.localRole === 'host' ? partial.localDeviceId : 'peer-dev',
    acceptor_coordination_device_id: partial.localRole === 'sandbox' ? partial.localDeviceId : 'peer-dev',
    internal_coordination_identity_complete: true,
    p2p_endpoint: null,
    counterparty_p2p_token: 'tok',
  } as HandshakeRecord
}

describe('hostAiUnifiedServiceRpcRelay (C1)', () => {
  const hostKeys = makeX25519Pair()
  const sandboxKeys = makeX25519Pair()
  const hostRecord = makeRecord({
    localRole: 'host',
    local: hostKeys,
    peer: sandboxKeys,
    localDeviceId: 'host-dev',
  })
  const sandboxRecord = makeRecord({
    localRole: 'sandbox',
    local: sandboxKeys,
    peer: hostKeys,
    localDeviceId: 'sandbox-dev',
  })

  const p2pBody = JSON.stringify({
    schema_version: P2P_SIGNAL_WIRE_SCHEMA_VERSION,
    signal_type: 'p2p_inference_offer',
    handshake_id: 'hs-c1',
    correlation_id: 'corr-1',
    session_id: 'sid-1',
    sender_device_id: 'sandbox-dev',
    receiver_device_id: 'host-dev',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    sdp: 'v=0',
  })

  beforeEach(() => {
    resetUnifiedServiceRpcRelayFlagsForTests()
    _setHostAiUnifiedRelaySendDepsForTests(null)
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    resetUnifiedServiceRpcRelayFlagsForTests()
    _setHostAiUnifiedRelaySendDepsForTests(null)
    vi.unstubAllEnvs()
  })

  it('flag OFF → null (caller uses /beap/p2p-signal unchanged)', async () => {
    const r = await trySendHostAiP2pSignalViaUnifiedRelay({
      db: {},
      handshakeId: 'hs-c1',
      senderDeviceId: 'host-dev',
      receiverDeviceId: 'sandbox-dev',
      p2pSignalBodyJson: p2pBody,
    })
    expect(r).toBeNull()
  })

  it('flag ON → seals host_ai_p2p_signal_v1 and sends sealed_service_rpc_v1', async () => {
    vi.stubEnv('WRDESK_UNIFIED_SERVICE_RPC_RELAY', '1')
    resetUnifiedServiceRpcRelayFlagsForTests()

    const sendSealedRelay = vi.fn(async () => ({ ok: true as const }))
    _setHostAiUnifiedRelaySendDepsForTests({
      getRecord: () => hostRecord,
      sendSealedRelay,
    })

    const r = await trySendHostAiP2pSignalViaUnifiedRelay({
      db: {},
      handshakeId: 'hs-c1',
      senderDeviceId: 'host-dev',
      receiverDeviceId: 'sandbox-dev',
      p2pSignalBodyJson: p2pBody,
    })

    expect(r).toEqual({ ok: true, status: 200 })
    expect(sendSealedRelay).toHaveBeenCalledTimes(1)
    const envelope = sendSealedRelay.mock.calls[0]![2]
    const opened = openServiceRpcPayload(sandboxRecord, envelope)
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      const inner = JSON.parse(opened.plaintextJson)
      expect(inner.type).toBe(HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE)
      expect(inner.p2p_signal_body).toBe(p2pBody)
    }
  })

  it('inner wire round-trip does not expose p2p_signal_body on envelope fields', () => {
    const inner = buildHostAiP2pSignalUnifiedRelayWire({
      handshakeId: 'hs-c1',
      senderDeviceId: 'host-dev',
      receiverDeviceId: 'sandbox-dev',
      p2pSignalBodyJson: p2pBody,
    })
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: 'hs-c1',
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: inner,
    })
    expect(sealed.ok).toBe(true)
    if (sealed.ok) {
      expect(sealed.envelope.ciphertext_b64).not.toContain('p2p_inference_offer')
      expect(sealed.envelope.ciphertext_b64).not.toContain('v=0')
    }
  })
})
