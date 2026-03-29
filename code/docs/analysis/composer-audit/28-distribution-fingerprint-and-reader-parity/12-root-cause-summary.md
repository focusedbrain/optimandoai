# Root cause summary

Separated per user request. **No** implementation in this document.

## 1. Selector / fingerprint structural regressions

- **PRIVATE/PUBLIC:** Inline uses **ad-hoc** `<button>`s (`BeapInlineComposer.tsx` ~495–533) instead of **`RecipientModeSwitch`** (`beap-messages/components/RecipientModeSwitch.tsx`). Missing: **icons**, **subtitle lines**, **gradient active treatment**, **mode description strip**.
- **Fingerprint:** Popup uses a **dedicated blue card** with section title, `<code>`, **Copy** (`popup-chat.tsx` ~1221–1261). Inline uses **one muted line** inside **Delivery details** (~579). **Order** differs: legacy **fingerprint before mode**; inline **mode before** delivery box containing fingerprint.
- **Data:** Short fingerprint **is** available inline (`getSigningKeyPair`); full key **available** for copy — **not** wired. **Uncertainty:** parity with popup’s `identity.fingerprint` / `formatFingerprintShort` pipeline.

## 2. Contrast / readability styling issues

- **Email “Connected email accounts”** title inherits **`fg` (`#e2e8f0`)** on **`rgba(59,130,246,0.08)`** — **documented** in [11-contrast-and-readability-root-causes.md](./11-contrast-and-readability-root-causes.md).
- **Reader modal** uses **`theme="standard"`** while composer is **dark** — discontinuity, not a single-field failure.

## 3. Active-field indicator gap

- **`DraftRefineLabel`** shows **sparkle after** label (`DraftRefineLabel.tsx`). Spec asks **pointing-finger before** label. **Store wiring** (`refineTarget`, `connected`) is **correct** for BEAP public/encrypted.

## 4. Parsed badge / reader / page-navigation regressions

- **Badge:** Inline **does not** render **`AttachmentStatusBadge`**; legacy uses **`runDraftAttachmentParseWithFallback`** + **`parseStatus`** + badge.
- **Reader + rail:** **`BeapDocumentReaderModal`** is **already** used inline — **page rail** is **inside** the shared modal. **Gap** is **workflow** (badge, pending state, auto-open policy) and **theme** choice, not **missing component**.
- **Parser backend vs display:** Inline **calls** `extractTextForPackagePreview` (local HTTP). Failures appear as **string** `previewError`, not **Failed** badge. **Primary** gap = **display layer** + **status model**; **deeper** parser issues **only** if HTTP route fails in production (not proven here).

## 5. Parser backend vs display-layer issues

| Issue type | Evidence |
|------------|----------|
| **Display-layer** | No `AttachmentStatusBadge`, no `pending` UI, no parity with `runDraftAttachmentParseWithFallback` state updates |
| **Backend** | Inline uses **different** entry (`beapPackageAttachmentPreview.ts` + port) vs extension **`parserService` / draftAttachmentAutoParse** — **integration** divergence; **success path** does populate `previewText` |

## Answered analysis questions (cross-reference)

| # | Answer |
|---|--------|
| 1 | **`RecipientModeSwitch`** |
| 2 | **Inline JSX** in **`popup-chat.tsx`** (fingerprint card), not a separate exported component |
| 3 | **Adjacent:** fingerprint **card** then **mode switch** — **not** one merged control |
| 4 | **Premium feel** from **RecipientModeSwitch** structure + **fingerprint card** typography (uppercase label, monospace, Copy) — see §01–03 |
| 5 | **Mostly yes** for fingerprint short text; **structure** is weaker |
| 6 | **Inherited `fg`** on blue-tint email panel title — see §11 |
| 7 | **BEAP™ message**, **Encrypted message (private)** — any field using **`DraftRefineLabel`** + future targets if added |
| 8 | **`AttachmentStatusBadge`** `CONFIGS.success.label === 'Parsed'` |
| 9 | **`BeapDocumentReaderModal`** |
| 10 | **Same modal** — **left sidebar** page list (`sidebarBg` / synthetic pages) |
| 11 | **Primarily display-layer** (badge/workflow); parse **can** succeed via `extractTextForPackagePreview` |
| 12 | **`RecipientModeSwitch`**, **`AttachmentStatusBadge`**, **`BeapDocumentReaderModal`**, **`runDraftAttachmentParseWithFallback`** (or port its contract), **`DraftRefineLabel`** (icon swap) |
| 13 | See [13-restoration-plan.md](./13-restoration-plan.md) |
