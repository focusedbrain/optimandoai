# Selector and fingerprint parity map

| Dimension | Legacy (popup-chat) | Current (BeapInlineComposer) |
|-----------|---------------------|------------------------------|
| **PRIVATE/PUBLIC component** | `RecipientModeSwitch` | Ad-hoc `<button>` pair |
| **Section label** | “Distribution Mode” | “Distribution” |
| **Icons** | 🔐 / 🌐 | None |
| **Subtitles** | qBEAP · Handshake Required / pBEAP · Auditable | None (only “(qBEAP)” in button text) |
| **Active styling** | Gradient fills, white text on active | `rgba(124,58,237,0.35)` / `rgba(59,130,246,0.3)` + `fg` |
| **Mode explainer** | Tinted strip below with bold keyword + body | None under toggle |
| **Fingerprint** | Standalone blue card, YOUR FINGERPRINT, `<code>`, Copy | Muted line in Delivery details |
| **Order** | Fingerprint → Mode → Handshake → Delivery | Mode → Handshake → Delivery (fingerprint inside delivery box) |

## Clustering

**Legacy:** Fingerprint **card** and **mode switch** are **adjacent siblings** (fingerprint **above** mode). **Not** one merged component — **two** visual blocks.

**Current:** Fingerprint **not** adjacent to mode — **nested** in delivery card **below** handshake.

## Lowest-risk restoration

1. **Import and render** `RecipientModeSwitch` with `theme="dark"` (or `standard` if shell goes light).
2. **Extract or copy** popup fingerprint **card** JSX (or small wrapper) **above** mode switch to match order.
