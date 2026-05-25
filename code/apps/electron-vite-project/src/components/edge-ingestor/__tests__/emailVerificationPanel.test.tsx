/**
 * Email verification panel — Prompt C/D surface tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EdgeIngestorPanelContent } from '../EdgeIngestorPanelContent.js'
import { SwitchBackToLocalModal } from '../SwitchBackToLocalModal.js'

describe('EdgeIngestorPanelContent email verification UX', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      dashboard: {
        getReplicas: vi.fn().mockResolvedValue([]),
        onUpdates: vi.fn(() => () => undefined),
      },
      ingestionMode: {
        get: vi.fn().mockResolvedValue({ holdQueue: { count: 0 }, mode: 'HostPodActive' }),
        onUpdated: vi.fn(() => () => undefined),
      },
      wizard: {
        refreshTier: vi.fn().mockResolvedValue({ tier: 'pro', isPaidTier: true }),
      },
    })
  })

  it('uses Email verification framing without Ingestor in primary copy', () => {
    const html = renderToStaticMarkup(<EdgeIngestorPanelContent />)
    expect(html).toContain('Email verification')
    expect(html).toContain('Current setup')
    expect(html).not.toContain('Edge Ingestor')
    expect(html).not.toContain('depackaging unit')
  })

  it('renders switch back confirmation modal copy', () => {
    const html = renderToStaticMarkup(
      <SwitchBackToLocalModal
        host="203.0.113.10"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    )
    expect(html).toContain('Switch back to local verification')
    expect(html).toContain('switch-back-local-confirm')
  })
})
