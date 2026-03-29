# Handshake selector (inline BEAP)

## Purpose
Select active handshake for private (qBEAP) delivery; drives `SelectedHandshakeRecipient` mapping.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` (private mode block ~458–532)
- `apps/electron-vite-project/src/shims/handshakeRpc.ts` — `listHandshakes`

## Ownership
`BeapInlineComposer` local state: `handshakeRows`, `selectedHandshakeId`, `handshakesLoading`, `handshakesError`.

## Rendering path
Rendered only when `recipientMode === 'private'`; native `<select>` with `value={selectedHandshakeId}`.

## Inputs and outputs
**Input:** Ledger rows from `listHandshakes('active')`.  
**Output:** `selectedRecipient` via `useMemo` mapping `mapLedgerRecordToSelectedRecipient` (~98–103).

## Dependencies
- `@ext/handshake/rpcTypes` — `SelectedHandshakeRecipient`, `hasHandshakeKeyMaterial`
- No `RecipientHandshakeSelect` from extension

## Data flow
`refreshHandshakes` on mount → `setHandshakeRows` → user selects id → `selectedRecipient` used in `BeapPackageConfig` on send.

## UX impact
- **Visual:** Default `<select>` styling (`width: 100%`, padding, border ~`#e5e7eb`) — minimal chrome; matches “cheap” product feedback versus branded handshake picker.
- **Errors:** Loading and error states are text + retry button (~461–469).

## Current issues
- No avatars, trust badges, or handshake health indicators unlike extension.
- Fingerprint display is separate (“Your fingerprint” in delivery details ~565).

## Old vs new comparison
Extension `RecipientHandshakeSelect` (popup-chat imports) — **not** used in Electron inline.

## Reuse potential
Import extension component or replicate styling from `HandshakeView` / extension.

## Change risk
`mapLedgerRecordToSelectedRecipient` must stay aligned with qBEAP key material checks (`hasHandshakeKeyMaterial` on send ~235–237).

## Notes
`replyToHandshakeId` effect pre-selects handshake when rows load (~145–150).
