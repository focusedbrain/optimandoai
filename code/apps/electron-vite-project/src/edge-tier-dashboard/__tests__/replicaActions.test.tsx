/**
 * Replica action modal — P4.7 UI tests.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReplicaActionModal } from '../ReplicaActionModal.js'
import {
  canConfirmDestructiveReplicaAction,
  replicaActionRequiresHostConfirm,
} from '../replicaActions.js'
import type { ReplicaStatus } from '../types.js'

const sampleReplica: ReplicaStatus = {
  host: 'edge.example',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:aa',
  health: 'healthy',
  health_checked_at: '2026-05-24T12:00:00.000Z',
  last_cert_timestamp: null,
  certs_per_minute: 0,
}

describe('canConfirmDestructiveReplicaAction', () => {
  it('requires exact host match for destructive actions', () => {
    expect(canConfirmDestructiveReplicaAction('edge.example', 'edge.example')).toBe(true)
    expect(canConfirmDestructiveReplicaAction('wrong', 'edge.example')).toBe(false)
    expect(canConfirmDestructiveReplicaAction(' edge.example ', 'edge.example')).toBe(true)
  })
})

describe('ReplicaActionModal', () => {
  it('disables submit for redeploy until host is confirmed', () => {
    expect(replicaActionRequiresHostConfirm('redeploy')).toBe(true)
    const html = renderToStaticMarkup(
      <ReplicaActionModal
        replica={sampleReplica}
        action="redeploy"
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(html).toContain('replica-action-submit')
    expect(html).toContain('replica-action-host-confirm')
    expect(html).toMatch(/disabled=/)
  })

  it('does not require host confirmation for restart', () => {
    expect(replicaActionRequiresHostConfirm('restart')).toBe(false)
    const html = renderToStaticMarkup(
      <ReplicaActionModal
        replica={sampleReplica}
        action="restart"
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(html).not.toContain('replica-action-host-confirm')
  })

  it('requires host confirmation for remove', () => {
    const html = renderToStaticMarkup(
      <ReplicaActionModal
        replica={sampleReplica}
        action="remove"
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(html).toContain('replica-action-host-confirm')
    expect(html).toContain('Remove replica')
  })
})

describe('submit gating', () => {
  it('blocks destructive action until host typed correctly', () => {
    const sshReady = Boolean('root') && Boolean('key-material')
    const hostConfirmed = canConfirmDestructiveReplicaAction('', sampleReplica.host)
    expect(sshReady && hostConfirmed).toBe(false)

    const confirmed = canConfirmDestructiveReplicaAction(sampleReplica.host, sampleReplica.host)
    expect(sshReady && confirmed).toBe(true)
  })
})
