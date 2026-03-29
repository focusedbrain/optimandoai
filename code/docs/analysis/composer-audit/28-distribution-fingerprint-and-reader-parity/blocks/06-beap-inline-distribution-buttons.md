# Beap inline distribution buttons (ad-hoc)

## Purpose

Toggles **`recipientMode`** between **private** and **public** in the Electron inline composer **without** using **`RecipientModeSwitch`**.

## Files

- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` (~495–533)

## Rendering path

Static JSX in main scroll column after delivery method / email account panel.

## State ownership

`useState<RecipientMode>('private')` in `BeapInlineComposer`.

## Inputs and outputs

- **Input:** Clicks set `recipientMode`.
- **Output:** Downstream `RecipientHandshakeSelect` visibility, `executeDeliveryAction` config.

## Dependencies

Type-only: `RecipientMode` from `@ext/beap-messages/components/RecipientModeSwitch`.

## Data flow

Click → `setRecipientMode` → handshake UI + send payload.

## Legacy behavior

See **`RecipientModeSwitch`** ([01-recipient-mode-switch.md](./01-recipient-mode-switch.md)).

## Current behavior

Two **flat** buttons, **Private (qBEAP)** / **Public (pBEAP)**, translucent purple/blue backgrounds when active, **`color: fg`**.

## Regression

See [02-current-private-public-selector.md](../02-current-private-public-selector.md).

## Root cause

Duplicate UX instead of shared component.

## Reuse potential

**Replace** with `RecipientModeSwitch`; this block becomes **obsolete**.

## Change risk

**None** once replaced — delete this pattern.

## Notes

Included as **negative** reference for parity audits.
