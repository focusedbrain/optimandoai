/**
 * Roadmap item 0.26 — sender-authenticated service RPC (schema_version 2).
 *
 * The v2 key mixes the sender's static device key into the derivation, so only the
 * device whose public key is pinned on the handshake can produce an envelope the
 * receiver opens. Expiry and message id are bound in the AAD; the receiver refuses
 * expired and too-far-future envelopes, the accepting handler's claim refuses replays,
 * and relay receivers refuse v1.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { HandshakeState, type HandshakeRecord } from '../../handshake/types'
import {
  SEALED_RPC_MAX_TTL_MS,
  SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH,
  __resetSealedRpcReplayGuardForTests,
  claimSealedServiceRpcMessage,
  openServiceRpcPayload,
  sealServiceRpcPayload,
  sealServiceRpcPayloadAuthenticated,
  type SealedServiceRpcEnvelope,
} from '../sealedServiceRpc'

function pair() {
  const priv = x25519.utils.randomPrivateKey()
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(x25519.getPublicKey(priv)).toString('base64'),
  }
}

function record(hid: string, local: ReturnType<typeof pair>, peer: ReturnType<typeof pair>): HandshakeRecord {
  return {
    handshake_id: hid,
    handshake_type: 'internal',
    state: HandshakeState.ACTIVE,
    peer_x25519_public_key_b64: peer.pubB64,
    local_x25519_private_key_b64: local.privB64,
    local_x25519_public_key_b64: local.pubB64,
  } as HandshakeRecord
}

const hid = 'hs-auth-rpc'
const host = pair()
const sandbox = pair()
const hostRecord = record(hid, host, sandbox)
const sandboxRecord = record(hid, sandbox, host)
const routing = { handshake_id: hid, sender_device_id: 'host-dev', receiver_device_id: 'sandbox-dev' }
const payload = { type: 'ingestion_poll_request', request_id: 'r1' }

function sealFromHost(opts: { ttlMs?: number; nowMs?: number; messageId?: string } = {}): SealedServiceRpcEnvelope {
  const r = sealServiceRpcPayloadAuthenticated(hostRecord, { ...routing, plaintextJson: payload }, host.privB64, opts)
  if (!r.ok) throw new Error(r.message)
  return r.envelope
}

describe('sealedServiceRpc v2 — sender authentication', () => {
  beforeEach(() => __resetSealedRpcReplayGuardForTests())

  it('round-trips and carries expiry + message id on the wire', () => {
    const env = sealFromHost()
    expect(env.schema_version).toBe(SEALED_SERVICE_RPC_SCHEMA_VERSION_AUTH)
    expect(typeof env.expires_at).toBe('number')
    expect(env.message_id).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(env)).not.toContain('ingestion_poll_request')
    const opened = openServiceRpcPayload(sandboxRecord, env, undefined, { requireAuthenticated: true })
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(JSON.parse(opened.plaintextJson)).toEqual(payload)
  })

  it('a sender without the pinned device key cannot produce an envelope the receiver opens', () => {
    const attacker = pair()
    // The attacker knows the sandbox's public key (it is not secret) and seals with its own key.
    const r = sealServiceRpcPayloadAuthenticated(hostRecord, { ...routing, plaintextJson: payload }, attacker.privB64)
    if (!r.ok) throw new Error(r.message)
    const opened = openServiceRpcPayload(sandboxRecord, r.envelope)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('E_SEALED_RPC_DECRYPT_FAILED')
  })

  it('tampering with expiry or message id breaks the tag', () => {
    const env = sealFromHost()
    for (const forged of [
      { ...env, expires_at: (env.expires_at as number) + 60_000 },
      { ...env, message_id: 'f'.repeat(32) },
      { ...env, sender_device_id: 'other-dev' },
    ]) {
      const opened = openServiceRpcPayload(sandboxRecord, forged)
      expect(opened.ok).toBe(false)
    }
  })

  it('opening is stateless (dispatch may open one envelope in several handlers); a second claim is a replay', () => {
    const env = sealFromHost()
    expect(openServiceRpcPayload(sandboxRecord, env).ok).toBe(true)
    expect(openServiceRpcPayload(sandboxRecord, env).ok).toBe(true)
    expect(claimSealedServiceRpcMessage(env).ok).toBe(true)
    const again = claimSealedServiceRpcMessage(env)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('E_SEALED_RPC_REPLAY')
    // A different envelope with its own id is unaffected.
    expect(claimSealedServiceRpcMessage(sealFromHost()).ok).toBe(true)
  })

  it('v1 envelopes carry no id and always claim', () => {
    const v1 = sealServiceRpcPayload(hostRecord, { ...routing, plaintextJson: payload })
    if (!v1.ok) throw new Error(v1.message)
    expect(claimSealedServiceRpcMessage(v1.envelope).ok).toBe(true)
    expect(claimSealedServiceRpcMessage(v1.envelope).ok).toBe(true)
  })

  it('refuses an expired envelope and one that expires too far ahead', () => {
    const now = Date.now()
    const expired = sealFromHost({ ttlMs: 1_000, nowMs: now - 60 * 60 * 1000 })
    const r1 = openServiceRpcPayload(sandboxRecord, expired, undefined, { nowMs: now })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.code).toBe('E_SEALED_RPC_EXPIRED')

    const farFuture = sealFromHost({ nowMs: now + SEALED_RPC_MAX_TTL_MS })
    const r2 = openServiceRpcPayload(sandboxRecord, farFuture, undefined, { nowMs: now })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.code).toBe('E_SEALED_RPC_EXPIRY_TOO_FAR')
  })

  it('relay receivers refuse unauthenticated v1 envelopes; other callers still open them', () => {
    const v1 = sealServiceRpcPayload(hostRecord, { ...routing, plaintextJson: payload })
    if (!v1.ok) throw new Error(v1.message)
    const strict = openServiceRpcPayload(sandboxRecord, v1.envelope, undefined, { requireAuthenticated: true })
    expect(strict.ok).toBe(false)
    if (!strict.ok) expect(strict.code).toBe('E_SEALED_RPC_UNAUTHENTICATED')
    expect(openServiceRpcPayload(sandboxRecord, v1.envelope).ok).toBe(true)
  })

  it('refuses to seal without a local static key (no unauthenticated fallback)', () => {
    const r = sealServiceRpcPayloadAuthenticated(hostRecord, { ...routing, plaintextJson: payload }, '')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_SEALED_RPC_MISSING_LOCAL_X25519')
  })
})
