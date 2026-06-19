/**
 * sealedServiceRpc — Prompt A1 unit tests (GATE A1).
 */

import { describe, it, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  SEALED_SERVICE_RPC_ENVELOPE_TYPE,
  openServiceRpcPayload,
  sealServiceRpcPayload,
  type SealedServiceRpcEnvelope,
} from '../sealedServiceRpc'

function makeX25519Pair() {
  const priv = x25519.utils.randomPrivateKey()
  const pub = x25519.getPublicKey(priv)
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(pub).toString('base64'),
  }
}

function makeInternalRecord(partial: {
  handshake_id: string
  localRole: 'host' | 'sandbox'
  local: ReturnType<typeof makeX25519Pair>
  peer: ReturnType<typeof makeX25519Pair>
  localDeviceId: string
}): HandshakeRecord {
  return {
    handshake_id: partial.handshake_id,
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

describe('sealedServiceRpc (A1)', () => {
  const handshakeId = 'hs-sealed-rpc-a1'
  const hostKeys = makeX25519Pair()
  const sandboxKeys = makeX25519Pair()

  const hostRecord = makeInternalRecord({
    handshake_id: handshakeId,
    localRole: 'host',
    local: hostKeys,
    peer: sandboxKeys,
    localDeviceId: 'host-dev',
  })
  const sandboxRecord = makeInternalRecord({
    handshake_id: handshakeId,
    localRole: 'sandbox',
    local: sandboxKeys,
    peer: hostKeys,
    localDeviceId: 'sandbox-dev',
  })

  const innerPayload = {
    type: 'ingestion_poll_request',
    schema_version: 1,
    request_id: 'req-a1-roundtrip',
    account_id: 'acc-test',
  }

  it('round-trip host→sandbox: seal with host record, open with sandbox record', () => {
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: innerPayload,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    expect(sealed.envelope.envelope_type).toBe(SEALED_SERVICE_RPC_ENVELOPE_TYPE)
    expect(sealed.envelope.handshake_id).toBe(handshakeId)
    expect(JSON.stringify(sealed.envelope)).not.toContain('ingestion_poll_request')

    const opened = openServiceRpcPayload(sandboxRecord, sealed.envelope)
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(JSON.parse(opened.plaintextJson)).toEqual(innerPayload)
    }
  })

  it('round-trip sandbox→host: both directions have key material', () => {
    const sealed = sealServiceRpcPayload(sandboxRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'sandbox-dev',
      receiver_device_id: 'host-dev',
      plaintextJson: { type: 'ingestion_poll_result', fetched: 3 },
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    const opened = openServiceRpcPayload(hostRecord, sealed.envelope)
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(JSON.parse(opened.plaintextJson)).toEqual({ type: 'ingestion_poll_result', fetched: 3 })
    }
  })

  it('opening with wrong local private key fails (fail-closed, no plaintext)', () => {
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: innerPayload,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    const wrongKeys = makeX25519Pair()
    const wrongRecord = makeInternalRecord({
      handshake_id: handshakeId,
      localRole: 'sandbox',
      local: wrongKeys,
      peer: hostKeys,
      localDeviceId: 'sandbox-dev',
    })
    const opened = openServiceRpcPayload(wrongRecord, sealed.envelope)
    expect(opened.ok).toBe(false)
    if (!opened.ok) {
      expect(opened.code).toBe('E_SEALED_RPC_DECRYPT_FAILED')
    }
  })

  it('tampered ciphertext fails AEAD open', () => {
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: innerPayload,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    const raw = Buffer.from(sealed.envelope.ciphertext_b64, 'base64')
    raw[0] ^= 0xff
    const tampered: SealedServiceRpcEnvelope = {
      ...sealed.envelope,
      ciphertext_b64: raw.toString('base64'),
    }
    const opened = openServiceRpcPayload(sandboxRecord, tampered)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('E_SEALED_RPC_DECRYPT_FAILED')
  })

  it('routing replay: altered receiver_device_id fails open (AAD binding)', () => {
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: innerPayload,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    const replayed: SealedServiceRpcEnvelope = {
      ...sealed.envelope,
      receiver_device_id: 'other-sandbox-dev',
    }
    const opened = openServiceRpcPayload(sandboxRecord, replayed)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('E_SEALED_RPC_DECRYPT_FAILED')
  })

  it('missing peer_x25519 on seal returns fail-closed error (never plaintext)', () => {
    const noPeer: HandshakeRecord = { ...hostRecord, peer_x25519_public_key_b64: null }
    const sealed = sealServiceRpcPayload(noPeer, {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: innerPayload,
    })
    expect(sealed.ok).toBe(false)
    if (!sealed.ok) expect(sealed.code).toBe('E_SEALED_RPC_MISSING_PEER_X25519')
  })

  it('missing local_x25519 on open returns fail-closed error', () => {
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: innerPayload,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    const noPriv: HandshakeRecord = { ...sandboxRecord, local_x25519_private_key_b64: null }
    const opened = openServiceRpcPayload(noPriv, sealed.envelope)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('E_SEALED_RPC_MISSING_LOCAL_X25519')
  })

  it('handshake_id mismatch between record and envelope fails open', () => {
    const sealed = sealServiceRpcPayload(hostRecord, {
      handshake_id: handshakeId,
      sender_device_id: 'host-dev',
      receiver_device_id: 'sandbox-dev',
      plaintextJson: innerPayload,
    })
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) return

    const otherRecord = { ...sandboxRecord, handshake_id: 'hs-other' }
    const opened = openServiceRpcPayload(otherRecord, sealed.envelope)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('E_SEALED_RPC_HANDSHAKE_MISMATCH')
  })
})
