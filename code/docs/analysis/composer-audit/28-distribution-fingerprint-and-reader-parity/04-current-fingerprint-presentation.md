# Current fingerprint presentation (inline)

## File

`apps/electron-vite-project/src/components/BeapInlineComposer.tsx`

## Data

- `fingerprintShort` from **`getSigningKeyPair()`** → `publicKey` truncated (~lines 119–127 effect) — **same conceptual data** as signing identity (short form), **not** necessarily the same string pipeline as popup’s `identity.fingerprint` / `formatFingerprintShort` (different sources: **popup** uses identity store; **inline** uses **beap signing key**). **Uncertainty:** whether both resolve to the same user-visible fingerprint in normal app state — **not verified** in this audit.

## Placement

**Inside** the **“Delivery details”** card (~549–580):

- Card: `padding: 12`, `borderRadius: 8`, `background: 'rgba(255,255,255,0.04)'`, `border`.
- **Last line** of that card:  
  `Your fingerprint: {fingerprintShort}`  
  — `fontSize: 11`, `color: muted` (`#64748b`).

**No** separate card above distribution. **No** `<code>` block. **No** Copy button.

## Structural differences vs legacy

| Aspect | Popup | Inline |
|--------|-------|--------|
| Visual hierarchy | Standalone **blue** card | **Muted** line in **grey** translucent panel |
| Typography | Monospace **code** + short | Plain text in **muted** sentence |
| Action | **Copy** | None |
| Label | **YOUR FINGERPRINT** uppercase section | Inline prefix “Your fingerprint:” |

## Root cause

**Weaker structure** — inline **folded** fingerprint into **delivery details** as **tertiary** text; legacy **elevated** it as **primary** identity chrome.

## Data availability

**Short fingerprint string:** yes. **Full fingerprint for copy:** inline **could** use `kp.publicKey` from `getSigningKeyPair()` same as send path — **available** but **not wired** to UI.
