# Old builder reference

## Purpose
Catalog of “previous” compose experiences for parity discussion: extension popup BEAP builder, modal email overlay, IPC-opened windows.

## Files (Electron)
- `apps/electron-vite-project/src/components/EmailComposeOverlay.tsx` — **still in repo**; rendering commented out in `EmailInboxView.tsx` (~2635–2638) and removed from bulk view.
- `apps/electron-vite-project/electron/main.ts` — `ipcMain.on('OPEN_BEAP_DRAFT'|'OPEN_EMAIL_COMPOSE', …)` (lines ~1057–1101 per product docs — verify in repo if needed).
- `apps/electron-vite-project/electron/main.ts` / `preload.ts` — `analysisDashboard.openBeapDraft` exposure for extension.

## Files (Extension / shared)
- `apps/extension-chromium/src/popup-chat.tsx` — **large** entry (~2400+ lines): `RecipientModeSwitch`, `RecipientHandshakeSelect`, `DeliveryMethodPanel`, `executeDeliveryAction`, `BeapDocumentReaderModal`, attachment parsing, `ConnectEmailFlow`, themes (`Theme` / `toBeapTheme`).
- `apps/extension-chromium/src/popup-chat.html` — popup entry HTML.

## Ownership
- **Popup:** Standalone window / extension routing — not the Electron renderer inbox tree.
- **Overlay:** Was child of `EmailInboxView` when `showEmailCompose` was true (disabled).

## Rendering path
- Popup: `createRoot` from `popup-chat.tsx` (standard Vite entry).
- IPC: Opens BrowserWindow or routes to dashboard — implementation in `main.ts` (not re-read in full for this audit).

## Inputs and outputs
Popup receives extension auth/UI store context; Electron inline composers receive only React props from parent.

## Dependencies
Popup pulls **many** `@ext/beap-messages` and `@ext/beap-builder` UI pieces that **BeapInlineComposer does not import**.

## Data flow
Same underlying send: `executeDeliveryAction` / email IPC — **functional** parity possible; **UI** parity not preserved in inline composer.

## UX impact
Old popup = dedicated surface, extension-themed controls, handshake select component. New inline = minimal HTML controls inside dashboard grid.

## Current issues
Product expectation “preserve old look and feel” implies **gap** between `popup-chat.tsx` richness and `BeapInlineComposer.tsx`.

## Old vs new comparison
| Aspect | Old (popup) | New (inline) |
|--------|-------------|--------------|
| Handshake UI | `RecipientHandshakeSelect` | Native `<select>` |
| Delivery | `DeliveryMethodPanel` | Native `<select>` |
| Attachments | Reader modal, size limits helpers | Simple file list |
| Layout | Popup window | Grid cell beside list |

## Reuse potential
Extract shared presentational components from extension into `packages/` consumed by Electron.

## Change risk
Importing extension into Electron increases bundle size and cross-target constraints.

## Notes
Multiple “candidates” for old builder: (1) `popup-chat.tsx`, (2) `EmailComposeOverlay`, (3) sidepanel docked mode (not fully traced here — `sidepanel.tsx` exists). **Uncertainty:** exact feature parity between docked sidepanel BEAP mode and popup.
