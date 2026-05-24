/**
 * EmailAccountsAndEdgeIngestorPanel — collapsible combined section tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmailAccountsAndEdgeIngestorPanel } from '../EmailAccountsAndEdgeIngestorPanel'

describe('EmailAccountsAndEdgeIngestorPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      edgeTier: { getStatus: vi.fn().mockResolvedValue({ edge_tier_enabled: false }) },
      dashboard: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  const baseProps = {
    theme: 'professional' as const,
    emailAccounts: [],
    isLoadingEmailAccounts: false,
    selectedEmailAccountId: null,
    onConnectEmail: () => undefined,
    onDisconnectEmail: () => undefined,
    onSelectEmailAccount: () => undefined,
  }

  it('shows collapsed title only by default', () => {
    const html = renderToStaticMarkup(<EmailAccountsAndEdgeIngestorPanel {...baseProps} />)
    expect(html).toContain('Email Accounts')
    expect(html).toContain('Edge Ingestor')
    expect(html).not.toContain('edge-ingestor-panel-content')
    expect(html).not.toContain('Connect Email')
  })

  it('shows edge ingestor and email sections when expanded', () => {
    const html = renderToStaticMarkup(<EmailAccountsAndEdgeIngestorPanel {...baseProps} expanded />)
    expect(html).toContain('edge-ingestor-panel-content')
    expect(html).toContain('Email accounts')
    expect(html).toContain('Connect Email')
  })
})
