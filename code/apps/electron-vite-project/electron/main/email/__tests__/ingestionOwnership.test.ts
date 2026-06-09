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
