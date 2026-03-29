# Legacy capsule-builder attachment flow

## Purpose

Describe how **popup-chat** and **`CapsuleSection`** attach, parse, badge, and open the document reader.

## Files

- `apps/extension-chromium/src/popup-chat.tsx` (BEAP draft attachments, ~lines 1355–1470, reader modal ~2372–2385)
- `apps/extension-chromium/src/beap-builder/components/CapsuleSection.tsx` (full builder: manual Parse, `AttachmentStatusBadge`)
- `apps/extension-chromium/src/beap-builder/draftAttachmentAutoParse.ts`
- `apps/extension-chromium/src/beap-builder/parserService.ts`

## Popup-chat (WR Chat) flow

### Add attachment

- FileReader → **base64** stored on **`DraftAttachment`**: `{ dataBase64, capsuleAttachment, processing }`.
- For **PDF**, initial state sets **`processing.parsing: true`** and immediately kicks off **`runDraftAttachmentParseWithFallback`** in a loop for new PDF items (inline IIFE in `onChange`).

### Parse

- **`runDraftAttachmentParseWithFallback`** → **`processAttachmentForParsing`** (with optional **Anthropic Vision** fallback in `draftAttachmentAutoParse.ts`).

### UI

- **`AttachmentStatusBadge`**: shown when `showPdfBadge` — PDF and (parsing OR success OR error).
- **`parseStatus`**: derived as `pending` | `success` | `failed` from `processing.parsing` and `capsuleAttachment.semanticExtracted`.
- **Open reader** button: visible when `isSuccess && capsuleAttachment.semanticContent`.
- **Retry** button: on parse error + base64 present.
- **Error strip**: shows `processing.error` (amber box).

### Reader modal

- State: **`beapDraftReaderModalId`**.
- **`BeapDocumentReaderModal`**: `semanticContent={att.capsuleAttachment.semanticContent}`, `theme` from popup theme.

## CapsuleSection (standalone builder) flow

- Files cached in **`attachmentDataMap`** (base64).
- User may click **Parse** → **`processAttachmentForParsing`**.
- **`AttachmentStatusBadge`** next to rows (see `CapsuleSection.tsx` imports and render).
- Uses same **`CapsuleAttachment`** model.

## State ownership

- **Popup**: React state `beapDraftAttachments`, `beapDraftReaderModalId`.
- **CapsuleSection**: local `parsingAttachments`, `parseErrors`, ref map for base64.

## Legacy behavior summary

| Feature | Popup-chat | CapsuleSection |
|---------|------------|----------------|
| Auto-parse PDF on add | Yes | No (manual Parse) |
| Badge | Yes | Yes |
| Reader | Yes | (reader typically from same components where wired) |

## Current inline composer

Does **not** share this state machine; see `01-current-inline-attachment-flow.md`.

## Notes

- **Sidepanel** (`sidepanel.tsx`) duplicates a similar BEAP draft block (grep shows `AttachmentStatusBadge`, `runDraftAttachmentParseWithFallback`) — same legacy pattern, not repeated here in full.
