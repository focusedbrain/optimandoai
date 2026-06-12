/**
 * UX-1 D4 — topologyAutoWire delegation callback unit tests.
 *
 * Verifies that autoWireTopologyForHandshake calls the registered delegation
 * callback when it successfully wires a host→sandbox topology, and does NOT
 * call it for non-wiring cases (wrong roles, not ACTIVE, etc.).
 *
 * All dependencies mocked so no filesystem or Electron access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (must be hoisted before imports) ────────────────────────────────────

const addLinkedTopologyEntry = vi.fn()
const removeLinkedTopologyEntry = vi.fn()
const getOrchestratorMode = vi.fn<[], { mode: 'host' | 'sandbox' }>()
const getLinkedTopologyEntries = vi.fn<[], Array<{ handshakeId: string; role: string; jobKinds: string[] }>>()

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getOrchestratorMode: () => getOrchestratorMode(),
  addLinkedTopologyEntry: (...args: unknown[]) => addLinkedTopologyEntry(...args),
  removeLinkedTopologyEntry: (...args: unknown[]) => removeLinkedTopologyEntry(...args),
  getLinkedTopologyEntries: () => getLinkedTopologyEntries(),
}))

import { autoWireTopologyForHandshake, setTopologyDelegationCallback } from '../topologyAutoWire'
import { HandshakeState } from '../types'
import type { HandshakeRecord } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

// localDeviceRoleInHandshake: reads local_role, then initiator_device_role or
// acceptor_device_role. For a host that INITIATED the handshake:
//   local_role='initiator', initiator_device_role='host', acceptor_device_role='sandbox'
// For a sandbox that ACCEPTED:
//   local_role='acceptor', initiator_device_role='host', acceptor_device_role='sandbox'
function activeInternalRecord(
  handshakeId: string,
  localRole: 'host' | 'sandbox',
  peerRole: 'host' | 'sandbox',
): HandshakeRecord {
  const isInitiator = true // local is always initiator in these tests for simplicity
  return {
    handshake_id: handshakeId,
    handshake_type: 'internal',
    state: HandshakeState.ACTIVE,
    internal_coordination_identity_complete: true,
    local_role: isInitiator ? 'initiator' : 'acceptor',
    initiator_device_role: isInitiator ? localRole : peerRole,
    acceptor_device_role: isInitiator ? peerRole : localRole,
  } as unknown as HandshakeRecord
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('topologyAutoWire — delegation callback (UX-1 D4)', () => {
  beforeEach(() => {
    addLinkedTopologyEntry.mockReset()
    getOrchestratorMode.mockReset()
    getLinkedTopologyEntries.mockReturnValue([])
    // Default: host mode (so assertRolePrecedence passes for host wiring)
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
  })

  it('callback fires with handshakeId when host→sandbox wiring succeeds', () => {
    const cb = vi.fn()
    setTopologyDelegationCallback(cb)

    const record = activeInternalRecord('hs-abc', 'host', 'sandbox')
    autoWireTopologyForHandshake(record)

    expect(addLinkedTopologyEntry).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith('hs-abc')

    setTopologyDelegationCallback(null) // cleanup
  })

  it('callback is NOT called when this node is the sandbox (no linked entry needed)', () => {
    const cb = vi.fn()
    setTopologyDelegationCallback(cb)
    getOrchestratorMode.mockReturnValue({ mode: 'sandbox' })

    // Sandbox accepted: local_role=acceptor, acceptor=sandbox, initiator=host
    const record = {
      handshake_id: 'hs-xyz',
      handshake_type: 'internal',
      state: HandshakeState.ACTIVE,
      internal_coordination_identity_complete: true,
      local_role: 'acceptor',
      initiator_device_role: 'host',
      acceptor_device_role: 'sandbox',
    } as unknown as HandshakeRecord
    autoWireTopologyForHandshake(record)

    expect(addLinkedTopologyEntry).not.toHaveBeenCalled()
    expect(cb).not.toHaveBeenCalled()

    setTopologyDelegationCallback(null)
  })

  it('callback is NOT called when handshake is not ACTIVE', () => {
    const cb = vi.fn()
    setTopologyDelegationCallback(cb)

    const record = {
      handshake_id: 'hs-pending',
      handshake_type: 'internal',
      state: HandshakeState.INITIATED,
      internal_coordination_identity_complete: true,
      local_role: 'initiator',
      initiator_device_role: 'host',
      acceptor_device_role: 'sandbox',
    } as unknown as HandshakeRecord
    autoWireTopologyForHandshake(record)

    expect(cb).not.toHaveBeenCalled()

    setTopologyDelegationCallback(null)
  })

  it('no callback registered → wiring still succeeds (callback is optional)', () => {
    setTopologyDelegationCallback(null)
    const record = activeInternalRecord('hs-no-cb', 'host', 'sandbox')
    expect(() => autoWireTopologyForHandshake(record)).not.toThrow()
    expect(addLinkedTopologyEntry).toHaveBeenCalledOnce()
  })

  it('throwing callback does not block the wiring (fail-safe try/catch)', () => {
    const explodingCb = vi.fn().mockImplementation(() => { throw new Error('CB_EXPLODED') })
    setTopologyDelegationCallback(explodingCb)

    const record = activeInternalRecord('hs-boom', 'host', 'sandbox')
    // Must not throw
    expect(() => autoWireTopologyForHandshake(record)).not.toThrow()
    // Entry was still added
    expect(addLinkedTopologyEntry).toHaveBeenCalledOnce()

    setTopologyDelegationCallback(null)
  })
})
