/**
 * StepExplainer component tests (P4.5.2).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { act, type ComponentProps } from 'react'

import { StepExplainer } from '../StepExplainer.js'

const noopRefresh = async () => ({ tier: 'free' })

function renderExplainer(tier: string, overrides: Partial<ComponentProps<typeof StepExplainer>> = {}) {
  return renderToStaticMarkup(
    <StepExplainer
      tier={tier}
      onContinue={() => undefined}
      onUpgrade={() => undefined}
      onRefreshTier={noopRefresh}
      {...overrides}
    />,
  )
}

describe('StepExplainer CTA', () => {
  it('paid tier renders Continue to deployment', () => {
    const html = renderExplainer('pro')
    expect(html).toContain('wizard-explainer-continue')
    expect(html).toContain('Continue to deployment')
    expect(html).not.toContain('wizard-explainer-upgrade')
  })

  it('free tier renders Upgrade Now and refresh control', () => {
    const html = renderExplainer('free')
    expect(html).toContain('wizard-explainer-upgrade')
    expect(html).toContain('Upgrade Now')
    expect(html).toContain('tier-badge-with-refresh')
    expect(html).toContain('tier-badge-refresh')
    expect(html).toContain('Already upgraded? Click the refresh icon to re-check your plan.')
    expect(html).not.toContain('wizard-explainer-continue')
  })

  it('enterprise tier shows Business/Enterprise note and Continue CTA', () => {
    const html = renderExplainer('enterprise')
    expect(html).toContain('wizard-explainer-enterprise-note')
    expect(html).toContain('Business/Enterprise plan')
    expect(html).toContain('Continue to deployment')
  })
})

describe('StepExplainer refresh', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('clicking refresh on free tier invokes onRefreshTier', async () => {
    const onRefreshTier = vi.fn(async () => ({ tier: 'free' }))
    await act(async () => {
      root.render(
        <StepExplainer
          tier="free"
          onContinue={() => undefined}
          onUpgrade={() => undefined}
          onRefreshTier={onRefreshTier}
        />,
      )
    })

    const refreshBtn = container.querySelector('[data-testid="tier-badge-refresh"]') as HTMLButtonElement
    expect(refreshBtn).toBeTruthy()
    await act(async () => {
      refreshBtn.click()
      await Promise.resolve()
    })
    expect(onRefreshTier).toHaveBeenCalledTimes(1)
  })
})

describe('StepExplainer accessibility structure', () => {
  it('uses semantic headings and lists', () => {
    const html = renderExplainer('free')
    expect(html).toContain('<article')
    expect(html).toContain('<h2')
    expect(html).toContain('<h3')
    expect(html).toContain('<section')
    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('role="region"')
    expect(html).toContain('Refresh plan tier to check upgrade')
  })
})

describe('StepExplainer tier snapshots', () => {
  it.each([
    ['free', 'free'],
    ['pro', 'pro'],
    ['publisher', 'publisher'],
    ['business', 'enterprise'],
  ] as const)('matches copy structure snapshot for %s tier', (_label, tier) => {
    expect(renderExplainer(tier)).toMatchSnapshot()
  })
})
