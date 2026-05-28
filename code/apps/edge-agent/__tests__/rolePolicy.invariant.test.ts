import { describe, test, expect } from 'vitest'

import { rolePolicy } from '@repo/role-policy'

/** PR6 must not introduce send capability on edge_agent accounts. */
describe('Stream B invariant (PR6)', () => {
  test('canSend remains forbidden for edge fetch accounts', () => {
    const decision = rolePolicy.canSend(
      {
        id: 'edge-acct',
        provider: 'gmail',
        edgeFetch: { replicaId: 'r1', state: 'active' },
      },
      { mode: 'EdgeActive', context: 'edge_mail_fetcher' },
    )
    expect(decision.allowed).toBe(false)
  })
})
