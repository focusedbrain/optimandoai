# Restoration plan (phased, lowest risk)

**Order is fixed** per audit requirements. **Analysis only** — no implementation here.

## Phase 1 — PRIVATE/PUBLIC selector parity

1. Import **`RecipientModeSwitch`** from `@ext/beap-messages` (same package as existing `RecipientMode` type import).
2. Replace inline **two-button** block with **`<RecipientModeSwitch mode={recipientMode} onModeChange={setRecipientMode} theme="dark" />`** (or `standard` if shell is restyled light — **match** `RecipientHandshakeSelect` which already uses **`theme="dark"`**).
3. **Risk:** Low — **same** `RecipientMode` state type; verify **layout** spacing vs handshake block.

## Phase 2 — Fingerprint block parity

1. **Lift** popup fingerprint **card** markup from **`popup-chat.tsx`** into a **small shared component** (optional) or **duplicate** structure in `BeapInlineComposer` to avoid coupling to popup.
2. Place **above** `RecipientModeSwitch` to match legacy **order** (fingerprint → distribution → handshake).
3. Wire **Copy** to **`getSigningKeyPair()`** full `publicKey` (or formatted string consistent with product).
4. **Risk:** Low–medium — **identity** string may need **product decision** to match WR identity fingerprint vs signing key.

## Phase 3 — High-contrast readability fixes

1. On **email accounts** tinted panel: set **title** `color` to **`#0f172a`** or **`#1e293b`** (or `muted` `#64748b` for secondary), **never** inherit `fg`.
2. Audit **any** new tinted surfaces after Phases 1–2 for **inherited** light text on light wash.
3. **Risk:** Low.

## Phase 4 — Active-field indicator (pointing finger)

1. Update **`DraftRefineLabel`** to render **👆** (or SVG) **before** `children` when `active`, **remove or replace** sparkle per product lock.
2. **Risk:** Low — affects all consumers of `DraftRefineLabel`; **grep** usages before change.

## Phase 5 — Parsed badge restoration

1. Import **`AttachmentStatusBadge`** from `@ext/beap-builder`.
2. Add **`AttachmentParseStatus`** (or map) to **`LocalAttachment`** lifecycle: **`pending`** during `extractTextForPackagePreview`, **`success`** if text, **`failed`** on error.
3. Render badge next to filename for **PDF** (or all parseable types — match popup `showPdfBadge` logic).
4. **Risk:** Low if status mirrors extension rules.

## Phase 6 — Text reader restoration

1. **Keep** **`BeapDocumentReaderModal`** — already integrated.
2. Align **`theme`** with composer (**`dark`** if shell stays dark) to reduce **jarring** modal.
3. Revisit **auto-open** on first parse: match popup behavior if specified in UX review.
4. **Risk:** Low.

## Phase 7 — Page-navigation restoration

1. **No new component** required if Phase 6 keeps **`BeapDocumentReaderModal`** — **rail** already present.
2. Verify **left rail** visible and **keyboard** behavior matches expectations (Escape, etc. — already in modal).
3. **Risk:** None if modal unchanged.

## Phase 8 — Deeper parser refactor (only if still needed)

1. If **`extractTextForPackagePreview`** is insufficient vs **`runDraftAttachmentParseWithFallback`** (formats, OCR, fallbacks), **port** or **share** the extension helper behind an Electron-safe adapter.
2. **Only after** display parity proves **remaining** failures are **backend**.
3. **Risk:** Medium–high — **touch** IPC, ports, and extension parity tests.

## Reuse summary

| Asset | Reuse |
|-------|--------|
| `RecipientModeSwitch` | Direct |
| Fingerprint card | Copy structure from popup |
| `AttachmentStatusBadge` | Direct |
| `BeapDocumentReaderModal` | Direct (already) |
| `runDraftAttachmentParseWithFallback` | Adapt or call shared core |
| `DraftRefineLabel` | Extend / swap icon |
