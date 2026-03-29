# 31 — Parser auth and parsed-reader restoration (inline BEAP Composer)

## Summary

The inline BEAP Composer’s PDF attachment flow called `POST /api/parser/pdf/extract` from the **renderer** without the **`X-Launch-Secret`** header. The Electron main HTTP server gates almost all routes with that header, so the request returned **401** with *"Unauthorized: missing or invalid launch secret"*. Extraction never succeeded, so there was no text for **`AttachmentStatusBadge`** (green **Parsed**), **`BeapDocumentReaderModal`**, or the reader’s synthetic **page rail**.

The fix routes PDF extraction through **preload → IPC → main** (`parser:extractPdfText`), reusing the same **`extractPdfTextForIpc`** implementation as the HTTP handler. The renderer never needs the launch secret for this path.

---

## Root cause of the 401

| Item | Detail |
|------|--------|
| **What failed** | Renderer `fetch('http://127.0.0.1:51248/api/parser/pdf/extract', …)` with JSON body only — **no** `X-Launch-Secret`. |
| **Why** | Main process Express stack applies global auth that requires a per-launch secret on requests to that route (same as other localhost API surfaces). |
| **Why not “just send the secret” from the renderer** | The launch secret is intentionally **not** exposed to the renderer (removed `security:getLaunchSecret` pattern); extension clients receive it over WebSocket. Exposing it again would widen the XSS blast radius. |
| **Correct pattern** | Run extraction in **main** via **`ipcMain.handle('parser:extractPdfText', …)`** and expose **`window.beap.extractPdfText`** from preload with strict argument bounds. |

---

## Authenticated / trusted path reused

| Layer | Mechanism |
|-------|-----------|
| **Main** | `extractPdfTextForIpc(attachmentId, base64)` — shared by `POST /api/parser/pdf/extract` (extension + header) and IPC. |
| **IPC** | `ipcMain.handle('parser:extractPdfText', …)` returns `{ success: false, error }` or the same success JSON as HTTP (`success`, `extractedText`, `pageCount`, …). |
| **Preload** | `contextBridge.exposeInMainWorld('beap', { …, extractPdfText })` → `ipcRenderer.invoke('parser:extractPdfText', { attachmentId, base64 })` with validation (attachment id length, base64 size cap). |
| **Renderer** | `extractTextForPackagePreview` (PDF branch) calls `window.beap.extractPdfText` when available; no HTTP to localhost for PDFs. |

**Extension / other clients** that already send **`X-Launch-Secret`** continue to use the HTTP route unchanged.

---

## Changed files

| File | Change |
|------|--------|
| `apps/electron-vite-project/electron/main.ts` | *(Already present.)* `extractPdfTextForIpc`, HTTP handler delegates to it, `ipcMain.handle('parser:extractPdfText', …)`. |
| `apps/electron-vite-project/electron/preload.ts` | Added `beap.extractPdfText` with argument validation. |
| `apps/electron-vite-project/src/lib/beapPackageAttachmentPreview.ts` | PDF path uses IPC via `window.beap.extractPdfText` instead of unauthenticated `fetch`. |
| `apps/electron-vite-project/src/lib/ingestAiContextFiles.ts` | AI context PDF ingest uses the same IPC (fixes the same 401 class of bug for HybridSearch context attach). Removed unused `CONTEXT_UPLOAD_HTTP_PORT` export. |
| `apps/electron-vite-project/src/vite-env.d.ts` | `BeapBridge` + `Window.beap` typing. |

**UI:** `BeapInlineComposer.tsx` was not restyled; it already wires **`extractTextForPackagePreview`**, **`AttachmentStatusBadge`**, and **`BeapDocumentReaderModal`**.

---

## How parsed status works now

1. User adds a PDF; row gets **`parseStatus: 'pending'`** and **Extracting…** badge.
2. `extractTextForPackagePreview` calls **`window.beap.extractPdfText`** → main runs PDF.js extraction.
3. On success: **`parseStatus: 'success'`**, **`previewText`** set → green **Parsed** badge (`AttachmentStatusBadge`).
4. On failure: **`parseStatus: 'failed'`**, **`previewError`** set → **Failed** badge and error message.

---

## How the reader is re-enabled

- **`previewText`** is stored on the attachment row after a successful parse; the user opens **`BeapDocumentReaderModal`** via **View Text** (or equivalent), which calls **`openAttachmentReader`** — see **Follow-up fix: manual reader opening only** below.
- **`BeapDocumentReaderModal`** splits text into synthetic pages and renders the **left page list**; this only needs non-empty **`semanticContent`** passed when the user opens the modal.

---

## Page rail

The modal’s **left-side page list** and **prev/next** controls are driven by **`splitToSyntheticPages`** over the extracted string. With extraction fixed, **page rail works again** for typical PDFs (subject to main-process truncation limits: max pages / max chars).

---

## Remaining limitations

- **Preload required:** If `window.beap.extractPdfText` is missing (non-Electron or misconfigured preload), PDF preview shows a clear error instead of attempting HTTP.
- **Size limits:** Main enforces PDF input size and extracted character caps (`PDF_PARSER_LIMITS` in `main.ts`); very large PDFs may truncate or fail with a server-style error message.
- **Non-PDF types:** Plain-text paths are unchanged (base64 decode in renderer).

---

## Manual QA checklist

- [ ] Add PDF attachment in inline BEAP composer.
- [ ] Parse no longer fails with **401** / “missing or invalid launch secret”.
- [ ] Successful parse shows green **Parsed** badge.
- [ ] Failed parse shows **Failed** badge and a clear message.
- [ ] Reader opens from parsed attachment only when the user chooses **View Text** (no auto-open after parse — see follow-up section).
- [ ] Reader shows extracted text body.
- [ ] Reader **left page rail** switches pages; prev/next works.
- [ ] Send flow still works end-to-end.
- [ ] No visual regression in current light-theme composer (no dark legacy theme reintroduced).

---

## Definition of done

Parsing runs through **trusted main-process extraction** (IPC), the **green Parsed** path and **BeapDocumentReaderModal** (including **page rail**) work again for normal PDFs, and the **light-theme** inline composer layout is unchanged except where behavior required no UI edits.

---

## Follow-up fix: manual reader opening only

**Changed file(s)**

- `apps/electron-vite-project/src/components/BeapInlineComposer.tsx`

**Exact behavioral change**

- Removed the **`addAttachments`** logic that auto-called **`setReaderOpen(true)`** (and **`setReaderFilename` / `setReaderText`**) after the first successfully parsed attachment in a batch — for both **PDF** (parsed with **`parseStatus`**) and **non-PDF text** attachments.
- **`previewText`**, **`previewError`**, and **`parseStatus`** are still written to attachment state exactly as before; only the automatic modal open was deleted.
- **`openAttachmentReader`** remains the sole code path that opens **`BeapDocumentReaderModal`** from the attachment row (user-triggered **View Text** / equivalent).

**Parsed status**

- Unchanged: **pending → success/failed** for PDFs, **`AttachmentStatusBadge`** still reflects **Extracting…**, **Parsed**, **Failed**; extracted text remains in **`previewText`** for instant open on click.

**Manual QA**

- Add a PDF → parse succeeds → **reader does not auto-open**.
- Green **Parsed** badge appears as before.
- Click **View Text** → **`BeapDocumentReaderModal`** opens with extracted text; **page rail** behaves as before.
