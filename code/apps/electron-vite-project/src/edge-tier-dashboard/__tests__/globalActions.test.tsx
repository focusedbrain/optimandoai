/**
 * Global dashboard actions — P4.8 UI tests.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GlobalActionsPanel } from '../GlobalActionsPanel.js'
import { RotateKeysModal } from '../RotateKeysModal.js'
import { PauseEdgeTierModal } from '../PauseEdgeTierModal.js'
import { FallbackPolicySettings } from '../FallbackPolicySettings.js'

describe('GlobalActionsPanel', () => {
  it('renders rotate and pause controls', () => {
    const html = renderToStaticMarkup(
      <GlobalActionsPanel
        replicaCount={2}
        fallbackPolicy="reject"
        onRotateKeys={() => undefined}
        onPauseEdgeTier={() => undefined}
        onFallbackPolicyChange={() => undefined}
      />,
    )
    expect(html).toContain('global-rotate-keys')
    expect(html).toContain('global-pause-edge-tier')
    expect(html).toContain('edge-fallback-policy-settings')
    expect(html).toContain('edge-known-hosts-settings')
    expect(html).toContain('Known hosts')
  })
})

describe('RotateKeysModal', () => {
  it('disables submit until confirmation and SSH key are provided', () => {
    const html = renderToStaticMarkup(
      <RotateKeysModal
        replicaCount={2}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(html).toContain('rotate-keys-confirm')
    expect(html).toContain('rotate-keys-submit')
    expect(html).toMatch(/disabled=/)
  })
})

describe('PauseEdgeTierModal', () => {
  it('shows security warning copy', () => {
    const html = renderToStaticMarkup(
      <PauseEdgeTierModal onClose={() => undefined} onConfirm={() => undefined} />,
    )
    expect(html).toContain('Pause edge tier?')
    expect(html).toContain('LOCAL_HOST')
  })
})

describe('FallbackPolicySettings', () => {
  it('renders reject as default selected policy', () => {
    const html = renderToStaticMarkup(
      <FallbackPolicySettings policy="reject" onChange={() => undefined} />,
    )
    expect(html).toContain('fallback-policy-reject')
    expect(html).toContain('safest choice for high-assurance use')
  })
})
