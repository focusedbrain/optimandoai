# Current PRIVATE / PUBLIC selector (inline)

## File

`apps/electron-vite-project/src/components/BeapInlineComposer.tsx` (~495–533)

## Implementation

**Not** `RecipientModeSwitch`. Two plain `<button>` elements:

- Wrapper: `<span>` label **"Distribution"** (`11px`, uppercase, `color: muted` = `#64748b`).
- **No** outer padded card matching `RecipientModeSwitch`’s `rgba(15,23,42,0.05)` shell.
- **No** 🔐 / 🌐 icons.
- **No** secondary subtitle lines **qBEAP · Handshake Required** / **pBEAP · Auditable**.
- **No** mode-description strip below (the **Private Mode / Public Mode** explainer block).

### Button styles (evidence)

- `flex: 1`, `padding: 10px 12px`, `borderRadius: 8`, `border` = `1px solid #e2e8eb` (from `border` variable).
- Active private: `background: 'rgba(124,58,237,0.35)'`, `color: fg` (`#e2e8f0`).
- Active public: `background: 'rgba(59,130,246,0.3)'`, same `color: fg`.
- Inactive: `background: 'transparent'`.

**Text:** `"Private (qBEAP)"` / `"Public (pBEAP)"` on **one line** only.

## State

`useState<RecipientMode>('private')` — same **type** as legacy (`RecipientMode` from `@ext/beap-messages`).

## Regression vs legacy

- **Visual language:** Legacy uses **card-in-card**, **icons**, **gradient active fills**, **white text on gradient when active**; inline uses **flat translucent purple/blue** on transparent with **gray** `fg` text on **inactive** and **active** — **not** the same premium pattern.
- **Information density:** Legacy mode description explains **cryptographic binding** vs **auditable**; inline has **no** equivalent under the toggle (delivery copy is in **Delivery details** box separately).

## Root cause

Inline composer implemented **minimal** toggle buttons instead of **reusing** `RecipientModeSwitch`.
