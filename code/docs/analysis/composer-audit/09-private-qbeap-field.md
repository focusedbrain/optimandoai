# Private qBEAP field

## Purpose
Optional encrypted payload when `recipientMode === 'private'`; becomes `encryptedMessage` on package config when non-empty.

## Files
- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` ~598–625
- `data-compose-field="encrypted-message"`

## Ownership
Local `encryptedMessage`; draft refine target `capsule-encrypted`.

## Rendering path
Only if `recipientMode === 'private'`; label “Encrypted message (private)”, `rows={5}`.

## Inputs and outputs
- **Send:** Included in config when `encryptedMessage.trim()` (~292–294).
- **AI:** Separate click handler from public field; `refineTarget === 'capsule-encrypted'`.

## Dependencies
`hasHandshakeKeyMaterial(selectedRecipient)` gate before send (~235–237).

## Data flow
Same as public field with different store target and styling (purple-tinted background ~619).

## UX impact
**Even smaller default** than public (`rows={5}` vs 6). Contributes to “text boxes too small” report.

## Current issues
Private mode only — switching to public hides field entirely (expected) but mode toggles are simple buttons (~418–455).

## Old vs new comparison
Extension may show encryption status / key indicators inline — not present here beyond error message on missing keys.

## Reuse potential
High — same draft refine pattern as public.

## Change risk
Encrypt path ties to handshake keys; UI changes must not skip validation.

## Notes
Click on textarea toggles draft refine — may compete with text selection UX (product may want explicit “Connect to AI” control).
