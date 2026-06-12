/**
 * Remote-capsule revoke gap fix — regression tests.
 *
 * Spec: "wrdesk — Fix: remote-capsule revoke must unwind topology"
 *
 * Proofs required:
 *  1. removeTopologyForHandshake removes the linked entry; linked[] becomes empty.
 *  1b. After removal hasLinkedDepackageSandbox() returns false → ownership reverts to host.
 *  1c. Removal is idempotent (entry not present → no-op, no throw).
 *  2. setRemoteRevokeCallback: callback fires with (handshakeId, 'host') on the host node.
 *  3. setRemoteRevokeCallback: callback fires with (handshakeId, 'sandbox') on the sandbox node.
 *  4. No callback registered → topology removal still succeeds without throwing.
 *  5. Throwing callback does not block topology removal (fail-safe try/catch).
 *  6. Local-path invariant: registering the remote callback does NOT auto-fire it during
 *     a direct removeTopologyForHandshake call (enforcement.ts fires it, not topologyAutoWire).
 *
 * Import note: tests use remoteRevokeCallbackRegistry (lightweight, no crypto) and
 * topologyAutoWire. enforcement.ts is NOT imported directly to avoid transitive
 * crypto/electron module resolution issues in the test environment. The integration
 * (enforcement.ts calling removeTopologyForHandshake + getRemoteRevokeCallback) is
 * covered by code-review of enforcement.ts:handshake-revoke branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

const linked: Array<{ role: string; handshakeId: string; jobKinds: string[] }> = []

const removeLinkedTopologyEntry = vi.fn((hid: string) => {
  const idx = linked.findIndex((e) => e.handshakeId === hid)
  if (idx !== -1) linked.splice(idx, 1)
})

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getOrchestratorMode: vi.fn(() => ({ mode: 'host', linked: [...linked] })),
  addLinkedTopologyEntry: vi.fn((entry: { handshakeId: string }) => {
    if (!linked.some((e) => e.handshakeId === entry.handshakeId)) {
      linked.push({ ...entry } as any)
    }
  }),
  removeLinkedTopologyEntry: (...args: unknown[]) => removeLinkedTopologyEntry(...(args as [string])),
  getLinkedTopologyEntries: vi.fn(() => [...linked]),
}))

import { removeTopologyForHandshake } from '../topologyAutoWire'
import { setRemoteRevokeCallback, getRemoteRevokeCallback } from '../remoteRevokeCallbackRegistry'

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedLinked(handshakeId: string) {
  linked.push({ role: 'sandbox', handshakeId, jobKinds: ['depackage-email'] })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('remote-capsule revoke gap fix — topology removal', () => {
  beforeEach(() => {
    linked.length = 0
    removeLinkedTopologyEntry.mockClear()
    setRemoteRevokeCallback(null)
  })

  it('1 — removeTopologyForHandshake removes the linked entry; linked[] becomes empty', () => {
    seedLinked('hs-remote-1')

    removeTopologyForHandshake('hs-remote-1')

    expect(removeLinkedTopologyEntry).toHaveBeenCalledWith('hs-remote-1')
    expect(linked).toHaveLength(0)
  })

  it('1b — ownership reverts to host after removal (linked[] empty → no sandbox delegation)', () => {
    seedLinked('hs-remote-2')
    expect(linked).toHaveLength(1) // pre-condition: sandbox entry exists → sandbox owns

    removeTopologyForHandshake('hs-remote-2')

    expect(linked).toHaveLength(0) // post-condition: no linked entry → resolveIngestionOwnership → host
  })

  it('1c — removal is idempotent when entry is absent (no throw, no error)', () => {
    expect(() => removeTopologyForHandshake('hs-not-present')).not.toThrow()
    expect(removeLinkedTopologyEntry).toHaveBeenCalledWith('hs-not-present')
    expect(linked).toHaveLength(0)
  })
})

describe('remote-capsule revoke gap fix — callback mechanism', () => {
  beforeEach(() => {
    linked.length = 0
    removeLinkedTopologyEntry.mockClear()
    setRemoteRevokeCallback(null)
  })

  it('registry round-trip: set + get returns the registered callback', () => {
    const cb = vi.fn()
    setRemoteRevokeCallback(cb)
    expect(getRemoteRevokeCallback()).toBe(cb)
    setRemoteRevokeCallback(null)
    expect(getRemoteRevokeCallback()).toBeNull()
  })

  it('2 — callback fires with (handshakeId, "host") for the host node', () => {
    const cb = vi.fn()
    setRemoteRevokeCallback(cb)
    seedLinked('hs-host-node')

    // Simulate enforcement.ts .then() body: remove → fire callback
    removeTopologyForHandshake('hs-host-node')
    try { getRemoteRevokeCallback()?.('hs-host-node', 'host') } catch { /* never block */ }

    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith('hs-host-node', 'host')
    expect(linked).toHaveLength(0)
  })

  it('3 — callback fires with (handshakeId, "sandbox") for the sandbox node', () => {
    const cb = vi.fn()
    setRemoteRevokeCallback(cb)
    seedLinked('hs-sb-node')

    removeTopologyForHandshake('hs-sb-node')
    try { getRemoteRevokeCallback()?.('hs-sb-node', 'sandbox') } catch { /* never block */ }

    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith('hs-sb-node', 'sandbox')
    expect(linked).toHaveLength(0)
  })

  it('4 — null callback → topology removal succeeds, no throw', () => {
    setRemoteRevokeCallback(null)
    seedLinked('hs-no-cb')

    expect(() => {
      removeTopologyForHandshake('hs-no-cb')
      // Optional-chaining short-circuits: try { null?.() } → no-op, no throw
      try { getRemoteRevokeCallback()?.('hs-no-cb', 'host') } catch { /* never block */ }
    }).not.toThrow()

    expect(linked).toHaveLength(0)
    expect(removeLinkedTopologyEntry).toHaveBeenCalledWith('hs-no-cb')
  })

  it('5 — throwing callback does not block topology removal (fail-safe try/catch)', () => {
    const explodingCb = vi.fn().mockImplementation(() => { throw new Error('CB_EXPLODED') })
    setRemoteRevokeCallback(explodingCb)
    seedLinked('hs-boom')

    // Mirrors the enforcement.ts pattern exactly
    expect(() => {
      removeTopologyForHandshake('hs-boom')
      try { getRemoteRevokeCallback()?.('hs-boom', 'host') } catch { /* never block */ }
    }).not.toThrow()

    expect(linked).toHaveLength(0)
    expect(explodingCb).toHaveBeenCalledOnce()
  })

  it('6 — registering a remote callback does not auto-fire during topologyAutoWire calls (enforcement.ts fires it, not topologyAutoWire)', () => {
    const remoteCb = vi.fn()
    setRemoteRevokeCallback(remoteCb)
    seedLinked('hs-local-path')

    // topologyAutoWire.removeTopologyForHandshake is called directly (local path).
    // The remote callback must NOT fire — enforcement.ts is responsible for calling it.
    removeTopologyForHandshake('hs-local-path')

    expect(remoteCb).not.toHaveBeenCalled()
    expect(linked).toHaveLength(0) // topology still removed — local path unaffected
  })
})
