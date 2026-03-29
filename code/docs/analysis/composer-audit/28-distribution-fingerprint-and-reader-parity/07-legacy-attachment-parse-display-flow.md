# Legacy attachment parse and display flow (popup / sidepanel)

## Files

- `apps/extension-chromium/src/popup-chat.tsx` (BEAP draft attachments)
- `apps/extension-chromium/src/beap-builder/draftAttachmentAutoParse.ts` — `runDraftAttachmentParseWithFallback`
- `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`
- `apps/extension-chromium/src/beap-builder/parserService.ts` (used by builder flows per audit 27)

## Flow (pattern)

1. User picks files → `DraftAttachment[]` with `attachmentId`, `parseStatus: 'pending' | 'success' | 'failed'`, `semanticContent`, etc.
2. **`runDraftAttachmentParseWithFallback`** orchestrates parse + fallbacks; updates attachment state via callbacks.
3. **Row UI:** For PDFs (and when `showPdfBadge`), renders **`<AttachmentStatusBadge status={parseStatus} />`** — labels **Extracting…** / **Parsed** / **Failed** (green success per `CONFIGS.success` in badge file).
4. **Reader:** `BeapDocumentReaderModal` opened from attachment actions with extracted `semanticContent`.

## Capsule builder

`CapsuleSection.tsx` also imports **`AttachmentStatusBadge`** for attachment rows — same badge component.

## vs inline

Legacy ties **badge** to **parse state machine**; inline uses **one-shot** extract + optional error string + **View text** only.
