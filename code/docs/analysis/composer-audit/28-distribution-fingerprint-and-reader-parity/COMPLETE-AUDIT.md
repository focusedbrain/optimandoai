# Distribution, fingerprint, and reader parity — complete audit (28)

**Scope:** Analysis-only comparison of **legacy BEAP builder (popup-chat + shared beap-messages / beap-builder)** vs **Electron `BeapInlineComposer`**: PRIVATE/PUBLIC selector, fingerprint, parsed-document UX, active-field indicator, contrast.

**No code changes** in this audit.

---

## Table of contents

1. [Quick reference](#quick-reference)
2. [Legacy PRIVATE / PUBLIC selector](#1-legacy-private--public-selector)
3. [Current PRIVATE / PUBLIC selector](#2-current-private--public-selector)
4. [Legacy fingerprint presentation](#3-legacy-fingerprint-presentation)
5. [Current fingerprint presentation](#4-current-fingerprint-presentation)
6. [Selector and fingerprint parity map](#5-selector-and-fingerprint-parity-map)
7. [Current inline attachment parse and display](#6-current-inline-attachment-parse-and-display-flow)
8. [Legacy attachment parse and display](#7-legacy-attachment-parse-and-display-flow)
9. [Parsed badge and status model](#8-parsed-badge-and-status-model)
10. [Text reader and page navigation](#9-text-reader-and-page-navigation)
11. [Active-field indicator hook points](#10-active-field-indicator-hook-points)
12. [Contrast and readability root causes](#11-contrast-and-readability-root-causes)
13. [Root cause summary](#12-root-cause-summary)
14. [Restoration plan](#13-restoration-plan)
15. [Component deep dives (blocks)](#part-ii--component-deep-dives-blocks)

---

## Quick reference

| # | Answer |
|---|--------|
| PRIVATE/PUBLIC premium selector | **`RecipientModeSwitch`** — `apps/extension-chromium/src/beap-messages/components/RecipientModeSwitch.tsx`; mounted in `popup-chat.tsx` above handshake + delivery. |
| Fingerprint block | **Inline JSX** in `popup-chat.tsx` (~1221–1261), not a separate exported component; **“Your Fingerprint”** card with `<code>`, Copy button. |
| Selector + fingerprint cluster | **fingerprint card → RecipientModeSwitch → RecipientHandshakeSelect → DeliveryMethodPanel** (fingerprint **not** inside `RecipientModeSwitch`; **adjacent**, fingerprint **first**). |
| Parsed badge | **`AttachmentStatusBadge`** — `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`. |
| Reader + page rail | **`BeapDocumentReaderModal`** — synthetic `splitToSyntheticPages` rail, not PDF image thumbnails. |

**Split files:** This folder also contains `00-index.md` … `13-restoration-plan.md` and `blocks/*.md` — same content as below.

---

## 1. Legacy PRIVATE / PUBLIC selector

### Component

**`RecipientModeSwitch`** — `apps/extension-chromium/src/beap-messages/components/RecipientModeSwitch.tsx`

### Mounting (original builder / WR Chat)

**`apps/extension-chromium/src/popup-chat.tsx`** (~1263–1267):

```tsx
<RecipientModeSwitch
  mode={beapRecipientMode}
  onModeChange={setBeapRecipientMode}
  theme={toBeapTheme(theme)}
/>
```

**Order in column:** Placed **after** the **Your Fingerprint** card and **before** `RecipientHandshakeSelect` (private) and `DeliveryMethodPanel`.

### Structure

1. **Section label:** `"Distribution Mode"` — `11px`, uppercase, letter-spacing `0.5px`, color `mutedColor` (`#64748b` standard / `rgba(255,255,255,0.7)` dark).
2. **Segmented control container:** `display: flex`, `gap: 4px`, `padding: 4px`, `borderRadius: 8px`, `border: 1px solid` purple/white border, background `rgba(15,23,42,0.05)` (standard) or `rgba(255,255,255,0.05)` (dark).
3. **Two buttons** (each `flex: 1`), **stacked content:**
   - Icon: **🔐** (private) / **🌐** (public), `16px`
   - Primary label: **PRIVATE** / **PUBLIC**
   - Secondary line (`9px`, `opacity: 0.8`): **qBEAP · Handshake Required** / **pBEAP · Auditable**
4. **Active state:** `linear-gradient(135deg, …)` — **blue** (`#3b82f6`→`#2563eb`) standard private; **standard** vs **dark** uses different gradient (purple `#8b5cf6`→`#7c3aed` for private active in dark). **Inactive:** `transparent` background, `mutedColor` text.
5. **Mode description card** below buttons (`marginTop: 8px`, `padding: 8px 10px`) — tinted background **blue or green** depending on mode; **strong** line with colored keyword (`#3b82f6` / `#22c55e` standard) + body `#475569` (standard) or `rgba(255,255,255,0.8)` (dark).

### Props

- `mode: RecipientMode`
- `onModeChange: (mode: RecipientMode) => void`
- `theme: 'standard' | 'hacker' | 'pro' | 'dark'`
- `disabled?: boolean`

### Reuse in Electron

**Yes, directly:** `RecipientModeSwitch` lives in `@ext/beap-messages`. Inline `BeapInlineComposer` already imports **`RecipientMode`** type — **only the type is imported**; the **component is not used**.

**Theme:** `theme="dark"` aligns with **dark** dashboard chrome; **`standard`** matches light-on-light if the composer column were restyled to light.

### Notes

**CapsuleSection** / standalone builder may use different patterns; **popup-chat** is the **reference** for “WR Chat BEAP draft” premium flow.

---

## 2. Current PRIVATE / PUBLIC selector

### File

`apps/electron-vite-project/src/components/BeapInlineComposer.tsx` (~495–533)

### Implementation

**Not** `RecipientModeSwitch`. Two plain `<button>` elements:

- Wrapper: `<span>` label **"Distribution"** (`11px`, uppercase, `color: muted` = `#64748b`).
- **No** outer padded card matching `RecipientModeSwitch`’s `rgba(15,23,42,0.05)` shell.
- **No** 🔐 / 🌐 icons.
- **No** secondary subtitle lines **qBEAP · Handshake Required** / **pBEAP · Auditable**.
- **No** mode-description strip below.

### Button styles (evidence)

- `flex: 1`, `padding: 10px 12px`, `borderRadius: 8`, `border` = `1px solid #e2e8eb`.
- Active private: `background: 'rgba(124,58,237,0.35)'`, `color: fg` (`#e2e8f0`).
- Active public: `background: 'rgba(59,130,246,0.3)'`, same `color: fg`.
- Inactive: `background: 'transparent'`.

**Text:** `"Private (qBEAP)"` / `"Public (pBEAP)"` on **one line** only.

### State

`useState<RecipientMode>('private')` — same **type** as legacy.

### Regression vs legacy

- **Visual language:** Legacy uses **card-in-card**, **icons**, **gradient active fills**; inline uses **flat translucent purple/blue** with **`fg`** — **not** the same premium pattern.
- **Information density:** Legacy mode description explains **cryptographic binding** vs **auditable**; inline has **no** equivalent under the toggle.

### Root cause

Inline composer implemented **minimal** toggle buttons instead of **reusing** `RecipientModeSwitch`.

---

## 3. Legacy fingerprint presentation

### Where it lives

**Not** a named export like `FingerprintCard` — **inline JSX** in **`apps/extension-chromium/src/popup-chat.tsx`** (~1221–1261), inside the BEAP compose scroll area, **above** `RecipientModeSwitch`.

### Structure

1. **Container:** `borderRadius: 8px`, `padding: 12px`, tinted blue background (standard: `rgba(59,130,246,0.08)`, border `1px solid rgba(59,130,246,0.2)`; dark variants in file).
2. **Title row:** `10px`, **uppercase**, letter-spacing `0.5px`, color `#3b82f6` (standard) / `#93c5fd` (dark) — **"Your Fingerprint"**.
3. **Value row:** **`<code>`** — monospace, `wordBreak: 'break-all'`; standard `#1e40af`, dark `#bfdbfe`.
4. **Copy button** — white on **blue** (`#3b82f6` standard); **Copied** state → `#22c55e` background.

### Data

- `ourFingerprintShort` from `formatFingerprintShort(identity.fingerprint)` (identity state).
- Full `ourFingerprint` for clipboard.

### Placement relative to distribution

**Fingerprint block is first**, then **`RecipientModeSwitch`**, then handshake, **`DeliveryMethodPanel`** (receives `ourFingerprintShort` for delivery hints).

### Shared components

**`DeliveryMethodPanel`** uses `ourFingerprintShort` for **recipient/filename** hints — **additional** context, not the **same** card block.

---

## 4. Current fingerprint presentation

### File

`apps/electron-vite-project/src/components/BeapInlineComposer.tsx`

### Data

- `fingerprintShort` from **`getSigningKeyPair()`** → `publicKey` truncated — **not** necessarily the same pipeline as popup’s `identity.fingerprint` / `formatFingerprintShort`. **Uncertainty:** not verified in this audit.

### Placement

**Inside** **“Delivery details”** card (~549–580): `background: 'rgba(255,255,255,0.04)'`, last line `Your fingerprint: {fingerprintShort}` — `fontSize: 11`, `color: muted` (`#64748b`).

**No** separate card above distribution. **No** `<code>`. **No** Copy.

### Structural differences vs legacy

| Aspect | Popup | Inline |
|--------|-------|--------|
| Visual hierarchy | Standalone **blue** card | **Muted** line in **grey** translucent panel |
| Typography | Monospace **code** | Plain **muted** sentence |
| Action | **Copy** | None |
| Label | **YOUR FINGERPRINT** uppercase | Inline “Your fingerprint:” |

### Data availability

Short string: yes. Full fingerprint for copy: **`getSigningKeyPair()`** — **available** but **not wired** to UI.

---

## 5. Selector and fingerprint parity map

| Dimension | Legacy (popup-chat) | Current (BeapInlineComposer) |
|-----------|---------------------|------------------------------|
| **PRIVATE/PUBLIC component** | `RecipientModeSwitch` | Ad-hoc `<button>` pair |
| **Section label** | “Distribution Mode” | “Distribution” |
| **Icons** | 🔐 / 🌐 | None |
| **Subtitles** | qBEAP · … / pBEAP · … | None (only “(qBEAP)” in button) |
| **Active styling** | Gradient fills | `rgba(124,58,237,0.35)` / `rgba(59,130,246,0.3)` + `fg` |
| **Mode explainer** | Tinted strip below | None under toggle |
| **Fingerprint** | Standalone blue card, `<code>`, Copy | Muted line in Delivery details |
| **Order** | Fingerprint → Mode → Handshake → Delivery | Mode → Handshake → Delivery (fingerprint inside delivery box) |

**Clustering:** Legacy: fingerprint **card** and **mode switch** are **adjacent siblings** (fingerprint **above** mode). **Current:** Fingerprint **nested** in delivery card **below** handshake.

**Lowest-risk restoration:** (1) Import **`RecipientModeSwitch`** with `theme="dark"`. (2) Copy popup fingerprint **card** **above** mode switch.

---

## 6. Current inline attachment parse and display flow

### Files

- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
- `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts` (`extractTextForPackagePreview`)

### Flow

1. **Add:** `addAttachments` → `window.emailInbox.showOpenDialogForAttachments` + `readFileForAttachment` → base64 + mime.
2. **Extract:** `extractTextForPackagePreview({ name, mimeType, base64 })` — HTTP to **`http://127.0.0.1:${CONTEXT_UPLOAD_HTTP_PORT}/api/parser/pdf/extract`**.
3. **State:** `LocalAttachment` — `previewText` / `previewError` — **no** `AttachmentParseStatus` enum.
4. **UI:** Light card row; **“View text”** if text; **Remove**; amber **previewError**.
5. **Badge:** **`AttachmentStatusBadge` not used** — no green **“Parsed”** pill.
6. **Reader:** `BeapDocumentReaderModal`; opens on first text or **View text**; `theme="standard"`.

### Parser backend vs display

- **Parse:** Inline **does** call local parser when extraction succeeds; failures = `previewError` string.
- **Display gap:** No **pending** UX, no **badge** (extension: `runDraftAttachmentParseWithFallback`).

### Uncertainty

`CONTEXT_UPLOAD_HTTP_PORT` vs extension parser — **environment-dependent**.

---

## 7. Legacy attachment parse and display flow

### Files

- `apps/extension-chromium/src/popup-chat.tsx`
- `apps/extension-chromium/src/beap-builder/draftAttachmentAutoParse.ts` — `runDraftAttachmentParseWithFallback`
- `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`
- `apps/extension-chromium/src/beap-builder/parserService.ts` (per audit 27)

### Flow

1. `DraftAttachment[]` with `parseStatus: 'pending' | 'success' | 'failed'`, `semanticContent`, etc.
2. **`runDraftAttachmentParseWithFallback`** orchestrates parse + fallbacks.
3. Row UI: **`<AttachmentStatusBadge status={parseStatus} />`** — **Extracting…** / **Parsed** / **Failed**.
4. **Reader:** `BeapDocumentReaderModal` with `semanticContent`.

**CapsuleSection.tsx** also uses **`AttachmentStatusBadge`**.

**vs inline:** Legacy **badge** + **state machine**; inline **one-shot** extract + error string + **View text**.

---

## 8. Parsed badge and status model

**Component:** `AttachmentStatusBadge` — `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`

```ts
success: { label: 'Parsed', bg: 'rgba(34,197,94,0.12)', color: '#16a34a', border: 'rgba(34,197,94,0.35)' },
```

**Type:** `AttachmentParseStatus = 'pending' | 'success' | 'failed'`

**Theme prop:** Declared but **implementation does not branch on `theme`** — dead API surface.

**Inline:** Does **not** mount `AttachmentStatusBadge`. Would need mapping `previewText`/`previewError` to status during async extract.

---

## 9. Text reader and page navigation

**`BeapDocumentReaderModal`** — `splitToSyntheticPages` (synthetic pages, not PDF thumbnails). **Left sidebar** = page list / navigation.

**Inline** (~800–806): `theme="standard"` while composer chrome is **dark**.

| Item | Legacy | Inline |
|------|--------|--------|
| Modal + rail | Yes | Yes (same component) |
| Green Parsed badge | Yes | No |
| Extracting… | Yes (`pending`) | No |
| Theming | Matches app | Fixed `standard` |

---

## 10. Active-field indicator hook points

**Store:** `useDraftRefineStore` — `refineTarget`, `connect`, `disconnect`, `connected`.

**BEAP inline mapping:** Public → `capsule-public`; Encrypted → `capsule-encrypted` (`handleFieldClick` ~157–173).

**`DraftRefineLabel`:** Sparkle SVG **after** label when `active`. Product ask: **pointing-finger before** label.

**Hook point:** Centralize in **`DraftRefineLabel`** (icon before `children` when `active`).

**Exact labels (BeapInlineComposer):**

1. `BEAP™ message (required)` — `capsule-public`
2. `Encrypted message (private)` — `capsule-encrypted`

Subject / attachments: **not** `DraftRefineLabel` in this file unless extended.

---

## 11. Contrast and readability root causes

**Finding 1 — Email “Connected email accounts” title (~474–477):** Inherits **`fg` (`#e2e8f0`)** on **`rgba(59,130,246,0.08)`** — **low contrast**. Subtext uses `muted` — better.

**Finding 2 — Fingerprint line (~579):** `muted` on dark translucent panel — acceptable; **hierarchy** vs popup.

**Finding 3 — Distribution toggles (~509–527):** `fg` on rgba over **dark** bg — usually OK; risk if shell lightens.

**Finding 4 — Send error (~739):** `rgba(239,68,68,0.15)` + `#fecaca` — intentional, high contrast.

**Finding 5 — Right rail:** `#f8fafc` + `#475569` — high contrast.

**Finding 6 — Attachment rows:** `#f8fafc` + `#0f172a` — high contrast.

**Finding 7 — Reader modal:** `theme="standard"` vs dark shell — **discontinuity**.

| Surface | Issue | Code cause |
|---------|-------|------------|
| Email accounts title | Low contrast | Inherited `fg` on light blue tint |
| Distribution buttons | Context-dependent | `fg` on rgba on dark |
| Fingerprint | Weak hierarchy | `muted` small text |
| Reader modal | Theme jump | `theme="standard"` vs dark composer |

---

## 12. Root cause summary

### Selector / fingerprint structural regressions

- **PRIVATE/PUBLIC:** Ad-hoc buttons vs **`RecipientModeSwitch`**. Missing icons, subtitles, gradient, explainer strip.
- **Fingerprint:** Popup **blue card** + Copy vs **one muted line** in Delivery details. Order: legacy **fingerprint before mode**; inline **fingerprint inside delivery** below handshake.
- **Data:** Short fp available inline; full copy not wired. **Uncertainty:** identity vs signing-key fingerprint parity.

### Contrast / readability

- Email panel title: inherited **`fg`** on blue tint.
- Reader: **`theme="standard"`** vs dark composer.

### Active-field indicator

- **`DraftRefineLabel`:** sparkle **after**; spec: finger **before**. Store wiring **OK**.

### Parsed badge / reader / page-navigation

- **Badge:** No **`AttachmentStatusBadge`**. Legacy: **`runDraftAttachmentParseWithFallback`** + **`parseStatus`**.
- **Reader + rail:** **`BeapDocumentReaderModal` already used** — gap = workflow + theme, not missing modal.
- **Backend vs display:** Primary gap **display + status model**; inline **`extractTextForPackagePreview`** can populate `previewText` on success.

### Parser backend vs display-layer

| Type | Evidence |
|------|----------|
| **Display-layer** | No badge, no pending UI |
| **Backend** | Different entry (`beapPackageAttachmentPreview` + port) vs extension **`parserService` / draftAttachmentAutoParse** |

### Analysis questions (numbered)

| # | Answer |
|---|--------|
| 1 | **`RecipientModeSwitch`** |
| 2 | **Inline JSX** in **`popup-chat.tsx`** (fingerprint card) |
| 3 | **Adjacent:** fingerprint card then mode switch — **not** one merged control |
| 4 | **Premium feel:** `RecipientModeSwitch` + fingerprint card typography |
| 5 | **Mostly yes** for short text; **structure** weaker |
| 6 | **Inherited `fg`** on blue-tint email title |
| 7 | **BEAP™ message**, **Encrypted message (private)** (+ future `DraftRefineLabel` targets) |
| 8 | **`AttachmentStatusBadge`** `CONFIGS.success.label === 'Parsed'` |
| 9 | **`BeapDocumentReaderModal`** |
| 10 | **Same modal** — left **sidebar** / synthetic pages |
| 11 | **Primarily display-layer**; parse **can** succeed |
| 12 | **`RecipientModeSwitch`**, **`AttachmentStatusBadge`**, **`BeapDocumentReaderModal`**, **`runDraftAttachmentParseWithFallback`** (or adapt), **`DraftRefineLabel`** |
| 13 | See [§13 Restoration plan](#13-restoration-plan) |

---

## 13. Restoration plan

**Order fixed.** Analysis only.

1. **PRIVATE/PUBLIC:** Import **`RecipientModeSwitch`**, replace two buttons, `theme="dark"` (match `RecipientHandshakeSelect`). **Risk:** Low.
2. **Fingerprint:** Lift popup card JSX; place **above** mode switch; Copy from **`getSigningKeyPair()`**. **Risk:** Low–medium (identity parity).
3. **Contrast:** Email title explicit dark/muted color — **never** inherit `fg` on light tint. **Risk:** Low.
4. **Active field:** **`DraftRefineLabel`** — 👆 **before** children; replace sparkle. **Risk:** Low — grep all usages.
5. **Parsed badge:** Import **`AttachmentStatusBadge`**; add **`AttachmentParseStatus`** to attachment lifecycle. **Risk:** Low.
6. **Reader:** Keep **`BeapDocumentReaderModal`**; align **`theme`** to composer; revisit auto-open. **Risk:** Low.
7. **Page navigation:** **No new component** if modal kept — verify rail + keyboard. **Risk:** None.
8. **Parser refactor (last):** Share **`runDraftAttachmentParseWithFallback`** behavior if **`extractTextForPackagePreview`** insufficient. **Risk:** Medium–high.

**Reuse:** `RecipientModeSwitch` (direct), fingerprint card (copy from popup), `AttachmentStatusBadge` (direct), `BeapDocumentReaderModal` (direct), `DraftRefineLabel` (extend).

---

## Part II — Component deep dives (blocks)

### B1. RecipientModeSwitch

**Purpose:** Premium PRIVATE/PUBLIC control: icons, subtitles, gradients, mode description strip.

**Files:** `apps/extension-chromium/src/beap-messages/components/RecipientModeSwitch.tsx`

**Rendering:** After fingerprint in `popup-chat.tsx`, before handshake / delivery.

**State:** Controlled `mode` / `onModeChange`.

**Dependencies:** React inline styles only.

**Legacy:** Full card-in-card UX.

**Current:** `BeapInlineComposer` does **not** use it — see [§2](#2-current-private-public-selector).

**Reuse:** Direct via `@ext/beap-messages`. **Risk:** Low.

---

### B2. Popup fingerprint card (inline JSX)

**Purpose:** Primary identity block: **Your Fingerprint**, monospace short value, Copy.

**Files:** `apps/extension-chromium/src/popup-chat.tsx` (~1221–1261)

**State:** `ourFingerprintShort`, full fingerprint, copy handlers.

**Dependencies:** `formatFingerprintShort` / identity store.

**Reuse:** Copy JSX into shared component or inline composer; optional extract to `beap-messages`.

**Risk:** Low–medium if signing key vs identity fingerprint must match product.

---

### B3. AttachmentStatusBadge

**Purpose:** Pill: **Extracting…** / **Parsed** / **Failed**.

**Files:** `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`

**Rendering:** `popup-chat`, `sidepanel`, `CapsuleSection` when badge rules apply.

**Data flow:** `runDraftAttachmentParseWithFallback` → `parseStatus` → badge.

**Current:** Not used in `BeapInlineComposer`.

**Reuse:** Direct from `@ext/beap-builder`.

**Notes:** `theme` prop unused in implementation.

---

### B4. BeapDocumentReaderModal

**Purpose:** Portal reader; **synthetic paging**; **left sidebar** page nav; search; copy.

**Files:** `BeapDocumentReaderModal.tsx`; **`splitToSyntheticPages`** exported from same file.

**Electron:** `BeapInlineComposer` toggles `open` / `filename` / `semanticContent`; currently **`theme="standard"`** on dark shell.

**Reuse:** Already in Electron.

**Notes:** Paging is text-based, not PDF thumbnails.

---

### B5. DraftRefineLabel

**Purpose:** Indicates active AI refinement target (with textarea border).

**Files:** `apps/electron-vite-project/src/components/DraftRefineLabel.tsx`

**Current:** Sparkle **after** `children` when `active`.

**Product:** Pointing-finger **before** label — single-component fix.

**Risk:** Low; check a11y.

---

### B6. Beap inline distribution buttons (ad-hoc)

**Purpose:** Toggle `recipientMode` **without** `RecipientModeSwitch`.

**Files:** `BeapInlineComposer.tsx` (~495–533)

**Replacement target:** Delete when **`RecipientModeSwitch`** is wired.

---

*End of COMPLETE-AUDIT.md*
