# Distribution, fingerprint, and reader parity audit (index)

**Scope:** Analysis-only comparison of **legacy BEAP builder (popup-chat + shared beap-messages components)** vs **Electron `BeapInlineComposer`** for: PRIVATE/PUBLIC selector, fingerprint presentation, parsed-document UX, active-field indicator, and contrast.

**No code changes** in this audit.

**Single-file bundle:** [COMPLETE-AUDIT.md](./COMPLETE-AUDIT.md) — full audit (sections 1–13 + block summaries) in one document.

## Reading order

| File | Contents |
|------|----------|
| [01-legacy-private-public-selector.md](./01-legacy-private-public-selector.md) | `RecipientModeSwitch` and popup usage |
| [02-current-private-public-selector.md](./02-current-private-public-selector.md) | Inline ad-hoc buttons |
| [03-legacy-fingerprint-presentation.md](./03-legacy-fingerprint-presentation.md) | Popup fingerprint card |
| [04-current-fingerprint-presentation.md](./04-current-fingerprint-presentation.md) | Inline one-line fingerprint |
| [05-selector-and-fingerprint-parity-map.md](./05-selector-and-fingerprint-parity-map.md) | Side-by-side |
| [06-current-inline-attachment-parse-display-flow.md](./06-current-inline-attachment-parse-display-flow.md) | Inline parse + UI |
| [07-legacy-attachment-parse-display-flow.md](./07-legacy-attachment-parse-display-flow.md) | Popup parse + UI |
| [08-parsed-badge-and-status-model.md](./08-parsed-badge-and-status-model.md) | `AttachmentStatusBadge` + state |
| [09-text-reader-and-page-navigation.md](./09-text-reader-and-page-navigation.md) | `BeapDocumentReaderModal` |
| [10-active-field-indicator-hook-points.md](./10-active-field-indicator-hook-points.md) | `DraftRefineLabel` / 👆 |
| [11-contrast-and-readability-root-causes.md](./11-contrast-and-readability-root-causes.md) | Evidence-based styles |
| [12-root-cause-summary.md](./12-root-cause-summary.md) | Separated causes |
| [13-restoration-plan.md](./13-restoration-plan.md) | Phased plan |

## Deep dives (`blocks/`)

| File | Topic |
|------|--------|
| [blocks/01-recipient-mode-switch.md](./blocks/01-recipient-mode-switch.md) | Legacy PRIVATE/PUBLIC component |
| [blocks/02-popup-fingerprint-card.md](./blocks/02-popup-fingerprint-card.md) | Prominent fingerprint block in popup |
| [blocks/03-attachment-status-badge.md](./blocks/03-attachment-status-badge.md) | Green “Parsed” badge |
| [blocks/04-beap-document-reader-modal.md](./blocks/04-beap-document-reader-modal.md) | Reader + P1/P2 rail |
| [blocks/05-draft-refine-label.md](./blocks/05-draft-refine-label.md) | Sparkle vs pointing-finger hook |
| [blocks/06-beap-inline-distribution-buttons.md](./blocks/06-beap-inline-distribution-buttons.md) | Current ad-hoc toggle (replacement target) |

## Quick answers (detail in §12)

1. **PRIVATE/PUBLIC premium selector:** `RecipientModeSwitch` — `apps/extension-chromium/src/beap-messages/components/RecipientModeSwitch.tsx`; mounted in `popup-chat.tsx` above handshake + delivery.
2. **Fingerprint block:** Inline JSX in `popup-chat.tsx` (~1221–1261), not a separate exported component; **“Your Fingerprint”** card with `<code>`, Copy button.
3. **Selector + fingerprint cluster:** Popup orders: **fingerprint card → RecipientModeSwitch → RecipientHandshakeSelect → DeliveryMethodPanel** (fingerprint **not** inside `RecipientModeSwitch`; **adjacent**, fingerprint **first**).
4. **Parsed badge:** `AttachmentStatusBadge` — `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`.
5. **Reader + page rail:** `BeapDocumentReaderModal` — synthetic `splitToSyntheticPages` rail, not PDF image thumbnails.
