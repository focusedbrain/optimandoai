# Extension popup-chat (legacy BEAP builder reference)

## Purpose
Primary **rich** BEAP builder UI in the extension: imports delivery panels, handshake select, document reader, themes.

## Files
- `apps/extension-chromium/src/popup-chat.tsx` (entry)
- `apps/extension-chromium/src/popup-chat.html`

## Ownership
Extension popup window — separate from Electron renderer.

## Rendering path
Vite entry → `createRoot` mount.

## Inputs and outputs
Extension stores (`useUIStore`), handshake hooks, BEAP inbox store.

## Dependencies
`RecipientModeSwitch`, `RecipientHandshakeSelect`, `DeliveryMethodPanel`, `executeDeliveryAction`, `BeapDocumentReaderModal`, `runDraftAttachmentParseWithFallback`, etc.

## Data flow
Same services as Electron for package build — **UI layer** differs.

## UX impact
**Reference standard** for “premium” builder per product.

## Current issues
Not reused by Electron inline composer — **intentional gap** in current architecture.

## Old vs new comparison
This **is** the old builder for extension users.

## Reuse potential
**High** if bundling constraints allow.

## Change risk
Bundle size + cross-environment (Chrome vs Electron) testing.

## Notes
Read only first ~80 lines in audit — full file is large; deeper field-by-field parity needs dedicated pass.
