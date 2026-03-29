# Design system, styling, and spacing

## Purpose
How the embedded composers relate to dashboard design tokens and why “premium” feel may be absent.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — extensive inline `style={{}}`
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — same
- `apps/electron-vite-project/src/App.css` — `.app-root` (inheritance)
- `apps/electron-vite-project/src/components/HybridSearch.css` — chat bar

## Ownership
No shared `ComposerTheme` — each file duplicates border (`#e5e7eb`), muted text vars, purple accents.

## Rendering path
Inline styles override parent; `fontFamily: 'inherit'` set in Prompt 6 for root grids.

## Inputs and outputs
N/A.

## Dependencies
CSS variables: `--color-bg`, `--color-text`, `--color-text-muted` where referenced.

## Data flow
N/A.

## UX impact
- **Density:** Forms pack many controls in one scroll column — limited whitespace between sections.
- **Handshake / selects:** Native controls match OS — flatter than extension themed components.
- **Hierarchy:** Section labels uppercase 11px — consistent but not “marketing premium.”

## Current issues
Product feedback (“does not feel premium”) aligns with **lack of shared design layer** and **constrained width** (see layout doc).

## Old vs new comparison
`EmailComposeOverlay` professional theme used light card on dark overlay — **higher contrast** figure/ground than inline embed.

## Reuse potential
Extract `ComposerSection`, `ComposerSelect` from extension or design system.

## Change risk
Global CSS changes affect entire dashboard.

## Notes
HybridSearch and composers use different border treatments — slight visual fragmentation.
