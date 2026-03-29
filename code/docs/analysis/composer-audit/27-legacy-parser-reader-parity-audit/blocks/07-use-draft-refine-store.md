# useDraftRefineStore

## Purpose

Zustand store: which **draft field** is **connected** to the **top chat bar** for AI refinement (`refineTarget`, `connected`, `draftText`, callbacks).

## Files

- `apps/electron-vite-project/src/stores/useDraftRefineStore.ts`

## Rendering path

N/A — consumed by **`BeapInlineComposer`**, **`EmailInlineComposer`**, and **`HybridSearch`** (not expanded in this audit).

## State ownership

**Global** client store (`zustand`).

## Inputs and outputs

**Actions:** `connect`, `disconnect`, `updateDraftText`, `deliverResponse`, `acceptRefinement`.

**Targets:** `'email' | 'capsule-public' | 'capsule-encrypted'`.

## Dependencies

None (pure state).

## Data flow

User clicks field → **`connect(..., refineTarget)`** → chat sends refinements → **`onResponse`** updates textarea.

## Legacy behavior

**Popup-chat** BEAP UI **does not** use this store (no matches in `popup-chat.tsx` for refine store).

## Current behavior

**Inline** composers set **`refineTarget`** when user clicks public/encrypted/body fields.

## Regression

**Not** a regression from legacy popup — **new** Electron integration; icon expectation (**👆**) vs **sparkle** in **`DraftRefineLabel`** is a **product** delta.

## Root cause

N/A.

## Reuse potential

**Central hook** for any **active field** indicator.

## Change risk

Low for **icon swap**; medium if **targets** multiply.

## Notes

`refineTarget` default **`'email'`** on disconnect.
