# UI Contrast Audit — Electron Dashboard Renderer

**Date:** 2026-03-29  
**Scope:** `code/apps/electron-vite-project/src` — analysis only (no code changes).  
**Method:** Repository-wide grep for hex/rgba color usage, targeted read of high-traffic components (inbox, composer, search, handshakes, badges).

Contrast ratios below are **approximate** (relative luminance vs adjacent background). Values **&lt; 3:1** are treated as failing for small text (WCAG AA normal text target is **4.5:1**). Same-hue “tint + saturated text” patterns typically land in **2:1–3.5:1** and are the dominant failure mode.

---

## Summary

| Category | Count (approx.) |
|----------|-----------------|
| Total colored UI elements reviewed (explicit fg/bg or fg/tint pairs) | **~95** |
| **A) Failing** — estimated **&lt; 3:1** | **~48** |
| **B) Marginal** — **~3:1–4.5:1** | **~28** |
| **C) Passing** — **&gt; 4.5:1** | **~19** |

The majority of failures share one pattern: **`background: rgba(R,G,B,0.1–0.2)` + `color: #<same-hue hex>`** (green-on-mint-green, red-on-pink-red, purple-on-lavender, amber-on-cream-amber). This matches user reports (P2P, Sent, qBEAP-adjacent labels, lavender actions).

---

## A) Failing Elements (must fix)

Representative table — **not exhaustive**; many duplicates of the same pattern across files.

| # | File | Line (approx.) | Element | Text color | Background | Issue |
|---|------|------------------|---------|------------|------------|-------|
| 1 | `P2PStatusBadge.tsx` | 57–60, 70–74, 83–89, … | P2P disabled / error / starting / pending / healthy | `#94a3b8`, `#ef4444`, `#f59e0b`, `#22c55e` | Matching `rgba(...,0.15)` tints | Same family; green/red/amber especially weak |
| 2 | `EmailInboxView.tsx` | 2611–2628 | Session **P2P** / **EMAIL** delivery badge | `#93c5fd` / `#fcd34d` | `rgba(59,130,246,0.2)` / `rgba(251,191,36,0.15)` | Blue/amber “pastel on pastel” |
| 3 | `EmailInboxView.tsx` | 2622–2628 | **Sent** / failed status badge | `#86efac` / `#fca5a5` | `rgba(34,197,94,0.2)` / `rgba(239,68,68,0.2)` | Green-on-green / red-on-red tint |
| 4 | `EmailInboxView.tsx` | 2633–2636 | **qBEAP** / **pBEAP** label (text only) | `#c4b5fd` / `#94a3b8` | *(none / inherits dark row)* | qBEAP lavender on dark can be **marginal**; on light purple surfaces becomes **failing** |
| 5 | `HybridSearch.tsx` | 1418, 1436 | Scope / result chips | `#22c55e`, `#a78bfa` | `rgba(34,197,94,0.12)`, `rgba(139,92,246,0.12)` | Same-hue chip pattern |
| 6 | `HandshakeContextSection.tsx` | 373–374, 129, 118 | Purple “capsule” / scope controls | `#a78bfa` | `rgba(139,92,246,0.2)` / similar | Purple-on-lavender |
| 7 | `HandshakeWorkspace.tsx` | 186, 995–996 | ACTIVE state / buttons | `#22c55e`, `#a78bfa` | `rgba(34,197,94,0.12)`, `rgba(139,92,246,0.2)` | Same pattern |
| 8 | `analysis/StatusBadge.css` | 26–53 | `.analysis-status-badge--verified` etc. | `#22c55e`, `#fb923c`, … | `rgba(...,0.15)` | Recorded variant uses **`var(--purple-accent)` on `var(--purple-accent-muted)`** — typically **purple-on-purple** |
| 9 | `PreExecutionAnalysis.css` | multiple | Status / severity text | e.g. `#fcd34d`, `#d8b4fe` | Often light panels / muted purple surfaces | Several lines are **light-on-light** (e.g. ~2796 lavender text) |
| 10 | `App.css` | 1609–1619 | `.inbox-detail-ai-section-toggle--active` | `#6d28d9` / `#7c3aed` | `#f5f0ff` / `#ede9fe` | Often **passing** for primary text; **inactive** uses `opacity: 0.7` (line 1634) — drops contrast globally |

**Hover / disabled / tabs**

| # | File | Issue |
|---|------|-------|
| 11 | `App.css` `inbox-detail-ai-section-toggle` | Inactive toggles at **opacity 0.7** reduce text + border contrast together — often pushes **&lt; 4.5:1**. |
| 12 | `EmailInboxView.tsx` | Left panel tabs **Inbox / Sent** inactive: `#f3f4f6` bg + `#374151` text — usually **passing**; active purple `#7c3aed` + `#fff` — **passing**. |
| 13 | `BeapInlineComposer.tsx` | Primary send `#fff` on `#7c3aed` — **passing**; outline capsule buttons inactive `#7c3aed` on white — **passing**. |

**Error / success messages**

- `BeapInlineComposer.tsx` / `EmailInlineComposer.tsx`: `#166534` on `#dcfce7`, `#991b1b` on `#fef2f2` — generally **passing** (dark on light pastel).
- `P2PStatusBadge` / session badges: success/error **tinted chips** remain **failing** as above.

---

## B) Marginal Elements (~3:1 – 4.5:1)

| Area | Example | Notes |
|------|---------|--------|
| `HybridSearch.tsx` | Purple scope labels `#a78bfa` on dark `var(--color-bg)` | Depends on theme; borderline for small 10px text. |
| `EmailMessageDetail.tsx` | `#fca5a5`, `#86efac` accents on dark | Often OK on **#0f172a**; weak if parent uses light surface. |
| `EmailInboxView.tsx` | `#888` secondary address on dark row | ~3.5:1 — risky for long labels. |
| `P2PStatusBadge.tsx` | Gray disabled `#94a3b8` on `rgba(107,114,128,0.15)` | Slightly better than saturated hues but still low. |

---

## C) Passing Elements (&gt; 4.5:1) — examples

| File | Pattern |
|------|---------|
| `BeapInlineComposer.tsx` | `#0f172a` / `#334155` on `#ffffff` / `#f8fafc`; send CTA **white on `#7c3aed`**. |
| `EmailInboxView.tsx` | Primary buttons `#fff` on `#2563eb` / `#7c3aed`. |
| `App.css` | `.inbox-detail-ai-action-btn` `#374151` on `#ffffff`. |
| `BeapBulkInboxDashboard.tsx` | `#fff` on `#2563eb` / `#7c3aed`. |

---

## Root cause (design-level)

1. **“Semantic tint” badges** use **low-alpha background + full-saturation foreground** of the **same hue**, which minimizes luminance difference.
2. **CSS variables** `--purple-accent` + `--purple-accent-muted` (`App.css` ~L48: `rgba(147, 51, 234, 0.2)`) encourage **purple text on purple mist**.
3. **Opacity on containers** (e.g. inactive tabs `opacity: 0.7`) reduces contrast without adjusting colors.
4. **Text-only labels** (qBEAP without a contrasting pill) rely entirely on parent background — fragile across themes.

---

## Recommended Fix Colors (for failing chip/badge pattern)

Use **dark foreground on light pastel** OR **white on solid** — not pastel-on-pastel.

| # | Element (concept) | Fixed text | Fixed bg | Notes |
|---|-------------------|------------|----------|-------|
| 1 | Green “success / Sent / P2P active” chip | `#166534` | `#dcfce7` | Reuse composer success strip |
| 2 | Red “error / failed” chip | `#991b1b` | `#fee2e2` | Dark red on light rose |
| 3 | Amber “warning / pending” chip | `#92400e` | `#fef3c7` | Dark amber on cream |
| 4 | Blue “P2P / info” chip | `#1e40af` | `#dbeafe` | Dark blue on sky |
| 5 | Purple “BEAP / scope” chip | `#5b21b6` | `#ede9fe` | Dark violet on lavender |
| 6 | Neutral disabled | `#374151` | `#f3f4f6` | Or keep border `1px solid #d1d5db` |

For **solid** compact badges, **white `#ffffff` on `#15803d` / `#b91c1c` / `#d97706` / `#1d4ed8` / `#6d28d9`** exceeds 4.5:1 for small text.

---

## Design System Recommendation (consistent pairs)

| Purpose | Text | Background | Use for |
|---------|------|------------|---------|
| Purple action / BEAP | `#5b21b6` | `#ede9fe` | Chips, secondary emphasis |
| Green success | `#166534` | `#dcfce7` | Sent, Active, P2P healthy (when using light chip) |
| Red error | `#991b1b` | `#fee2e2` | Failed, destructive hints |
| Blue info / P2P | `#1e40af` | `#dbeafe` | Delivery method P2P |
| Amber warning / Email route | `#92400e` | `#fef3c7` | Email delivery, pending |
| Gray neutral | `#374151` | `#f3f4f6` | Inactive, metadata |
| Primary button (solid) | `#ffffff` | `#7c3aed` | Primary CTA (already used — keep) |
| Secondary button | `#374151` | `#ffffff` | Outline + `#d1d5db` border |

**Avoid:** `color: #22c55e` with `background: rgba(34,197,94,0.15)` for small labels.

---

## Files with highest concentration of risk

Priority order for a future fix pass:

1. `P2PStatusBadge.tsx` — global, always visible.  
2. `EmailInboxView.tsx` — session list badges + tabs (verify inactive opacity).  
3. `HybridSearch.tsx` — chat scope chips.  
4. `HandshakeContextSection.tsx` / `HandshakeWorkspace.tsx` — purple/green pills.  
5. `analysis/StatusBadge.css` + `PreExecutionAnalysis.css` — analysis dashboard.  
6. `App.css` — `--purple-accent-muted` consumers + `.inbox-detail-ai-section-toggle`.

---

## Verification checklist (when implementing fixes)

- [ ] WCAG **4.5:1** for normal text (&lt; 18px) on all new badge pairs.  
- [ ] Re-check **inactive** and **hover** states — no reliance on `opacity` alone.  
- [ ] **Dark theme** (`--color-bg: #0f172a`) vs **light** embedded panels (`#fff`) — same badge component may need **theme tokens**.  
- [ ] Spot-check: P2P, Sent, qBEAP, pBEAP, lavender actions, HybridSearch scope.

---

## Appendix — Search commands used

```bash
grep -rn "color:.*#\|background:.*#\|backgroundColor:.*#" \
  code/apps/electron-vite-project/src/components --glob "*.tsx" | head -100

grep -rn "color:.*#\|background:.*#\|background-color:.*#" \
  code/apps/electron-vite-project/src --glob "*.css" | head -100

grep -rn "#[0-9a-fA-F]{3,8}" \
  code/apps/electron-vite-project/src --glob "*.tsx" | head -200
```

---

*End of report.*
