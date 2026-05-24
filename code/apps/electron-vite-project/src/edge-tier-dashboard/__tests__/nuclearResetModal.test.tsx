/**
 * Nuclear reset modal — P5.10 UI tests.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NuclearResetModal } from '../NuclearResetModal.js'
import { canConfirmNuclearReset } from '../nuclearResetConfirm.js'
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

describe('canConfirmNuclearReset', () => {
  it('requires host, RESET token, and reason', () => {
    expect(
      canConfirmNuclearReset({
        hostConfirm: 'edge.example',
        expectedHost: 'edge.example',
        resetConfirm: 'RESET',
        reason: 'VM corruption suspected',
      }),
    ).toBe(true)

    expect(
      canConfirmNuclearReset({
        hostConfirm: 'wrong',
        expectedHost: 'edge.example',
        resetConfirm: 'RESET',
        reason: 'VM corruption suspected',
      }),
    ).toBe(false)

    expect(
      canConfirmNuclearReset({
        hostConfirm: 'edge.example',
        expectedHost: 'edge.example',
        resetConfirm: 'reset',
        reason: 'VM corruption suspected',
      }),
    ).toBe(false)

    expect(
      canConfirmNuclearReset({
        hostConfirm: 'edge.example',
        expectedHost: 'edge.example',
        resetConfirm: 'RESET',
        reason: '  ',
      }),
    ).toBe(false)
  })
})

describe('NuclearResetModal', () => {
  it('renders wipe list and disables submit until confirmations are valid', () => {
    const html = renderToStaticMarkup(
      <NuclearResetModal
        replica={sampleReplica}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(html).toContain('nuclear-reset-modal')
    expect(html).toContain('nuclear-reset-wipe-list')
    expect(html).toContain('edge signing keypair')
    expect(html).toContain('nuclear-reset-host-confirm')
    expect(html).toContain('nuclear-reset-token-confirm')
    expect(html).toContain('nuclear-reset-reason')
    expect(html).toMatch(/disabled=/)
  })
})
