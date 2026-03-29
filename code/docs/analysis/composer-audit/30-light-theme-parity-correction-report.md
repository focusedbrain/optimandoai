# Light-theme parity correction report

**Date:** 2026-03-28  
**Goal:** Keep **legacy structure and behavior** from audits **28** / **29** while **reverting the full dark/navy composer transplant** so the inline BEAP composer matches the **current light dashboard** visually.

---

## Files that introduced the overcorrection

| File | Issue |
|------|--------|
| **`apps/electron-vite-project/src/components/BeapInlineComposer.tsx`** | **Strict legacy parity** pass (report **29**) set the **root grid**, **header**, **scroll column**, **fingerprint card**, **delivery details**, **Cancel**, and **`RecipientModeSwitch` / `RecipientHandshakeSelect`** / **`BeapDocumentReaderModal`** to **dark-theme** values (`#0f172a`, `#1e293b`, dark fingerprint tint, `theme="dark"`). That made the composer a **foreign dark block** inside a light shell. |

**Unchanged by the dark pass (no revert needed for theme):**  
`DraftRefineLabel.tsx` — only behavior (👆 before label); works on light or dark.

---

## Styling / theme changes reverted or corrected

| Area | Before (overcorrection) | After (correction) |
|------|-------------------------|---------------------|
| **Root / main column** | `var(--color-bg, #0f172a)`, light gray text (`fg`) | **`#f8fafc`** page surface, **`#0f172a`** body text |
| **Header** | Navy `#0f172a`, dark chrome buttons | **White** `#ffffff`, **dark** title, **white** Clear/Close with **slate border** `#cbd5e1` |
| **Scroll area** | Navy `#0f172a` | **`#f8fafc`** (same as root) |
| **Fingerprint card** | Dark popup branch (strong blue tint, `#93c5fd` / `#bfdbfe`) | **Light / popup `standard` branch:** `rgba(59,130,246,0.08)`, border `rgba(59,130,246,0.22)`, title **`#3b82f6`**, code **`#1e40af`**, Copy **`#3b82f6`** |
| **RecipientModeSwitch** | `theme="dark"` | **`theme="standard"`** — segmented control uses **light** card shell + **blue/green gradients** on active (per component) |
| **RecipientHandshakeSelect** | `theme="dark"` | **`theme="standard"`** |
| **Delivery details** | Slate panel `#1e293b`, light gray copy | **White card** `#ffffff`, border `#e2e8f0`, body **`#334155`** / **`#475569`** |
| **Cancel** | Navy `#1e293b` | **White** + slate border + **dark** text |
| **BeapDocumentReaderModal** | `theme="dark"` | **`theme="standard"`** — light modal consistent with dashboard; **page rail** unchanged (internal to modal) |

**Intentionally unchanged (already light):**  
Email accounts strip (`#eff6ff`), draft **white** textareas, **purple** send primary, attachment rows **`#f8fafc`**, send-error strip, right rail **`#f1f5f9`** with **dark** footer copy.

---

## Legacy structure / behavior preserved

- **Order:** fingerprint → **RecipientModeSwitch** → handshake (private) → delivery method → email strip (if email) → delivery details → subject → messages → session → attachments → actions.
- **Components:** still **`RecipientModeSwitch`**, **`RecipientHandshakeSelect`**, **`AttachmentStatusBadge`**, **`BeapDocumentReaderModal`**, **`extractTextForPackagePreview`** + PDF **`pending` / `success` / `failed`** lifecycle.
- **Fingerprint:** still **prominent** block with **Copy** + short **`&lt;code&gt;`** (structure from audit **28**; colors from **light** branch).
- **Active refine:** **`DraftRefineLabel`** still shows **👆** before the label (not color-only).

---

## Selector / fingerprint parity without a full dark theme transplant

- **Parity = layout + component choice + information hierarchy**, not copying popup **dark** CSS.
- **`RecipientModeSwitch`** and **`RecipientHandshakeSelect`** use **`theme="standard"`**, which is the **same component** as legacy **light** WR Chat paths (`isStandard === true` in those components).
- **Fingerprint** uses the same **geometry** and **trust framing** as **`popup-chat`** **standard** theme (audit **28** §3), not the dark-branch colors.

---

## Parsed badge / reader workflow

- **Retained:** PDF **`AttachmentStatusBadge`**, **`parseStatus`** updates, **View text**, auto-open reader on first successful preview, **`BeapDocumentReaderModal`** with **`splitToSyntheticPages`** (left rail inside modal).
- **Only change:** modal **`theme="standard"`** so the reader matches the **light** composer (rail still present).

---

## Manual QA checklist

- [ ] Composer sits in dashboard with **light** gray/white surfaces — **no** full-width navy panel.
- [ ] **PRIVATE / PUBLIC** still shows **icons, subtitles, mode description** (`RecipientModeSwitch` **standard**).
- [ ] **Fingerprint** card is **visibly prominent** (blue tint on white) with readable **Copy**.
- [ ] **Handshake** list matches light styling (**`theme="standard"`**).
- [ ] **Delivery details** is a **white** card with **dark** body text.
- [ ] Draft fields stay **white** with **dark** text; refine **👆** appears when connected.
- [ ] PDF shows **Extracting… → Parsed / Failed** badge; **View text** opens reader; **page list** visible in modal.
- [ ] **Send / Cancel** look professional on light background; **Cancel** is secondary (white + border).
- [ ] **Right AI rail** still readable (unchanged light treatment).
- [ ] No **left inbox list** reappears during compose.

---

## Definition of done (this correction)

- [x] Remove **foreign dark-theme** full-surface treatment from **`BeapInlineComposer`**.
- [x] Keep **premium structure** (selector, fingerprint order, badges, reader).
- [x] Align with **light dashboard** language (**`#f8fafc` / white / slate text**).
- [x] Document in this report; **no** parser backend changes.
