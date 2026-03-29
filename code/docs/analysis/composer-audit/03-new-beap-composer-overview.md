# New BEAP composer overview (`BeapInlineComposer`)

## Purpose
Electron-only inline BEAP™ package composer: delivery method, recipient mode, handshake selection, subject, public (pBEAP) and optional encrypted (qBEAP) bodies, session, file attachments, send via `executeDeliveryAction`.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`
- Shared logic from `@ext/beap-messages` (`executeDeliveryAction`, `DeliveryMethodPanel` types, `RecipientModeSwitch` types)
- `apps/electron-vite-project/src/shims/handshakeRpc.ts` (`listHandshakes`)

## Ownership
Self-contained functional component; mounted by `EmailInboxView`, `EmailInboxBulkView`, `BeapInboxDashboard`, `BeapBulkInboxDashboard`.

## Rendering path
Imported as `{ BeapInlineComposer }`; rendered when parent `composeMode === 'beap'`.

## Inputs and outputs
**Props:** `onClose`, `onSent`, optional `replyToHandshakeId`.

**State:** Local `useState` for all form fields; `useDraftRefineStore` selectors for AI field wiring.

**Side effects:** `initBeapPqAuth()` on mount; `listHandshakes('active')`; orchestrator sessions fetch `GET .../api/orchestrator/sessions`; `window.emailAccounts.listAccounts` for email delivery.

## Dependencies
- **Crypto:** `getSigningKeyPair` from `@ext/beap-messages/services/beapCrypto`
- **Builder:** `BeapPackageBuilder` / `executeDeliveryAction`
- **AI refinement:** `useDraftRefineStore` — click public/encrypted textarea to `connect(null, 'New BEAP Message', …, 'capsule-public' | 'capsule-encrypted')`

## Data flow
Form → `BeapPackageConfig` → `executeDeliveryAction` → on success `onSent()`.

## UX impact
- **Layout:** Root `display: grid; gridTemplateColumns: 1fr 280px` (`~367–378`) — main form scrolls in left cell; static “Hints” aside right.
- **Field sizes:** Public textarea `rows={6}`, encrypted `rows={5}` (`~576–607`) — fixed small vertical space unless user drags resize.
- **Visual:** Borders `#e5e7eb`, draft-refine selection `#7c3aed` outline (Prompt 6 polish).

## Current issues
- Does not use shared extension components `RecipientHandshakeSelect` / rich BEAP panels from `popup-chat.tsx` — different UX tier.
- Orchestrator HTTP base hardcoded: `http://127.0.0.1:51248` (`~16`).

## Old vs new comparison
Extension `popup-chat.tsx` imports `RecipientModeSwitch`, `RecipientHandshakeSelect`, `DeliveryMethodPanel`, document reader modal, attachment parsing — **much richer** UI. `BeapInlineComposer` uses plain `<select>` for handshake (`~471–530`).

## Reuse potential
Porting extension subcomponents into Electron would align look-and-feel.

## Change risk
`executeDeliveryAction` and config shape are security-sensitive; handshake mapping must stay consistent with `SelectedHandshakeRecipient`.

## Notes
Comment at top: “Mirrors popup-chat draft fields” — **partially true** for data model, not for UI parity.
