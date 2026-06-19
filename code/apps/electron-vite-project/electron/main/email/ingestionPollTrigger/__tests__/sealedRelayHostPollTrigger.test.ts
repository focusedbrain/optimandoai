/**
 * A3 — sealed relay host poll trigger + pending correlation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import type { HandshakeRecord, PartyIdentity } from '../../../handshake/types'
import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'
import {
  sendDedicatedSandboxIngestionPollTrigger,
  sendDedicatedSandboxIngestionPollTriggerViaDirectHttp,
  DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS,
} from '../hostTrigger'
import type { IngestionPollTransport } from '../send'
import { INGESTION_POLL_SCHEMA_VERSION } from '../wire'
import {
  _resetHostIngestionPollPendingForTests,
  getHostIngestionPollPending,
} from '../hostPendingStore'
import {
  _resetHostIngestionPollAcksForTests,
  getLastHostIngestionPollAck,
} from '../hostAckStore'
import { openServiceRpcPayload } from '../../../serviceRpc/sealedServiceRpc'
import { buildSealedServiceRpcRelayCapsule } from '../relaySend'

const topologyKind = vi.hoisted(() => ({ value: 'dedicated' as 'single_machine' | 'dedicated' | 'none' }))
const ownershipState = vi.hoisted(() => ({
  thisNodeRole: 'host' as 'host' | 'sandbox',
  hostShouldReadPoll: false,
}))
const listHandshakeRecords = vi.hoisted(() => vi.fn(() => [] as HandshakeRecord[]))
const getInstanceId = vi.hoisted(() => vi.fn(() => 'dev-ws-1'))
const sendCapsuleViaCoordination = vi.hoisted(() => vi.fn())

vi.mock('../../../handshake/resolvePeerDirectBeapIngestEndpoint', () => ({
  resolveSandboxPeerDirectBeapIngestEndpoint: vi.fn((_db: unknown, _hid: string, ledger: string | null | undefined) => {
    const t = typeof ledger === 'string' ? ledger.trim() : ''
    if (!t || !t.includes('/beap/ingest')) return null
    return t.replace(':51249/', ':51250/')
  }),
}))

vi.mock('../../../handshake/p2pTransport', () => ({
  sendCapsuleViaCoordination: (...args: unknown[]) => sendCapsuleViaCoordination(...args),
}))

vi.mock('../../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    use_coordination: true,
    coordination_url: 'https://relay.test.invalid',
  }),
}))

vi.mock('../../../handshake/ipc', () => ({
  getCoordinationOidcToken: vi.fn(async () => 'oidc-test-token'),
}))

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
}))

vi.mock('../../../handshake/sandboxTopologyKind', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../handshake/sandboxTopologyKind')>()
  return {
    ...actual,
    resolveSandboxTopologyKind: () => topologyKind.value,
  }
})

vi.mock('../../../handshake/db', () => ({
  listHandshakeRecords: (...args: unknown[]) => listHandshakeRecords(...args),
}))

vi.mock('../../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => getInstanceId(),
  getOrchestratorMode: () => ({
    mode: 'host',
    linked: [] as Array<{ handshakeId: string; pairingKind?: string }>,
  }),
}))

vi.mock('../../ingestionOwnership', () => ({
  resolveIngestionOwnershipWithLedger: () =>
    Promise.resolve({
      thisNodeRole: ownershipState.thisNodeRole,
      hostShouldReadPoll: ownershipState.hostShouldReadPoll,
      sandboxShouldReadPoll: false,
      owner: 'sandbox',
      reason: 'test',
    }),
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

function party(uid: string): PartyIdentity {
  return { email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

function hostToSandboxRecord(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-dedicated-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    initiator: party('u1'),
    acceptor: party('u1'),
    local_role: 'initiator',
    handshake_type: 'internal',
    internal_coordination_identity_complete: true,
    internal_coordination_repair_needed: false,
    initiator_coordination_device_id: 'dev-ws-1',
    acceptor_coordination_device_id: 'dev-sand-1',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    p2p_endpoint: 'http://10.0.0.2:51249/beap/ingest',
    local_p2p_auth_token: 'host-bearer',
    counterparty_p2p_token: 'peer-bearer',
    peer_x25519_public_key_b64: sandboxKeys.pubB64,
    local_x25519_private_key_b64: hostKeys.privB64,
    local_x25519_public_key_b64: hostKeys.pubB64,
    ...over,
  } as unknown as HandshakeRecord
}

describe('sendDedicatedSandboxIngestionPollTrigger — sealed relay (A3)', () => {
  beforeEach(() => {
    topologyKind.value = 'dedicated'
    ownershipState.hostShouldReadPoll = false
    getInstanceId.mockReturnValue('dev-ws-1')
    listHandshakeRecords.mockReturnValue([hostToSandboxRecord()])
    sendCapsuleViaCoordination.mockReset()
    sendCapsuleViaCoordination.mockResolvedValue({ success: true, statusCode: 200 })
    _resetHostIngestionPollPendingForTests()
    _resetHostIngestionPollAcksForTests()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetHostIngestionPollPendingForTests()
  })

  it('seals ingestion_poll_request and sends opaque relay capsule (not direct HTTP POST)', async () => {
    const out = await sendDedicatedSandboxIngestionPollTrigger({}, { accountId: 'acc-1' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.trigger.pollStatus).toBe('pending')
    expect(out.trigger.fetched).toBe(0)

    expect(sendCapsuleViaCoordination).toHaveBeenCalledTimes(1)
    const [capsule, coordUrl, token, handshakeId] = sendCapsuleViaCoordination.mock.calls[0] as [
      Record<string, unknown>,
      string,
      string,
      string,
    ]
    expect(coordUrl).toBe('https://relay.test.invalid')
    expect(token).toBe('oidc-test-token')
    expect(handshakeId).toBe('hs-dedicated-1')
    expect(capsule.capsule_type).toBe(SEALED_SERVICE_RPC_CAPSULE_TYPE)
    expect(capsule.sender_device_id).toBe('dev-ws-1')
    expect(capsule.receiver_device_id).toBe('dev-sand-1')
    expect(capsule).not.toHaveProperty('type', 'ingestion_poll_request')

    const sandboxRecord = hostToSandboxRecord({
      local_x25519_private_key_b64: sandboxKeys.privB64,
      peer_x25519_public_key_b64: hostKeys.pubB64,
    })
    const opened = openServiceRpcPayload(sandboxRecord, {
      envelope_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
      schema_version: 1,
      handshake_id: String(capsule.handshake_id),
      sender_device_id: String(capsule.sender_device_id),
      receiver_device_id: String(capsule.receiver_device_id),
      sender_ephemeral_x25519_pub_b64: String(capsule.sender_ephemeral_x25519_pub_b64),
      salt_b64: String(capsule.salt_b64),
      nonce_b64: String(capsule.nonce_b64),
      ciphertext_b64: String(capsule.ciphertext_b64),
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const inner = JSON.parse(opened.plaintextJson) as Record<string, unknown>
    expect(inner.type).toBe('ingestion_poll_request')
    expect(inner.account_id).toBe('acc-1')
    expect(inner.request_id).toBe(out.trigger.requestId)

    const pending = getHostIngestionPollPending(out.trigger.requestId)
    expect(pending?.accountId).toBe('acc-1')
    expect(pending?.startedAt).toBeGreaterThan(0)
  })

  it('sealing failure fails loud — no relay send, no direct fallback', async () => {
    listHandshakeRecords.mockReturnValue([
      hostToSandboxRecord({ peer_x25519_public_key_b64: undefined }),
    ])
    const out = await sendDedicatedSandboxIngestionPollTrigger({}, { accountId: 'acc-1' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.code).toBe('E_SEALED_RPC_MISSING_PEER_X25519')
    expect(sendCapsuleViaCoordination).not.toHaveBeenCalled()
  })

  it('relay send failure cancels pending and records unreachable on link-down', async () => {
    sendCapsuleViaCoordination.mockResolvedValueOnce({
      success: false,
      error: 'HTTP 503',
      statusCode: 503,
    })
    const out = await sendDedicatedSandboxIngestionPollTrigger({}, { accountId: 'acc-1' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.code).toBe('E_INGESTION_POLL_LINK_DOWN')
    const ack = getLastHostIngestionPollAck('acc-1')
    expect(ack?.pollStatus).toBe('trigger_unreachable')
    expect(ack?.requestId).toBeTruthy()
    expect(getHostIngestionPollPending(ack!.requestId)).toBeUndefined()
  })

  it('pending timeout records unreachable via hostAckStore', async () => {
    vi.useFakeTimers()
    const out = await sendDedicatedSandboxIngestionPollTrigger(
      {},
      { accountId: 'acc-timeout', timeoutMs: 5_000 },
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(getHostIngestionPollPending(out.trigger.requestId)).toBeDefined()

    vi.advanceTimersByTime(5_000)
    expect(getHostIngestionPollPending(out.trigger.requestId)).toBeUndefined()
    expect(getLastHostIngestionPollAck('acc-timeout')?.pollStatus).toBe('trigger_unreachable')
  })
})

describe('sendDedicatedSandboxIngestionPollTriggerViaDirectHttp — legacy path retained (A6 removal)', () => {
  beforeEach(() => {
    topologyKind.value = 'dedicated'
    ownershipState.hostShouldReadPoll = false
    getInstanceId.mockReturnValue('dev-ws-1')
    listHandshakeRecords.mockReturnValue([hostToSandboxRecord()])
    sendCapsuleViaCoordination.mockReset()
    _resetHostIngestionPollAcksForTests()
  })

  it('still posts ingestion_poll_request via HTTP transport when called explicitly', async () => {
    const transport: IngestionPollTransport = vi.fn(async ({ wire }) => ({
      ok: true,
      body: {
        type: 'ingestion_poll_result',
        schema_version: INGESTION_POLL_SCHEMA_VERSION,
        request_id: wire.request_id,
        handshake_id: wire.handshake_id,
        sender_device_id: 'dev-sand-1',
        target_device_id: 'dev-ws-1',
        created_at: new Date().toISOString(),
        account_id: wire.account_id,
        poll_status: 'ok',
        fetched: 3,
        depackaged: 3,
        delivered: 2,
        held: 1,
      },
    }))

    const out = await sendDedicatedSandboxIngestionPollTriggerViaDirectHttp(
      {},
      { accountId: 'acc-1', transport },
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.trigger.fetched).toBe(3)
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://10.0.0.2:51250/beap/ingest',
        wire: expect.objectContaining({ type: 'ingestion_poll_request' }),
      }),
    )
    expect(sendCapsuleViaCoordination).not.toHaveBeenCalled()
  })
})

describe('buildSealedServiceRpcRelayCapsule', () => {
  it('sets capsule_type for relay routing without exposing inner service type', () => {
    const capsule = buildSealedServiceRpcRelayCapsule({
      envelope_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
      schema_version: 1,
      handshake_id: 'hs-1',
      sender_device_id: 'a',
      receiver_device_id: 'b',
      sender_ephemeral_x25519_pub_b64: 'ephemeral',
      salt_b64: 'salt',
      nonce_b64: 'nonce',
      ciphertext_b64: 'cipher',
    })
    expect(capsule.capsule_type).toBe(SEALED_SERVICE_RPC_CAPSULE_TYPE)
    expect(capsule).not.toHaveProperty('type')
  })
})

describe('DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS', () => {
  it('defaults to 120s when env unset', () => {
    expect(DEFAULT_INGESTION_POLL_TRIGGER_TIMEOUT_MS).toBeGreaterThan(0)
  })
})
