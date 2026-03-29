# DraftRefineLabel

## Purpose

Shows which **composer field** is the **active AI draft refinement target**, in addition to textarea border/focus styling.

## Files

- `apps/electron-vite-project/src/components/DraftRefineLabel.tsx`

## Rendering path

Wraps **label text** inside **`BeapInlineComposer`** (and potentially **Email** inline composer) for fields that call `connect(..., refineTarget)`.

## State ownership

**Parent** passes `active` boolean from `useDraftRefineStore` (`connected` + `refineTarget` match).

## Inputs and outputs

- **Props:** `children` (label text), `active: boolean`.
- **Output:** Visual indicator only.

## Dependencies

`useDraftRefineStore` in parent, not inside this component.

## Data flow

User clicks field → `connect` → `refineTarget` set → `active` true → icon shown.

## Legacy behavior

N/A — Electron-specific wrapper; extension may use different affordances.

## Current behavior

When `active`, renders **sparkle SVG** **after** `children` (`color: #7c3aed`).

## Regression vs product ask

Spec requests **pointing-finger before** label; implementation uses **sparkle after**.

## Root cause

Design choice at implementation time, not store bug.

## Reuse potential

**Single edit point** to swap icon position/style for all BEAP (and email) refine labels.

## Change risk

**Low**; verify **a11y** (`aria-label` on icon container already present).

## Notes

**Minimum** labels for BEAP inline: **public** and **encrypted** field labels only.
