# Public pBEAP field

## Purpose
Required public / transport-visible capsule text (`messageBody` in `BeapPackageConfig`).

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — textarea ~575–596
- `data-compose-field="public-message"`

## Ownership
Local state `publicMessage`; AI refine via `useDraftRefineStore` target `capsule-public`.

## Rendering path
Label “BEAP™ message (required)” + textarea with `rows={6}`.

## Inputs and outputs
- **User input:** typing updates `publicMessage`.
- **AI:** Click textarea → `connect(null, 'New BEAP Message', publicMessage, setPublicMessage, 'capsule-public')`; `updateDraftText` sync on change (~177–181).
- **Validation:** Send requires `publicMessage.trim()` (~227–230).

## Dependencies
`useDraftRefineStore`; HybridSearch builds draft-refine prompts when `refineTarget === 'capsule-public'` (`HybridSearch.tsx` field labels).

## Data flow
State → package config `messageBody: publicMessage` (~287).

## UX impact
- **Small feel:** `rows={6}` in a **narrow center column** (grid `1fr` minus 320px list) — limited vertical space; user can resize vertically (`resize: 'vertical'`) but default is modest.
- **Premium:** Plain textarea; no rich preview or capsule metadata cards.

## Current issues
Product asks for larger editor — code fix is mostly layout (`rows`, `minHeight`, grid width), not logic.

## Old vs new comparison
Popup builder likely used larger flexible regions and companion panels.

## Reuse potential
Same `data-compose-field` attribute for automation/testing.

## Change risk
AI refine store assumes this field maps to `capsule-public`; HybridSearch prompt strings reference “preview summary of a reply.”

## Notes
Border highlights `#7c3aed` when draft refine active for this target.
