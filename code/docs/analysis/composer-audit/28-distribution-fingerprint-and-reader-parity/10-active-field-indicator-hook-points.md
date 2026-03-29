# Active-field indicator (AI refinement target)

## Store

`useDraftRefineStore` — `refineTarget`, `connect`, `disconnect`, `connected` (imported in `BeapInlineComposer.tsx`).

## Field mapping (BEAP inline)

`handleFieldClick` (~157–173):

- **Public message** → `refineTarget === 'capsule-public'`
- **Encrypted message** → `refineTarget === 'capsule-encrypted'`

**Email inline composer** may use other targets — **out of scope** unless product asks; this audit lists **BEAP** fields only.

## Label wrapper

**`DraftRefineLabel`** — `apps/electron-vite-project/src/components/DraftRefineLabel.tsx`

- **Current behavior:** Renders **`children`** first, then (if `active`) a **sparkle SVG** **after** the label (`gap: 6`).
- **Product ask:** **Pointing-finger (👆) before** the field title.

## Lowest-risk hook point

**Centralize in `DraftRefineLabel`:** Add optional **`icon="sparkle" | "point"`** or replace default with 👆 **before** `{children}` when `active`, matching product spec. **All** labels that wrap refinement targets should use this component so **BEAP public**, **BEAP encrypted**, and any future fields stay consistent.

## Exact labels (BEAP inline)

From `BeapInlineComposer.tsx`:

1. **`<DraftRefineLabel active={connected && refineTarget === 'capsule-public'}>BEAP™ message (required)</DraftRefineLabel>`**
2. **`<DraftRefineLabel active={connected && refineTarget === 'capsule-encrypted'}>Encrypted message (private)</DraftRefineLabel>`**

**Subject** and **attachments** do **not** use `DraftRefineLabel` in this file — **no** pointing-finger for those unless `connect()` is extended to new targets.

## Regression

**Sparkle-after** vs **finger-before** — **spec delta**, not a missing store wire.
