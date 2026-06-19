/**
 * PROMPT 1 — dedicated sandbox must not self-initiate ingestion pulls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IngestionOwnership } from '../ingestionOwnership'

const getAccountConfig = vi.fn()
const getAccount = vi.fn()
const runSandboxIngestionPoll = vi.fn()
const dedicatedFetchNode = vi.hoisted(() => ({ value: false }))
const topologyKind = vi.hoisted(() => ({ value: 'none' as 'single_machine' | 'dedicated' | 'none' }))
const hostTriggerMock = vi.hoisted(() => ({
  shouldTrigger: vi.fn(() => Promise.resolve(false)),
  sendTrigger: vi.fn(),
}))

const ownershipState = vi.hoisted(() => ({
  value: {
    owner: 'host',
    thisNodeRole: 'host',
    hostShouldReadPoll: true,
    sandboxShouldReadPoll: false,
    reason: 'test-default',
  } as IngestionOwnership,
}))

vi.mock('../gateway', () => ({
  emailGateway: {
    getAccountConfig: (...args: unknown[]) => getAccountConfig(...args),
    getAccount: (...args: unknown[]) => getAccount(...args),
    listAccounts: vi.fn(async () => []),
    updateAccount: vi.fn(),
  },
}))

vi.mock('../handshake/sandboxTopologyKind', () => ({
  resolveSandboxTopologyKind: () => topologyKind.value,
}))

vi.mock('../ingestionPollTrigger/hostTrigger', () => ({
  shouldHostTriggerDedicatedSandboxPoll: (...args: unknown[]) => hostTriggerMock.shouldTrigger(...args),
  sendDedicatedSandboxIngestionPollTrigger: (...args: unknown[]) => hostTriggerMock.sendTrigger(...args),
}))

vi.mock('../sandboxIngestion', () => ({
  runSandboxIngestionPoll: (...args: unknown[]) => runSandboxIngestionPoll(...args),
}))

vi.mock('../sandboxIngestionProduction', () => ({
  buildProductionSandboxIngestionDeps: vi.fn(() => ({})),
}))

vi.mock('../internalInference/listInferenceTargets', () => ({
  hasActiveInternalLedgerSandboxToHostForHostAi: vi.fn(async () => false),
}))

vi.mock('../ingestionOwnership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ingestionOwnership')>()
  class HostReadPollForbiddenError extends Error {
    readonly code = 'E_HOST_READ_POLL_FORBIDDEN' as const
  }
  return {
    ...actual,
    resolveIngestionOwnershipWithLedger: () => Promise.resolve(ownershipState.value),
    isDedicatedSandboxFetchNode: () => Promise.resolve(dedicatedFetchNode.value),
    assertHostMayReadPoll: (site: string, o?: IngestionOwnership) => {
      const own = o ?? ownershipState.value
      if (own.thisNodeRole === 'host' && !own.hostShouldReadPoll) {
        throw new HostReadPollForbiddenError(site)
      }
    },
    HostReadPollForbiddenError,
  }
})

import { syncAccountEmails, startAutoSync } from '../syncOrchestrator'
import { INGESTION_HOST_TRIGGERED_ONLY_SKIP } from '../ingestionOwnership'
import { mapSkipReasonToIpcWarning, HOST_TRIGGERED_HINT } from '../ipcSyncResultShape'

function makeDb(initialRows = 2) {
  let rowCount = initialRows
  return {
    prepare: (sql: string) => ({
      get: (..._args: unknown[]) => {
        if (sql.includes('auto_sync_enabled')) return { auto_sync_enabled: 1 }
        if (sql.includes('FROM inbox_messages')) return { c: rowCount }
        return undefined
      },
      all: (..._args: unknown[]) => {
        if (sql.includes('email_message_id FROM inbox_messages')) {
          return Array.from({ length: rowCount }, (_, i) => ({ email_message_id: `m-${i}` }))
        }
        return []
      },
      run: () => {
        if (sql.includes('INSERT INTO inbox_messages')) rowCount += 1
      },
    }),
    get rowCount() {
      return rowCount
    },
  }
}

describe('syncAccountEmails — dedicated sandbox self-trigger gate', () => {
  beforeEach(() => {
    getAccountConfig.mockReset()
    getAccount.mockReset()
    runSandboxIngestionPoll.mockReset()
    dedicatedFetchNode.value = false
    topologyKind.value = 'none'
    hostTriggerMock.shouldTrigger.mockReset()
    hostTriggerMock.sendTrigger.mockReset()
    hostTriggerMock.shouldTrigger.mockResolvedValue(false)
    ownershipState.value = {
      owner: 'sandbox',
      thisNodeRole: 'sandbox',
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: true,
      reason: 'dedicated sandbox owns ingestion',
    }
  })

  it('dedicated sandbox → skips syncAccountEmailsImpl (no provider list, zero new rows)', async () => {
    dedicatedFetchNode.value = true
    topologyKind.value = 'dedicated'
    getAccountConfig.mockReturnValue({ provider: 'gmail' })
    getAccount.mockRejectedValue(new Error('SANDBOX_SHOULD_NOT_LIST'))

    const db = makeDb(3)
    const before = db.rowCount
    const r = await syncAccountEmails(db as any, { accountId: 'acc-dedicated' })

    expect(r.skipReason).toBe(INGESTION_HOST_TRIGGERED_ONLY_SKIP)
    expect(r.newMessages).toBe(0)
    expect(r.newInboxMessageIds).toEqual([])
    expect(r.listedFromProvider).toBe(0)
    expect(getAccount).not.toHaveBeenCalled()
    expect(db.rowCount).toBe(before)
  })

  it('single-machine host → unchanged (still enters sync body)', async () => {
    dedicatedFetchNode.value = false
    topologyKind.value = 'single_machine'
    ownershipState.value = {
      owner: 'host',
      thisNodeRole: 'host',
      hostShouldReadPoll: true,
      sandboxShouldReadPoll: false,
      reason: 'single-machine host owns ingestion',
    }
    getAccountConfig.mockReturnValue({ provider: 'gmail' })
    getAccount.mockRejectedValue(new Error('SYNC_BODY_REACHED'))

    const r = await syncAccountEmails({} as any, { accountId: 'acc-single' })
    expect(r.skipReason).not.toBe(INGESTION_HOST_TRIGGERED_ONLY_SKIP)
    expect(getAccount).toHaveBeenCalled()
  })

  it('dedicated delegated host → sends poll trigger (host does not fetch locally)', async () => {
    dedicatedFetchNode.value = false
    topologyKind.value = 'dedicated'
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
        requestId: 'req-dedicated',
        pollStatus: 'pending',
        fetched: 0,
        depackaged: 0,
        delivered: 0,
        held: 0,
      },
    })
    getAccountConfig.mockReturnValue({ provider: 'gmail' })
    getAccount.mockRejectedValue(new Error('HOST_SHOULD_NOT_FETCH'))

    const r = await syncAccountEmails({} as any, { accountId: 'acc-host-delegated' })
    expect(r.skipReason).toBe('ingestion_trigger_pending')
    expect(r.skipReason).not.toBe(INGESTION_HOST_TRIGGERED_ONLY_SKIP)
    expect(getAccount).not.toHaveBeenCalled()
    expect(hostTriggerMock.sendTrigger).toHaveBeenCalled()
  })
})

describe('startAutoSync — dedicated sandbox auto timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getAccountConfig.mockReset()
    runSandboxIngestionPoll.mockReset()
    dedicatedFetchNode.value = true
    topologyKind.value = 'dedicated'
    ownershipState.value = {
      owner: 'sandbox',
      thisNodeRole: 'sandbox',
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: true,
      reason: 'dedicated sandbox',
    }
    getAccountConfig.mockReturnValue({ provider: 'imap' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not self-call runSandboxIngestionPoll on dedicated sandbox timer tick', async () => {
    runSandboxIngestionPoll.mockResolvedValue({ status: 'ok', fetched: 0, delivered: 0, held: 0 })
    const db = makeDb()
    const loop = startAutoSync(db as any, 'acc-1', 60_000)
    await vi.runOnlyPendingTimersAsync()
    expect(runSandboxIngestionPoll).not.toHaveBeenCalled()
    loop.stop()
  })
})

describe('mapSkipReasonToIpcWarning — host-triggered copy', () => {
  it('ingestion_host_triggered_only surfaces dedicated-sandbox hint', () => {
    const r = mapSkipReasonToIpcWarning(INGESTION_HOST_TRIGGERED_ONLY_SKIP)
    expect(r.isSkip).toBe(true)
    if (r.isSkip) {
      expect(r.hint).toBe(HOST_TRIGGERED_HINT)
      expect(r.msg).toContain('host device')
    }
  })
})
