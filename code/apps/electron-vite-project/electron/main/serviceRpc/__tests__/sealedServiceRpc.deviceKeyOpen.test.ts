/**
 * STEP 1 regression — openServiceRpcPayloadResolvingLocalKey resolves the local X25519
 * private key from the orchestrator-DB device key store when the handshake record does NOT
 * carry it (post device-key-migration flow). Mirrors the seal path / qBEAP decrypt key source.
 *
 * Proves BOTH directions (sandbox opens host's request; host opens sandbox's result) and that
 * the path stays fail-closed (no plaintext fallback) when no key is resolvable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  openServiceRpcPayloadResolvingLocalKey,
  sealServiceRpcPayload,
} from '../sealedServiceRpc'

const getDeviceX25519KeyPair = vi.hoisted(() => vi.fn())

vi.mock('../../device-keys/deviceKeyStore', () => ({
  getDeviceX25519KeyPair: () => getDeviceX25519KeyPair(),
}))

function makeX25519Pair() {
  const priv = x25519.utils.randomPrivateKey()
  const pub = x25519.getPublicKey(priv)
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(pub).toString('base64'),
  }
}

const handshakeId = 'hs-devkey-open'
const hostKeys = makeX25519Pair()
const sandboxKeys = makeX25519Pair()

/** Record WITH local private key on it (seal side / legacy). */
function recordWithPriv(localRole: 'host' | 'sandbox'): HandshakeRecord {
  const local = localRole === 'host' ? hostKeys : sandboxKeys
  const peer = localRole === 'host' ? sandboxKeys : hostKeys
  return {
    handshake_id: handshakeId,
    handshake_type: 'internal',
    state: HandshakeState.ACTIVE,
    local_role: localRole,
    peer_x25519_public_key_b64: peer.pubB64,
    local_x25519_private_key_b64: local.privB64,
    local_x25519_public_key_b64: local.pubB64,
  } as HandshakeRecord
}

/** Record WITHOUT local private key — the private key lives in the device key store. */
function recordNoPriv(localRole: 'host' | 'sandbox'): HandshakeRecord {
  const local = localRole === 'host' ? hostKeys : sandboxKeys
  const peer = localRole === 'host' ? sandboxKeys : hostKeys
  return {
    handshake_id: handshakeId,
    handshake_type: 'internal',
    state: HandshakeState.ACTIVE,
    local_role: localRole,
    peer_x25519_public_key_b64: peer.pubB64,
    local_x25519_private_key_b64: null,
    local_x25519_public_key_b64: local.pubB64,
  } as HandshakeRecord
}

describe('openServiceRpcPayloadResolvingLocalKey — device key store fallback (STEP 1)', () => {
  beforeEach(() => {
    getDeviceX25519KeyPair.mockReset()
  })

  it('sandbox opens host REQUEST using device-store private key (record priv NULL)', async () => {
    const inner = { type: 'ingestion_poll_request', schema_version: 1, request_id: 'r1', account_id: 'a1' }
    const sealed = sealServiceRpcPayload(recordWithPriv('host'), {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: inner,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    getDeviceX25519KeyPair.mockResolvedValue({
      keyId: 'x25519_device_v1',
      publicKey: sandboxKeys.pubB64,
      privateKey: sandboxKeys.privB64,
    })

    const opened = await openServiceRpcPayloadResolvingLocalKey(recordNoPriv('sandbox'), sealed.envelope)
    expect(getDeviceX25519KeyPair).toHaveBeenCalledOnce()
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(JSON.parse(opened.plaintextJson)).toEqual(inner)
  })

  it('host opens sandbox RESULT using device-store private key (record priv NULL)', async () => {
    const inner = { type: 'ingestion_poll_result', fetched: 3, delivered: 2 }
    const sealed = sealServiceRpcPayload(recordWithPriv('sandbox'), {
      handshake_id: handshakeId,
      sender_device_id: 'sandbox-dev',
      receiver_device_id: 'host-dev',
      plaintextJson: inner,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    getDeviceX25519KeyPair.mockResolvedValue({
      keyId: 'x25519_device_v1',
      publicKey: hostKeys.pubB64,
      privateKey: hostKeys.privB64,
    })

    const opened = await openServiceRpcPayloadResolvingLocalKey(recordNoPriv('host'), sealed.envelope)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(JSON.parse(opened.plaintextJson)).toEqual(inner)
  })

  it('prefers the record private key without consulting the device store', async () => {
    const inner = { type: 'ingestion_poll_request', schema_version: 1, request_id: 'r2' }
    const sealed = sealServiceRpcPayload(recordWithPriv('host'), {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: inner,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    const opened = await openServiceRpcPayloadResolvingLocalKey(recordWithPriv('sandbox'), sealed.envelope)
    expect(getDeviceX25519KeyPair).not.toHaveBeenCalled()
    expect(opened.ok).toBe(true)
  })

  it('fail-closed: no record priv and device store throws → MISSING_LOCAL_X25519 (no plaintext)', async () => {
    const inner = { type: 'ingestion_poll_request', schema_version: 1, request_id: 'r3' }
    const sealed = sealServiceRpcPayload(recordWithPriv('host'), {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: inner,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    getDeviceX25519KeyPair.mockRejectedValue(new Error('DEVICE_KEY_NOT_FOUND'))

    const opened = await openServiceRpcPayloadResolvingLocalKey(recordNoPriv('sandbox'), sealed.envelope)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('E_SEALED_RPC_MISSING_LOCAL_X25519')
  })
})
