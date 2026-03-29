# New Email composer overview (`EmailInlineComposer`)

## Purpose
Plain-email compose for Electron: To, Subject, Body, attachments, signature preview pattern, send via `window.emailAccounts.sendEmail`.

## Files
- `apps/electron-vite-project/src/components/EmailInlineComposer.tsx`
- `apps/electron-vite-project/src/components/EmailComposeOverlay.tsx` (exports `EMAIL_SIGNATURE`, `DraftAttachment` type only — overlay UI largely superseded for dashboard)

## Ownership
Same mounting pattern as `BeapInlineComposer` when `composeMode === 'email'`.

## Rendering path
Default export + named export; parents pass `replyTo` for reply prefill.

## Inputs and outputs
**Props:** `onClose`, `onSent`, optional `replyTo` (`to`, `subject`, `body`, `initialAttachments`).

**Output:** IPC `emailAccounts.sendEmail(accountId, { to, subject, bodyText, attachments })`.

## Dependencies
- `pickDefaultEmailAccountRowId` from `@ext/shared/email/pickDefaultAccountRow`
- `useDraftRefineStore` for body field AI refine (`connect(null, 'New Email', body, setBody, 'email')`)

## Data flow
Local state → validation → `sendEmail` → `onSent` on success.

## UX impact
- Same **1fr + 280px** grid as BEAP (`~187–199`) with hints aside.
- Body `minHeight: 160`, flexible textarea — somewhat larger default than BEAP public field but still constrained by column width.

## Current issues
- **Parity with `EmailComposeOverlay`:** Overlay used professional light theme option (`theme === 'professional'`) and modal framing; inline uses dark dashboard chrome only.

## Old vs new comparison
`EmailComposeOverlay.tsx` (`~34+`): full-screen dimmed overlay, `maxWidth` container, theme tokens for light “premium” sheet. **Inline** embeds in dashboard grid — different visual framing.

## Reuse potential
`EMAIL_SIGNATURE` and attachment MIME mapping are shared concepts; UI could import more overlay styling without bringing back modal.

## Change risk
Send pipeline must stay aligned with provider IPC contract.

## Notes
Bulk view removed modal path; reply flows use `composeReplyTo` + `EmailInlineComposer` (`EmailInboxBulkView.tsx`).
