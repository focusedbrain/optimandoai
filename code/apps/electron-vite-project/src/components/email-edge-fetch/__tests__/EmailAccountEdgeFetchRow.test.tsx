/**
 * EmailAccountEdgeFetchRow — snapshot tests per state (P4.5.7).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmailAccountEdgeFetchRow } from '../EmailAccountEdgeFetchRow.js'
import type { EdgeFetchAccountSnapshot, EdgeFetchUiState } from '../edgeFetchCopy.js'

const baseSnapshot = (state: EdgeFetchUiState, extra?: Partial<EdgeFetchAccountSnapshot>): EdgeFetchAccountSnapshot => ({
  accountId: 'acct-1',
  email: 'user@example.com',
  provider: 'gmail',
  state,
  ...extra,
})

describe('EmailAccountEdgeFetchRow state snapshots', () => {
  const states: EdgeFetchUiState[] = [
    'not_on_edge',
    'migrating',
    'migrating_back',
    'awaiting_key',
    'active',
    'degraded',
  ]

  for (const state of states) {
    it(`matches snapshot for ${state}`, () => {
      const html = renderToStaticMarkup(
        <EmailAccountEdgeFetchRow
          accountId="acct-1"
          provider="gmail"
          snapshot={baseSnapshot(state, state === 'degraded' ? { lastError: 'refresh_token_rejected' } : {})}
          canMigrate={state === 'not_on_edge'}
          migrateDisabledReason={state === 'not_on_edge' ? undefined : 'Already on edge'}
          onMoveToEdge={() => undefined}
          onMoveBack={() => undefined}
          onReauthorize={() => undefined}
          onViewStatus={() => undefined}
        />,
      )
      expect(html).toMatchSnapshot()
    })
  }

  it('disables Move to edge when not eligible', () => {
    const html = renderToStaticMarkup(
      <EmailAccountEdgeFetchRow
        accountId="acct-1"
        provider="gmail"
        snapshot={baseSnapshot('not_on_edge')}
        canMigrate={false}
        migrateDisabledReason="Deploy an edge replica first"
        onMoveToEdge={() => undefined}
      />,
    )
    expect(html).toContain('Move to edge')
    expect(html).toContain('disabled')
  })
})
