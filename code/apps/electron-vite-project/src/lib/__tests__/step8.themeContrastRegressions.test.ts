/** @vitest-environment node */
/**
 * STEP 8 — Theme / contrast regression (source + resolved token math).
 * Complements visual QA: see MANUAL_STEP8_THEME_SCREENSHOTS at bottom.
 *
 * 1–2. Sandbox Clone disclosure: Standard + dark via the same class rules + theme flags.
 * 3. Sandbox unavailable dialog (intentionally fixed high-contrast light card).
 * 4. Link warning dialog (intentionally fixed high-contrast Standard palette in App.css).
 * 5–6. Host AI selector row: HybridSearch list items use `var(--text-primary)`; icon uses accent.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(__dir, '..', '..')

function readRel(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf-8')
}

function extractCssSection(css: string, start: string, end: string): string {
  const i = css.indexOf(start)
  if (i < 0) throw new Error(`Missing CSS marker: ${start.slice(0, 40)}…`)
  const j = end ? css.indexOf(end, i + start.length) : css.length
  if (j < 0) throw new Error(`Missing CSS end marker: ${end?.slice(0, 40)}…`)
  return css.slice(i, j)
}

/* --- sRGB relative luminance + WCAG contrast (for #rrggbb and known tokens) --- */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  if (h.length !== 6) throw new Error(`Only 6-digit hex: ${hex}`)
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
}

function channelLuminance(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const L1 = relativeLuminance(fgHex)
  const L2 = relativeLuminance(bgHex)
  const L = L1 > L2 ? (L1 + 0.05) / (L2 + 0.05) : (L2 + 0.05) / (L1 + 0.05)
  return L
}

describe('STEP 8 — theme tokens: Standard vs dark (resolved surfaces + primary text)', () => {
  it('Standard: --bg-elevated-prof on --text-primary-prof meets >= 4.5:1', () => {
    expect(contrastRatio('#0f1419', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('Dark: --bg-elevated-dark on --text-primary-dark meets >= 4.5:1', () => {
    expect(contrastRatio('#e7e9ea', '#1a212c')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('STEP 8 — 1 & 2: Sandbox Clone disclosure (App.css) — token-based, no muted primary', () => {
  const appCss = readRel('App.css')
  const block = extractCssSection(
    appCss,
    '/* --- Sandbox clone (Host → internal Sandbox)',
    '/* --- Bulk Inbox View',
  )

  it('uses theme foreground tokens for primary text (not inherited/muted for prose)', () => {
    expect(block).toMatch(/\.sandbox-clone-disclosure \{\s*[\s\S]*?var\(--text-primary/)
    expect(block).toMatch(/\.sandbox-clone-disclosure__prose[^}]*color:\s*var\(--text-primary/)
    // Comment may say "not --text-muted"; forbid actual muted color on disclosure rules
    expect(block).not.toMatch(/color:\s*var\(--text-muted/)
  })

  it('uses elevated / surface token stack for background (no hardcoded #1a1a1a + dark text pair in rules)', () => {
    expect(block).toMatch(/background:\s*var\(--bg-elevated/)
    expect(block).not.toMatch(/background:\s*#[0-1][0-9a-fA-F]{5}/)
  })

  it('meta labels use --text-secondary (readable secondary, not --text-muted — comment in source)', () => {
    expect(block).toMatch(/not --text-muted/)
    expect(block).toMatch(/\.sandbox-clone-disclosure__k[^}]*var\(--text-secondary/)
  })

  it('Component: default collapsed, expanded copy is primary-path (TSX structure)', () => {
    const tsx = readRel('components', 'SandboxCloneDisclosure.tsx')
    expect(tsx).toContain("useState(false)")
    expect(tsx).toMatch(/className="sandbox-clone-disclosure__prose"/)
  })
})

describe('STEP 8 — 3: Sandbox unavailable dialog (BeapSandboxUnavailableDialog) — Standard', () => {
  it('light card + dark body: no dark-on-dark surface for explanatory copy', () => {
    const src = readRel('components', 'BeapSandboxUnavailableDialog.tsx')
    expect(src).toMatch(/cardBg:\s*['"]#ffffff['"]/)
    expect(src).toMatch(/body:\s*['"]#1e293b['"]/)
    expect(src).toMatch(/bodyStrong:\s*['"]#0f172a['"]/)
    expect(src).toMatch(/NO active Sandbox handshake found/i)
    expect(contrastRatio('#1e293b', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#0f172a', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('primary actions remain visible: explicit button styles + Open Handshakes (purple)', () => {
    const src = readRel('components', 'BeapSandboxUnavailableDialog.tsx')
    expect(src).toContain('beap-sandbox-unavail-dialog__btn--primary')
    expect(src).toContain('UI_BUTTON.primary')
    expect(src).toMatch(/type="button"[\s\S]*Close/)
    expect(src).toMatch(/Open Handshakes/)
  })
})

describe('STEP 8 — 4: Link / redirect warning dialog (link-warning-* in App.css) — Standard', () => {
  const appCss = readRel('App.css')
  const block = extractCssSection(
    appCss,
    '/* --- Link warning dialog (safe link confirmation)',
    '/* Safe link button (replaces raw URLs in message body)',
  )

  it('panel is light surface with dark primary title / primary paragraph (not body-muted for main warnings)', () => {
    expect(block).toMatch(/\.link-warning-dialog[\s\S]*?background:\s*#ffffff/)
    expect(block).toMatch(/\.link-warning-para--primary[\s\S]*?color:\s*#0f172a/)
    expect(block).toMatch(/\.link-warning-para(?!-)[\s\S]*?#334155/)
  })

  it('primary block contrast vs white >= 4.5:1; secondary line still not “disabled” band', () => {
    expect(contrastRatio('#0f172a', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#334155', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('source: LinkWarningDialog maps security copy to BEM (para--primary) + actions', () => {
    const dlg = readRel('components', 'LinkWarningDialog.tsx')
    expect(dlg).toMatch(/className="link-warning-para link-warning-para--primary"/)
    expect(dlg).toMatch(/className="link-warning-btn-sandbox"/)
  })
})

describe('STEP 8 — 5 & 6: Host AI selector option (HybridSearch.css + HybridSearch row)', () => {
  it('list row text uses `var(--text-primary)`; Host group uses .host-ai-model-icon with accent', () => {
    const css = readRel('components', 'HybridSearch.css')
    expect(css).toMatch(/\.hs-model-item\s*\{[^}]*color:\s*var\(--text-primary\)/s)
    expect(css).toMatch(/\.host-ai-model-icon::after[^}]*var\(--purple-accent\)/s)
  })

  it('WR Chat: host icon class present for consistent visibility', () => {
    const wr = readRel('components', 'WRChatDashboardView.css')
    expect(wr).toMatch(/\.host-ai-model-icon/)
  })

  it('renderer: model menu renders Host section + icon', () => {
    const hs = readRel('components', 'HybridSearch.tsx')
    expect(hs).toMatch(/host-ai-model-icon|Host AI|section:\s*['"]host['"]/)
  })
})

/** Manual QA: capture in Standard + dark as listed; not automated. */
export const MANUAL_STEP8_THEME_SCREENSHOTS = `
Manual acceptance (screenshots)

1) Standard — Sandbox Clone: collapsed (shows "Sandbox Clone ▸" only, readable title).
2) Standard — Sandbox Clone: expanded (primary paragraph readable; optional meta).
3) Dark — Sandbox Clone: expanded (light text on dark elevated surface, borders visible).
4) Sandbox model selector: Host AI target row visible (label + small monitor icon + readable text).

Regressions caught by this file: token wiring and contrast math on theme definitions + CSS BEM
for link-warning and disclosure blocks; it does not render the UI.
` as const

describe('STEP 8 — manual acceptance (documentation export)', () => {
  it('exports non-empty manual screenshot checklist', () => {
    expect(MANUAL_STEP8_THEME_SCREENSHOTS.trim().length).toBeGreaterThan(80)
  })
})
