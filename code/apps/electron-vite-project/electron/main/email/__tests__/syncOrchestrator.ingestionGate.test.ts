/**
 * Prompt 3 — host read-poll OWNERSHIP gate in the sync orchestrator.
 *
 * Proves the safety-critical half of the A2 relocation: when a linked sandbox
 * owns email ingestion, the host performs NO list / NO detail fetch / NO parse
 * (it returns early with `skipReason: 'ingestion_delegated_to_sandbox'`); and the
 * single-machine path is UNCHANGED (host owns ingestion → enters the sync body
 * and fetches as today, Prompt 1 courier/legacy).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IngestionOwnership } from '../ingestionOwnership'

const getAccountConfig = vi.fn()
const getAccount = vi.fn()

vi.mock('../gateway', () => ({
  emailGateway: {
    getAccountConfig: (...args: unknown[]) => getAccountConfig(...args),
    getAccount: (...args: unknown[]) => getAccount(...args),
  },
}))

// Configurable ownership; `assertHostMayReadPoll` keeps its real semantics so the
// in-body tripwire would also fire if the early-return gate were ever removed.
// `vi.hoisted` so these exist when the (hoisted) `vi.mock` factory runs.
const ownershipState = vi.hoisted(() => ({
  value: {
    owner: 'host',
    thisNodeRole: 'host',
    hostShouldReadPoll: true,
    sandboxShouldReadPoll: false,
    reason: 'test-default',
  } as IngestionOwnership,
}))
const hostTriggerMock = vi.hoisted(() => ({
  shouldTrigger: vi.fn(() => Promise.resolve(false)),
  sendTrigger: vi.fn(),
}))
vi.mock('../ingestionPollTrigger/hostTrigger', () => ({
  shouldHostTriggerDedicatedSandboxPoll: (...args: unknown[]) => hostTriggerMock.shouldTrigger(...args),
  sendDedicatedSandboxIngestionPollTrigger: (...args: unknown[]) => hostTriggerMock.sendTrigger(...args),
}))
vi.mock('../ingestionOwnership', () => {
  class HostReadPollForbiddenError extends Error {
    readonly code = 'E_HOST_READ_POLL_FORBIDDEN' as const
  }
  return {
    // syncOrchestrator now calls the async with-ledger variant
    resolveIngestionOwnershipWithLedger: () => Promise.resolve(ownershipState.value),
    isDedicatedSandboxFetchNode: () => Promise.resolve(false),
    INGESTION_HOST_TRIGGERED_ONLY_SKIP: 'ingestion_host_triggered_only',
    assertHostMayReadPoll: (site: string, o?: IngestionOwnership) => {
      const own = o ?? ownershipState.value
      if (own.thisNodeRole === 'host' && !own.hostShouldReadPoll) {
        throw new HostReadPollForbiddenError(site)
      }
    },
    HostReadPollForbiddenError,
  }
})

import { syncAccountEmails } from '../syncOrchestrator'

describe('syncAccountEmails — Prompt 3 ingestion-ownership gate', () => {
  beforeEach(() => {
    getAccountConfig.mockReset()
    getAccount.mockReset()
    hostTriggerMock.shouldTrigger.mockReset()
    hostTriggerMock.sendTrigger.mockReset()
    hostTriggerMock.shouldTrigger.mockResolvedValue(false)
  })

  it('linked sandbox owns ingestion + host node (non-dedicated) → host does NOT read-poll (no fetch, no parse)', async () => {
    getAccountConfig.mockReturnValue({ provider: 'gmail' })
    // The host should NEVER reach provider work; if it did, this would throw.
    getAccount.mockRejectedValue(new Error('HOST_SHOULD_NOT_FETCH'))
    ownershipState.value = {
      owner: 'sandbox',
      thisNodeRole: 'host',
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: false,
      reason: 'linked sandbox owns ingestion',
    }

    const r = await syncAccountEmails({} as any, { accountId: 'acc-multi' })
    expect(r.ok).toBe(true)
    expect(r.skipReason).toBe('ingestion_delegated_to_sandbox')
    expect(r.listedFromProvider).toBe(0)
    expect(r.newMessages).toBe(0)
    expect(r.newInboxMessageIds).toEqual([])
    // INV: host performed no provider read work at all.
    expect(getAccount).not.toHaveBeenCalled()
    expect(hostTriggerMock.sendTrigger).not.toHaveBeenCalled()
  })

  it('dedicated delegated host → sends ingestion poll trigger instead of local fetch', async () => {
    getAccountConfig.mockReturnValue({ provider: 'gmail' })
    getAccount.mockRejectedValue(new Error('HOST_SHOULD_NOT_FETCH'))
    ownershipState.value = {
      owner: 'sandbox',
      thisNodeRole: 'host',
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: false,
      reason: 'linked sandbox owns ingestion',
    }
    hostTriggerMock.shouldTrigger.mockResolvedValue(true)
    hostTriggerMock.sendTrigger.mockResolvedValue({
      ok: true,
      trigger: {
        requestId: 'req-1',
        pollStatus: 'ok',
        fetched: 2,
        depackaged: 2,
        delivered: 1,
        held: 0,
      },
    })

    const r = await syncAccountEmails({} as any, { accountId: 'acc-dedicated-host' })
    expect(r.ok).toBe(true)
    expect(r.skipReason).toBe('ingestion_triggered_to_sandbox')
    expect(r.ingestionPollTrigger?.fetched).toBe(2)
    expect(r.ingestionPollTrigger?.delivered).toBe(1)
    expect(getAccount).not.toHaveBeenCalled()
    expect(hostTriggerMock.sendTrigger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acc-dedicated-host' }),
    )
  })

  it('single-machine (host owns ingestion) → enters sync body and fetches as today', async () => {
    getAccountConfig.mockReturnValue({ provider: 'gmail' })
    getAccount.mockRejectedValue(new Error('SYNC_BODY_REACHED'))
    ownershipState.value = {
      owner: 'host',
      thisNodeRole: 'host',
      hostShouldReadPoll: true,
      sandboxShouldReadPoll: false,
      reason: 'no linked sandbox → host owns ingestion',
    }

    const r = await syncAccountEmails({} as any, { accountId: 'acc-single' })
    expect(r.skipReason).not.toBe('ingestion_delegated_to_sandbox')
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('SYNC_BODY_REACHED'))).toBe(true)
    // Host DID begin provider work (single-machine path unchanged).
    expect(getAccount).toHaveBeenCalled()
  })
})
