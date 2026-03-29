# Root cause summary

## Purpose

Separate issues into **parser backend**, **missing UI wiring**, **missing legacy components**, **contrast/readability**, and **active-field indicator** — answering whether failures are **parse**, **display**, **wiring**, or **combined**.

---

## 1. Parser backend problems

- **Not the only story:** Inline composer uses **`extractTextForPackagePreview`** (HTTP `127.0.0.1:51248` + UTF-8 decode). Legacy popup uses **`processAttachmentForParsing`** (pdfjs + orchestrator + optional **vision**).
- **Symptom overlap:** If port **51248** is down, **both** inline preview and parts of legacy can fail — but legacy may still get **pdfjs** text in-extension **without** Electron (per `parserService.ts` comments).
- **Conclusion:** Some user-visible “parse failures” are **environment / pipeline differences**, not necessarily “parser deleted.” **Uncertainty:** per-file comparison of outputs not run.

---

## 2. Missing UI wiring

- **`AttachmentStatusBadge`** is **not** imported or rendered in **`BeapInlineComposer.tsx`**.
- Inline **`LocalAttachment`** does not model **`processing.parsing`**, so **Extracting…** cannot be shown without state additions.
- **`runDraftAttachmentParseWithFallback`** is **not** called from inline composer — **vision fallback** and **`CapsuleAttachment`** update path are **absent**.

---

## 3. Missing legacy components (in inline UI)

- **Green “Parsed” badge:** component exists (**`AttachmentStatusBadge`**) but **not used** in inline attachment rows.
- **Retry** control for failed PDF parse: **not present** on inline rows (popup has it).
- **Semantic parity:** inline **`handleSend`** sets **`semanticContent: null`**, **`semanticExtracted: false`** on `CapsuleAttachment` entries — parse preview **does not feed** send-time capsule fields in current code.

---

## 4. Contrast / readability styling issues

- **`BeapInlineComposer`** still uses **translucent** panels: e.g. **`rgba(255,255,255,0.04)`** delivery details, **`rgba(59,130,246,0.08)`** email panel, **purple/blue translucent** distribution toggles with **`#e2e8f0`** text — evidence in `09-contrast-and-readability-audit.md`.
- **Legacy `popup-chat`** still has **lavender** encrypted textarea and **muted-on-purple** info surfaces — if product compares inline to **popup**, both may be “wrong” for stricter contrast rules.
- **Right rail:** current `AiDraftContextRail` file uses **opaque** light text colors; if users still see **washed** UI, suspect **older build**, **different panel**, or **CSS variables** outside audited files.

---

## 5. Active-field indicator gap

- **Electron inline** already uses **`DraftRefineLabel`** + **sparkle SVG** when `connected && refineTarget` matches — **not** a pointing-finger icon.
- **Legacy popup-chat** BEAP draft **does not** use **`useDraftRefineStore`** — **no** equivalent indicator there.

---

## Direct answers (analysis questions)

1. **Green “Parsed” badge source:** `AttachmentStatusBadge` **`success`** config, label string **`Parsed`** (`AttachmentStatusBadge.tsx`).
2. **Raw text reader component:** **`BeapDocumentReaderModal`**.
3. **Page navigation / thumbnails:** **`BeapDocumentReaderModal`** left rail — **synthetic text pages** (`P1`, `P2`, …), not image thumbnails (`splitToSyntheticPages`).
4. **Legacy reader document model:** Single **`semanticContent`** string; paging is **synthetic**, not PDF page objects.
5. **Inline failing to parse vs failing to display:** **Both possible** — inline can **extract** to `previewText` but **does not show badge**; if HTTP fails, **`previewError`** shows. **Display-layer** gap is certain for **badge**; **parser** gap is **pipeline-specific**.
6. **Parsed results produced but not wired?** **Inline:** `previewText` **is** stored and can open **`BeapDocumentReaderModal`** — **partially wired**. **`semanticExtracted` / badge:** **not wired**.
7. **Lowest-risk reuse:** **`AttachmentStatusBadge`**, **`BeapDocumentReaderModal`**, optionally **`runDraftAttachmentParseWithFallback`** if Electron can supply **base64** in same shape as popup.
8. **Low-contrast styles:** Listed in **`09-contrast-and-readability-audit.md`** with file references.
9. **Labels for pointing-finger icon:** **`DraftRefineLabel`** call sites: **BEAP public**, **BEAP encrypted**, **Email body** — same component can swap icon once.
10. **Lowest-risk restoration path:** See **`12-restoration-recommendation.md`**.

---

## Unambiguous conclusion

Problems are a **combination**:

- **Display-layer regression** for **badge + full parse lifecycle UI** in inline composer.
- **Architectural fork** (preview helper vs **`parserService` + draft auto-parse**).
- **Contrast debt** in **specific inline and popup inline styles** (evidence-based list above).
- **Active-field indicator** is **partially implemented** (sparkle), not **missing entirely**, unless product definition requires **👆** specifically.
