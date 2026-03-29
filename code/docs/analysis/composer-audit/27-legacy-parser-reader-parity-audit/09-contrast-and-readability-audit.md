# Contrast and readability audit

## Purpose

List **code-evidenced** styles in BEAP-related UIs that can yield **low contrast** or **washed** appearance. No redesign — identifiers only.

## Inline `BeapInlineComposer.tsx`

| Location (concept) | Style source | Risk |
|--------------------|--------------|------|
| Main column background | `background: 'var(--color-bg, #0f172a)'` | Dark chrome — OK for light-on-dark labels. |
| Primary text on chrome | `fg = '#e2e8f0'` | Light gray on slate — **softer than white** for headings/body in chrome. |
| Muted labels | `muted = '#64748b'` | **Lower contrast** against `#0f172a` than pure white — intentional muted. |
| Delivery details card | `background: 'rgba(255,255,255,0.04)'` + `border` | **Translucent** panel — can read as “disabled” vs opaque cards. |
| Email delivery panel | `background: 'rgba(59,130,246,0.08)'` | Light blue wash — helper text inside still uses default **card title** without forcing dark text (title uses default inherited `fg`). |
| Distribution toggles (active) | `background: 'rgba(124,58,237,0.35)'` / `rgba(59,130,246,0.3)'`, `color: fg` | **Purple/blue translucent** fills with **#e2e8f0** text — can feel **low-contrast** vs solid buttons. |
| RecipientHandshakeSelect | `theme="dark"` | Component-internal colors — see `RecipientHandshakeSelect.tsx` (not fully expanded here); **dark-on-dark** list is intentional for that component. |
| Attachment rows | `background: '#f8fafc'`, `color: '#0f172a'` | **High contrast** (light card on dark scroll area). |
| Send error | `background: 'rgba(239,68,68,0.15)', color: '#fecaca'` | Red tint + **light red text** — readable on dark; **translucent** background. |

## `AiDraftContextRail.tsx`

| Location | Style | Risk |
|----------|-------|------|
| Copy | `railFg = '#0f172a'`, `railMuted = '#64748b'` on rail | **High contrast** on light rail (evidence from current file). |
| Empty state | `background: '#f8fafc'`, dashed border | Opaque — not translucent. |

## Legacy `popup-chat.tsx` (lavender / purple fields)

| Location | Style | Risk |
|----------|-------|------|
| Encrypted message textarea (dark theme branch) | `background: 'rgba(139,92,246,0.15)'`, `border: '1px solid rgba(139,92,246,0.4)'`, **`color: textColor`** | If `textColor` is light on **purple tint**, contrast can be **borderline**; **standard** branch uses `rgba(139,92,246,0.05)` with dark text — better. |
| Helper under encrypted | `color: isStandard ? '#7c3aed' : '#c4b5fd'` | **#c4b5fd** on dark — **soft lavender**. |
| Info box | `background: isStandard ? 'rgba(168,85,247,0.08)' : 'rgba(168,85,247,0.15)'`, `color: mutedColor` | **Muted** on **tinted** panel — can read **low contrast**. |

## `BeapDocumentReaderModal.tsx`

| Location | Style | Risk |
|----------|-------|------|
| Modal backdrop | `backgroundColor: 'rgba(0,0,0,0.55)'` | Full-screen dim — **not** the right rail; separate pattern. |
| Copy buttons (footer) | `background: 'rgba(139,92,246,0.25)'`, `color: '#c4b5fd'` | **Light purple** on **purple-tinted** button — **lower contrast** than black-on-white. |

## `ComposerAttachmentButton.tsx` (if used)

- Gradient **white** background, `#0f172a` label — **high contrast** (separate file).

## CSS variables

- `BeapInlineComposer` uses `var(--color-bg, #0f172a)` — **inherited theme** could shift contrast if dashboard sets different `--color-text` / `--color-text-muted` **without** updating inline local `fg`/`muted` constants (locals **override** many fields but not all global children).

## Summary

**Confirmed translucent / wash patterns** still in **`BeapInlineComposer`**: delivery details **`rgba(255,255,255,0.04)`**, email panel **`rgba(59,130,246,0.08)`**, distribution **`rgba(124,58,237,0.35)`**. **Legacy popup** still uses **lavender encrypted** surfaces and **muted-on-purple** info boxes.

## Uncertainty

Runtime theme from **parent dashboard** not fully traced; values above are **from component inline styles** as read.
