# Parsed state model

## Purpose

Compare **canonical capsule attachment state** with **inline composer local attachment state**.

## Files

- `apps/extension-chromium/src/beap-builder/canonical-types.ts` — `CapsuleAttachment`
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` — `LocalAttachment`
- `apps/extension-chromium/src/popup-chat.tsx` — `DraftAttachment` (embedded type)

## CapsuleAttachment (legacy / builder)

From `canonical-types.ts` (excerpt):

- `semanticContent: string | null` — parsed text for capsule semantics.
- `semanticExtracted: boolean` — extraction success flag.
- Plus transport fields: `encryptedRef`, `encryptedHash`, `previewRef`, `rasterProof`, `isMedia`, `hasTranscript`.

**Provenance**: Filled by **`processAttachmentForParsing`** (`parserService.ts`), optionally updated by vision path in **`runDraftAttachmentParseWithFallback`**.

## Draft attachment (popup-chat)

Typical shape (from code references):

- `capsuleAttachment: CapsuleAttachment`
- `processing: { parsing: boolean; rasterizing: boolean; error?: string }`
- `dataBase64: string` — required for re-parse / vision.

## LocalAttachment (inline composer)

From `BeapInlineComposer.tsx`:

- `previewText?: string | null`
- `previewError?: string | null`
- Path/size/mime for send — **no** `semanticExtracted` boolean separate from text presence.

## Mapping

| Concept | Legacy | Inline |
|---------|--------|--------|
| Parsed text | `semanticContent` | `previewText` |
| Success flag | `semanticExtracted` | implied by `previewText` non-empty |
| In progress | `processing.parsing` | **not modeled** (extract is awaited in `addAttachments` synchronously from UI perspective) |
| Error | `processing.error` | `previewError` |
| Vision fallback | `draftAttachmentAutoParse.ts` | **not called** |

## Regression

Inline **does not** persist **`CapsuleAttachment`**-shaped parse results for rows; preview is **parallel** to send packaging.

## Uncertainty

Whether product requires **semantic text in capsule** for attachments at send time is determined by **`BeapPackageBuilder`** / `executeDeliveryAction` — inline composer still passes **`semanticContent: null`** in the snippet observed in analysis. Confirm in builder if attachments rely on pre-extracted text for any path.
