# Subject, session, and attachments (BEAP inline)

## Purpose
Non-body fields: subject line, optional orchestrator session, and capsule file attachments for package build.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
  - Subject: ~568–573
  - Session: ~628–639
  - Attachments: ~203–223 (add), `readFileForAttachment` / `showOpenDialogForAttachments` ~253–278, list UI ~592–621

## Ownership
All local React state inside `BeapInlineComposer`.

## Rendering path
Vertical stack in scrollable main column; attachments are **BEAP package** attachments (built into `CapsuleAttachment[]` / `originalFiles`).

## Inputs and outputs
- **Subject:** `subject` state → `BeapPackageConfig.subject`.
- **Session:** `sessionId` — logged in payload (`orchestratorSessionId`) ~299–301; **uncertainty:** whether orchestrator consumes it end-to-end without further IPC review.
- **Attachments:** Local paths via `window.emailInbox` APIs — **same channel as inbox attachments**, not AI context documents.

## Dependencies
`window.emailInbox?.readFileForAttachment`, `showOpenDialogForAttachments` (when available).

## Data flow
User picks files → read base64 → push to `capsuleAttachments` + `originalFiles` in config (~250–277).

## UX impact
Attachment UX is a simple list with remove — contrast with extension’s document reader / validation modals.

## Current issues
Mixing **user mental model**: product wants AI-only PDFs on a **right rail** — current design puts **package** attachments in-form; HybridSearch `contextDocs` is separate (see doc 13).

## Old vs new comparison
Popup-chat includes `BeapDocumentReaderModal`, `runDraftAttachmentParseWithFallback` — **not** in inline composer.

## Reuse potential
Attachment pipeline for **send** is sound; AI context should be a **separate** state bucket to avoid confusion.

## Change risk
Altering attachment shape affects `executeDeliveryAction` and crypto package.

## Notes
`ORCHESTRATOR_HTTP_BASE = 'http://127.0.0.1:51248'` for session list fetch (~152–171).
