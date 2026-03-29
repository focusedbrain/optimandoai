# Send flow, validation, and errors

## Purpose
Validation gates and error surfaces for BEAP inline send vs email inline send.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — `handleSend` ~225–315
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx` — `handleSend` (useCallback)
- `@ext/beap-messages/services/BeapPackageBuilder` — `executeDeliveryAction`

## Ownership
Composer-local; errors in `sendError` / `error` state; BEAP shows red banner ~623–625.

## Rendering path
Send button triggers async `handleSend`; failures set string state.

## Inputs and outputs
**BEAP checks:** public message non-empty; private mode requires `selectedRecipient` + `hasHandshakeKeyMaterial`; public+email requires `emailTo`; attachments read async.

**Email checks:** To required; account id; `sendEmail` availability.

## Dependencies
IPC `window.emailAccounts`, `window.emailInbox` for files.

## Data flow
Validation failure → early return with message; success → `onSent()`.

## UX impact
Inline error divs — functional, not “premium” toast system (except separate `sendEmailToast` in `EmailInboxView` for **AI panel send**, not composer).

## Current issues
No inline field-level validation summary; long error strings in one banner.

## Old vs new comparison
Popup may surface richer debug (`ClientSendFailureDebug`) — not wired in inline BEAP.

## Reuse potential
Align error display with inbox toast patterns.

## Change risk
Tight coupling to handshake key errors — copy changes affect support burden.

## Notes
Ctrl/Cmd+Enter shortcut sends (Prompt 6) — global window listener in composers.
