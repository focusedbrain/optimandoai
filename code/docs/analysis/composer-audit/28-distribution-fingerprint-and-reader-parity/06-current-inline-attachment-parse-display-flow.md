# Current inline attachment parse and display flow

## Files

- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
- `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts` (`extractTextForPackagePreview`)

## Flow (evidence)

1. **Add:** `addAttachments` → `window.emailInbox.showOpenDialogForAttachments` + `readFileForAttachment` → base64 + mime.
2. **Extract:** For each file, `extractTextForPackagePreview({ name, mimeType, base64 })` — HTTP to **`http://127.0.0.1:${CONTEXT_UPLOAD_HTTP_PORT}/api/parser/pdf/extract`** (see `beapPackageAttachmentPreview.ts`).
3. **State:** `LocalAttachment` stores `previewText` / `previewError` — **no** `pending` / `success` / `failed` enum; **no** `AttachmentParseStatus`.
4. **UI:** Attachment row is **light** card (`#f8fafc` bg, `#0f172a` text). Shows filename, **“View text”** if `previewText` non-empty, **Remove**, and **amber** error line if `previewError`.
5. **Badge:** **`AttachmentStatusBadge` is not imported or rendered** — no green **“Parsed”** pill.
6. **Reader:** `BeapDocumentReaderModal` with `readerOpen`, `readerFilename`, `readerText`. Opens when first attachment with text is added (`setReaderOpen(true)`) or user clicks **View text**. `theme="standard"` (light modal on dark shell).

## Parser backend vs display

- **Parse:** Inline **does** call the local parser route when extraction succeeds; failures surface as `previewError` string (not badge).
- **Display gap:** Missing **status model** + **badge** + **pending** UX (extension uses `runDraftAttachmentParseWithFallback` + async state updates).

## Uncertainty

Whether `CONTEXT_UPLOAD_HTTP_PORT` matches extension parser service in all dev setups — **environment-dependent**; not validated here.
