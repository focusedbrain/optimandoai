# PDF parsing consent — rationale

## Principle

Untrusted PDF bytes must not be parsed on the user's primary device without **explicit, session-scoped user consent**. Parsing runs in the isolated depackager/pdf-parser pod; the host only stores verified text after consent (or accepts edge-verified text from a capsule).

## Case A — User-initiated, user's own bytes (consent not required)

The user deliberately chose the file from their own machine for an **outbound** or **local authoring** flow. The bytes are not inbound mail from an untrusted sender.

Examples:

- BEAP inline composer: `showOpenDialogForAttachments` → user picks a PDF to attach to an outgoing package.
- AI context upload / project form attachments: file picker on the user's filesystem.
- Letter scan processing: user scanned or imported their own document for the letter composer.
- Chat / composer PDF preview via `parser:extractPdfText` with base64 from a user drop or picker (not an inbox row).

These paths may call the pod directly without the inbox consent dialog. They must still be documented at the call site so future contributors do not "fix" them by adding redundant consent UI.

## Case B — Received content (consent required)

The PDF arrived via email, BEAP ingest, provider fetch, or any path where the **original sender** supplied the bytes. The user may later open or query that attachment, but parsing is still host-side processing of untrusted input.

Examples:

- Inbox ingest: `consent_required` on `inbox_attachments` until `inbox:requestPdfExtraction`.
- Edge capsule with `extracted_text_v1`: host never parses; verifies structural hash and stores text.
- `email:extractAttachmentText` / `gateway.extractAttachmentText` for provider PDFs: must not parse; returns `CONSENT_REQUIRED`.

## Case C — Mixed entry points

If a single component can receive both user-picked and forwarded bytes, only **Case B** branches use the consent flow. As of this document, `BeapInlineComposer` is **Case A only** (open-dialog paths only; no inbound attachment forwarding).

## Session consent

"Don't ask again this session" applies to **Case B** inbox/chat flows via `src/lib/sessionConsent.ts` scope `pdf_parsing`. It does not grant permanent or per-sender trust.

## References

- Dialog variants: `src/components/PdfParsingConsentDialog.tsx`
- Decision tree: `src/lib/pdfParsingConsentDecision.ts`
- Inbox IPC: `inbox:issuePdfExtractionConsent`, `inbox:requestPdfExtraction`
- Host error for provider fetch: `PdfConsentRequiredError` in `electron/main/email/pdfConsentRequired.ts`
