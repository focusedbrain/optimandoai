import { describe, it, expect, vi, beforeEach } from 'vitest'

const hasLinkedDepackageSandbox = vi.fn<[], boolean>()
const getOrchestratorMode = vi.fn<[], { mode: 'host' | 'sandbox' }>()

vi.mock('../opaqueIngestion', () => ({
  hasLinkedDepackageSandbox: () => hasLinkedDepackageSandbox(),
}))
vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getOrchestratorMode: () => getOrchestratorMode(),
}))

import {
  resolveIngestionOwnership,
  assertHostMayReadPoll,
  HostReadPollForbiddenError,
  thisNodeMayPerformRemoteProviderMutations,
  SANDBOX_REMOTE_MUTATIONS_HOST_ONLY,
} from '../ingestionOwnership'

describe('ingestionOwnership — fetch-ownership single source of truth (Prompt 3)', () => {
  beforeEach(() => {
    hasLinkedDepackageSandbox.mockReset()
    getOrchestratorMode.mockReset()
  })

  it('single-machine (no linked sandbox): host OWNS ingestion and read-polls', () => {
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })

    const o = resolveIngestionOwnership()
    expect(o.owner).toBe('host')
    expect(o.thisNodeRole).toBe('host')
    expect(o.hostShouldReadPoll).toBe(true)
    expect(o.sandboxShouldReadPoll).toBe(false)
    // Tripwire is inert when host owns ingestion.
    expect(() => assertHostMayReadPoll('test', o)).not.toThrow()
  })

  it('multi-machine (linked sandbox) on the HOST node: host read-poll DISABLED', () => {
    hasLinkedDepackageSandbox.mockReturnValue(true)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })

    const o = resolveIngestionOwnership()
    expect(o.owner).toBe('sandbox')
    expect(o.thisNodeRole).toBe('host')
    expect(o.hostShouldReadPoll).toBe(false)
    expect(o.sandboxShouldReadPoll).toBe(false)
    // Tripwire fires: the host must never read-poll while a sandbox owns ingestion.
    expect(() => assertHostMayReadPoll('host.fetch', o)).toThrow(HostReadPollForbiddenError)
  })

  it('multi-machine (linked sandbox) on the SANDBOX node: sandbox runs the read-poll', () => {
    hasLinkedDepackageSandbox.mockReturnValue(true)
    getOrchestratorMode.mockReturnValue({ mode: 'sandbox' })

    const o = resolveIngestionOwnership()
    expect(o.owner).toBe('sandbox')
    expect(o.thisNodeRole).toBe('sandbox')
    expect(o.hostShouldReadPoll).toBe(false)
    expect(o.sandboxShouldReadPoll).toBe(true)
    // Tripwire is for the host only; on the sandbox it never throws.
    expect(() => assertHostMayReadPoll('sandbox', o)).not.toThrow()
  })

  it('derives ownership from the SAME topology signal as isOpaqueIngestionActive (no parallel flag)', () => {
    // Ownership only flips on a real LINKED sandbox — not on the courier flag.
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
    expect(resolveIngestionOwnership().owner).toBe('host')

    hasLinkedDepackageSandbox.mockReturnValue(true)
    expect(resolveIngestionOwnership().owner).toBe('sandbox')
  })

  it('never throws when the mode store is unavailable (defaults to host-owned)', () => {
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockImplementation(() => {
      throw new Error('mode store unavailable')
    })
    const o = resolveIngestionOwnership()
    expect(o.thisNodeRole).toBe('host')
    expect(o.owner).toBe('host')
    expect(o.hostShouldReadPoll).toBe(true)
  })
})

// ── Regression: sandbox role from ledger (stale orchestrator-mode.json) ───────
//
// Root cause: accepting an internal handshake in sandbox role writes
// acceptor_device_role='sandbox' to the handshake ledger but NEVER writes
// orchestrator-mode.json.mode='sandbox' (no sync-back exists). Without the
// opts.ledgerProvesSandbox path, a correctly-paired sandbox was treated as
// host: isSandbox=false, hostShouldReadPoll=true → pulled mail locally.

describe('resolveIngestionOwnership — REGRESSION: stale orchestrator-mode.json, ledger proves sandbox', () => {
  beforeEach(() => {
    hasLinkedDepackageSandbox.mockReset()
    getOrchestratorMode.mockReset()
  })

  it('paired sandbox with stale mode=host: ledgerProvesSandbox=true → sandboxShouldReadPoll=true, owner=sandbox', () => {
    // orchestrator-mode.json still says 'host' (never sync-backed after accept)
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })

    const o = resolveIngestionOwnership({ ledgerProvesSandbox: true })
    expect(o.owner).toBe('sandbox')
    expect(o.thisNodeRole).toBe('sandbox')
    expect(o.sandboxShouldReadPoll).toBe(true)
    expect(o.hostShouldReadPoll).toBe(false)
  })

  it('host node (mode=host, ledgerProvesSandbox=false): unchanged — stays host', () => {
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })

    const o = resolveIngestionOwnership({ ledgerProvesSandbox: false })
    expect(o.owner).toBe('host')
    expect(o.hostShouldReadPoll).toBe(true)
    expect(o.sandboxShouldReadPoll).toBe(false)
  })

  it('single-machine (mode=host, no linked sandbox, no ledger): unchanged', () => {
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })

    // No opts = no ledger value injected → backward-compatible sync path
    const o = resolveIngestionOwnership()
    expect(o.owner).toBe('host')
    expect(o.hostShouldReadPoll).toBe(true)
    expect(o.sandboxShouldReadPoll).toBe(false)
  })

  it('stale sandbox + linked sandbox entry: both signals agree → sandboxShouldReadPoll=true', () => {
    // Edge: linked entry exists on sandbox (unlikely but must not break)
    hasLinkedDepackageSandbox.mockReturnValue(true)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })

    const o = resolveIngestionOwnership({ ledgerProvesSandbox: true })
    expect(o.owner).toBe('sandbox')
    expect(o.sandboxShouldReadPoll).toBe(true)
  })

  it('mode=sandbox + ledgerProvesSandbox=true: effective sandbox, no double-counting issue', () => {
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockReturnValue({ mode: 'sandbox' })

    const o = resolveIngestionOwnership({ ledgerProvesSandbox: true })
    expect(o.owner).toBe('sandbox')
    expect(o.sandboxShouldReadPoll).toBe(true)
    expect(o.thisNodeRole).toBe('sandbox')
  })
})

describe('thisNodeMayPerformRemoteProviderMutations — PROMPT 5 host-only remote lifecycle', () => {
  beforeEach(() => {
    hasLinkedDepackageSandbox.mockReset()
    getOrchestratorMode.mockReset()
  })

  it('single-machine host may perform remote provider mutations', () => {
    hasLinkedDepackageSandbox.mockReturnValue(false)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
    expect(thisNodeMayPerformRemoteProviderMutations()).toBe(true)
  })

  it('delegated host may perform remote provider mutations', () => {
    hasLinkedDepackageSandbox.mockReturnValue(true)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
    expect(thisNodeMayPerformRemoteProviderMutations()).toBe(true)
  })

  it('sandbox node is denied remote provider mutations', () => {
    hasLinkedDepackageSandbox.mockReturnValue(true)
    getOrchestratorMode.mockReturnValue({ mode: 'sandbox' })
    expect(thisNodeMayPerformRemoteProviderMutations()).toBe(false)
  })

  it('exports stable skip reason token for enqueue/drain policy gate', () => {
    expect(SANDBOX_REMOTE_MUTATIONS_HOST_ONLY).toBe('sandbox_remote_mutations_host_only')
  })
})
