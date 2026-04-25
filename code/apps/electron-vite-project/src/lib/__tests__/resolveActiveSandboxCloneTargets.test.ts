import { describe, test, expect } from 'vitest'
import { resolveActiveSandboxCloneTargets } from '../resolveActiveSandboxCloneTargets'
import type { InternalSandboxTargetWire, InternalSandboxIncompleteWire } from '../../hooks/useInternalSandboxesList'

const row = (o: Partial<InternalSandboxTargetWire> & { handshake_id: string }): InternalSandboxTargetWire =>
  ({
    relationship_id: 'r',
    state: 'active',
    peer_role: 'sandbox',
    peer_label: 'Sandbox',
    peer_device_id: 'd1',
    peer_device_name: null,
    internal_coordination_identity_complete: true,
    p2p_endpoint_set: true,
    last_known_delivery_status: 'idle',
    sandbox_keying_complete: true,
    beap_clone_eligible: false,
    ...o,
  }) as InternalSandboxTargetWire

describe('resolveActiveSandboxCloneTargets', () => {
  test('counts identity-complete + incomplete; sendable filters keying', () => {
    const inc: InternalSandboxIncompleteWire[] = [
      { handshake_id: 'h0', relationship_id: 'r0', reason: 'identity_incomplete' },
    ]
    const s: InternalSandboxTargetWire[] = [
      row({ handshake_id: 'a', sandbox_keying_complete: true, beap_clone_eligible: true }),
      row({ handshake_id: 'b', sandbox_keying_complete: false, beap_clone_eligible: false }),
    ]
    const r = resolveActiveSandboxCloneTargets(s, inc)
    expect(r.activeHostSandboxCount).toBe(3)
    expect(r.sendableTargets.length).toBe(1)
    expect(r.sendableTargets[0].handshake_id).toBe('a')
    expect(r.liveEligibleCount).toBe(1)
  })
})
