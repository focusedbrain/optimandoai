/**
 * A5 — sealed_service_rpc_v1 dispatch: reject plaintext; host result before sandbox request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INGESTION_POLL_SCHEMA_VERSION } from '../wire'
import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'
import { resetUnifiedServiceRpcRelayFlagsForTests } from '../../../internalInference/unifiedServiceRpcRelayFlags'

const tryHandleResult = vi.hoisted(() => vi.fn(async () => true))
const tryHandleRequest = vi.hoisted(() => vi.fn(async () => false))

vi.mock('../relayResultCapsuleHandler', () => ({
  tryHandleIngestionPollResultRelayCapsule: (...args: unknown[]) => tryHandleResult(...args),
}))

vi.mock('../relayCapsuleHandler', () => ({
  isSealedServiceRpcRelayCapsule: (capsule: Record<string, unknown>) => {
    const ct = typeof capsule.capsule_type === 'string' ? capsule.capsule_type.trim() : ''
    return ct === SEALED_SERVICE_RPC_CAPSULE_TYPE
  },
  tryHandleIngestionPollRelayCapsule: (...args: unknown[]) => tryHandleRequest(...args),
}))

import { tryHandleSealedServiceRpcRelayCapsule } from '../sealedServiceRpcRelayDispatch'

describe('tryHandleSealedServiceRpcRelayCapsule (A5 dispatch)', () => {
  const sendAck = vi.fn()

  beforeEach(() => {
    sendAck.mockReset()
    tryHandleResult.mockReset()
    tryHandleRequest.mockReset()
    tryHandleResult.mockResolvedValue(true)
    tryHandleRequest.mockResolvedValue(false)
    resetUnifiedServiceRpcRelayFlagsForTests()
    vi.unstubAllEnvs()
  })

  it('rejects plaintext ingestion_poll_result on relay (INV-ENCRYPT)', async () => {
    await tryHandleSealedServiceRpcRelayCapsule({
      relayMessageId: 'relay-plain',
      capsule: {
        type: 'ingestion_poll_result',
        schema_version: INGESTION_POLL_SCHEMA_VERSION,
        request_id: 'req-plain',
        handshake_id: 'hs-1',
        sender_device_id: 'dev-sand',
        target_device_id: 'dev-ws',
        created_at: new Date().toISOString(),
        account_id: 'acc-1',
        poll_status: 'ok',
        fetched: 1,
        depackaged: 1,
        delivered: 1,
        held: 0,
      },
      db: {},
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    })

    expect(sendAck).toHaveBeenCalledWith(['relay-plain'])
    expect(tryHandleResult).not.toHaveBeenCalled()
    expect(tryHandleRequest).not.toHaveBeenCalled()
  })

  it('routes sealed capsules to host result handler first', async () => {
    await tryHandleSealedServiceRpcRelayCapsule({
      relayMessageId: 'relay-sealed',
      capsule: {
        capsule_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
        schema_version: 1,
        envelope_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
        handshake_id: 'hs-1',
        sender_device_id: 'dev-sand',
        receiver_device_id: 'dev-ws',
        sender_ephemeral_x25519_pub_b64: 'AA==',
        salt_b64: 'AA==',
        nonce_b64: 'AA==',
        ciphertext_b64: 'AA==',
      },
      db: {},
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    })

    expect(tryHandleResult).toHaveBeenCalledTimes(1)
    expect(tryHandleRequest).not.toHaveBeenCalled()
  })

  it('falls through to sandbox request handler when host result returns false', async () => {
    tryHandleResult.mockResolvedValue(false)
    tryHandleRequest.mockResolvedValue(true)

    await tryHandleSealedServiceRpcRelayCapsule({
      relayMessageId: 'relay-fallback',
      capsule: {
        capsule_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
        schema_version: 1,
        envelope_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
        handshake_id: 'hs-1',
        sender_device_id: 'dev-ws',
        receiver_device_id: 'dev-sand',
        sender_ephemeral_x25519_pub_b64: 'AA==',
        salt_b64: 'AA==',
        nonce_b64: 'AA==',
        ciphertext_b64: 'AA==',
      },
      db: {},
      ssoSession: { wrdesk_user_id: 'u1' } as never,
      sendAck,
      getOidcToken: async () => 'tok',
    })

    expect(tryHandleResult).toHaveBeenCalledTimes(1)
    expect(tryHandleRequest).toHaveBeenCalledTimes(1)
  })
})
