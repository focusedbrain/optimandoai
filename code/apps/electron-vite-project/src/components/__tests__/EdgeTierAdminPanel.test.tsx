/**
 * EdgeTierAdminPanel — P3.10 UI tests.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  EdgeTierAdminPanelForm,
  type EdgeTierStatusView,
  type EdgeVerificationRow,
} from '../EdgeTierAdminPanel'

const sampleStatus: EdgeTierStatusView = {
  mode: 'LOCAL_VERIFY',
  edge_tier_enabled: true,
  fallback_policy: 'reject',
  jwks_last_refreshed_at: '2026-05-24T12:00:00.000Z',
  replicas: [
    {
      host: 'edge.example',
      port: 18100,
      edge_pod_id: '11111111-1111-4111-8111-111111111111',
      edge_public_key: 'ed25519:aa',
      last_success_at: '2026-05-24T12:01:00.000Z',
    },
  ],
}

const sampleVerifications: EdgeVerificationRow[] = [
  {
    timestamp: '2026-05-24T12:02:00.000Z',
    edge_pod_id: '11111111-1111-4111-8111-111111111111',
    sub: 'user-sub',
    result: 'verified',
    phase: 'shallow',
  },
  {
    timestamp: '2026-05-24T12:02:01.000Z',
    edge_pod_id: '11111111-1111-4111-8111-111111111111',
    sub: 'user-sub',
    result: 'PACKAGE_HASH_MISMATCH',
    phase: 'deep',
  },
]

describe('EdgeTierAdminPanelForm', () => {
  it('renders mode and replica status', () => {
    const html = renderToStaticMarkup(
      <EdgeTierAdminPanelForm status={sampleStatus} verifications={[]} />,
    )
    expect(html).toContain('LOCAL_VERIFY')
    expect(html).toContain('edge.example')
    expect(html).toContain('11111111-1111-4111-8111-111111111111')
  })

  it('renders verification table rows', () => {
    const html = renderToStaticMarkup(
      <EdgeTierAdminPanelForm status={sampleStatus} verifications={sampleVerifications} />,
    )
    expect(html).toContain('edge-verifications-table')
    expect(html).toContain('verified')
    expect(html).toContain('PACKAGE_HASH_MISMATCH')
    expect(html).toContain('user-sub')
  })

  it('shows empty state when no verifications', () => {
    const html = renderToStaticMarkup(
      <EdgeTierAdminPanelForm status={sampleStatus} verifications={[]} />,
    )
    expect(html).toContain('No verification events recorded yet')
  })
})
