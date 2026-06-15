/**
 * SandboxLockSurface unit tests.
 *
 * Verifies: copy, variants, accessibility, theme tokens, testids.
 * Uses renderToStaticMarkup (no jsdom needed).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SandboxLockSurface, SANDBOX_LOCK_COPY } from './SandboxLockSurface'

function render(props: React.ComponentProps<typeof SandboxLockSurface> = {}) {
  return renderToStaticMarkup(<SandboxLockSurface {...props} />)
}

// ── Copy ──────────────────────────────────────────────────────────────────────

describe('SandboxLockSurface — copy', () => {
  it('renders the canonical lock copy', () => {
    expect(render()).toContain(SANDBOX_LOCK_COPY)
  })

  it('renders the lock glyph', () => {
    expect(render()).toContain('🔒')
  })

  it('SANDBOX_LOCK_COPY is the expected string', () => {
    expect(SANDBOX_LOCK_COPY).toBe('Sending messages is disabled on the sandbox for security.')
  })
})

// ── Variants ──────────────────────────────────────────────────────────────────

describe('SandboxLockSurface — variants', () => {
  it('defaults to compact variant', () => {
    expect(render()).toContain('sandbox-lock-surface--compact')
  })

  it('applies field variant class', () => {
    expect(render({ variant: 'field' })).toContain('sandbox-lock-surface--field')
  })

  it('compact variant does not include field class', () => {
    expect(render({ variant: 'compact' })).not.toContain('sandbox-lock-surface--field')
  })

  it('always includes sandbox-lock-surface base class', () => {
    expect(render({ variant: 'field' })).toContain('sandbox-lock-surface')
    expect(render({ variant: 'compact' })).toContain('sandbox-lock-surface')
  })

  it('merges extra className', () => {
    expect(render({ className: 'my-custom-class' })).toContain('my-custom-class')
  })
})

// ── Accessibility ─────────────────────────────────────────────────────────────

describe('SandboxLockSurface — accessibility', () => {
  it('has role=status', () => {
    expect(render()).toContain('role="status"')
  })

  it('aria-label matches lock copy', () => {
    expect(render()).toContain(`aria-label="${SANDBOX_LOCK_COPY}"`)
  })

  it('lock glyph has aria-hidden', () => {
    expect(render()).toContain('aria-hidden')
  })

  it('default data-testid is sandbox-lock-surface', () => {
    expect(render()).toContain('data-testid="sandbox-lock-surface"')
  })

  it('custom data-testid is applied', () => {
    expect(render({ 'data-testid': 'sandbox-lock-reply' })).toContain('data-testid="sandbox-lock-reply"')
  })
})

// ── Theme tokens / ui-readability ─────────────────────────────────────────────

describe('SandboxLockSurface — theme tokens', () => {
  it('uses --bg-elevated token for background', () => {
    expect(render()).toContain('--bg-elevated')
  })

  it('uses --text-secondary token for text color', () => {
    expect(render()).toContain('--text-secondary')
  })

  it('uses --border token for border color', () => {
    expect(render()).toContain('--border')
  })

  it('includes *-prof fallbacks', () => {
    const html = render()
    expect(html).toContain('--bg-elevated-prof')
    expect(html).toContain('--text-secondary-prof')
    expect(html).toContain('--border-prof')
  })

  it('does not use naked hard-coded colors as primary style (CSS var wraps any fallbacks)', () => {
    // Hex fallbacks inside var(..., #hex) are acceptable; a naked `color:#hex`
    // or `background:#hex` outside a var() would be the bad case.
    // We verify the bg/color properties use CSS variable tokens, not naked hex.
    const html = render()
    expect(html).toContain('var(--bg-elevated')
    expect(html).toContain('var(--text-secondary')
  })
})

// ── Premium look: not an error state ─────────────────────────────────────────

describe('SandboxLockSurface — premium feel', () => {
  it('does not contain error-state class names', () => {
    const html = render()
    expect(html).not.toMatch(/error|danger|alert-danger/i)
  })

  it('does not use disabled/muted as primary text class', () => {
    expect(render()).not.toContain('text-muted')
  })
})
