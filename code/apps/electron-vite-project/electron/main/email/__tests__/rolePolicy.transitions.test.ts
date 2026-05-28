/**
 * Mode transition scenarios — role policy matrix (Stream B7).
 */

import { describe, test, expect } from 'vitest'

import { rolePolicy, type AccountSummary, type RolePolicyModeSnapshot } from '@repo/role-policy'

const hostAccount: AccountSummary = { id: 'host', edgeFetchState: 'not_on_edge' }
const edgeAccount: AccountSummary = { id: 'edge', edgeFetchState: 'active' }

function snap(mode: RolePolicyModeSnapshot['mode']): RolePolicyModeSnapshot {
  return { mode, hostPodVariant: null, context: 'host_orchestrator' }
}

describe('role policy mode transitions', () => {
  test('HostPodActive: host account fetch+send', () => {
    const m = snap('HostPodActive')
    expect(rolePolicy.canFetch(hostAccount, m).allowed).toBe(true)
    expect(rolePolicy.canSend(hostAccount, m).allowed).toBe(true)
  })

  test('EdgeActive: edge account no host fetch, send ok', () => {
    const m = snap('EdgeActive')
    expect(rolePolicy.canFetch(edgeAccount, m).allowed).toBe(false)
    expect(rolePolicy.canSend(edgeAccount, m).allowed).toBe(true)
  })

  test('Blocked: edge account no fetch, no send', () => {
    const m = snap('Blocked')
    expect(rolePolicy.canFetch(edgeAccount, m).allowed).toBe(false)
    expect(rolePolicy.canSend(edgeAccount, m).allowed).toBe(false)
  })

  test('Blocked: host-mode account unaffected', () => {
    const m = snap('Blocked')
    expect(rolePolicy.canFetch(hostAccount, m).allowed).toBe(true)
    expect(rolePolicy.canSend(hostAccount, m).allowed).toBe(true)
  })

  test('return to EdgeActive restores edge send', () => {
    const blocked = snap('Blocked')
    const active = snap('EdgeActive')
    expect(rolePolicy.canSend(edgeAccount, blocked).allowed).toBe(false)
    expect(rolePolicy.canSend(edgeAccount, active).allowed).toBe(true)
  })
})
