/**
 * TierBadgeWithRefresh component tests (P4.5.3).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import { TierBadgeWithRefresh } from '../TierBadgeWithRefresh.js'

describe('TierBadgeWithRefresh initial render', () => {
  it('shows the initial tier on the badge', () => {
    const html = renderToStaticMarkup(
      <TierBadgeWithRefresh initialTier="free" onRefresh={async () => ({ tier: 'free' })} />,
    )
    expect(html).toContain('data-testid="tier-badge"')
    expect(html).toContain('Free')
  })
})

describe('TierBadgeWithRefresh interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  async function clickRefresh() {
    const btn = container.querySelector('[data-testid="tier-badge-refresh"]') as HTMLButtonElement
    expect(btn).toBeTruthy()
    await act(async () => {
      btn.click()
    })
  }

  it('click invokes onRefresh and updates the badge', async () => {
    const onRefresh = vi.fn(async () => ({ tier: 'pro' }))
    await act(async () => {
      root.render(<TierBadgeWithRefresh initialTier="free" onRefresh={onRefresh} />)
    })

    await clickRefresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)

    const badge = container.querySelector('[data-testid="tier-badge"]')
    expect(badge?.textContent).toBe('Pro')
  })

  it('disables the refresh button while refresh is in flight', async () => {
    let resolveRefresh!: (value: { tier: string }) => void
    const onRefresh = vi.fn(
      () =>
        new Promise<{ tier: string }>((resolve) => {
          resolveRefresh = resolve
        }),
    )

    await act(async () => {
      root.render(<TierBadgeWithRefresh initialTier="free" onRefresh={onRefresh} />)
    })

    const btn = container.querySelector('[data-testid="tier-badge-refresh"]') as HTMLButtonElement
    await act(async () => {
      btn.click()
    })

    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')

    await act(async () => {
      resolveRefresh({ tier: 'pro' })
      await Promise.resolve()
    })

    expect(btn.disabled).toBe(false)
  })

  it('shows cooldown tooltip on rapid re-click within 5 seconds', async () => {
    const onRefresh = vi.fn(async () => ({ tier: 'free' }))
    await act(async () => {
      root.render(<TierBadgeWithRefresh initialTier="free" onRefresh={onRefresh} />)
    })

    await clickRefresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)

    await clickRefresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)

    const tooltip = container.querySelector('[data-testid="tier-badge-refresh-cooldown"]')
    expect(tooltip).toBeTruthy()
    expect(tooltip?.textContent).toBe('Already refreshed just now')

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    await clickRefresh()
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })
})
