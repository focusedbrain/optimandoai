# Parity: old vs new

## Purpose
Side-by-side view of behavior and UI parity between legacy surfaces and embedded composers.

## Files
See `05-old-builder-reference.md`, `03-new-beap-composer-overview.md`, `04-new-email-composer-overview.md`.

## Ownership
N/A (comparison doc).

## Rendering path
N/A.

## Inputs and outputs

| Capability | Extension popup (`popup-chat`) | `BeapInlineComposer` | `EmailInlineComposer` | `EmailComposeOverlay` |
|------------|-------------------------------|----------------------|------------------------|------------------------|
| pBEAP / public body | Rich form | Yes (`publicMessage`) | N/A | N/A |
| qBEAP / encrypted | Rich form | Yes (`encryptedMessage`) | N/A | N/A |
| Handshake pick | Component | `<select>` + `listHandshakes` | N/A | N/A |
| Email send | Various paths | N/A | `sendEmail` | `sendEmail` |
| Theme / density | Multiple themes | Dark inline styles | Dark inline | Light “professional” option |
| Modal framing | Window / popup | None | None | Centered overlay |
| AI draft refine | Sidepanel/search | Via `useDraftRefineStore` + HybridSearch | Same | Not wired in overlay |

## Dependencies
New composers depend on **Zustand** `useDraftRefineStore` + **HybridSearch** for AI; old popup had integrated search/command context in-extension.

## Data flow
Send pipelines converge on same services (`executeDeliveryAction`, `emailAccounts.sendEmail`).

## UX impact
**Functional:** Core send paths preserved. **Perceived premium:** Reduced — layout, controls, and density differ.

## Current issues
Explicit gaps: handshake UX, document reader, attachment validation UX, full-width layout.

## Old vs new comparison
This document **is** the comparison table.

## Reuse potential
High for shared components; medium for state architecture.

## Change risk
Parity work could over-import extension into Electron without code splitting.

## Notes
**Confidence:** High for files read; medium for IPC window behavior without reading full `main.ts` open handlers.
