# BEAP™ Capsule Builder & Inbox — Diagnostic Analysis

## Executive Summary

This document traces six reported issues through the codebase, identifies root causes, and proposes specific fixes. The analysis follows actual code paths and does not guess.

---

═══════════════════════════════════════════════════════
## ISSUE 1: Download Does Not Work — False "Sent via Handshake" Feedback
═══════════════════════════════════════════════════════

### ROOT CAUSE

When the user selects **PRIVATE mode** with a handshake recipient and clicks Send/Download, the code **bypasses the delivery method entirely**. It always uses `sendViaHandshakeRefresh` (handshake.refresh RPC), which sends via the handshake channel and shows "BEAP™ Message sent via handshake!" — regardless of whether the user selected Email, Messenger, or **Download**. The Download option is never honored in this path.

Additionally, **useReplyComposer** and **useBulkSend** use `buildResult.pkg`, but `buildPackage` returns `PackageBuildResult` with `package` (not `pkg`). This causes all BEAP/email sends from the inbox reply composer to fail with "BEAP package build failed" or "Email package build failed" — even when the build succeeds.

### CODE TRACE

1. **sidepanel.tsx** lines 446–463: Private + handshake path
   - Condition: `beapRecipientMode === 'private' && selectedRecipient && 'handshake_id' in selectedRecipient`
   - Calls `sendViaHandshakeRefresh(hsId, { text: beapDraftMessage }, accountId)`
   - Never checks `handshakeDelivery` (email | messenger | download)
   - Success feedback: `'BEAP™ Message sent via handshake!'` (line 454)

2. **sidepanel.tsx** lines 465–527: Legacy path (PUBLIC or when delivery is download)
   - Uses `executeDeliveryAction(config)` with `config.deliveryMethod = handshakeDelivery`
   - Correctly routes to `executeDownloadAction` when `handshakeDelivery === 'download'`

3. **useReplyComposer.ts** lines 379–381, 412–417:
   - Checks `buildResult.pkg` — **wrong property** (should be `buildResult.package`)
   - `PackageBuildResult` interface (BeapPackageBuilder.ts:612–617) has `package?: BeapPackage`, not `pkg`

4. **useBulkSend.ts** lines 143, 163, 167: Same `buildResult.pkg` bug

### EVIDENCE

```typescript
// sidepanel.tsx:446-454
if (beapRecipientMode === 'private' && selectedRecipient && 'handshake_id' in selectedRecipient) {
  const result = await sendViaHandshakeRefresh(hsId, { text: beapDraftMessage }, accountId)
  if (result.success) {
    setNotification({ message: 'BEAP™ Message sent via handshake!', type: 'success' })
    // ... clears form — NO download, NO check of handshakeDelivery
  }
}
```

```typescript
// BeapPackageBuilder.ts:612-617
export interface PackageBuildResult {
  success: boolean
  package?: BeapPackage   // <-- property is "package", not "pkg"
  packageJson?: string
  error?: string
}
```

```typescript
// useReplyComposer.ts:380
if (!buildResult.success || !buildResult.pkg) {  // pkg is always undefined
  throw new Error(buildResult.error ?? 'BEAP package build failed.')
}
```

### PROPOSED FIX

1. **sidepanel.tsx**: When `handshakeDelivery === 'download'`, always use the legacy path (executeDeliveryAction) — never use sendViaHandshakeRefresh. Add condition:
   ```ts
   if (handshakeDelivery === 'download' || (beapRecipientMode === 'public') || ...) {
     // use executeDeliveryAction
   } else if (beapRecipientMode === 'private' && selectedRecipient && ...) {
     // use sendViaHandshakeRefresh (email/messenger only)
   }
   ```

2. **useReplyComposer.ts** and **useBulkSend.ts**: Replace `buildResult.pkg` with `buildResult.package` everywhere, and pass `buildResult.package` to `executeEmailAction`.

### ESTIMATED COMPLEXITY

**Medium** — Logic change in sidepanel + property name fix in two hooks.

### DEPENDENCIES

None. Fixes can be applied independently.

---

═══════════════════════════════════════════════════════
## ISSUE 2: PDF Attachment Not Parsed — Text Not Extracted and Embedded
═══════════════════════════════════════════════════════

### ROOT CAUSE

The BEAP capsule builder **does** call `processAttachmentForParsing` for PDFs (sidepanel.tsx lines 5228–5240). The parser service uses the **Electron Orchestrator HTTP API** at `http://127.0.0.1:51248/api/parser/pdf/extract`. When the extension runs **without Electron** (Chrome extension–only), the parser is unavailable — fetch fails, and parsing silently fails. The attachment is included with `semanticContent: null` and `semanticExtracted: false`.

The handshake context graph uses a different pipeline: documents are uploaded via `uploadHsProfileDocument` (RPC to vault/Electron), which runs extraction server-side. The capsule builder runs in the extension and depends on Electron being reachable.

### CODE TRACE

1. **sidepanel.tsx** lines 5181–5268: File input onChange
   - Creates `CapsuleAttachment` with `semanticContent: null`, `semanticExtracted: false`
   - For PDFs: calls `processAttachmentForParsing(item.capsuleAttachment, item.dataBase64)`
   - Updates state with `parseResult.attachment` (which may still have null semanticContent if parse fails)

2. **parserService.ts** lines 107–139: `extractPdfText`
   - `fetch('http://127.0.0.1:51248/api/parser/pdf/extract', ...)`
   - On connection error: returns `{ success: false, error: 'Failed to connect to parser service' }`

3. **parserService.ts** lines 152–203: `processAttachmentForParsing`
   - On `!result.success`: returns attachment with `semanticContent: null`, `semanticExtracted: false`

4. **BeapPackageBuilder** intake: Uses `config.attachments` (CapsuleAttachment[]) — semanticContent is passed through when present.

### EVIDENCE

```typescript
// parserService.ts:83
const ELECTRON_BASE_URL = 'http://127.0.0.1:51248'

// parserService.ts:133-137
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to connect to parser service'
  }
}
```

### PROPOSED FIX

1. **Extension-only fallback**: When Electron is not reachable, use a client-side PDF text extraction (e.g., pdf.js in worker) for basic text extraction. This requires adding a bundled PDF parser that runs in the extension context.

2. **User feedback**: When parsing fails, show a clear message: "PDF text extraction requires the WR Desk Desktop App. Install it for full PDF support, or the attachment will be included without extracted text."

3. **Canon compliance**: Document that Canon A.3.054.7 ("Documents are parsed and normalized") is satisfied when Electron is running; when not, the attachment is included as encrypted blob with best-effort semantic content.

### ESTIMATED COMPLEXITY

**Large** — Client-side PDF parsing adds ~500KB+ and requires careful security review. Simpler fix: improve UX messaging.

### DEPENDENCIES

Issue 4 (vision fallback) is related — both address parse failure handling.

---

═══════════════════════════════════════════════════════
## ISSUE 3: Receiver-Side Attachment Handling Mismatch
═══════════════════════════════════════════════════════

### ROOT CAUSE

**BeapMessageDetailPanel** renders attachments with a minimal `AttachmentRow` (filename, mime, size, click-to-select). It does **not**:
- Show semanticContent in a reader view
- Show a warning dialog before viewing the original
- Use the same reader component as the handshake context graph

The handshake context graph uses **HsContextDocumentReader** (page-by-page, search, copy) and **HsContextDocumentUpload** (with BYOK Vision fallback). These are backed by `hsContextProfilesRpc` (WebSocket → Electron) and require a document ID from the vault. BEAP message attachments come from the depackaged capsule — they have `BeapAttachment` with `semanticContent` and `attachmentId` but no vault document ID. The infrastructure is different.

### CODE TRACE

1. **BeapMessageDetailPanel.tsx** lines 411–431: `AttachmentRow` for each attachment
   - Displays: filename, mimeType, sizeBytes
   - Click: `onSelectAttachment(attachmentId)` — updates search context
   - No reader view, no warning dialog

2. **BeapAttachment** (beapInboxTypes.ts:55–79): Has `semanticContent?: string`, `rasterProof?: string`

3. **HsContextDocumentReader** (vault/hsContext): Requires `documentId` from vault RPC — not applicable to BEAP message attachments

### EVIDENCE

```typescript
// BeapMessageDetailPanel.tsx:504-518
<div>
  <div>{attachment.filename}</div>
  <div>{attachment.mimeType} · {formatBytes(attachment.sizeBytes)}</div>
</div>
// No semanticContent display, no reader, no warning
```

### PROPOSED FIX

1. **Inline reader for semanticContent**: When `attachment.semanticContent` is present, add an expandable section below the AttachmentRow that shows the text in a reader-style block (same font/styling as HsContextDocumentReader). Reuse styling, not the RPC-backed component.

2. **Warning dialog for original access**: Before allowing download/view of the original artefact (when implemented), show: "This file is an original artefact from outside the protected environment. Opening it carries risk. Proceed?"

3. **Selection and search**: Already implemented — `onSelectAttachment` updates context; search bar can query selected attachment. Verify the selected attachment's semanticContent is included in the AI query payload.

### ESTIMATED COMPLEXITY

**Medium** — Add expandable reader + warning dialog; reuse existing BeapAttachment data model.

### DEPENDENCIES

None. Can be done after Issue 2 if semanticContent is populated.

---

═══════════════════════════════════════════════════════
## ISSUE 4: PDF Parse Failure Fallback — Vision AI Option Missing
═══════════════════════════════════════════════════════

### ROOT CAUSE

The **handshake context graph** uses **HsContextDocumentUpload** (vault/hsContext), which has a BYOK Vision fallback: when extraction fails with `error_code === 'NO_TEXT_EXTRACTED'`, it shows an Anthropic API key input and calls `retryExtractionWithVision(docId)`. This is backed by vault RPC and server-side vision extraction.

The **BEAP capsule builder** (sidepanel, popup-chat) uses `processAttachmentForParsing` from `beap-builder/parserService`. When parsing fails, it silently sets `semanticExtracted: false` and `semanticContent: null`. There is **no** vision fallback — no Anthropic key input, no retry with vision API.

### CODE TRACE

1. **HsContextDocumentUpload.tsx** lines 137–148, 551–649:
   - `hasImageOnlyFailure = documents.some(d => d.extraction_status === 'failed' && d.error_code === 'NO_TEXT_EXTRACTED')`
   - Shows "Extract with AI" button or "Enter API Key & Retry"
   - Calls `retryExtractionWithVision(docId)` via `hsContextProfilesRpc`

2. **sidepanel.tsx** lines 5242–5246: Parse error handling
   - `catch`: sets `processing.error` — no vision fallback UI

3. **parserService.ts** lines 173–183: On parse failure
   - Returns `attachment` with `semanticContent: null`, `semanticExtracted: false` — no retry path

### EVIDENCE

```typescript
// HsContextDocumentUpload.tsx:569
You have an Anthropic API key saved. Extract text using AI Vision?
```

```typescript
// sidepanel.tsx:5242-5246
.catch((err) => {
  setBeapDraftAttachments((prev) => prev.map((a) => 
    a.id === item.id ? { ...a, processing: { ...a.processing, parsing: false, error: String(err) } } : a
  ))
})
// No vision fallback — user sees error, cannot retry with AI
```

### PROPOSED FIX

1. **Shared vision extraction service**: Create a module that calls Anthropic Vision API for PDF page images (or use existing vault RPC if it can accept base64 input). The capsule builder would need to either:
   - Rasterize the PDF (already done via `processAttachmentForRasterization`), then send page images to vision API, or
   - Call a new RPC that accepts base64 PDF + API key and returns extracted text

2. **UI in capsule builder**: When `processing.error` is set for a PDF attachment, show a card similar to HsContextDocumentUpload: "Text extraction failed. Extract with AI Vision?" with API key input or one-click retry if key is stored.

3. **Reuse hasAnthropicApiKey / saveAnthropicApiKey** from `hsContextProfilesRpc` — the key is stored in the vault and can be used by the capsule builder if the RPC is accessible.

### ESTIMATED COMPLEXITY

**Large** — Requires new RPC or client-side vision integration, plus UI parity with HsContextDocumentUpload.

### DEPENDENCIES

Issue 2 — if parsing never runs (Electron down), the fallback would need to handle "no parse attempted" as well.

---

═══════════════════════════════════════════════════════
## ISSUE 5: Inbox and BEAP Builder Do Not Open on Linux
═══════════════════════════════════════════════════════

### ROOT CAUSE

No explicit platform checks were found that disable the BEAP Inbox or Builder on Linux. The codebase uses:
- `chrome.runtime.getPlatformInfo()` for UI hints (e.g., "On Linux, start WR Desk from your application menu")
- No conditional rendering that hides `BeapInboxView` or the BEAP Message section on Linux

**Likely causes** (require reproduction to confirm):
1. **Chrome sidepanel API**: Fully supported on Linux. Manifest has `side_panel.default_path` with no platform restrictions.
2. **Sandbox page**: `sandbox.html` is used for depackaging. Sandboxed pages work on Linux; path separators (`/` vs `\`) are not used in extension URLs.
3. **Electron dependency**: Parser, rasterizer, and handshake RPC require Electron. On Linux, if Electron is not running or fails to start, features that depend on it (e.g., PDF parsing, handshake refresh) will fail — but the UI should still render.
4. **Import/runtime errors**: A dynamic import or missing module could cause the BEAP tab content to fail to render. The sidepanel uses a single React root; if an error occurs during BeapInboxView mount, the whole panel could show blank.
5. **CSS/layout**: `useMediaQuery` and viewport breakpoints could behave differently if the sidepanel has different dimensions on Linux. `NARROW_VIEWPORT = '(max-width: 767px)'` — if the sidepanel is narrow, layout may collapse. Unlikely to cause "does not open" unless it results in zero-height content.

### CODE TRACE

1. **sidepanel.tsx** lines 4750–4764, 6278–6290, 7391–7403: `dockedWorkspace === 'beap-messages'` → renders `<BeapInboxView ... />`
2. **BeapInboxView.tsx**: No platform checks; uses `useMediaQuery` for responsive layout
3. **manifest.config.ts**: No `platform` restrictions
4. **background.ts** lines 1674–1698: Linux-specific logic for launching Electron via `wrcode://start` — does not affect inbox rendering

### EVIDENCE

```typescript
// sidepanel.tsx:3631
? 'On Linux, start WR Desk from your application menu. Check the system tray (🧠) if it\'s running.'
```

```typescript
// BeapInboxView.tsx — no platform checks
export const BeapInboxView = React.forwardRef<BeapInboxViewHandle, BeapInboxViewProps>(...)
```

### PROPOSED FIX

1. **Reproduce on Linux**: Open DevTools for the sidepanel (right-click sidepanel → Inspect), check Console for errors when switching to BEAP Messages tab. Check for failed imports, undefined references, or CORS/network errors.
2. **Error boundary**: Wrap `BeapInboxView` in an error boundary that catches render errors and displays a fallback UI with the error message. This will prevent a single component failure from blanking the entire panel.
3. **Lazy loading**: If BeapInboxView or its children are lazy-loaded, ensure the dynamic import path is correct and does not fail on Linux (e.g., case sensitivity, path resolution).
4. **Electron connection**: If the inbox depends on Electron for initial data (e.g., handshake list), add a "Desktop App not connected" state that still renders the UI with an empty/disabled state instead of failing silently.

### ESTIMATED COMPLEXITY

**Small to Medium** — Depends on actual root cause. Error boundary is a quick win.

### DEPENDENCIES

None.

---

═══════════════════════════════════════════════════════
## ISSUE 6: Handshake Flow Attachment Handling (Reference Trace)
═══════════════════════════════════════════════════════

### UPLOAD

- **Component**: `HsContextDocumentUpload` (vault/hsContext/HsContextDocumentUpload.tsx)
- **Flow**: User selects PDF → `handleFileChange` → `uploadHsProfileDocument(profileId, file, ...)` via `hsContextProfilesRpc`
- **RPC**: Sends file to vault/Electron; server runs extraction (pdfjs or similar)

### PARSE

- **Service**: Server-side (vault backend) — not parserService.ts
- **Result**: `ProfileDocumentSummary` with `extraction_status`, `extracted_text`, `error_code`
- **Storage**: Document stored in vault; `extracted_text` available via `getDocumentPage`, `getDocumentFullText`

### FALLBACK (Parse failure → Vision AI)

- **Trigger**: `extraction_status === 'failed'` and `error_code === 'NO_TEXT_EXTRACTED'`
- **UI**: HsContextDocumentUpload shows BYOK card — "Extract with AI" or "Enter API Key & Retry"
- **RPC**: `retryExtractionWithVision(docId)` — server uses Anthropic Vision API
- **Key storage**: `saveAnthropicApiKey`, `hasAnthropicApiKey` via vault RPC

### ENCRYPT

- **Context**: Handshake context blocks are hashed (proof-only); full content is in BEAP capsules
- **Original artefact**: In BEAP pipeline, `originalFiles` and `rasterArtefacts` are encrypted via `encryptOriginalArtefactWithAAD`, `encryptArtefactWithAAD` in BeapPackageBuilder

### DISPLAY (Receiver-side)

- **Component**: `HsContextDocumentReader` (vault/hsContext/HsContextDocumentReader.tsx)
- **Props**: `documentId`, `filename`, `onViewOriginal`, `canViewOriginal`
- **Features**: Page-by-page text, search, copy, sidebar with page list
- **Original access**: `onViewOriginal` callback — parent can show warning before allowing download

### SEARCH INTEGRATION

- **HsContextDocumentReader**: `searchDocumentPages(documentId, query)` — returns matches
- **BEAP message**: `onSelectAttachment` updates `selectedAttachmentId`; parent's `onAiQuery` receives `messageId` and `attachmentId` — AI query should include selected attachment's semanticContent in context

---

## FIX ORDER RECOMMENDATION

1. **First (critical, unblocks users)**:
   - **Issue 1**: Fix `buildResult.pkg` → `buildResult.package` in useReplyComposer and useBulkSend
   - **Issue 1**: Fix sidepanel to respect `handshakeDelivery === 'download'` — use executeDeliveryAction instead of sendViaHandshakeRefresh when user selects Download

2. **Second (high value)**:
   - **Issue 3**: Add semanticContent reader and warning dialog to BeapMessageDetailPanel attachments
   - **Issue 5**: Add error boundary around BeapInboxView; reproduce on Linux and fix any platform-specific failures

3. **Third (can parallelize)**:
   - **Issue 2**: Improve UX when Electron/parser is unavailable; consider client-side PDF fallback
   - **Issue 4**: Add vision AI fallback to capsule builder attachment flow (share with HsContextDocumentUpload pattern)

### Total Estimated Effort

- **Issue 1**: 2–4 hours
- **Issue 3**: 4–6 hours
- **Issue 5**: 2–4 hours (depending on repro)
- **Issue 2**: 8–16 hours (client-side parser) or 2–4 hours (UX messaging only)
- **Issue 4**: 12–20 hours (RPC + UI)

**Total (minimal critical path)**: ~8–14 hours  
**Total (full parity)**: ~28–50 hours
