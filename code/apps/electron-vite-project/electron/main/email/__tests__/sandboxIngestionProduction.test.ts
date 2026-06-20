/**
 * Production sandbox A2 ingestion wiring — provider router, delivery/custody resolution,
 * and fail-closed HELD paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HandshakeRecord } from '../../handshake/types'
import type { IngestionOwnership } from '../ingestionOwnership'
import type { OAuthTokens } from '../secure-storage'
import type { RoleScopedTokenRecord } from '../roleScopedTokenStore'
import type { SandboxFetchedMessage } from '../sandboxIngestion'

const h = vi.hoisted(() => {
  const SANDBOX_OWNER: IngestionOwnership = {
    owner: 'sandbox',
    thisNodeRole: 'sandbox',
    hostShouldReadPoll: false,
    sandboxShouldReadPoll: true,
    reason: 'test: sandbox owns ingestion',
  }
  const FAKE_TOKENS: OAuthTokens = { accessToken: 'read-at', refreshToken: 'read-rt' } as OAuthTokens
  const FAKE_RECORD: RoleScopedTokenRecord = {
    accountId: 'acc',
    role: 'read',
    tokens: FAKE_TOKENS,
    savedAt: 0,
  }
  const CUSTODY_PUB = 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM='
  const HOST_INGEST = 'http://192.168.178.28:51250/beap/ingest'
  const HOST_TOKEN = 'sandbox-local-p2p-token'

  function baseHandshake(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
    return {
      handshake_id: 'hs-prod-a2',
      state: 'ACTIVE',
      handshake_type: 'internal',
      internal_coordination_identity_complete: true,
      initiator_coordination_device_id: 'dev-sandbox',
      acceptor_coordination_device_id: 'dev-host',
      initiator_device_role: 'sandbox',
      acceptor_device_role: 'host',
      local_role: 'initiator',
      p2p_endpoint: 'http://192.168.178.28:51249/beap/ingest',
      local_p2p_auth_token: HOST_TOKEN,
      local_x25519_public_key_b64: CUSTODY_PUB,
      peer_x25519_public_key_b64: 'peerPubKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      peer_mlkem768_public_key_b64: 'peerMlkemKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ...overrides,
    } as HandshakeRecord
  }

  class SandboxFetchUnsupportedProviderError extends Error {
    readonly code = 'unsupported_provider' as const
    constructor(readonly provider: string) {
      super(`sandbox opaque fetch unsupported for provider: ${provider}`)
      this.name = 'SandboxFetchUnsupportedProviderError'
    }
  }

  return {
    SANDBOX_OWNER,
    FAKE_TOKENS,
    FAKE_RECORD,
    CUSTODY_PUB,
    HOST_INGEST,
    HOST_TOKEN,
    baseHandshake,
    SandboxFetchUnsupportedProviderError,
    mockGetAccountConfig: vi.fn(),
    mockListHandshakeRecords: vi.fn(() => [baseHandshake()]),
    mockResolveIngest: vi.fn(() => ({
      ok: true,
      url: HOST_INGEST,
      resolutionCategory: 'accepted_peer_header',
    })),
    gmailImpl: vi.fn(async (): Promise<SandboxFetchedMessage[]> => [
      { id: 'g1', opaqueBytes: Buffer.from('raw-gmail') },
    ]),
    outlookImpl: vi.fn(async (): Promise<SandboxFetchedMessage[]> => [
      { id: 'o1', opaqueBytes: Buffer.from('raw-outlook') },
    ]),
    transportCalls: [] as Array<{ url: string; token: string; wire: Record<string, unknown> }>,
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getAppPath: () => '/tmp' },
  shell: { openExternal: async () => {} },
}))

vi.mock('../gateway', () => ({
  emailGateway: { getAccountConfig: (id: string) => h.mockGetAccountConfig(id) },
}))

vi.mock('../sandboxEmailFetch', () => ({
  fetchOpaqueViaGmail: (...args: unknown[]) => h.gmailImpl(...args),
  fetchOpaqueViaOutlook: (...args: unknown[]) => h.outlookImpl(...args),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-sandbox',
}))

vi.mock('../../handshake/db', () => ({
  listHandshakeRecords: (...args: unknown[]) => h.mockListHandshakeRecords(...args),
}))

vi.mock('../../internalInference/policy', () => ({
  deriveInternalHostAiPeerRoles: vi.fn(() => ({
    ok: true,
    localRole: 'sandbox',
    peerRole: 'host',
    localCoordinationDeviceId: 'dev-sandbox',
    peerCoordinationDeviceId: 'dev-host',
  })),
  assertRecordForServiceRpc: vi.fn((r: HandshakeRecord | null) =>
    r ? { ok: true as const, record: r } : { ok: false as const, code: 'missing' },
  ),
  outboundP2pBearerToCounterpartyIngest: vi.fn((r: HandshakeRecord) =>
    typeof r.local_p2p_auth_token === 'string' ? r.local_p2p_auth_token.trim() : '',
  ),
}))

vi.mock('../../internalInference/p2pEndpointRepair', () => ({
  resolveSandboxToHostHttpDirectIngest: (...args: unknown[]) => h.mockResolveIngest(...args),
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: vi.fn(() => ({ use_coordination: false, coordination_url: '' })),
}))

vi.mock('../../critical-jobs/featureFlags', () => ({
  isCriticalJobsEnabled: vi.fn(() => false),
}))

vi.mock('../../critical-jobs/liveDepackageCutover', () => ({
  dispatchDepackageEmail: vi.fn(),
}))

vi.mock('../ingestionOwnership', () => ({
  resolveIngestionOwnershipWithLedger: vi.fn(),
}))

vi.mock('../roleScopedTokenStore', () => ({
  loadRoleScopedTokens: vi.fn(),
}))

describe('fetchOpaqueForProviderAccount — provider router', () => {
  beforeEach(() => {
    h.gmailImpl.mockClear()
    h.outlookImpl.mockClear()
    h.mockGetAccountConfig.mockReset()
  })

  it('routes gmail → fetchOpaqueViaGmail', async () => {
    h.mockGetAccountConfig.mockReturnValue({ provider: 'gmail' })
    const { fetchOpaqueForProviderAccount } = await import('../sandboxOpaqueFetchRouter')
    const rows = await fetchOpaqueForProviderAccount('acc-gmail', h.FAKE_RECORD)
    expect(rows[0]?.id).toBe('g1')
    expect(h.gmailImpl).toHaveBeenCalled()
    expect(h.outlookImpl).not.toHaveBeenCalled()
  })

  it('routes microsoft365 → fetchOpaqueViaOutlook', async () => {
    h.mockGetAccountConfig.mockReturnValue({ provider: 'microsoft365' })
    const { fetchOpaqueForProviderAccount } = await import('../sandboxOpaqueFetchRouter')
    await fetchOpaqueForProviderAccount('acc-outlook', h.FAKE_RECORD)
    expect(h.outlookImpl).toHaveBeenCalled()
    expect(h.gmailImpl).not.toHaveBeenCalled()
  })

  it('unsupported provider → fail-closed typed error', async () => {
    h.mockGetAccountConfig.mockReturnValue({ provider: 'imap' })
    const { fetchOpaqueForProviderAccount, SandboxFetchUnsupportedProviderError } = await import(
      '../sandboxOpaqueFetchRouter',
    )
    await expect(fetchOpaqueForProviderAccount('acc-imap', h.FAKE_RECORD)).rejects.toBeInstanceOf(
      SandboxFetchUnsupportedProviderError,
    )
  })
})

describe('sandboxIngestionProduction — custody + delivery resolution', () => {
  it('resolves custody from sandbox local_x25519_public_key_b64', async () => {
    const { resolveSandboxCustodyPubKeyB64 } = await import('../sandboxIngestionProduction')
    expect(resolveSandboxCustodyPubKeyB64({})).toBe(h.CUSTODY_PUB)
  })

  it('resolves host delivery endpoint + outbound bearer', async () => {
    const { resolveSandboxHostDeliveryContext } = await import('../sandboxIngestionProduction')
    expect(resolveSandboxHostDeliveryContext({})).toEqual({
      handshakeId: 'hs-prod-a2',
      hostEndpoint: h.HOST_INGEST,
      hostP2pToken: h.HOST_TOKEN,
    })
  })
})

describe('buildProductionSandboxIngestionDeps — production poll path', () => {
  it('fetch → depackage → deliver: INV-2 token not in wire payload', async () => {
    h.mockGetAccountConfig.mockReturnValue({ provider: 'gmail' })
    h.transportCalls.length = 0

    const mockTransport = vi.fn(async (args: { url: string; token: string; wire: Record<string, unknown> }) => {
      h.transportCalls.push(args)
      return { ok: true, inboxRowId: 'host-row-1' }
    })

    const { buildProductionSandboxIngestionDeps } = await import('../sandboxIngestionProduction')
    const { runSandboxIngestionPoll } = await import('../sandboxIngestion')

    const r = await runSandboxIngestionPoll({
      accountId: 'acc-gmail',
      deps: {
        ...buildProductionSandboxIngestionDeps({}, { deliveryTransport: mockTransport }),
        ownership: h.SANDBOX_OWNER,
        listReadScopedAccountIds: () => ['acc-gmail'],
        loadReadToken: () => ({
          accountId: 'acc-gmail',
          role: 'read',
          tokens: h.FAKE_TOKENS,
          savedAt: 0,
        }),
        depackage: async () => ({
          ok: true,
          result: {
            ok: true,
            type: 'plain',
            safeText: { subject: 's', body_text: 't', attachment_refs: [] },
            artifacts: [],
            displayEnvelope: { from: undefined, to: [], cc: [], subject: 's', date: '' },
          },
        }),
      },
    })

    expect(r.ok).toBe(true)
    expect(r.fetched).toBe(1)
    expect(r.delivered).toBe(1)
    expect(h.transportCalls).toHaveLength(1)
    expect(h.transportCalls[0]!.url).toBe(h.HOST_INGEST)
    expect(h.transportCalls[0]!.token).toBe(h.HOST_TOKEN)
    expect(JSON.stringify(h.transportCalls[0]!.wire)).not.toContain(h.HOST_TOKEN)
    expect(h.transportCalls[0]!.wire).not.toHaveProperty('token')
  })
})

describe('buildProductionSandboxIngestionDeps — fail-closed HELD modes', () => {
  beforeEach(() => {
    h.mockListHandshakeRecords.mockReturnValue([h.baseHandshake()])
    h.mockResolveIngest.mockReturnValue({
      ok: true,
      url: h.HOST_INGEST,
      resolutionCategory: 'accepted_peer_header',
    })
    h.mockGetAccountConfig.mockReturnValue({ provider: 'gmail' })
  })

  it('held_no_custody_key when local X25519 public key missing', async () => {
    h.mockListHandshakeRecords.mockReturnValueOnce([
      h.baseHandshake({ local_x25519_public_key_b64: null }),
    ])
    const { buildProductionSandboxIngestionDeps } = await import('../sandboxIngestionProduction')
    const { runSandboxIngestionPoll } = await import('../sandboxIngestion')
    const fetchOpaque = vi.fn()
    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: {
        ...buildProductionSandboxIngestionDeps({}),
        ownership: h.SANDBOX_OWNER,
        listReadScopedAccountIds: () => ['acc'],
        loadReadToken: () => ({ accountId: 'acc', role: 'read', tokens: h.FAKE_TOKENS, savedAt: 0 }),
        fetchOpaque,
      },
    })
    expect(r.status).toBe('held_no_custody_key')
    expect(fetchOpaque).not.toHaveBeenCalled()
  })

  it('held_fetch_failed for unsupported provider', async () => {
    h.mockGetAccountConfig.mockReturnValue({ provider: 'imap' })
    const { buildProductionSandboxIngestionDeps } = await import('../sandboxIngestionProduction')
    const { runSandboxIngestionPoll } = await import('../sandboxIngestion')
    const deliverToHost = vi.fn()
    const r = await runSandboxIngestionPoll({
      accountId: 'acc-imap',
      deps: {
        ...buildProductionSandboxIngestionDeps({}),
        ownership: h.SANDBOX_OWNER,
        listReadScopedAccountIds: () => ['acc-imap'],
        loadReadToken: () => ({
          accountId: 'acc-imap',
          role: 'read',
          tokens: h.FAKE_TOKENS,
          savedAt: 0,
        }),
        deliverToHost,
      },
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('held_fetch_failed')
    expect(r.errors[0]).toContain('unsupported for provider')
    expect(deliverToHost).not.toHaveBeenCalled()
  })

  it('per-message HELD when host delivery endpoint unresolved', async () => {
    h.mockResolveIngest.mockReturnValueOnce({
      ok: false,
      code: 'HOST_AI_DIRECT_PEER_BEAP_MISSING',
      resolutionCategory: 'rejected_no_peer_ad',
    })
    const { buildProductionSandboxIngestionDeps } = await import('../sandboxIngestionProduction')
    const { runSandboxIngestionPoll } = await import('../sandboxIngestion')
    const r = await runSandboxIngestionPoll({
      accountId: 'acc-gmail',
      deps: {
        ...buildProductionSandboxIngestionDeps({}),
        ownership: h.SANDBOX_OWNER,
        listReadScopedAccountIds: () => ['acc-gmail'],
        loadReadToken: () => ({
          accountId: 'acc-gmail',
          role: 'read',
          tokens: h.FAKE_TOKENS,
          savedAt: 0,
        }),
        depackage: async () => ({
          ok: true,
          result: {
            ok: true,
            type: 'plain',
            safeText: { subject: 's', body_text: 't', attachment_refs: [] },
            artifacts: [],
            displayEnvelope: { from: undefined, to: [], cc: [], subject: 's', date: '' },
          },
        }),
      },
    })
    expect(r.fetched).toBe(1)
    expect(r.depackaged).toBe(1)
    expect(r.delivered).toBe(0)
    expect(r.held).toBe(1)
  })
})

describe('single-machine / host path unchanged', () => {
  it('host node with sandboxShouldReadPoll=false still no-ops', async () => {
    const { runSandboxIngestionPoll } = await import('../sandboxIngestion')
    const fetchOpaque = vi.fn()
    const r = await runSandboxIngestionPoll({
      accountId: 'acc',
      deps: {
        ownership: {
          owner: 'sandbox',
          thisNodeRole: 'host',
          hostShouldReadPoll: false,
          sandboxShouldReadPoll: false,
          reason: 'host delegated',
        },
        fetchOpaque,
      },
    })
    expect(r.status).toBe('not_owner')
    expect(fetchOpaque).not.toHaveBeenCalled()
  })
})
