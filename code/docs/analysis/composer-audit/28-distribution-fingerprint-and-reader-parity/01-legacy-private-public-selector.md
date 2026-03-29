# Legacy PRIVATE / PUBLIC selector

## Component

**`RecipientModeSwitch`** — `apps/extension-chromium/src/beap-messages/components/RecipientModeSwitch.tsx`

## Mounting (original builder / WR Chat)

**`apps/extension-chromium/src/popup-chat.tsx`** (~1263–1267):

```tsx
<RecipientModeSwitch
  mode={beapRecipientMode}
  onModeChange={setBeapRecipientMode}
  theme={toBeapTheme(theme)}
/>
```

**Order in column:** Placed **after** the **Your Fingerprint** card and **before** `RecipientHandshakeSelect` (private) and `DeliveryMethodPanel`.

## Structure

1. **Section label:** `"Distribution Mode"` — `11px`, uppercase, letter-spacing `0.5px`, color `mutedColor` (`#64748b` standard / `rgba(255,255,255,0.7)` dark).
2. **Segmented control container:** `display: flex`, `gap: 4px`, `padding: 4px`, `borderRadius: 8px`, `border: 1px solid` purple/white border, background `rgba(15,23,42,0.05)` (standard) or `rgba(255,255,255,0.05)` (dark).
3. **Two buttons** (each `flex: 1`), **stacked content:**
   - Icon: **🔐** (private) / **🌐** (public), `16px`
   - Primary label: **PRIVATE** / **PUBLIC**
   - Secondary line (`9px`, `opacity: 0.8`): **qBEAP · Handshake Required** / **pBEAP · Auditable**
4. **Active state:** `linear-gradient(135deg, …)` — **blue** (`#3b82f6`→`#2563eb`) standard private, **green** public uses same pattern when active for public; **standard** vs **dark** uses different gradient (purple `#8b5cf6`→`#7c3aed` for private active in dark). **Inactive:** `transparent` background, `mutedColor` text.
5. **Mode description card** below buttons (`marginTop: 8px`, `padding: 8px 10px`) — tinted background **blue or green** depending on mode; **strong** line with colored keyword (`#3b82f6` / `#22c55e` standard) + body `#475569` (standard) or `rgba(255,255,255,0.8)` (dark).

## Props

- `mode: RecipientMode`
- `onModeChange: (mode: RecipientMode) => void`
- `theme: 'standard' | 'hacker' | 'pro' | 'dark'`
- `disabled?: boolean`

## Reuse in Electron

**Yes, directly:** `RecipientModeSwitch` lives in `@ext/beap-messages` (same alias as `@ext/beap-messages/components/RecipientModeSwitch`). Inline `BeapInlineComposer` already imports **`RecipientMode`** type from that package path — **only the type is imported**; the **component is not used**.

**Theme:** `theme="dark"` would align with **dark** dashboard chrome; **`standard`** matches light-on-light if the composer column were restyled to light.

## Notes

- **CapsuleSection** / standalone builder may use different patterns; **popup-chat** is the **reference** for “WR Chat BEAP draft” premium flow cited in product feedback.
