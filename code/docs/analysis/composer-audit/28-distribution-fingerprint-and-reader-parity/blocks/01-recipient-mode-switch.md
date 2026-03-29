# RecipientModeSwitch

## Purpose

Renders the **premium PRIVATE / PUBLIC distribution mode** control: labeled section, two segmented buttons with emoji icons, subtitles (qBEAP / pBEAP), gradient active styling, and a **mode description** strip below.

## Files

- `apps/extension-chromium/src/beap-messages/components/RecipientModeSwitch.tsx`

## Rendering path

Imported by **`popup-chat.tsx`** (and potentially other surfaces) inside the BEAP compose column **after** fingerprint and **before** handshake selection / delivery panels.

## State ownership

**Controlled:** `mode` + `onModeChange` from parent. Parent owns `RecipientMode` (`'private' | 'public'`).

## Inputs and outputs

- **Props:** `mode`, `onModeChange`, `theme` (`standard` | `hacker` | `pro` | `dark`), optional `disabled`.
- **Output:** User selection via `onModeChange`.

## Dependencies

Internal only (React inline styles). No parser or handshake RPC.

## Data flow

Parent state → props → local button clicks → `onModeChange(next)`.

## Legacy behavior

Full **card-in-card** layout with **Distribution Mode** label, 🔐/🌐, **PRIVATE**/**PUBLIC**, subtitle lines, gradient active fill, explainer block.

## Current behavior

**`BeapInlineComposer`** does **not** import this component; uses two plain buttons (see [02-current-private-public-selector.md](../02-current-private-public-selector.md)).

## Regression

Missing **visual and informational** parity (icons, subtitles, explainer strip, gradient).

## Root cause

Inline composer implemented a **minimal** toggle instead of **reusing** the shared component.

## Reuse potential

**Direct reuse** in Electron via `@ext/beap-messages` path (same as type import for `RecipientMode`).

## Change risk

**Low** — swap UI only; state type already matches.

## Notes

**Theme:** `dark` likely matches dashboard chrome next to `RecipientHandshakeSelect theme="dark"`.
