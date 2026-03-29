# PDF parser and text extraction

## Purpose
Documents the HTTP PDF text extraction path used by HybridSearch context upload and the pdf.js-based extraction logic in main process.

## Files
- `apps/electron-vite-project/electron/main.ts` — `POST /api/parser/pdf/extract` ~8147–8278
- `apps/electron-vite-project/src/components/HybridSearch.tsx` — `handleContextUpload`, `arrayBufferToBase64`, `CONTEXT_PDF_ATTACHMENT_ID`, `CONTEXT_UPLOAD_HTTP_PORT` (51248)
- **Not used in audit scope:** `electron/main/email/pdf-extractor.ts` (user story) — verify if duplicate or legacy; **grep recommended** before refactor.

## Ownership
Express route in Electron **main** HTTP server; client is renderer `HybridSearch`.

## Rendering path
N/A (API).

## Inputs and outputs
**Request JSON:** `{ attachmentId: string, base64: string }` — `attachmentId` required by validator even for ad-hoc uploads (HybridSearch uses sentinel `'context-upload'`).

**Response JSON:** `{ success, extractedText, pageCount, … }` — client reads `extractedText` when `success`.

## Dependencies
- `pdfjs-dist` dynamic import in main
- Worker path: `pdf.worker.mjs` beside main bundle (`path.join(__dirname, 'pdf.worker.mjs')`)

## Data flow
PDF bytes → pdf.js `getDocument` → per-page `getTextContent` → concatenate `item.str` with limited newline handling from `hasEOL` (~8208–8218).

## UX impact
**Extraction quality:** Text-only PDFs work; complex layouts may lose ordering/spacing (typical pdf.js behavior). **Incorrect extraction** reports may stem from:
- Missing spaces between items (no explicit space insertion except EOL)
- Scanned PDFs without OCR — **no OCR fallback** in traced handler (only text content).

## Current issues
- **No OCR** in this endpoint — image-only PDFs → empty or garbage text.
- **Client/server mismatch risk:** Renderer must use same port as HTTP server (hardcoded 51248 — must match orchestrator/main listen port).

## Old vs new comparison
Extension may embed different PDF handling — separate code path.

## Reuse potential
Centralize port/config; add telemetry on empty extract.

## Change risk
Touching pdf.js worker paths breaks packaged app if `__dirname` layout changes.

## Notes
Build logs previously warned missing `tesseract.js-core` wasm copies for **builder** resources — distinct from this endpoint’s extraction quality.
