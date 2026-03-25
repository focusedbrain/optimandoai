# BEAP™ Attachment Handling — Codebase Analysis Report

Read-only trace of the repository. Paths are relative to the workspace root `code/` unless noted as absolute from repo root.

---

## 1. HS Profile Vault — Document Parsing Pipeline

### 1.1 Where documents live and how they are modeled (extension ↔ vault)

- **Summary type (extension):** `ProfileDocumentSummary` in `apps/extension-chromium/src/vault/hsContextProfilesRpc.ts` — fields `id`, `profile_id`, `filename`, `mime_type`, optional `label` / `document_type`, `extraction_status` (`'pending' | 'success' | 'failed'`), optional `extracted_text`, `error_message`, `error_code`, `sensitive`, `created_at` (lines **157–171**).
- **Upload RPC payload:** `uploadHsProfileDocument` sends `profileId`, `filename`, `mimeType`, `contentBase64`, `sensitive`, `label`, `documentType` over `vault.hsProfiles.uploadDocument` with a **60s** timeout (lines **273–295**). Binary is **not** kept only in React state; it is transferred to the vault backend via this RPC.
- **Persistence / encryption on host:** The Electron vault stores encrypted document rows and runs extraction asynchronously; table and job implementation live under `apps/electron-vite-project/electron/main/vault/` (e.g. `hsContextProfileService.ts`, `hsContextOcrJob.ts`, `vault/db.ts`). **Full server-side call chains beyond `sendVaultRpc` are not re-traced here** — treat host handlers as the continuation.

### 1.2 How parsing is triggered (UI → RPC)

- **Component:** `HsContextDocumentUpload` — `apps/extension-chromium/src/vault/hsContext/HsContextDocumentUpload.tsx`.
- **Control:** User clicks **+ Add PDF** (lines **383–389**), which opens a hidden `<input type="file" accept="application/pdf">` (lines **391–397**).
- **Handler:** `handleFileChange` (lines **219–267**) validates PDF MIME and **50 MB** max (lines **222–228**), resolves `profileId`, then calls `uploadHsProfileDocument(...)` (line **257**). This is **automatic server-side parsing after upload**, not a separate “Parse” button.
- **Polling while `pending`:** If any document has `extraction_status === 'pending'`, an interval calls `onDocumentsChanged` every **2s**, max **180** attempts (~6 min), matching comment about server timeout (lines **154–172**).

### 1.3 Primary text extraction (vault path vs `parserService.extractPdfText`)

- **HS vault documents:** Primary extraction is implemented on the **Electron** side (`hsContextOcrJob.ts` — pdfjs text + OCR paths, `NO_TEXT_EXTRACTED`, etc.; not the extension’s `parserService.extractPdfText`).
- **WR Chat / capsule draft:** Uses `processAttachmentForParsing` in `apps/extension-chromium/src/beap-builder/parserService.ts` (lines **254–305**), which calls `extractPdfText` (lines **217–241**):
  - **Browser:** `extractPdfTextBrowser` — `pdfjs-dist`, **90s** timeout via `Promise.race` (lines **40–41**, **47–92**).
  - **Electron orchestrator (optional):** `extractPdfTextElectron` — `POST http://127.0.0.1:51248/api/parser/pdf/extract`, `AbortSignal.timeout(30_000)` (lines **160**, **179–204**).
- **Output on capsule model:** For draft attachments, extracted text is stored in `CapsuleAttachment.semanticContent` with `semanticExtracted: true` (lines **288–303** in `parserService.ts`). Canonical fields: `apps/extension-chromium/src/beap-builder/canonical-types.ts` lines **175–211**.

### 1.4 Vision AI fallback (two distinct paths)

**A — HS profile / vault (BYOK, server uses stored key)**

- **Condition:** UI shows Vision card when `extraction_status === 'failed'` and `error_code === 'NO_TEXT_EXTRACTED'` (lines **139–141**, **551–667** in `HsContextDocumentUpload.tsx`).
- **RPC:** `retryExtractionWithVision(documentId)` → `vault.hsProfiles.retryExtractionWithVision` (lines **401–410** in `hsContextProfilesRpc.ts`). Comment states the **server** uses the stored API key (lines **396–399**).
- **Key storage:** `saveAnthropicApiKey` / `hasAnthropicApiKey` (lines **374–387** in `hsContextProfilesRpc.ts`).
- **Anthropic usage on host:** `hsContextOcrJob.ts` defines `VISION_MODEL` and `VISION_MAX_PAGES = 100` (e.g. lines **42–43**, **375** region per grep).

**B — WR Chat draft / capsule builder (extension, direct API)**

- **Service:** `extractPdfTextWithVision` in `apps/extension-chromium/src/beap-builder/visionExtractionService.ts` — renders PDF pages to **PNG** via pdfjs canvas (lines **57–83**), then `POST https://api.anthropic.com/v1/messages` with `model: 'claude-sonnet-4-20250514'` (lines **13**, **92–112**). Prompt: `EXTRACT_PROMPT` (lines **19–26**). Per-page errors map HTTP **401**, **403**, **429**, **529** (lines **115–131**).
- **UI entry:** `VisionFallbackButton` calls `extractPdfTextWithVision` with key from `anthropicApiKeyStorage` (lines **84–92** in `VisionFallbackButton.tsx`); used from `sidepanel.tsx` draft rows (lines **5257–5263**).

### 1.5 How parsed text is displayed

- **Inline preview:** **Preview** toggles `expandedDoc`, shows up to **800** chars of `extracted_text` (lines **497–501**, **529–541** in `HsContextDocumentUpload.tsx`).
- **Full reader:** **Open Document Reader** sets `readerDoc` (lines **490–495**); modal renders `HsContextDocumentReader` (lines **685–725**) with `documentId`, `filename`, `mimeType`, `onViewOriginal` chaining to owner download (lines **713–721**).
- **Reader behavior:** `HsContextDocumentReader.tsx` — page load via `getDocumentPageCount` / `getDocumentPage` / `getDocumentPageList` (lines **7–14**, **57–95**), in-document search (lines **102–115**), copy page (lines **136–145**).

### 1.6 Document state lifecycle (HS profile)

| Phase | Model | UI |
|--------|--------|-----|
| Uploading | — | **Uploading…** on button (lines **384–388**) |
| `pending` | `extraction_status` | `StatusBadge` “Extracting…” (lines **81–86**); polling (lines **154–172**) |
| `success` | `extracted_text` set | “Text ready”; reader + preview (lines **488–502**) |
| `failed` + `NO_TEXT_EXTRACTED` | `error_code` | BYOK / Vision card (lines **551–667**) |
| Other `failed` | `error_message` / `error_code` | Password, timeout, generic error block (lines **671–679**) |

**Call chain (upload → text in UI):** `+ Add PDF` → `handleFileChange` → `uploadHsProfileDocument` → vault RPC → async extraction on host → parent refresh via `onDocumentsChanged` / polling → `ProfileDocumentSummary.extracted_text` / `extraction_status` → Preview or `HsContextDocumentReader` (RPC page APIs: `getDocumentPage`, etc., lines **414–427** in `hsContextProfilesRpc.ts`).

---

## 2. Depackaged Email — Receiver-Side Attachment Handling

*This section covers the **WR Chat (extension) BEAP inbox**, which ingests verified packages from Stage 5 (native BEAP and depackaged paths share the same sanitised package → store mapping). WR Desk™ mail UI (separate Electron app) uses `useEmailInboxStore` / `EmailMessageDetail` / `HybridSearch` — see paths referenced in prior internal notes if you need Desk-only behavior.*

### 2.1 Where attachment objects live after verification

- **Ingress:** On sandbox success, `importPipeline.ts` calls `useBeapInboxStore.getState().addMessage(pkg, handshakeId)` when gates authorize (lines **603–612** in `apps/extension-chromium/src/ingress/importPipeline.ts`).
- **Store:** `addMessage` maps `SanitisedDecryptedPackage` → `BeapMessage` via `sanitisedPackageToBeapMessage`, and stores the raw `pkg` in `packages` (lines **318–337** in `apps/extension-chromium/src/beap-messages/useBeapInboxStore.ts`).
- **Attachment model (UI):** `BeapAttachment` in `apps/extension-chromium/src/beap-messages/beapInboxTypes.ts` — `attachmentId`, `filename`, `mimeType`, `sizeBytes`, optional `semanticContent`, optional `rasterProof` (first page sha), `selected` (lines **52–79**).
- **Mapping from capsule:** `mapAttachments` copies `att.semanticContent` from `pkg.capsule.attachments` (lines **71–81** in `sanitisedPackageToBeapMessage.ts`) — parsed text is **whatever the verified capsule contains** (sender-supplied extraction in capsule), not re-extracted in this mapper.

### 2.2 Attachment list UI

- **Component:** `MessageContentPanel` inside `BeapMessageDetailPanel.tsx` (lines **401–475**) — section **Attachments (N)**, maps `message.attachments` to `AttachmentRow` (lines **423–445**).
- **Row metadata:** Filename, `mimeType · formatBytes(sizeBytes)`, suffix “· text extracted” when `semanticContent` present (lines **572–589**).
- **Actions:** **Summarize** (if `onSummarizeAttachment`), **View Original** (lines **591–625**).

### 2.3 Text reader (parsed content)

- **Component:** `BeapAttachmentReader` (`apps/extension-chromium/src/beap-messages/components/BeapAttachmentReader.tsx`) — scrollable semantic text, optional copy (lines **32–120**).
- **Trigger:** Selecting a row sets `selectedAttachmentId`; if that attachment has `semanticContent`, a **Extracted Text** block renders `BeapAttachmentReader` (lines **447–472** in `BeapMessageDetailPanel.tsx`). **Not** the same component as `HsContextDocumentReader`; similar UX, different data source (in-memory `semanticContent` vs vault page RPCs).

### 2.4 Original file access

- **Warning dialog:** `ProtectedAccessWarningDialog.tsx` — `ORIGINAL_COPY` title **“View Original Document”**, body paragraphs (lines **19–26**, **96–104**). Buttons **Cancel** / **I understand, proceed** (lines **105–120** region).
- **Trigger:** `AttachmentRow` **View Original** sets local `showWarning` (lines **534–537**, **609–624**); on acknowledge calls `onViewOriginal(attachment)` (lines **649–652**).
- **Download path:** `useViewOriginalArtefact.ts` loads `pkg` via `getPackageForMessage`, then `getOriginalArtefact(pkg, attachment.attachmentId)` (lines **47–60**). `getOriginalArtefact` selects artefact with `class === 'original'` (lines **1594–1600** in `apps/extension-chromium/src/beap-messages/services/beapDecrypt.ts`). Decrypted `base64` is passed to `triggerDownload` (lines **62–71** in `useViewOriginalArtefact.ts`). Error strings include **“Original file not available (pBEAP packages may not include encrypted originals).”** (lines **57–59**).

### 2.5 Selection / deselection

- **Mechanism:** Click row toggles selection (`AttachmentRow` `onClick` vs `data-no-select` for buttons) — lines **546–550**, **591–625**.
- **Local state:** `selectedAttachmentId` in `BeapMessageDetailPanel` (lines **1037–1038**, **1127–1134`).
- **Parent notification:** `onAttachmentSelect?.(messageId, id)` when selection changes (lines **1129–1131**, **1076–1086** reset on message change).
- **Ref for LLM:** `beapInboxSelectedAttachmentIdRef` updated from `onAttachmentSelect` in `sidepanel.tsx` (lines **4692–4694**).

### 2.6 Selected attachments → LLM query

- **Summarize path:** `handleSummarizeAttachment` calls `onAiQuery('Summarize attachment: …', messageId, attachmentId)` (lines **1137–1144** in `BeapMessageDetailPanel.tsx`).
- **Parent wiring:** `onAiQuery` sets `beapInboxSelectedAttachmentIdRef`, fills `pendingInboxAiRef` with optional `attachmentId`, sets chat input, calls `handleSendMessage()` (lines **4695–4705** in `sidepanel.tsx`).
- **Prompt injection:** `handleSendMessage` prepends `[Selected Attachment: ${filename}]\n${sem.slice(0, 4000)}` when inbox is focused and ref/`semanticContent` available (lines **2542–2554** in `sidepanel.tsx`); merges into the last user message payload for the LLM path (lines **2671–2681**).

---

## 3. WR Chat Capsule Builder — Current Attachment Pipeline (Sender)

### 3.1 Attachment addition

- **State:** `beapDraftAttachments: DraftAttachment[]` (line **415** in `sidepanel.tsx`).
- **`DraftAttachment`:** `id`, `name`, `mime`, `size`, `dataBase64`, `capsuleAttachment`, `processing: { parsing, rasterizing, error? }`, optional `rasterPageData` (lines **62–77**).
- **File input:** e.g. draft section lines **5128–5172** — `FileReader.readAsDataURL`, base64 strip after comma (**5138–5143**), builds `CapsuleAttachment` with `semanticContent: null`, `semanticExtracted: false`, placeholder `encryptedRef`, empty `encryptedHash`, `rasterProof: null` (**5146–5158**). Initial `processing: { parsing: false, rasterizing: false }` (**5167**).
- **`popup-chat.tsx`:** Same `executeDeliveryAction` path with `originalFiles` + `capsuleAttachments` (lines **655–677**); file-add pattern mirrored there (grep `beapDraftAttachments` / `processAttachmentForParsing`).

### 3.2 Processing flags

- **Set during manual parse:** Button sets `parsing: true` (**5207–5209**), then `processAttachmentForParsing` clears `parsing` and merges `capsuleAttachment` (**5210–5218**).
- **`rasterizing`:** Flag exists on `DraftAttachment` type and initial state; **`processAttachmentForRasterization` is not invoked from `sidepanel.tsx`** (no matches in extension src outside `parserService` / tests — grep March 2025 snapshot).
- **UI:** `AttachmentStatusBadge` driven by parse state only in the shown block (lines **5178–5201**).

### 3.3 Parse pipeline (draft)

**Chain:** Parse button → `processAttachmentForParsing` (`parserService.ts` **254–305**) → `extractPdfText` → browser/Electron as in §1.3.

### 3.4 Raster pipeline (optional / not used in current draft UI)

- **Implementation:** `processAttachmentForRasterization` (**385+** in `parserService.ts`) → `rasterizePdf` POST `/api/parser/pdf/rasterize` (**337–370**).
- **Package integration:** `BeapPackageConfig.rasterArtefacts` (lines **311–321** in `BeapPackageBuilder.ts`); encrypted in `buildQBeapPackage` when present (**1303–1309**). Current draft UI does **not** populate `rasterArtefacts` in the inspected `handleSendBeapMessage` block (only `attachments` + `originalFiles`).

### 3.5 Capsule assembly

- **Entry:** `executeDeliveryAction` calls `buildPackage(config)` first (**2108–2121** in `BeapPackageBuilder.ts`).
- **Capsule JSON attachments:** Includes `id`, names, sizes, types, `semanticExtracted`, `semanticContent`, refs, `rasterProof`, `isMedia` (**1143–1154**).
- **Original binaries:** `config.originalFiles` → `encryptOriginalArtefactWithAAD` loop (**1314–1320**). Sidepanel builds `originalFiles` from each draft row’s `dataBase64` (**537–554** in `sidepanel.tsx`).

### 3.6 Draft UI

- **List:** Inline `map` over `beapDraftAttachments` (**5175–5281** in `sidepanel.tsx`).
- **Badges:** `AttachmentStatusBadge` when PDF parse state active (**5201**).
- **Remove / Clear:** Per-row **Remove** and **Clear all** (**5265**, **5281**).
- **View parsed text:** **View text** toggles `beapDraftReaderOpenId`; inline `BeapAttachmentReader` with `draftAttachmentToBeapReaderModel` (**5240–5271**, helper **87–97**).

### 3.7 Send validation

- **`handleSendBeapMessage` (`sidepanel.tsx` lines **488–590`):** Requires private **recipient** if `beapRecipientMode === 'private'` (**490–493**); requires non-empty **`beapDraftMessage`** (**496–502**). **No** check for attachment parse completion or `semanticExtracted`.
- **Handshake refresh path:** When `useHandshakeRefresh` applies, only `sendViaHandshakeRefresh(hsId, { text: beapDraftMessage }, …)` runs (**521**); **attachments are not passed** on this path (draft still clears attachments on success **529–530**).
- **Builder path:** `executeDeliveryAction` with current `capsuleAttachment` state (may still have `semanticExtracted: false` for PDFs never parsed).
- **Button disabled:** `isBeapSendDisabled` — `isSendingBeap || !beapDraftMessage.trim() || (private && !selectedRecipient)` (**604–605**). **Not** gated on attachments.

---

## 4. WR Chat — Received BEAP™ Message Display

### 4.1 Incoming handling

- Same as §2.1: verified package → `addMessage` → `BeapMessage` + stored `SanitisedDecryptedPackage` for artefact download (**603–612** `importPipeline.ts`, **318–337** `useBeapInboxStore.ts`).

### 4.2 Attachment display

- **Yes:** `BeapMessageDetailPanel` / `MessageContentPanel` (**401–475**), `BeapAttachmentReader`, original download via **View Original** as in §2.

### 4.3 LLM integration

- **Yes:** Search / chat flow uses `beapInboxSelectedAttachmentIdRef` + `semanticContent` prefix (**2542–2554**, **2671–2681** in `sidepanel.tsx`).
- **`pendingInboxAiRef` shape:** Includes optional `attachmentId` and `isBulk` (**210–215** in `sidepanel.tsx`).

---

## 5. Form Validation Patterns (WR Chat / WR Desk™ scope traced: extension)

### 5.1 `handleSendBeapMessage` checks (`sidepanel.tsx`)

- Private mode without recipient → `setNotification` error, **3s** clear (**490–493**).
- Empty public message → `setNotification` **“BEAP™ Message (required): enter the public capsule text before sending.”**, **5s** (**496–502**).
- Success / failure notifications (**523–534**, **566–579**); `finally` clears notification after **3s** (**587–588**).

### 5.2 `popup-chat.tsx`

- Same logical validations with **`setToastMessage`** (**608–620**, **714–715**).
- **`isBeapSendDisabled`:** **731–732** (mirrors sidepanel).

### 5.3 Labels and placeholders (`sidepanel.tsx`)

- **Public field:** Label **“BEAP™ Message (required)”** (**5033–5034**); placeholder **“Public capsule text — required before send. This is the transport-visible message body.”** (**5040**).
- **Private encrypted field:** Label **“🔐 Encrypted Message (Private · qBEAP)”** (**5061–5062**); placeholder **“This message is encrypted, capsule-bound, and never transported outside the BEAP package.”** (**5068**).
- **Helper (under encrypted textarea):** **“⚠️ This content is authoritative when present and never leaves the encrypted capsule.”** — `sidepanel.tsx` **5084–5086**.
- **No** label that literally says **“pBEAP™”** on the public field — it is described as public / transport-visible in copy above.

### 5.4 Mandatory-field patterns elsewhere (examples)

- **HS document label:** `validateDocumentLabel` on upload (**250–253** `HsContextDocumentUpload.tsx`); inline `uploadError` box (**400–407**).
- **Vision key:** `sk-ant-` prefix checks in HS upload Vision flow (**198–199**, **625** region) and `VisionFallbackButton` (**63–66**).
- **No** single shared “FormField required” abstraction found in this trace — mostly inline.

### 5.5 Send button

- **Disabled** when sending, empty public message, or private without recipient (**604–605**); **not** disabled for empty encrypted-only body or unparsed attachments.

---

## 6. Reuse Map

| Existing artifact | Reuse for native BEAP send/receive alignment |
|-------------------|-----------------------------------------------|
| `processAttachmentForParsing` / `extractPdfText` | Draft PDF parsing (already wired); same limits/errors as §1.3 |
| `VisionFallbackButton` + `visionExtractionService` | Client-side Vision when parse returns empty; parallel to vault BYOK path |
| `BeapAttachmentReader` | Draft “View text” + inbox reader (already both) |
| `HsContextDocumentReader` | Rich page UI for vault PDFs; optional future parity for draft |
| `ProtectedAccessWarningDialog` | Inbox original access (already) |
| `BeapPackageBuilder` capsule `attachments` + `originalFiles` encryption | Sender assembly; receiver `getOriginalArtefact` |
| `sanitisedPackageToBeapMessage` / `mapAttachments` | Single mapper for all verified inbox packages |
| `handleSendMessage` attachment prefix (`slice(0, 4000)`) | Pattern for LLM context from selected inbox attachment |

---

## 7. Gap Analysis

1. **Handshake refresh send path** omits draft attachments (`sendViaHandshakeRefresh` only `{ text: beapDraftMessage }` — **521** `sidepanel.tsx`) while still clearing attachments on success — **attachments never ride this delivery mode**.
2. **Send does not wait** for PDF parse; builder may emit `semanticExtracted: false` and empty `semanticContent` if user never clicked **Parse** or Vision (**488–558**, **604–605**).
3. **Public message is mandatory** even when private encrypted body is filled — enforced by validation and disabled button (**496–502**, **604–605**); only `console.warn` if private empty encrypted (**560–561**).
4. **Two Vision systems:** Vault server (`retryExtractionWithVision`, up to **100** pages in `hsContextOcrJob.ts`) vs extension (`VISION_MAX_PAGES = 50` in `visionExtractionService.ts` **16**) — different caps and storage.
5. **pBEAP™ branding:** UI uses **“BEAP™ Message (required)”** + transport placeholder, not explicit **“pBEAP™”** label (**5033–5040**).
6. **`BeapAttachment` comment** in `beapInboxTypes.ts` still says semantic content is populated “after verification” by “parserService” (**66–68**) — for inbox, it is **mapped from the verified capsule** (`mapAttachments`), which may mismatch mental model.
7. **Original download** may be unavailable for some encodings — explicit message in `useViewOriginalArtefact.ts` (**57–59**).

### Surprises / inconsistencies

- Draft attachment label states **“no auto rasterization”** (**5126** `sidepanel.tsx`) — consistent with **no** `processAttachmentForRasterization` call in UI.
- `pendingInboxAiRef` typing **includes** `attachmentId` and `isBulk` (**210–215**) — older reports claiming `attachmentId` was dropped are **obsolete** relative to **4695–4701**.

---

*End of report.*
