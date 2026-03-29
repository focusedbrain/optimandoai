# Contrast and readability — code-evidenced causes

## Method

Trace **explicit** `color`, `background`, `opacity` on **tinted** surfaces in `BeapInlineComposer.tsx` and related children. **No** visual measurement — **structural** risk from **light-on-light** or **muted-on-tint** pairings.

## Finding 1: Inherited `fg` on light blue email panel

**Location:** ~474–477

```tsx
<div style={{ padding: 12, borderRadius: 8, background: 'rgba(59,130,246,0.08)', border }}>
  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Connected email accounts</div>
```

**Parent** scroll column sets **`color: fg`** with `fg = '#e2e8f0'` (~399).

**Cause:** Inner **title** div has **no** `color` → inherits **`#e2e8f0`** on **`rgba(59,130,246,0.08)`** — **light gray on pale blue**, **low contrast**.

**Subtext** ~478 explicitly uses `color: muted` (`#64748b`) — **better** on that background.

## Finding 2: Muted fingerprint line in delivery card

**Location:** ~579

`fontSize: 11, color: muted` on **`rgba(255,255,255,0.04)`** — **#64748b** on **very dark translucent** panel: generally **acceptable**; **premium** popup used **stronger** blue monospace — **hierarchy** issue more than WCAG failure.

## Finding 3: Distribution toggle active states

**Location:** ~509–527

Active: `background: 'rgba(124,58,237,0.35)'` / `'rgba(59,130,246,0.3)'`, **`color: fg`** (`#e2e8f0`).

**Context:** Main column background `var(--color-bg, #0f172a)` — **dark**. **Text on purple/blue translucency** over **dark** — usually **readable**; **risk** if background were **lightened** without updating `fg`.

## Finding 4: Send error banner

**Location:** ~739

`background: 'rgba(239,68,68,0.15)', color: '#fecaca'` — **pink** on **red tint** on **dark** — intentional error styling; **high** contrast.

## Finding 5: Right rail (`aside`)

**Location:** ~767–777

`background: '#f8fafc'`, `color: hintOnRail` (`#475569`) — **dark slate on near-white** — **high** contrast.

## Finding 6: Attachment rows

**Location:** ~696–700

`background: '#f8fafc'`, `color: '#0f172a'` — **high** contrast.

## Finding 7: `BeapDocumentReaderModal` theme mismatch

Inline passes **`theme="standard"`** while shell is **dark** — **not** a single-surface contrast bug, but **jarring** transition (user-reported “premium” continuity).

## Summary table

| Surface | Suspected issue | Code cause |
|---------|-----------------|------------|
| Email accounts card title | Low contrast | Inherited `fg` on light blue tint |
| Distribution buttons | Context-dependent | `fg` on rgba fills; OK on dark bg |
| Fingerprint in delivery | Weak hierarchy | `muted` small text, not wrong pairing |
| Reader modal | Theme jump | `theme="standard"` vs dark composer |
