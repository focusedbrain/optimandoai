/**
 * PROMPT 2 — dedicated host→sandbox ingestion poll trigger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HandshakeRecord, PartyIdentity } from '../../../handshake/types'
import {
  SANDBOX_OUTBOUND_ALLOWED_TYPES,
  classifySandboxOutboundCapsule,
  isSandboxAllowedOutboundType,
} from '@repo/ingestion-core'
import {
  isIngestionPollServiceRpcShape,
  INGESTION_POLL_SCHEMA_VERSION,
} from '../wire'
import {
  handleIngestionPollRequest,
  makeIngestionPollRequestWire,
} from '../receiver'
import {
  sendDedicatedSandboxIngestionPollTrigger,
  sendDedicatedSandboxIngestionPollTriggerViaDirectHttp,
  shouldHostTriggerDedicatedSandboxPoll,
} from '../hostTrigger'
import type { IngestionPollTransport } from '../send'

const topologyKind = vi.hoisted(() => ({ value: 'none' as 'single_machine' | 'dedicated' | 'none' }))
const ownershipState = vi.hoisted(() => ({
  thisNodeRole: 'host' as 'host' | 'sandbox',
  hostShouldReadPoll: true,
}))
const listHandshakeRecords = vi.hoisted(() => vi.fn(() => [] as HandshakeRecord[]))
const getInstanceId = vi.hoisted(() => vi.fn(() => 'dev-ws-1'))

const resolveSandboxPeerDirectBeapIngestEndpoint = vi.hoisted(() =>
  vi.fn((_db: unknown, _hid: string, ledger: string | null | undefined) => {
    const t = typeof ledger === 'string' ? ledger.trim() : ''
    if (!t || !t.includes('/beap/ingest')) return null
    return t.replace(':51249/', ':51250/')
  }),
)

vi.mock('../../../handshake/resolvePeerDirectBeapIngestEndpoint', () => ({
  resolveSandboxPeerDirectBeapIngestEndpoint: (...args: unknown[]) =>
    resolveSandboxPeerDirectBeapIngestEndpoint(...args),
}))

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
}))

vi.mock('../../sandboxIngestion', () => ({
  runSandboxIngestionPoll: vi.fn(),
}))

vi.mock('../../sandboxIngestionProduction', () => ({
  buildProductionSandboxIngestionDeps: vi.fn(() => ({})),
}))

vi.mock('../../../internalInference/listInferenceTargets', () => ({
  hasActiveInternalLedgerSandboxToHostForHostAi: vi.fn(async () => false),
  registerP2pEnsureCacheInvalidator: vi.fn(),
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
    ...over,
  } as unknown as HandshakeRecord
}

describe('shouldHostTriggerDedicatedSandboxPoll', () => {
  beforeEach(() => {
    topologyKind.value = 'none'
    ownershipState.thisNodeRole = 'host'
    ownershipState.hostShouldReadPoll = true
  })

  it('returns false on single-machine (host reads poll locally)', async () => {
    topologyKind.value = 'single_machine'
    ownershipState.hostShouldReadPoll = true
    expect(await shouldHostTriggerDedicatedSandboxPoll({})).toBe(false)
  })

  it('returns false when host still owns read-poll', async () => {
    topologyKind.value = 'dedicated'
    ownershipState.hostShouldReadPoll = true
    expect(await shouldHostTriggerDedicatedSandboxPoll({})).toBe(false)
  })

  it('returns true only for dedicated delegated host', async () => {
    topologyKind.value = 'dedicated'
    ownershipState.hostShouldReadPoll = false
    expect(await shouldHostTriggerDedicatedSandboxPoll({})).toBe(true)
  })

  it('returns true for misclassified single_machine when distinct host/sandbox device ids (two-device override)', async () => {
    topologyKind.value = 'single_machine'
    ownershipState.hostShouldReadPoll = false
    getInstanceId.mockReturnValue('8929353a')
    listHandshakeRecords.mockReturnValue([
      hostToSandboxRecord({
        initiator_coordination_device_id: '8929353a',
        acceptor_coordination_device_id: '4a90a60b',
        topology_pairing_kind: 'local_inner_vm',
        p2p_endpoint: 'http://192.168.178.28:51250/beap/ingest',
      }),
    ])
    expect(await shouldHostTriggerDedicatedSandboxPoll({})).toBe(true)
  })

  it('returns false for in-host VM loopback + deliberate local_inner_vm even with distinct device ids', async () => {
    topologyKind.value = 'single_machine'
    ownershipState.hostShouldReadPoll = false
    getInstanceId.mockReturnValue('dev-ws-1')
    listHandshakeRecords.mockReturnValue([
      hostToSandboxRecord({
        topology_pairing_kind: 'local_inner_vm',
        p2p_endpoint: 'http://127.0.0.1:51249/beap/ingest',
      }),
    ])
    expect(await shouldHostTriggerDedicatedSandboxPoll({})).toBe(false)
  })

  it('returns false when topology is none (linux-native / unpaired)', async () => {
    topologyKind.value = 'none'
    ownershipState.hostShouldReadPoll = false
    listHandshakeRecords.mockReturnValue([])
    expect(await shouldHostTriggerDedicatedSandboxPoll({})).toBe(false)
  })

  it('emits [IngestionTriggerDecision] with topology, device ids, and decision', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    topologyKind.value = 'single_machine'
    ownershipState.hostShouldReadPoll = false
    getInstanceId.mockReturnValue('8929353a')
    listHandshakeRecords.mockReturnValue([
      hostToSandboxRecord({
        initiator_coordination_device_id: '8929353a',
        acceptor_coordination_device_id: '4a90a60b',
        topology_pairing_kind: 'local_inner_vm',
        p2p_endpoint: 'http://192.168.178.28:51250/beap/ingest',
      }),
    ])
    await shouldHostTriggerDedicatedSandboxPoll({})
    const line = logSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes('[IngestionTriggerDecision]'))
    expect(line).toBeDefined()
    expect(line).toContain('topology=single_machine')
    expect(line).toContain('two_device_pair=true')
    expect(line).toContain('host_device_id=8929353a')
    expect(line).toContain('peer_sandbox_device_id=4a90a60b')
    expect(line).toContain('decision=trigger')
    logSpy.mockRestore()
  })
})

describe('sendDedicatedSandboxIngestionPollTriggerViaDirectHttp', () => {
  beforeEach(() => {
    topologyKind.value = 'dedicated'
    ownershipState.thisNodeRole = 'host'
    ownershipState.hostShouldReadPoll = false
    getInstanceId.mockReturnValue('dev-ws-1')
    listHandshakeRecords.mockReturnValue([hostToSandboxRecord()])
  })

  it('posts ingestion_poll_request and maps synchronous counts ack (no host fetch)', async () => {
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
    expect(out.trigger.delivered).toBe(2)
    expect(out.trigger.held).toBe(1)
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://10.0.0.2:51250/beap/ingest',
        bearer: 'host-bearer',
        wire: expect.objectContaining({
          type: 'ingestion_poll_request',
          account_id: 'acc-1',
          sender_device_id: 'dev-ws-1',
          target_device_id: 'dev-sand-1',
        }),
      }),
    )
  })

  it('rejects when in-host VM delegated host (loopback local_inner_vm)', async () => {
    topologyKind.value = 'single_machine'
    listHandshakeRecords.mockReturnValue([
      hostToSandboxRecord({
        topology_pairing_kind: 'local_inner_vm',
        p2p_endpoint: 'http://127.0.0.1:51249/beap/ingest',
      }),
    ])
    const out = await sendDedicatedSandboxIngestionPollTriggerViaDirectHttp({}, { accountId: 'acc-1' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.code).toBe('E_INGESTION_POLL_NOT_APPLICABLE')
  })

  it('fails with peer endpoint error when ingest URL cannot be resolved', async () => {
    resolveSandboxPeerDirectBeapIngestEndpoint.mockReturnValueOnce(null)
    listHandshakeRecords.mockReturnValue([
      hostToSandboxRecord({ p2p_endpoint: 'http://coordination:51249/beap/capsule' }),
    ])
    const out = await sendDedicatedSandboxIngestionPollTriggerViaDirectHttp({}, { accountId: 'acc-1' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.code).toBe('E_INGESTION_POLL_PEER_ENDPOINT')
  })
})

describe('handleIngestionPollRequest — sandbox receiver', () => {
  const runPoll = vi.fn()

  beforeEach(() => {
    runPoll.mockReset()
    runPoll.mockResolvedValue({
      status: 'ok',
      fetched: 1,
      depackaged: 1,
      delivered: 1,
      held: 0,
    })
    getInstanceId.mockReturnValue('dev-sand-1')
  })

  it('runs exactly one poll per trigger with production deps builder', async () => {
    const buildDeps = vi.fn(() => ({ mocked: true }))
    const wire = makeIngestionPollRequestWire({
      handshake_id: 'hs-dedicated-1',
      account_id: 'acc-sandbox',
      sender_device_id: 'dev-ws-1',
      target_device_id: 'dev-sand-1',
    })

    const out = await handleIngestionPollRequest(wire, 'dev-sand-1', {
      db: { test: true },
      getRecord: () => hostToSandboxRecord(),
      runPoll,
      buildDeps,
    })

    expect(out.type).toBe('ingestion_poll_result')
    if (out.type !== 'ingestion_poll_result') return
    expect(out.fetched).toBe(1)
    expect(out.delivered).toBe(1)
    expect(runPoll).toHaveBeenCalledTimes(1)
    expect(runPoll).toHaveBeenCalledWith({
      accountId: 'acc-sandbox',
      deps: { mocked: true },
    })
    expect(buildDeps).toHaveBeenCalledWith('acc-sandbox', { test: true })
  })

  it('rejects wrong target_device_id without running poll', async () => {
    const wire = makeIngestionPollRequestWire({
      handshake_id: 'hs-dedicated-1',
      account_id: 'acc-sandbox',
      target_device_id: 'wrong-device',
    })
    const out = await handleIngestionPollRequest(wire, 'dev-sand-1', {
      db: {},
      getRecord: () => hostToSandboxRecord(),
      runPoll,
    })
    expect(out.type).toBe('ingestion_poll_error')
    expect(runPoll).not.toHaveBeenCalled()
  })
})

describe('sandbox egress allowlist — ingestion_poll_* must stay off outbound', () => {
  it('ingestion poll service types are not sandbox-outbound allowlisted', () => {
    for (const t of ['ingestion_poll_request', 'ingestion_poll_result', 'ingestion_poll_error']) {
      expect(SANDBOX_OUTBOUND_ALLOWED_TYPES.has(t)).toBe(false)
      expect(isSandboxAllowedOutboundType(t)).toBe(false)
      const cls = classifySandboxOutboundCapsule({ type: t })
      expect(cls.allowed).toBe(false)
      expect(cls.dataPlane).toBe(true)
    }
  })

  it('isIngestionPollServiceRpcShape detects wire family without widening allowlist', () => {
    expect(isIngestionPollServiceRpcShape({ type: 'ingestion_poll_request' })).toBe(true)
    expect(SANDBOX_OUTBOUND_ALLOWED_TYPES.has('ingestion_poll_request')).toBe(false)
  })
})
