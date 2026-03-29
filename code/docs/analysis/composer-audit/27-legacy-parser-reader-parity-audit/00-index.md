# Legacy parser / reader parity audit (index)

**Single merged document:** [COMPLETE-AUDIT.md](./COMPLETE-AUDIT.md) — all sections below in one file.

## Scope

Analysis-only documentation comparing **legacy BEAP capsule-builder / popup-chat attachment UX** with the **Electron inline `BeapInlineComposer`**, plus **contrast**, **parsed-state models**, and **AI refine field indicators**.

No code changes were made in this pass.

## Reading order

| File | Contents |
|------|----------|
| [01-current-inline-attachment-flow.md](./01-current-inline-attachment-flow.md) | End-to-end attachment + preview path in `BeapInlineComposer` |
| [02-legacy-capsule-builder-attachment-flow.md](./02-legacy-capsule-builder-attachment-flow.md) | Popup-chat + `CapsuleSection` patterns |
| [03-parsed-state-model.md](./03-parsed-state-model.md) | `CapsuleAttachment` vs `LocalAttachment` + preview fields |
| [04-parsed-badge-rendering.md](./04-parsed-badge-rendering.md) | `AttachmentStatusBadge` (“Parsed”) |
| [05-text-reader-and-raw-text-view.md](./05-text-reader-and-raw-text-view.md) | `BeapDocumentReaderModal` |
| [06-page-thumbnail-navigation.md](./06-page-thumbnail-navigation.md) | Synthetic page rail vs true PDF thumbnails |
| [07-parser-service-and-result-contracts.md](./07-parser-service-and-result-contracts.md) | `parserService`, HTTP extract, vision fallback |
| [08-current-vs-legacy-parity-map.md](./08-current-vs-legacy-parity-map.md) | Preserved / partial / missing / broken |
| [09-contrast-and-readability-audit.md](./09-contrast-and-readability-audit.md) | Inline styles and variables with evidence |
| [10-selected-field-indicator-hook-points.md](./10-selected-field-indicator-hook-points.md) | `useDraftRefineStore` + label sites |
| [11-root-cause-summary.md](./11-root-cause-summary.md) | Separated root causes |
| [12-restoration-recommendation.md](./12-restoration-recommendation.md) | Phased restoration order |

## Deep-dive blocks (`blocks/`)

| File | Topic |
|------|--------|
| [blocks/01-beap-document-reader-modal.md](./blocks/01-beap-document-reader-modal.md) | Reader modal UI and paging |
| [blocks/02-draft-attachment-auto-parse.md](./blocks/02-draft-attachment-auto-parse.md) | `runDraftAttachmentParseWithFallback` |
| [blocks/03-attachment-status-badge.md](./blocks/03-attachment-status-badge.md) | Green “Parsed” badge |
| [blocks/04-page-thumbnail-rail.md](./blocks/04-page-thumbnail-rail.md) | Synthetic P1/P2 rail (not image thumbnails) |
| [blocks/05-parser-service-process-attachment.md](./blocks/05-parser-service-process-attachment.md) | `processAttachmentForParsing` |
| [blocks/06-beap-inline-preview-helper.md](./blocks/06-beap-inline-preview-helper.md) | `extractTextForPackagePreview` |
| [blocks/07-use-draft-refine-store.md](./blocks/07-use-draft-refine-store.md) | Refine targets and hooks |

## Questions answered (see `11-root-cause-summary.md` for detail)

1. Green “Parsed” badge: `AttachmentStatusBadge` success config (`apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`).
2. Raw text reader: `BeapDocumentReaderModal` (`apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx`).
3. Page navigation / “thumbnails”: left rail in `BeapDocumentReaderModal` — **synthetic** pages from `splitToSyntheticPages`, not image thumbnails.
4. Legacy reader model: single `semanticContent` string (plus modal paging), not per-page OCR bitmaps.
5. Inline composer: **different** extract path (`extractTextForPackagePreview`); not the same as `processAttachmentForParsing` + `CapsuleAttachment` state machine.
