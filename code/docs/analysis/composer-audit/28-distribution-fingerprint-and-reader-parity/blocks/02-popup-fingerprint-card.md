# Popup fingerprint card (inline JSX)

## Purpose

Displays **Your Fingerprint** as a **primary** identity block: uppercase blue title, monospace short fingerprint, **Copy** to clipboard.

## Files

- `apps/extension-chromium/src/popup-chat.tsx` (lines ~1221–1261 in current tree; exact line numbers may shift)

## Rendering path

Rendered **inside** the BEAP draft scroll area in **popup-chat**, **above** `RecipientModeSwitch`.

## State ownership

Uses `ourFingerprintShort`, `ourFingerprint`, `copyFingerprint`, `fingerprintCopied` (or equivalent names) from popup state/hooks.

## Inputs and outputs

- **Inputs:** Short + full fingerprint strings, theme branch for colors.
- **Outputs:** Clipboard write on Copy; optional **Copied** feedback.

## Dependencies

`formatFingerprintShort` / identity store (popup path).

## Data flow

Identity loaded → short string for display → user copies full fingerprint.

## Legacy behavior

Standalone **blue-tint bordered card**, high-contrast title and `<code>` value row.

## Current behavior

**`BeapInlineComposer`:** single line `Your fingerprint: {fingerprintShort}` in **Delivery details** with `muted` color; **no** Copy.

## Regression

**Hierarchy** and **actions** (Copy) missing; **not** a separate card.

## Root cause

Inline folded fingerprint into **delivery** summary.

## Reuse potential

**No** named export — **copy JSX** into shared component or inline composer, or extract to **`beap-messages`** if both apps need it.

## Change risk

**Low–medium** if signing-key fingerprint vs identity fingerprint must align.

## Notes

Verify **same** semantic fingerprint as popup before shipping Copy.
