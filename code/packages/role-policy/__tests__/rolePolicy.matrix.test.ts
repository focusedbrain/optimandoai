import { describe, test, expect } from 'vitest'

import {
  rolePolicy,
  EDGE_ROLE_POLICY_ACCOUNT,
  type AccountSummary,
  type EdgeFetchState,
  type IngestionModeForPolicy,
  type RolePolicyModeSnapshot,
} from '../src/index.js'

const MODES: IngestionModeForPolicy[] = ['EdgeActive', 'HostPodActive', 'Blocked']

const EDGE_STATES: EdgeFetchState[] = [
  'not_on_edge',
  'active',
  'awaiting_key',
  'migrating',
  'migrating_back',
  'degraded',
]

function account(state: EdgeFetchState): AccountSummary {
  return { id: 'acct-1', edgeFetchState: state }
}

function mode(
  m: IngestionModeForPolicy,
  hostPodVariant?: RolePolicyModeSnapshot['hostPodVariant'],
): RolePolicyModeSnapshot {
  return { mode: m, hostPodVariant: hostPodVariant ?? null, context: 'host_orchestrator' }
}

/** Executable matrix from Stream B spec. */
const EXPECTED_FETCH: Record<
  IngestionModeForPolicy,
  Record<EdgeFetchState, boolean>
> = {
  EdgeActive: {
    not_on_edge: true,
    active: false,
    awaiting_key: false,
    migrating: false,
    migrating_back: false,
    degraded: false,
  },
  Blocked: {
    not_on_edge: true,
    active: false,
    awaiting_key: false,
    migrating: false,
    migrating_back: false,
    degraded: false,
  },
  HostPodActive: {
    not_on_edge: true,
    active: false,
    awaiting_key: false,
    migrating: false,
    migrating_back: false,
    degraded: false,
  },
}

const EXPECTED_SEND: Record<
  IngestionModeForPolicy,
  Record<EdgeFetchState, boolean>
> = {
  EdgeActive: {
    not_on_edge: true,
    active: true,
    awaiting_key: true,
    migrating: true,
    migrating_back: true,
    degraded: true,
  },
  Blocked: {
    not_on_edge: true,
    active: false,
    awaiting_key: true,
    migrating: true,
    migrating_back: true,
    degraded: false,
  },
  HostPodActive: {
    not_on_edge: true,
    active: true,
    awaiting_key: true,
    migrating: true,
    migrating_back: true,
    degraded: true,
  },
}

describe('rolePolicy matrix — host orchestrator', () => {
  for (const m of MODES) {
    for (const st of EDGE_STATES) {
      test(`canFetch mode=${m} edge=${st}`, () => {
        const d = rolePolicy.canFetch(account(st), mode(m))
        expect(d.allowed).toBe(EXPECTED_FETCH[m][st])
      })

      test(`canSend mode=${m} edge=${st}`, () => {
        const d = rolePolicy.canSend(account(st), mode(m))
        expect(d.allowed).toBe(EXPECTED_SEND[m][st])
      })
    }
  }

  test('halted host pod blocks fetch and send', () => {
    const snap = mode('HostPodActive', 'halted_by_anomaly')
    expect(rolePolicy.canFetch(account('not_on_edge'), snap).allowed).toBe(false)
    expect(rolePolicy.canSend(account('not_on_edge'), snap).allowed).toBe(false)
  })
})

describe('rolePolicy — edge mail-fetcher', () => {
  test('canSend is always forbidden', () => {
    const snap: RolePolicyModeSnapshot = {
      mode: 'EdgeActive',
      context: 'edge_mail_fetcher',
    }
    expect(rolePolicy.canSend(EDGE_ROLE_POLICY_ACCOUNT, snap).allowed).toBe(false)
    expect(rolePolicy.canSend(EDGE_ROLE_POLICY_ACCOUNT, snap).reason).toBe(
      'edge_role_send_forbidden',
    )
  })

  test('startup assertion account must not allow send', () => {
    const d = rolePolicy.canSend(EDGE_ROLE_POLICY_ACCOUNT, {
      mode: 'EdgeActive',
      context: 'edge_mail_fetcher',
    })
    expect(d.allowed).toBe(false)
  })
})
