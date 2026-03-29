# Restoration recommendation (phased)

## Purpose

Ordered **phased** path: **contrast → active-field icon → badge → reader → synthetic page rail → parser refactor only if needed**.

**Constraint reminder:** analysis-only doc; no implementation here.

---

## Phase 1 — Contrast / readability fixes

**Goal:** Remove **translucent “disabled”** appearance from business-critical composer surfaces.

**Actions (conceptual):**

1. Replace **`rgba(255,255,255,0.04)`** delivery-details card and similar with **opaque** neutrals (`#f8fafc` / `#ffffff`) **or** ensure **dark text** on any tinted panel — files: **`BeapInlineComposer.tsx`** (evidence in `09-contrast-and-readability-audit.md`).
2. Revisit **distribution** toggle active states: prefer **solid** fills or **clear border** with **#ffffff** / **#0f172a** text instead of **`rgba(124,58,237,0.35)` + `#e2e8f0`**.
3. Align **legacy popup** encrypted field with same drafting-surface rules **if** popup remains a reference UX — **`popup-chat.tsx`** lavender block.

**Risk:** Low — visual only.

---

## Phase 2 — Active-field indicator

**Goal:** **Pointing-finger** (or product-approved glyph) at **label** when refine is active.

**Hook:** **`DraftRefineLabel`** (`10-selected-field-indicator-hook-points.md`) — swap icon, keep **`active`** prop contract.

**Risk:** Low — isolated component.

---

## Phase 3 — Parsed badge restoration

**Goal:** Restore **Extracting… / Parsed / Failed** for inline attachments.

**Actions:**

1. Extend row state to **`processing`-like** flags **or** map from **`previewText` / `previewError`** + async parse.
2. Render **`AttachmentStatusBadge`** beside filename (import from `@ext/beap-builder/components` in Electron alias).

**Risk:** Medium — must not block send; badge is informational.

---

## Phase 4 — Text reader restoration (parity)

**Goal:** Ensure reader opens from **same mental model** as popup (**Open reader** always available when text exists).

**Actions:**

1. Keep **`BeapDocumentReaderModal`**; ensure **`semanticContent`** string is passed (today: **`readerText`** from **`previewText`**).
2. Decide **auto-open vs manual-only** — popup uses **manual “Open reader”**; inline **auto-opens** first successful preview — product may want **alignment**.

**Risk:** Low–medium — UX policy choice.

---

## Phase 5 — Page “thumbnail” navigation

**Goal:** Clarify product intent:

- If **synthetic P1/P2 rail** is enough: **already in `BeapDocumentReaderModal`** — **no new component**; ensure modal is **reachable** whenever text exists.
- If **true PDF page thumbnails** are required: **new work** — **not** in current `BeapDocumentReaderModal`; **out of scope** for “reuse legacy” unless another component exists (none found in this audit).

**Risk:** High if image thumbnails are mandatory.

---

## Phase 6 — Parser refactor (only if needed)

**Goal:** Single pipeline: **`runDraftAttachmentParseWithFallback`** + **`CapsuleAttachment`** updates **if** product requires **vision fallback** and **same extract** as extension.

** Preconditions:**

- Electron can provide **base64** + stable **`CapsuleAttachment`** ids **before** send.
- Confirm **`executeDeliveryAction`** / builder **uses** `semanticContent` for attachments when set.

**Risk:** High — touches **send / package** semantics.

---

## Reuse priority (lowest risk first)

1. **`AttachmentStatusBadge`**
2. **`BeapDocumentReaderModal`**
3. **`DraftRefineLabel`** (icon only)
4. **`runDraftAttachmentParseWithFallback`** + **`processAttachmentForParsing`** (after contract review)

---

## Notes

**Do not** assume **parser backend is broken** without comparing **51248** health vs **pdfjs** path for the same file — **diagnostic step**, not code change in this audit.
