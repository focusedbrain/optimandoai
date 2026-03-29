# Current inline BEAP attachment flow

## Purpose

Trace how **`BeapInlineComposer`** (`apps/electron-vite-project/src/components/BeapInlineComposer.tsx`) handles package attachments from pick → preview → send.

## Files

- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
- `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts`
- `apps/electron-vite-project/src/lib/ingestAiContextFiles.ts` (shared `CONTEXT_UPLOAD_HTTP_PORT` = 51248)
- `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx` (imported via `@ext`)

## Rendering path

1. User clicks **`ComposerAttachmentButton`** → `addAttachments()` → `window.emailInbox.showOpenDialogForAttachments()`.
2. For each file, `window.emailInbox.readFileForAttachment(path)` yields base64 + mime.
3. **`extractTextForPackagePreview`** runs (PDF → POST `/api/parser/pdf/extract` on `127.0.0.1:51248`; text-like extensions → UTF-8 decode).
4. State: `LocalAttachment[]` with `previewText`, `previewError`.
5. Optional **`BeapDocumentReaderModal`**: opened when first attachment has `previewText`; per-row **View text** calls `openAttachmentReader`.
6. **Send path**: `handleSend` rebuilds `CapsuleAttachment[]` from files again via `readFileForAttachment`; **`semanticContent` / `semanticExtracted` are set to null/false** in the inline mapping (package still ships originals as `originalFiles` / capsule attachment metadata per existing builder contract in that file).

## State ownership

- **React local state** in `BeapInlineComposer`: `attachments`, `readerOpen`, `readerFilename`, `readerText`.
- **No** `CapsuleAttachment.semanticExtracted` progression in UI state for attachments.
- **No** shared Zustand store for package parse status (unlike AI context `useAiDraftContextStore`).

## Inputs and outputs

| Stage | Input | Output |
|-------|--------|--------|
| Pick | File paths from dialog | `LocalAttachment` rows |
| Preview | base64 + mime | `previewText` or `previewError` |
| Reader modal | `previewText` | `BeapDocumentReaderModal` display |
| Send | Disk read again | `BeapPackageConfig` + `executeDeliveryAction` |

## Dependencies

- **Electron preload**: `emailInbox.showOpenDialogForAttachments`, `readFileForAttachment`.
- **Local HTTP parser** (port 51248): same route family as AI context PDF ingest, **not** `parserService.ts` from the extension.

## Data flow (summary)

```
Dialog → readFileForAttachment → extractTextForPackagePreview → LocalAttachment.preview*
     → optional BeapDocumentReaderModal
Send → readFileForAttachment → CapsuleAttachment (semantic* null) → executeDeliveryAction
```

## Legacy behavior (comparison)

Legacy popup-chat stores **`CapsuleAttachment`** + **`processing`** and uses **`runDraftAttachmentParseWithFallback`** → **`processAttachmentForParsing`**.

## Current behavior

Parallel **preview-only** pipeline for the dashboard composer; **does not** run `runDraftAttachmentParseWithFallback` or update **`AttachmentStatusBadge`** state.

## Regression

- No **`AttachmentStatusBadge`** (“Parsed” / “Extracting…” / “Failed”).
- No **`semanticExtracted`** on the attachment row for inline UI (send still works).

## Root cause

**Architectural fork**: inline composer was implemented with a **lightweight preview helper** (`beapPackageAttachmentPreview.ts`) instead of wiring **`draftAttachmentAutoParse.ts`** + **`CapsuleAttachment`** + badge + reader state machine from popup-chat.

## Notes

- Whether “parsing fails” vs “UI missing” must be diagnosed **per layer**: HTTP 51248 up vs. UI not showing badge (see `11-root-cause-summary.md`).
