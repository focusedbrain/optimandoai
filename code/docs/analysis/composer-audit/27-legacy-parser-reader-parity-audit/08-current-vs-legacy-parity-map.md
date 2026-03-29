# Current vs legacy parity map

## Purpose

Classify behaviors: **preserved**, **partial**, **missing**, **broken**, **present but unwired**.

## Legend

1. Preserved  
2. Partially preserved  
3. Missing  
4. Broken  
5. Present in code, not wired to inline UI  

---

| Behavior | Status | Evidence |
|----------|--------|----------|
| PDF text extraction (some path) | **2** | Inline: HTTP 51248 (`beapPackageAttachmentPreview.ts`). Legacy: `parserService` pdfjs + HTTP + vision. |
| Green “Parsed” badge | **5** / **3** for inline | `AttachmentStatusBadge` exists; **not** imported in `BeapInlineComposer.tsx`. |
| Extracting / Failed badge | **3** | No `processing.parsing` model on inline rows. |
| `BeapDocumentReaderModal` | **2** | Wired in inline with `readerText` from `previewText`; legacy uses `semanticContent`. |
| Synthetic page rail (P1, P2, …) | **1** | Same `BeapDocumentReaderModal` component. |
| Open reader from row | **2** | Legacy: “Open reader”; Inline: “View text” when `previewText` set. |
| Auto-open modal on success | **2** | Popup: **manual** “Open reader” only (`popup-chat.tsx`). Inline: **auto-opens** when first new row has `previewText` (`BeapInlineComposer.tsx` `addAttachments`, ~263–267). |
| Vision fallback for scanned PDF | **3** for inline | `runDraftAttachmentParseWithFallback` not used. |
| Retry parse button | **3** for inline | Popup has Retry on error. |
| `CapsuleAttachment.semanticExtracted` on send | **2** | Inline sets **false** / **null** in `handleSend` (observed lines 321–327). |
| AI refine field wiring | **2** | `useDraftRefineStore` + `DraftRefineLabel` (sparkle SVG) on public/encrypted labels — **not** pointing-finger icon. |
| Popup encrypted field lavender styling | **1** (legacy) | `popup-chat.tsx` ~1336–1349 `rgba(139,92,246,…)` — **product concern**: low contrast on tinted field. |
| Inline encrypted/public white fields | **1** (current code) | `BeapInlineComposer` uses `#ffffff` / `#0f172a` for main text areas (observed). |
| Right rail AI context | **2** | `AiDraftContextRail` uses solid `#f8fafc` aside + dark text in file reviewed — **if** user still sees lavender, may be **cached build** or **other shell** not audited here. |

## Summary sentence

**Parsing** is **not globally broken** — two pipelines exist; **inline uses a thinner HTTP+decode path**. **Display-layer regression** is clear for **badge + full legacy state machine**. **Reader component** exists in both; **thumbnail** expectation may be **spec mismatch** (synthetic text pages only).
