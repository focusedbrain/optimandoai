# Strict legacy-parity implementation report (inline BEAP Composer)

**Date:** 2026-03-28  
**Scope:** Product implementation matching audits **28** (distribution / fingerprint / reader) and **27** (parser/reader), using the lowest-risk reuse path.

---

## Changed files

| File | Change |
|------|--------|
| `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` | Full parity pass: `RecipientModeSwitch`, fingerprint card, contrast, `AttachmentStatusBadge`, PDF parse lifecycle, `BeapDocumentReaderModal` `theme="dark"`, layout order |
| `apps/electron-vite-project/src/components/DraftRefineLabel.tsx` | Active refine: **👆 before** label (replaces sparkle-after) |

---

## What was restored from legacy behavior

1. **PRIVATE / PUBLIC:** Reused **`RecipientModeSwitch`** from `@ext/beap-messages` — same component as `popup-chat.tsx` (card shell, 🔐/🌐, PRIVATE/PUBLIC subtitles, mode description strip, gradient active states). **`theme="dark"`** for the dark dashboard column (non-`standard` branch = white text on gradient when active, matching extension dark/hacker styling intent).

2. **Fingerprint:** Restructured to match **`popup-chat.tsx`** fingerprint block: blue-tint bordered card, **YOUR FINGERPRINT** title, monospace `<code>` short value, **Copy** button. **Order:** fingerprint → distribution → handshake → delivery method → … (aligned with audit §5).

3. **Copy affordance:** **`getSigningKeyPair().publicKey`** stored as `fingerprintFull`; Copy writes full key (same source as send path short form).

4. **Parsed attachments:** **PDF** attachments use **`AttachmentParseStatus`**: `pending` while `extractTextForPackagePreview` runs, then `success` or `failed`. **`AttachmentStatusBadge`** shows **Extracting…** / **Parsed** / **Failed** for PDFs only (same visibility rule as legacy `showPdfBadge` for PDF).

5. **Reader:** **`BeapDocumentReaderModal`** unchanged in API; **`theme="dark"`** so the modal matches the composer chrome and keeps the built-in **left page-navigation rail** (`splitToSyntheticPages`) readable on dark. First successful PDF/text preview still opens the reader; **View text** remains for any row with `previewText`.

---

## Reused directly vs adapted

| Asset | How |
|-------|-----|
| `RecipientModeSwitch` | **Direct import** from `@ext/beap-messages` |
| `AttachmentStatusBadge` | **Direct import** from `@ext/beap-builder/components/AttachmentStatusBadge` |
| `BeapDocumentReaderModal` | **Direct** — only `theme` changed `standard` → `dark` |
| `extractTextForPackagePreview` | **Unchanged** — display/state layer was the gap per audit; no `parserService` / `draftAttachmentAutoParse` port in this pass |
| Fingerprint card | **Adapted** from popup inline JSX (structure/colors aligned to dark branch of popup) |
| `DraftRefineLabel` | **Adapted** — shared wrapper; 👆 before children for all consumers |

---

## Selector parity result

- Ad-hoc **Private (qBEAP) / Public (pBEAP)** buttons removed.
- **Distribution Mode** label, segmented control, icons, subtitles, and **mode description** block are back via **`RecipientModeSwitch`**.

---

## Fingerprint parity result

- Standalone **premium** card at top of scroll content; fingerprint **removed** from the nested **Delivery details** box to avoid duplication.
- **Copy** + short display + high-contrast blue title/code on tinted background.

---

## Contrast / readability fixes

- **Email accounts** panel: **opaque** `#eff6ff` background, `#93c5fd` border, titles **`#0c4a6e`**, body **`#0f172a`** — no inherited light-gray (`fg`) on pale blue.
- **Delivery details:** **Opaque** `#1e293b` + `#334155` border; body copy **`#cbd5e1`** / **`#e2e8f0`** for headings — no `rgba(255,255,255,0.04)` wash.
- **Main column** scroll area: explicit **`#0f172a`** background; header/toolbar buttons use solid **`#1e293b`** borders.
- **Send error:** solid light red panel **`#fef2f2`** + **`#991b1b`** text (no pink-on-red-transparent-only).
- **Right rail:** **`#f1f5f9`** background, footer copy **`#0f172a`** (sharp dark-on-light).
- **Send** button: removed **opacity** reduction while sending; **`cursor: wait`** only.
- **Attachment row** “View text”:** `#1e1b4b` text on white for strong contrast on indigo border.

---

## Active-field indicator

- Implemented in **`DraftRefineLabel`**: when `active`, **👆** renders **before** `children`.
- **BEAP:** public + encrypted labels unchanged in wiring.
- **Email:** **`EmailInlineComposer`** uses the same **`DraftRefineLabel`** for **Body** — automatically gets 👆 when `refineTarget === 'email'`.

---

## Parsed badge / reader / page rail

- **Badge:** Restored for **PDF** rows via **`AttachmentStatusBadge`** + `parseStatus`.
- **Parser backend:** **No change** to `beapPackageAttachmentPreview.ts` or Electron HTTP parser routes in this pass. Regression was **state + UI** (pending/success/failed + badge), per audit.
- **Reader + rail:** Same **`BeapDocumentReaderModal`**; rail is internal to the modal; **`theme="dark"`** for continuity.

---

## Parser backend changes

**None.** Parse still uses **`extractTextForPackagePreview`** (local `CONTEXT_UPLOAD_HTTP_PORT`). If production still sees empty extracts, that would be a **follow-up** (env/port/service), not part of this UI parity pass.

---

## Remaining gaps / notes

- **Identity fingerprint vs signing key:** Popup uses **`formatFingerprintShort(identity.fingerprint)`** from identity store; inline uses **`getSigningKeyPair().publicKey`**. Product may want them unified — **not changed** here (send path already used signing key).
- **`AttachmentStatusBadge` `theme` prop:** Still unused inside the component (pre-existing).
- **Non-PDF** attachments: no badge (matches legacy PDF-only badge visibility); text files still get preview + **View text** when extract succeeds.

---

## Manual QA checklist

- [ ] BEAP compose opens full-width with **no** left message list (unchanged shell).
- [ ] **PRIVATE / PUBLIC** matches premium **`RecipientModeSwitch`** (icons, subtitles, explainer strip).
- [ ] **Fingerprint** card is prominent, readable, **Copy** works.
- [ ] No white/low-contrast text on **light lavender/tinted** panels (email panel uses dark text on `#eff6ff`).
- [ ] Active refine field shows **👆** in the **label** (BEAP public, BEAP encrypted; Email **Body** if connected).
- [ ] **PDF** attachment: **Extracting…** then **Parsed** or **Failed** badge.
- [ ] **Green Parsed** badge on successful PDF parse.
- [ ] **View text** / auto-open shows **`BeapDocumentReaderModal`** with parsed content.
- [ ] Reader **left-side page list** visible (synthetic pages).
- [ ] **Send** still succeeds for BEAP (no config changes).
- [ ] **Handshake** list, select, retry, preselect unchanged logically.
- [ ] **Email composer** refine label still behaves if AI connected to **Body**.

---

## Definition of done (this pass)

Addressed: original-style **RecipientModeSwitch**, **premium fingerprint block**, **high-contrast** panels and rail, **👆** active-field labels, **Parsed** badge + **reader** workflow with **dark** modal theme and existing **page rail**.
