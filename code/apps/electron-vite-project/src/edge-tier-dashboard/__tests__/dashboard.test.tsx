/**
 * Edge tier dashboard UI — P4.6 snapshot tests.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DashboardShellView } from '../DashboardShell.js'
import { ReplicasList } from '../ReplicasList.js'
import { VerificationsList } from '../VerificationsList.js'
import { ReplicaDetail } from '../ReplicaDetail.js'
import type { ReplicaStatus, VerificationEvent } from '../types.js'

const sampleReplica: ReplicaStatus = {
  host: 'edge.example',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:aa',
  health: 'healthy',
  health_checked_at: '2026-05-24T12:00:00.000Z',
  last_cert_timestamp: '2026-05-24T12:01:00.000Z',
  certs_per_minute: 1.2,
}

const sampleVerifications: VerificationEvent[] = [
  {
    timestamp: '2026-05-24T12:02:00.000Z',
    edge_pod_id: sampleReplica.edge_pod_id,
    sub: 'user-sub',
    result: 'verified',
    phase: 'shallow',
  },
  {
    timestamp: '2026-05-24T12:02:01.000Z',
    edge_pod_id: sampleReplica.edge_pod_id,
    sub: 'user-sub',
    result: 'PACKAGE_HASH_MISMATCH',
    phase: 'deep',
  },
]

describe('DashboardShellView', () => {
  it('matches snapshot for empty state when edge tier disabled', () => {
    const html = renderToStaticMarkup(
      <DashboardShellView
        edgeTierEnabled={false}
        replicas={[]}
        verifications={[]}
        activeTab="replicas"
        onTabChange={() => undefined}
        selectedReplica={null}
        onViewDetails={() => undefined}
        onCloseDetail={() => undefined}
        onLaunchWizard={() => undefined}
      />,
    )
    expect(html).toMatchSnapshot()
    expect(html).toContain('edge-dashboard-empty')
    expect(html).toContain('Start the wizard to deploy your first replica')
  })

  it('matches snapshot for list state with replicas and verifications tab', () => {
    const html = renderToStaticMarkup(
      <DashboardShellView
        edgeTierEnabled={true}
        replicas={[sampleReplica]}
        verifications={sampleVerifications}
        activeTab="replicas"
        onTabChange={() => undefined}
        selectedReplica={null}
        onViewDetails={() => undefined}
        onCloseDetail={() => undefined}
        onLaunchWizard={() => undefined}
      />,
    )
    expect(html).toMatchSnapshot()
    expect(html).toContain('edge-dashboard')
    expect(html).toContain('edge.example')
  })
})

describe('ReplicasList', () => {
  it('renders replica rows', () => {
    const html = renderToStaticMarkup(
      <ReplicasList replicas={[sampleReplica]} onViewDetails={() => undefined} />,
    )
    expect(html).toContain('View details')
    expect(html).toContain('Healthy')
  })
})

describe('VerificationsList', () => {
  it('renders verification table', () => {
    const html = renderToStaticMarkup(<VerificationsList verifications={sampleVerifications} />)
    expect(html).toContain('edge-verifications-table')
    expect(html).toContain('verified')
    expect(html).toContain('PACKAGE_HASH_MISMATCH')
  })
})

describe('ReplicaDetail', () => {
  it('matches snapshot for detail state', () => {
    const html = renderToStaticMarkup(
      <ReplicaDetail replica={sampleReplica} onClose={() => undefined} />,
    )
    expect(html).toMatchSnapshot()
    expect(html).toContain('edge-replica-detail')
    expect(html).toContain('Fetch logs')
  })
})
