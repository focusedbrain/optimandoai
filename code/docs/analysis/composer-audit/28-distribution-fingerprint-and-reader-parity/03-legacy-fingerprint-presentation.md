# Legacy fingerprint presentation

## Where it lives

**Not** a named export like `FingerprintCard` — **inline JSX** in **`apps/extension-chromium/src/popup-chat.tsx`** (~1221–1261), inside the BEAP compose scroll area, **above** `RecipientModeSwitch`.

## Structure

1. **Container:** `borderRadius: 8px`, `padding: 12px`, tinted blue background:
   - Standard: `rgba(59,130,246,0.08)`, border `1px solid rgba(59,130,246,0.2)`
   - Dark: `rgba(59,130,246,0.15)`, border `rgba(59,130,246,0.3)`
2. **Title row:** `10px`, **uppercase**, letter-spacing `0.5px`, color `#3b82f6` (standard) / `#93c5fd` (dark) — label **"Your Fingerprint"**.
3. **Value row:** `display: flex`, `alignItems: center`, `gap: 8px`
   - **`<code>`** — `flex: 1`, `fontSize: 13px`, monospace, `wordBreak: 'break-all'`
   - Colors: standard `#1e40af`, dark `#bfdbfe` (high contrast on blue tint).
4. **Copy button** — `fontSize: 10px`, `fontWeight: 600`, white on **blue** (`#3b82f6` standard) or `rgba(59,130,246,0.5)` dark; **Copied** state → `#22c55e` background.

## Data

- `ourFingerprintShort` from `formatFingerprintShort(identity.fingerprint)` (identity state ~399–400).
- Full `ourFingerprint` for clipboard.

## Placement relative to distribution

**Fingerprint block is first** in the compose stack shown (~1221), then **`RecipientModeSwitch`** (~1264), then handshake, **`DeliveryMethodPanel`** (receives `ourFingerprintShort` prop for delivery-line copy).

## Premium feel (evidence)

- **Dedicated card** with **labeled section** and **monospace** short fingerprint.
- **Action** (Copy) **inline** with the value.
- **Contrast:** Dark blue / light blue text on **light blue wash** (standard) — intentional **brand** fingerprint styling.

## Shared components

**`DeliveryMethodPanel`** (`beap-messages/components/DeliveryMethodPanel.tsx`) uses `ourFingerprintShort` for **recipient/filename** hints — **additional** fingerprint context, not the **same** card block.
