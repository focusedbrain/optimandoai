/**
 * A4 — dashboard and panel both expose setup_in_progress for pending replica.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { DashboardShellView } from '../../../edge-tier-dashboard/DashboardShell.js'
import type { ReplicaStatus } from '../../../edge-tier-dashboard/types.js'

const pendingReplica: ReplicaStatus = {
  host: '203.0.113.10',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:aa',
  health: 'unknown',
  health_checked_at: null,
  last_cert_timestamp: null,
  certs_per_minute: 0,
}

describe('setup_in_progress surfaces', () => {
  it('dashboard shows resume setup for pending configuration', () => {
    const html = renderToStaticMarkup(
      <DashboardShellView
        configurationState="setup_in_progress"
        replicas={[pendingReplica]}
        verifications={[]}
        activeTab="replicas"
        onTabChange={() => undefined}
        selectedReplica={null}
        onViewDetails={() => undefined}
        onCloseDetail={() => undefined}
        onLaunchWizard={() => undefined}
      />,
    )
    expect(html).toContain('data-configuration-state="setup_in_progress"')
    expect(html).toContain('edge-dashboard-setup-in-progress')
    expect(html).toContain('Resume setup')
    expect(html).toContain('203.0.113.10')
  })
})
