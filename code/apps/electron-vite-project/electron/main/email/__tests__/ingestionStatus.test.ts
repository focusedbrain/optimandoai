/**
 * UX-1 — resolveIngestionStatus() unit tests.
 *
 * Each test drives one of the six IngestionStatusCode values through real
 * combinations of:
 *   • resolveIngestionOwnershipWithLedger() output (mocked)
 *   • hasRoleScopedTokens(id, 'read') (mocked)
 *   • getLastSandboxPollOutcomes() store (mocked)
 *
 * The tests also verify INV-5: the result never carries message content,
 * only codes/counters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (must appear before the import under test) ─────────────────────────

const mockResolveIngestionOwnership = vi.fn()
const mockHasRoleScopedTokens = vi.fn<[string, 'send' | 'read'], boolean>()
const mockGetLastSandboxPollOutcomes = vi.fn<[], Map<string, any>>()

vi.mock('../ingestionOwnership', () => ({
  // resolveIngestionStatus now calls the async with-ledger variant
  resolveIngestionOwnershipWithLedger: () => Promise.resolve(mockResolveIngestionOwnership()),
}))
vi.mock('../roleScopedTokenStore', () => ({
  hasRoleScopedTokens: (id: string, role: 'send' | 'read') => mockHasRoleScopedTokens(id, role),
}))
vi.mock('../sandboxIngestion', () => ({
  getLastSandboxPollOutcomes: () => mockGetLastSandboxPollOutcomes(),
}))

import { resolveIngestionStatus, type IngestionStatusResult, _setIngestionStatusTopologyKindForTests } from '../ingestionStatus'
import { _resetHostIngestionPollAcksForTests, recordHostIngestionPollAck, recordHostIngestionPollUnreachable } from '../ingestionPollTrigger/hostAckStore'

// ── Helpers ──────────────────────────────────────────────────────────────────

function singleMachineOwnership() {
  return {
    owner: 'host',
    thisNodeRole: 'host',
    hostShouldReadPoll: true,
    sandboxShouldReadPoll: false,
    reason: 'single-machine-host',
  }
}

function delegatedOwnershipOnHost() {
  return {
    owner: 'sandbox',
    thisNodeRole: 'host',
    hostShouldReadPoll: false,
    sandboxShouldReadPoll: false,
    reason: 'ingestion_delegated_to_sandbox',
  }
}

function sandboxOwnsOnSandbox() {
  return {
    owner: 'sandbox',
    thisNodeRole: 'sandbox',
    hostShouldReadPoll: false,
    sandboxShouldReadPoll: true,
    reason: 'sandbox-owns',
  }
}

function pollOutcome(status: string, extras: Partial<{
  fetched: number; delivered: number; held: number; errors: string[]
}> = {}) {
  return {
    result: {
      ok: status === 'ok',
      status,
      fetched: extras.fetched ?? 1,
      depackaged: extras.fetched ?? 1,
      delivered: extras.delivered ?? 1,
      held: extras.held ?? 0,
      errors: extras.errors ?? [],
      inboxMessageIds: [],
    },
    at: Date.now(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveIngestionStatus — IngestionStatusCode mapping', () => {
  beforeEach(() => {
    mockResolveIngestionOwnership.mockReset()
    mockHasRoleScopedTokens.mockReset()
    mockGetLastSandboxPollOutcomes.mockReset()
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map())
    _setIngestionStatusTopologyKindForTests(null)
    _resetHostIngestionPollAcksForTests()
  })

  // ── OK_SINGLE_MACHINE ──────────────────────────────────────────────────────

  it('OK_SINGLE_MACHINE — host owns, polling normally', async () => {
    mockResolveIngestionOwnership.mockReturnValue(singleMachineOwnership())
    mockHasRoleScopedTokens.mockReturnValue(false) // irrelevant on host-only
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map())

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('OK_SINGLE_MACHINE')
    expect(res.owner).toBe('host')
    expect(res.hostShouldReadPoll).toBe(true)
    expect(res.sandboxShouldReadPoll).toBe(false)
  })

  it('OK_SINGLE_MACHINE — no accounts provided, still resolves correctly', async () => {
    mockResolveIngestionOwnership.mockReturnValue(singleMachineOwnership())
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map())

    const res = await resolveIngestionStatus([])
    expect(res.code).toBe('OK_SINGLE_MACHINE')
    expect(res.accounts).toHaveLength(0)
  })

  // ── PAUSED_HOST_DELEGATED ──────────────────────────────────────────────────

  it('PAUSED_HOST_DELEGATED — host correctly not polling, sandbox not yet confirmed', async () => {
    mockResolveIngestionOwnership.mockReturnValue(delegatedOwnershipOnHost())
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map())

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('PAUSED_HOST_DELEGATED')
    expect(res.thisNodeRole).toBe('host')
    expect(res.hostShouldReadPoll).toBe(false)
    // ownershipReason carries the real code, not invented
    expect(res.ownershipReason).toBe('ingestion_delegated_to_sandbox')
  })

  it('PAUSED_HOST_DELEGATED — sandbox owns, consent present, but no poll has run yet', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)   // consent present
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map()) // no poll yet

    const res = await resolveIngestionStatus(['acc1'])
    // Consent granted but no evidence a poll ran yet — treat as waiting
    expect(res.code).toBe('PAUSED_HOST_DELEGATED')
  })

  // ── ACTION_NEEDED_READ_CONSENT ─────────────────────────────────────────────

  it('ACTION_NEEDED_READ_CONSENT — sandbox owns, read consent missing for one account', async () => {
    _setIngestionStatusTopologyKindForTests('dedicated')
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    // acc1 has consent, acc2 does not
    mockHasRoleScopedTokens.mockImplementation((id, role) => role === 'read' && id === 'acc1')
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('ok')],
    ]))

    const res = await resolveIngestionStatus(['acc1', 'acc2'])
    expect(res.code).toBe('ACTION_NEEDED_READ_CONSENT')
    // The account missing consent is visible to the renderer
    const missing = res.accounts.find((a) => a.accountId === 'acc2')
    expect(missing?.readConsentPresent).toBe(false)
  })

  it('ACTION_NEEDED_READ_CONSENT — maps to sandboxIngestion held_read_consent_missing', async () => {
    _setIngestionStatusTopologyKindForTests('dedicated')
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(false) // no read consent
    // The sandbox ran a poll and returned held_read_consent_missing
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('held_read_consent_missing', { fetched: 0, delivered: 0 })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('ACTION_NEEDED_READ_CONSENT')
    // Verify the real code from sandboxIngestion is surfaced
    expect(res.accounts[0].lastPollStatus).toBe('held_read_consent_missing')
  })

  // ── OK_SANDBOX_FETCHING ────────────────────────────────────────────────────

  it('OK_SANDBOX_FETCHING — sandbox owns, last poll ok, no held messages', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('ok', { fetched: 3, delivered: 3, held: 0 })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('OK_SANDBOX_FETCHING')
    expect(res.accounts[0].lastPollDelivered).toBe(3)
    expect(res.accounts[0].lastPollHeld).toBe(0)
  })

  it('OK_SANDBOX_FETCHING — sandbox poll ok with zero fetched (inbox empty, still ok)', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('ok', { fetched: 0, delivered: 0, held: 0 })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('OK_SANDBOX_FETCHING')
  })

  // ── PAUSED_SANDBOX_UNREACHABLE ─────────────────────────────────────────────

  it('PAUSED_SANDBOX_UNREACHABLE — sandbox owns, last poll held_fetch_failed', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true) // consent present
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('held_fetch_failed', { fetched: 0, delivered: 0 })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('PAUSED_SANDBOX_UNREACHABLE')
    // Real code from sandboxIngestion.ts is visible
    expect(res.accounts[0].lastPollStatus).toBe('held_fetch_failed')
  })

  it('PAUSED_SANDBOX_UNREACHABLE — held_no_custody_key maps to unreachable (not consent)', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true) // consent present
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('held_no_custody_key', { fetched: 0, delivered: 0 })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    // Not a consent gap — custody key is infra; treated as unreachable
    expect(res.code).toBe('PAUSED_SANDBOX_UNREACHABLE')
  })

  // ── DEGRADED_HELD_MESSAGES ─────────────────────────────────────────────────

  it('DEGRADED_HELD_MESSAGES — fetching ok but individual messages held in depackage', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('ok', { fetched: 5, delivered: 3, held: 2 })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('DEGRADED_HELD_MESSAGES')
    expect(res.accounts[0].lastPollHeld).toBe(2)
    expect(res.accounts[0].lastPollDelivered).toBe(3)
  })

  it('DEGRADED_HELD_MESSAGES — ok on acc1 but acc2 also ok; held on acc2 triggers DEGRADED', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('ok', { held: 0 })],
      ['acc2', pollOutcome('ok', { held: 1 })],
    ]))

    const res = await resolveIngestionStatus(['acc1', 'acc2'])
    expect(res.code).toBe('DEGRADED_HELD_MESSAGES')
  })

  // ── INV-5 compliance ──────────────────────────────────────────────────────

  it('INV-5 — result never contains error message text, only error count', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)
    const secretError = 'SENSITIVE: auth token xyz expired'
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('held_fetch_failed', { errors: [secretError] })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    const json = JSON.stringify(res)
    expect(json).not.toContain(secretError)
    // Count is present, text is not
    expect(res.accounts[0].lastPollErrorCount).toBe(1)
  })

  // ── Structural contract ───────────────────────────────────────────────────

  it('result always includes resolvedAt timestamp', async () => {
    mockResolveIngestionOwnership.mockReturnValue(singleMachineOwnership())
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map())

    const before = Date.now()
    const res = await resolveIngestionStatus([])
    expect(res.resolvedAt).toBeGreaterThanOrEqual(before)
  })

  it('accounts array mirrors the accountIds input order', async () => {
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('ok')],
      ['acc2', pollOutcome('ok')],
      ['acc3', pollOutcome('ok')],
    ]))

    const res = await resolveIngestionStatus(['acc3', 'acc1', 'acc2'])
    expect(res.accounts.map((a) => a.accountId)).toEqual(['acc3', 'acc1', 'acc2'])
  })

  // ── PROMPT 4 dedicated topology ───────────────────────────────────────────

  it('dedicated sandbox, no read accounts → ACTION_NEEDED_READ_CONSENT', async () => {
    _setIngestionStatusTopologyKindForTests('dedicated')
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(false)

    const res = await resolveIngestionStatus([])
    expect(res.code).toBe('ACTION_NEEDED_READ_CONSENT')
    expect(res.sandboxTopologyKind).toBe('dedicated')
  })

  it('single-machine sandbox, missing read consent → silent PAUSED_HOST_DELEGATED', async () => {
    _setIngestionStatusTopologyKindForTests('single_machine')
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(false)

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('PAUSED_HOST_DELEGATED')
    expect(res.sandboxTopologyKind).toBe('single_machine')
  })

  it('dedicated delegated host learns missing read account from trigger ack', async () => {
    _setIngestionStatusTopologyKindForTests('dedicated')
    mockResolveIngestionOwnership.mockReturnValue(delegatedOwnershipOnHost())
    recordHostIngestionPollAck({
      accountId: 'acc-host',
      requestId: 'req-1',
      pollStatus: 'held_read_consent_missing',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
      at: Date.now(),
    })

    const res = await resolveIngestionStatus(['acc-host'])
    expect(res.code).toBe('ACTION_NEEDED_READ_CONSENT')
    expect(res.thisNodeRole).toBe('host')
  })

  it('dedicated delegated host distinguishes fetch failure from missing read account', async () => {
    _setIngestionStatusTopologyKindForTests('dedicated')
    mockResolveIngestionOwnership.mockReturnValue(delegatedOwnershipOnHost())
    recordHostIngestionPollAck({
      accountId: 'acc-host',
      requestId: 'req-2',
      pollStatus: 'held_fetch_failed',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
      at: Date.now(),
    })

    const res = await resolveIngestionStatus(['acc-host'])
    expect(res.code).toBe('PAUSED_SANDBOX_UNREACHABLE')
  })

  it('single_machine delegated host learns trigger_unreachable from ack', async () => {
    _setIngestionStatusTopologyKindForTests('single_machine')
    mockResolveIngestionOwnership.mockReturnValue(delegatedOwnershipOnHost())
    recordHostIngestionPollUnreachable('acc-host', 'req-unreach')

    const res = await resolveIngestionStatus(['acc-host'])
    expect(res.code).toBe('PAUSED_SANDBOX_UNREACHABLE')
    expect(res.sandboxTopologyKind).toBe('single_machine')
  })

  it('single_machine delegated host learns missing read account from ack', async () => {
    _setIngestionStatusTopologyKindForTests('single_machine')
    mockResolveIngestionOwnership.mockReturnValue(delegatedOwnershipOnHost())
    recordHostIngestionPollAck({
      accountId: 'acc-host',
      requestId: 'req-consent',
      pollStatus: 'held_read_consent_missing',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
      at: Date.now(),
    })

    const res = await resolveIngestionStatus(['acc-host'])
    expect(res.code).toBe('ACTION_NEEDED_READ_CONSENT')
  })

  it('dedicated delegated host with ok trigger ack stays quiet', async () => {
    _setIngestionStatusTopologyKindForTests('dedicated')
    mockResolveIngestionOwnership.mockReturnValue(delegatedOwnershipOnHost())
    recordHostIngestionPollAck({
      accountId: 'acc-host',
      requestId: 'req-3',
      pollStatus: 'ok',
      fetched: 1,
      depackaged: 1,
      delivered: 1,
      held: 0,
      at: Date.now(),
    })

    const res = await resolveIngestionStatus(['acc-host'])
    expect(res.code).toBe('PAUSED_HOST_DELEGATED')
  })

  it('dedicated sandbox working → OK_SANDBOX_FETCHING (quiet)', async () => {
    _setIngestionStatusTopologyKindForTests('dedicated')
    mockResolveIngestionOwnership.mockReturnValue(sandboxOwnsOnSandbox())
    mockHasRoleScopedTokens.mockReturnValue(true)
    mockGetLastSandboxPollOutcomes.mockReturnValue(new Map([
      ['acc1', pollOutcome('ok', { fetched: 2, delivered: 2, held: 0 })],
    ]))

    const res = await resolveIngestionStatus(['acc1'])
    expect(res.code).toBe('OK_SANDBOX_FETCHING')
  })
})
