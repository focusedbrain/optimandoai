# Selected-field indicator hook points

## Purpose

Identify where **AI refinement** marks an active field and where a **pointing-finger** (or other) icon could attach **without** restructuring refine logic.

## Core state

**File:** `apps/electron-vite-project/src/stores/useDraftRefineStore.ts`

- `connected: boolean`
- `refineTarget: 'email' | 'capsule-public' | 'capsule-encrypted'`
- `connect(..., refineTarget)` / `disconnect()`

**Stable rule:** Active target is **`connected && refineTarget === '<target>'`**.

## BEAP inline composer

**File:** `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`

| Field | refineTarget | Label location | Field handler |
|-------|--------------|----------------|---------------|
| Public message | `capsule-public` | `<label>` wrapping **`DraftRefineLabel`** (~595–596) | `handleFieldClick('public')` on textarea `onClick` |
| Encrypted message | `capsule-encrypted` | `<label>` with **`DraftRefineLabel`** (~630–631) | `handleFieldClick('encrypted')` |

**Best hook:** **`DraftRefineLabel`** (`apps/electron-vite-project/src/components/DraftRefineLabel.tsx`) — already wraps label text and conditionally renders an icon when `active` is true. **Replace or augment** the inner SVG (currently **sparkle** / Heroicons-style) with a **pointing-finger** glyph or SVG **here** so **all** composers using `DraftRefineLabel` stay consistent.

**Alternative hook:** Put the icon **inside** each `<label>` **before** children, passing the same `active` expression — duplicates logic vs `DraftRefineLabel`.

## Email inline composer

**File:** `apps/electron-vite-project/src/components/EmailInlineComposer.tsx`

- **Body** label uses **`DraftRefineLabel`** with `active={connected && refineTarget === 'email'}`.

## Legacy popup-chat

**Grep:** no `useDraftRefineStore` / `DraftRefineLabel` in `popup-chat.tsx` — **legacy BEAP draft in popup does not use this refine indicator pattern** in the analyzed file.

## Extension capsule builder

Not using `useDraftRefineStore` (Electron-only store path) for builder fields — **N/A** for same hook.

## Recommended insertion point (analysis conclusion)

**Single component:** **`DraftRefineLabel`** — props `{ children, active }` already encode the **active refine target** decision at call sites; swapping iconography is **lowest churn**.

## Notes

- **data-compose-field** attributes (`public-message`, `encrypted-message`, `email-body`) exist for other features — could be used for **querySelector**-based hints, but **less stable** than React props.
