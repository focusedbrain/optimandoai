/**
 * Prompt 4 — topologyAutoWire tests.
 *
 * Proofs required:
 *  A. handshake→ACTIVE persists linked[] and ownership flips to sandbox.
 *  B. Revoke removes the entry and ownership returns to host.
 *  C. Role-precedence conflict fails loudly (TopologyRoleConflictError).
 *  D. autoWireTopologyForHandshake is idempotent (double-call safe).
 *  E. syncTopologyFromActiveHandshakes syncs all eligible rows at startup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HandshakeState } from '../types'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const linked: Array<{ role: string; handshakeId: string; jobKinds: string[] }> = []

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getOrchestratorMode: vi.fn(() => ({ mode: 'host', linked: [...linked] })),
  addLinkedTopologyEntry: vi.fn((entry: { handshakeId: string }) => {
    if (!linked.some((e) => e.handshakeId === entry.handshakeId)) {
      linked.push({ ...entry })
    }
  }),
  removeLinkedTopologyEntry: vi.fn((hid: string) => {
    const idx = linked.findIndex((e) => e.handshakeId === hid)
    if (idx !== -1) linked.splice(idx, 1)
  }),
}))

vi.mock('../db', () => ({
  listHandshakeRecords: vi.fn(() => []),
}))

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<{
  handshake_id: string
  state: HandshakeState
  handshake_type: string
  local_role: 'initiator' | 'acceptor'
  initiator_device_role: 'host' | 'sandbox' | null
  acceptor_device_role: 'host' | 'sandbox' | null
  internal_coordination_identity_complete: boolean
}> = {}) {
  return {
    handshake_id: 'hs-test-1',
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
    local_role: 'initiator' as const,
    initiator_device_role: 'host' as const,
    acceptor_device_role: 'sandbox' as const,
    internal_coordination_identity_complete: true,
    relationship_id: 'rel-1',
    initiator: { wrdesk_user_id: 'u1', email: 'a@test.com' },
    acceptor: { wrdesk_user_id: 'u1', email: 'a@test.com' },
    last_seq_sent: 1,
    last_seq_received: 1,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    sharing_mode: null,
    reciprocal_allowed: false,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    effective_policy: {} as any,
    external_processing: 'none',
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: null,
    counterparty_p2p_token: null,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('topologyAutoWire — autoWireTopologyForHandshake', () => {
  beforeEach(() => {
    linked.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('A — ACTIVE host-initiator+sandbox-acceptor record adds linked entry', async () => {
    const { autoWireTopologyForHandshake } = await import('../topologyAutoWire')
    const { addLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    const record = makeRecord()
    autoWireTopologyForHandshake(record)

    expect(addLinkedTopologyEntry).toHaveBeenCalledOnce()
    const call = (addLinkedTopologyEntry as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe('sandbox')
    expect(call.handshakeId).toBe('hs-test-1')
    expect(call.jobKinds).toContain('depackage-email')
    expect(linked).toHaveLength(1)
  })

  it('A — acceptor-side host record also wires (local=host, peer=sandbox via acceptor fields)', async () => {
    const { autoWireTopologyForHandshake } = await import('../topologyAutoWire')
    const { addLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    // local_role=acceptor; acceptor_device_role=host, initiator_device_role=sandbox
    const record = makeRecord({
      local_role: 'acceptor',
      initiator_device_role: 'sandbox',
      acceptor_device_role: 'host',
    })
    autoWireTopologyForHandshake(record)

    expect(addLinkedTopologyEntry).toHaveBeenCalledOnce()
  })

  it('no-op for non-internal handshake', async () => {
    const { autoWireTopologyForHandshake } = await import('../topologyAutoWire')
    const { addLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    autoWireTopologyForHandshake(makeRecord({ handshake_type: 'standard' }))
    expect(addLinkedTopologyEntry).not.toHaveBeenCalled()
  })

  it('no-op when state is not ACTIVE', async () => {
    const { autoWireTopologyForHandshake } = await import('../topologyAutoWire')
    const { addLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    autoWireTopologyForHandshake(makeRecord({ state: HandshakeState.ACCEPTED }))
    expect(addLinkedTopologyEntry).not.toHaveBeenCalled()
  })

  it('no-op when identity is incomplete', async () => {
    const { autoWireTopologyForHandshake } = await import('../topologyAutoWire')
    const { addLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    autoWireTopologyForHandshake(makeRecord({ internal_coordination_identity_complete: false }))
    expect(addLinkedTopologyEntry).not.toHaveBeenCalled()
  })

  it('no-op when this device is the sandbox side (does not need linked entry)', async () => {
    const { autoWireTopologyForHandshake } = await import('../topologyAutoWire')
    const { addLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    // local=sandbox, peer=host
    autoWireTopologyForHandshake(makeRecord({
      initiator_device_role: 'sandbox',
      acceptor_device_role: 'host',
    }))
    expect(addLinkedTopologyEntry).not.toHaveBeenCalled()
  })

  it('D — idempotent: double-call does not duplicate linked entry', async () => {
    const { autoWireTopologyForHandshake } = await import('../topologyAutoWire')

    const record = makeRecord()
    autoWireTopologyForHandshake(record)
    autoWireTopologyForHandshake(record)

    expect(linked).toHaveLength(1)
  })

  it('C — role conflict (mode=sandbox but ledger says local=host) throws TopologyRoleConflictError', async () => {
    const { getOrchestratorMode } = await import('../../orchestrator/orchestratorModeStore')
    ;(getOrchestratorMode as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      mode: 'sandbox',
      linked: [],
    })

    const { autoWireTopologyForHandshake, TopologyRoleConflictError } = await import('../topologyAutoWire')
    const record = makeRecord() // local=host but mode says sandbox

    expect(() => autoWireTopologyForHandshake(record)).toThrow(TopologyRoleConflictError)
  })
})

describe('topologyAutoWire — removeTopologyForHandshake', () => {
  beforeEach(() => {
    linked.length = 0
    vi.clearAllMocks()
  })

  it('B — removing an existing entry updates linked[] and calls removeLinkedTopologyEntry', async () => {
    linked.push({ role: 'sandbox', handshakeId: 'hs-test-1', jobKinds: ['depackage-email'] })
    const { removeTopologyForHandshake } = await import('../topologyAutoWire')
    const { removeLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    removeTopologyForHandshake('hs-test-1')

    expect(removeLinkedTopologyEntry).toHaveBeenCalledWith('hs-test-1')
    expect(linked).toHaveLength(0)
  })

  it('idempotent: removing an entry that does not exist is a no-op', async () => {
    const { removeTopologyForHandshake } = await import('../topologyAutoWire')
    const { removeLinkedTopologyEntry } = await import('../../orchestrator/orchestratorModeStore')

    removeTopologyForHandshake('hs-not-found')
    expect(removeLinkedTopologyEntry).toHaveBeenCalledWith('hs-not-found')
    expect(linked).toHaveLength(0)
  })
})

describe('topologyAutoWire — syncTopologyFromActiveHandshakes', () => {
  beforeEach(() => {
    linked.length = 0
    vi.clearAllMocks()
  })

  it('E — startup sync adds linked entries for all ACTIVE eligible rows', async () => {
    const { listHandshakeRecords } = await import('../db')
    ;(listHandshakeRecords as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      makeRecord({ handshake_id: 'hs-A' }),
      makeRecord({ handshake_id: 'hs-B' }),
    ])

    const { syncTopologyFromActiveHandshakes } = await import('../topologyAutoWire')
    syncTopologyFromActiveHandshakes({ fake: 'db' })

    expect(linked).toHaveLength(2)
    expect(linked.map((e) => e.handshakeId)).toContain('hs-A')
    expect(linked.map((e) => e.handshakeId)).toContain('hs-B')
  })

  it('E — skips incomplete identity rows', async () => {
    const { listHandshakeRecords } = await import('../db')
    ;(listHandshakeRecords as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      makeRecord({ handshake_id: 'hs-X', internal_coordination_identity_complete: false }),
    ])

    const { syncTopologyFromActiveHandshakes } = await import('../topologyAutoWire')
    syncTopologyFromActiveHandshakes({ fake: 'db' })

    expect(linked).toHaveLength(0)
  })

  it('E — role conflict in sync is logged as error but does not throw', async () => {
    const { listHandshakeRecords } = await import('../db')
    ;(listHandshakeRecords as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      makeRecord({ handshake_id: 'hs-conflict' }),
    ])
    const { getOrchestratorMode } = await import('../../orchestrator/orchestratorModeStore')
    ;(getOrchestratorMode as ReturnType<typeof vi.fn>).mockReturnValue({ mode: 'sandbox', linked: [] })

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { syncTopologyFromActiveHandshakes } = await import('../topologyAutoWire')

    expect(() => syncTopologyFromActiveHandshakes({ fake: 'db' })).not.toThrow()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Role conflict'))
    expect(linked).toHaveLength(0)
  })
})
