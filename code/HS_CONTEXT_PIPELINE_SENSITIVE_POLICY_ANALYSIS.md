# HS Context Pipeline & Sensitive Policy — Second Analysis Report

**Purpose:** Focused code analysis for document/link/policy pipeline and per-item "Sensitive" policy integration.  
**Builds on:** HS_CONTEXT_REFACTOR_ANALYSIS_REPORT.md (first analysis).  
**No implementation proposed.**

---

## 1. Parser and Extraction Pipeline

### 1.1 Exact Files/Classes/Functions/Jobs

| Component | File | Function/Class |
|-----------|------|----------------|
| HS Profile PDF extraction | `electron/main/vault/hsContextOcrJob.ts` | `extractTextFromPdf`, `runExtractionJob`, `extractTextDirect`, `extractTextOcr` |
| OCR service | `electron/main/ocr/ocr-service.ts` | `OCRService`, `ocrService.processImage` |
| Email PDF extractor | `electron/main/email/pdf-extractor.ts` | `extractPdfText`, `extractTextBasic`, `isPdfBuffer` |
| PDF parser API (capsule-bound) | `electron/main.ts` (lines 7164–7304) | Inline handler for `POST /api/parser/pdf/extract` |

**Note:** The email `pdf-extractor` and main.ts PDF parser API are **not** used by HS Context Profiles. HS Profile documents use **hsContextOcrJob only**.

### 1.2 Entry Points from Upload to Extraction

1. **Extension:** `HsContextDocumentUpload.tsx` → `uploadHsProfileDocument(profileId, file)` (hsContextProfilesRpc)
2. **Extension API:** HTTP to Electron backend (vault document upload route or HS Profile route)
3. **VaultService:** `uploadHsProfileDocument` → `hsContextProfileService.uploadProfileDocument`
4. **uploadProfileDocument** (`hsContextProfileService.ts` lines 313–373):
   - Encrypts PDF → `vault_documents`
   - Inserts `hs_context_profile_documents` row with `extraction_status: 'pending'`
   - `setImmediate(() => runExtractionJob(db, docId, content))` — fire-and-forget
5. **runExtractionJob** (`hsContextOcrJob.ts` lines 221–244):
   - `markDocumentExtractionPending`
   - `extractTextFromPdf(pdfBuffer)` → `OcrJobResult`
   - `markDocumentExtractionSuccess` or `markDocumentExtractionFailed`

### 1.3 MIME Types Accepted Today

| Pipeline | MIME Check | Location |
|----------|------------|----------|
| HS Profile upload | **Extension only:** `file.type !== 'application/pdf'` | `HsContextDocumentUpload.tsx` line 59 |
| Backend `uploadProfileDocument` | **None** — accepts `mimeType` param as-is | `hsContextProfileService.ts` line 319 |
| Document Vault | `detectMimeType` from extension (extension-based) | `documentService.ts` — not used for HS Profile |

**Confirmed:** HS Profile backend does **not** validate MIME. Extension restricts to PDF.

### 1.4 MIME Detection and Validation

- **HS Profile:** No backend MIME validation. Extension uses `file.type` (browser-provided).
- **Document Vault:** `detectMimeType(filename)` — extension-based from `extname()`; never trusts user-supplied MIME.
- **Detection method:** Extension-based (`.pdf` → `application/pdf`). No magic-byte or header validation for HS Profile.

### 1.5 Non-PDF Inputs

- **HS Profile:** Extension rejects non-PDF (`file.type !== 'application/pdf'`). Backend would accept any buffer if called directly.
- **hsContextOcrJob:** Expects PDF buffer; `pdfjs.getDocument({ data })` will fail on non-PDF.

### 1.6 pdfjs and OCR Fallback Flow

**File:** `hsContextOcrJob.ts`

1. `extractTextFromPdf(pdfBuffer)`:
2. `loadPdfjs()` → `pdfjs-dist/legacy/build/pdf.mjs` or `pdfjs-dist`
3. **Attempt 1:** `extractTextDirect(pdfjs, data)` — `getTextContent()` per page, join with `\n\n`
4. If `avgCharsPerPage >= MIN_TEXT_CHARS_PER_PAGE` (30) → return direct text, `extractor_name: 'pdfjs-direct'`
5. If sparse → **Attempt 2:** `extractTextOcr(pdfjs, data)`:
   - `require('canvas')` for rendering
   - Per page: `page.render()` → PNG buffer → `ocrService.processImage({ type: 'buffer', data: pngBuffer })`
   - Tesseract returns `result.data.text`
6. If OCR fails but direct gave sparse text → return sparse with `extractor_name: 'pdfjs-direct-sparse'`

### 1.7 Tesseract Invocation

- **File:** `electron/main/ocr/ocr-service.ts`
- **Method:** `ocrService.processImage(input)` → `this.worker.recognize(imageData)`
- **Called from:** `hsContextOcrJob.extractTextOcr` line 104: `await ocrService.processImage({ type: 'buffer', data: pngBuffer })`

### 1.8 When OCR vs Direct Extraction

- **Direct:** When `charCount / pageCount >= 30` (MIN_TEXT_CHARS_PER_PAGE)
- **OCR:** When direct text is sparse or direct fails; requires `canvas` package
- **Fallback to sparse:** When OCR fails but direct produced some text

### 1.9 Timeout, Retry, Queue, Failure Handling

| Aspect | Status | Location |
|--------|--------|----------|
| Timeout | **None** | `runExtractionJob` has no timeout |
| Retry | **None** | Single attempt; failure → `markDocumentExtractionFailed` |
| Queue | **None** | `setImmediate` fire-and-forget; no job queue |
| Failure | `markDocumentExtractionFailed(db, docId, errorMessage)` | `hsContextOcrJob.ts` lines 199–212 |
| Logging | `console.error` for failure | `hsContextOcrJob.ts` line 239 |

### 1.10 Max File Size / Page Count / Runtime Limits

| Limit | Value | Location |
|-------|-------|----------|
| HS Profile file size | 50 MB (extension) | `HsContextDocumentUpload.tsx` line 63 |
| Backend upload | **None** in `uploadProfileDocument` | — |
| Page count (HS OCR) | **None** | Processes all pages |
| Extracted text length | **None** | Stored as-is in `extracted_text` |
| PDF parser API (main.ts) | 300 pages, 5MB chars, 100MB input | `main.ts` lines 7168–7172 |

### 1.11 Extracted Text Normalization

- **Direct extraction:** `.trim()` on page text; `\n\n` between pages
- **OCR:** `.trim()` on each page
- **No** chunking, truncation, or schema-based cleaning before storage
- **No** HTML/markdown stripping

### 1.12 Parser Output Trust

- **No post-validation** before `markDocumentExtractionSuccess`
- Extracted text written directly to `hs_context_profile_documents.extracted_text`
- **Assumption:** Parser output is trusted; no safety validation.

### 1.13 Parser Output Structure

- **Layout:** Plain text; no structure
- **Metadata:** `extractor_name`, `extracted_at` stored
- **Links:** Not extracted; PDF links would appear as plain text if present in content
- **Embedded references:** Not parsed

### 1.14 HTML/Markdown Preservation

- **None** — output is plain text only.

---

## 2. Parsed Content Validation

### 2.1 Validators/Schemas Applied to Extracted Text

**None.** No validators or schemas are applied to `extracted_text` before it is stored or included in handshake context.

### 2.2 Schema/Safety Validation Before Handshake-Visible

- **None.** `resolveProfilesForHandshake` includes `extracted_text` in block content without validation.
- **Location:** `ipc.ts` line 168: `documents.map((d: any) => ({ filename: d.filename, extracted_text: d.extracted_text }))`

### 2.3 Dangerous Content Patterns

- **None.** No checks for XSS, prompt injection, or other dangerous patterns.

### 2.4 Markup/UI Injection Risk

- **HandshakeWorkspace BlockCard:** Renders `block.parsedContent` as text in React; no `dangerouslySetInnerHTML`.
- **HsContextDocumentUpload Preview:** Renders `doc.extracted_text` in `<pre>` — text only.
- **Risk:** If extracted text contained HTML and were ever rendered with `dangerouslySetInnerHTML`, XSS would be possible. Current code does not do that.

### 2.5 Length Limits, Character Set, Normalization

- **None** for `extracted_text` in `hs_context_profile_documents`.
- Column is `TEXT`; SQLite has no built-in length limit for TEXT.

### 2.6 Storage Format

- **Raw text** in `hs_context_profile_documents.extracted_text`.

### 2.7 Code Points for Strict Validation

| Insertion Point | File | Purpose |
|-----------------|------|---------|
| Before `markDocumentExtractionSuccess` | `hsContextOcrJob.ts` line 231 | Validate before DB write |
| In `resolveProfilesForHandshake` before block build | `hsContextProfileService.ts` | Validate before handshake inclusion |
| In `runExtractionJob` after `extractTextFromPdf` | `hsContextOcrJob.ts` line 229 | Single point for all extraction output |

**Minimal disruption:** Add validation in `runExtractionJob` immediately after `extractTextFromPdf` returns, before `markDocumentExtractionSuccess`.

---

## 3. Data Lineage and Storage Separation

### 3.1 Write Paths

| Path | Flow | Tables/Storage |
|------|------|----------------|
| **(a) Uploaded original** | `uploadProfileDocument` → `sealRecord` → INSERT | `vault_documents` (id=storage_key, wrapped_dek, ciphertext) |
| **(b) Encrypted blob** | Same as (a) | `vault_documents` |
| **(c) Document metadata** | INSERT | `hs_context_profile_documents` (id, profile_id, filename, mime_type, storage_key, scope, extraction_status, created_at) |
| **(d) Extracted text** | `markDocumentExtractionSuccess` | `hs_context_profile_documents.extracted_text` |
| **(e) Profile/context block** | `resolveProfilesForHandshake` → `resolveProfileIdsToContextBlocks` → JSON content | `context_store` → `context_blocks` (payload) |
| **(f) AI-usage policy** | `governance_json` on block | `context_blocks.governance_json`, `context_store.governance_json` |
| **(g) Sensitivity flags** | `data_classification` on block; `sensitivity` in governance | `context_blocks.data_classification`; `governance_json` (UsagePolicy) |

### 3.2 Extracted Text vs Original Storage

- **Separate:** Extracted text in `hs_context_profile_documents.extracted_text`; original in `vault_documents` (encrypted).
- **Not derived on demand:** Extracted text is stored; original is only decrypted when `getProfileDocumentContent` is called.

### 3.3 DB Tables/Columns

| Table | Columns Relevant to Pipeline |
|-------|------------------------------|
| `vault_documents` | id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext |
| `hs_context_profile_documents` | id, profile_id, filename, mime_type, storage_key, scope, extraction_status, extracted_text, extracted_at, extractor_name, error_message |
| `hs_context_profiles` | id, org_id, name, fields, custom_fields, scope |
| `context_store` | block_id, content, status, governance_json |
| `context_blocks` | payload, governance_json, data_classification, visibility |

### 3.4 Encryption Key Usage

- **vault_documents:** Per-record DEK wrapped by vault KEK; AAD `hsdoc:${docId}`
- **context_blocks payload:** Plain text in SQLite (vault DB encrypted at rest)

### 3.5 Provenance Fields

| Field | Exists | Location |
|-------|--------|----------|
| Per-document hash | `sha256` in Document Vault; **empty** for HS Profile docs | `vault_documents.sha256` — `''` in uploadProfileDocument |
| Parser version | `extractor_name` | `hs_context_profile_documents.extractor_name` |
| Validation timestamp | **None** | — |
| Provenance | `provenance` in governance | `context_blocks.governance_json` |

### 3.6 Model Support Assessment

| Requirement | Current Support |
|--------------|-----------------|
| Original encrypted artefact | ✅ `vault_documents` |
| Validated extracted text | ❌ No validation |
| Share-safe handshake view | ✅ Extracted text in payload; no original |
| Whitelist-gated original access | ❌ No whitelist |
| Per-item Sensitive flag | ⚠️ `cloud_ai_allowed: false` in UsagePolicy approximates; no dedicated Sensitive |
| AI-query restriction metadata | ✅ `governance_json` with `usage_policy` |

**Backward compatibility:** Adding validation and Sensitive flag can be additive if defaults preserve current behavior.

---

## 4. Existing AI-Use Default Settings and Policy Model

### 4.1 System Defaults for AI Use

| Default | Value | Location |
|---------|-------|----------|
| `DEFAULT_AI_PROCESSING_MODE` | `'local_only'` | `packages/shared/src/handshake/policyUtils.ts` line 29 |
| `DEFAULT_AI_POLICY` | `{ ai_processing_mode: 'local_only' }` | `PolicyRadioGroup.tsx` line 15 |
| `DEFAULT_USAGE_POLICY` | All false except `transmit_to_peer_allowed: true` | `packages/shared/src/handshake/contextGovernance.ts` lines 62–69 |
| `MESSAGE_DEFAULT_POLICY` | Same as DEFAULT_USAGE_POLICY | `contextGovernance.ts` lines 72–79 |

### 4.2 Files/Configs Where Defaults Are Defined

- `packages/shared/src/handshake/policyUtils.ts` — `DEFAULT_AI_PROCESSING_MODE`, `parsePolicyToMode`, `modeToUsageFlags`
- `packages/shared/src/handshake/contextGovernance.ts` — `DEFAULT_USAGE_POLICY`, `MESSAGE_DEFAULT_POLICY`
- `apps/electron-vite-project/src/components/PolicyRadioGroup.tsx` — `DEFAULT_AI_POLICY`

### 4.3 Scope of AI Use Control

| Level | Present | Location |
|-------|---------|----------|
| Global | ❌ | No global config |
| Per vault | ❌ | — |
| Per item | ✅ | `governance_json.usage_policy` per block |
| Per workspace | ❌ | — |
| Per user | ❌ | — |
| Per role | ⚠️ | Tier gates HS Context access |
| Per orchestrator | ❌ | — |
| Per handshake | ✅ | `policy_selections` / `effective_policy` |

### 4.4 Persistence and Enforcement

- **Persisted:** `handshakes.policy_selections` (JSON), `context_blocks.governance_json`
- **Enforced:** `filterBlocksForLocalAI`, `filterBlocksForCloudAI`, `filterBlocksForSearch`, etc. in `contextGovernance.ts`
- **Resolution:** `baselineFromHandshake` + `resolveEffectiveGovernance` + `itemAllowsUsage`

### 4.5 Distinctions (a)–(d)

| Concept | Model |
|---------|-------|
| **(a) Internal AI only** | `local_ai_allowed: true`, `cloud_ai_allowed: false` |
| **(b) External AI** | `cloud_ai_allowed: true` |
| **(c) Non-queryable / storage-only** | `searchable: false`, `local_ai_allowed: false`, `cloud_ai_allowed: false` |
| **(d) Inherited** | `policy_mode: 'inherit'`; baseline from handshake `policy_selections` |

### 4.6 Similar Concepts

- **Sensitivity:** `'public' | 'internal' | 'confidential' | 'restricted'` in governance — display/classification, not enforcement
- **Restricted:** `sensitivity: 'restricted'` exists but does not automatically set `cloud_ai_allowed: false`
- **Private visibility:** `visibility: 'private'` — vault-lock filtering, not AI policy

### 4.7 User Influence Paths

| Path | Component | Purpose |
|------|------------|---------|
| Handshake policy | `PolicyRadioGroup` in AcceptHandshakeModal, HandshakeWorkspace | `ai_processing_mode` (none/local_only/internal_and_cloud) |
| Per-item governance | `ContextItemEditor` (HandshakeContextSection) | Edit `usage_policy` per block post-ingestion |
| Per-item at attach | `HandshakeContextProfilePicker` | `policy_mode`, `policy` per profile (Phase 2) |

### 4.8 Effective AI Permission Resolution

| Location | Purpose |
|----------|---------|
| `handshake/ipc.ts` `handshake.requestContextBlocks` | Filters by `purpose` (local_ai, cloud_ai, search, etc.) |
| `main.ts` `/api/handshake/:id/context-blocks` | Same filtering |
| `main.ts` chatWithContextRag (lines 2794–2824) | `filterBlocksForCloudAI` when `isCloud` |
| `embeddings.ts` `processEmbeddingQueue` | `filterBlocksForSearch` before embedding |
| `embeddings.ts` `semanticSearch` | `filterBlocksForSearch` on results |

---

## 5. Sensitive Flag Integration Analysis

### 5.1 Best Model for Sensitive

**Recommendation:** Extend `UsagePolicy` with a `sensitive` boolean (or equivalent) that implies:
- `cloud_ai_allowed: false`
- `searchable: false` (or separate `external_ai_queryable: false`)
- Data remains in inner vault; not queryable by external AI

**Rationale:** Existing `UsagePolicy` already has `local_ai_allowed`, `cloud_ai_allowed`, `searchable`. A `sensitive` flag can be a convenience that sets these conservatively, with explicit override possible.

### 5.2 Where Sensitivity Should Live

| Option | Pros | Cons |
|--------|------|-----|
| **(a) context_blocks** | Already has governance | Applies only after ingestion |
| **(b) HS Context profile fields** | Profile-level default | Not per-document |
| **(c) hs_context_profile_documents** | Per-document | Documents only; not blocks/links |
| **(d) vault_documents** | Per-artefact | Shared table; HS docs use storage_key |
| **(e) Generic policy table** | Flexible | New schema |

**Recommended:** 
- **Per-block:** `context_blocks.governance_json` (existing) — add `sensitive` or derive from `usage_policy`
- **Per-document (HS Profile):** `hs_context_profile_documents` — add `sensitive` column for upload-time setting
- **Profile default:** `hs_context_profiles` — optional `default_sensitive` for new documents

### 5.3 Effective Policy Computation

**Current:** `baselineFromHandshake` → `resolveEffectiveGovernance` → `itemAllowsUsage(field, denyByDefault)`

**For Sensitive:**
- **Global default:** Handshake `policy_selections` (e.g. `local_only` = more restrictive)
- **Vault default:** Not present
- **Profile default:** New `hs_context_profiles.default_sensitive`
- **Per-item override:** `governance_json.usage_policy.sensitive` or `governance_json.sensitive`
- **Recipient constraints:** `effective_policy` (e.g. `allowsCloudEscalation`) — already enforced

**Inheritance:** Sensitive = explicit true wins; else inherit from profile; else from handshake baseline.

### 5.4 Parsed Text vs Original Policies

- **Parsed text:** Should inherit document's sensitivity; when document is Sensitive, extracted text is too.
- **Original artefact:** Same policy; whitelist gate applies to access, not to AI use.

### 5.5 Structured Fields and Links

- **Structured fields:** Same policy model — `governance_json` on block from profile.
- **Links:** If links become first-class items, they need `usage_policy`; otherwise treat as part of block payload.

### 5.6 Meaning of "Sensitive"

Per tooltip: *"if checked, the data will remain in the inner vault of the receiving orchestrator and must not be queryable by external AI"*

| Implication | Enforcement |
|-------------|-------------|
| Never in external AI query corpus | `filterBlocksForCloudAI` with `cloud_ai_allowed: false` |
| Still visible in structured handshake UI | Yes — visibility is separate |
| Only in receiving orchestrator inner vault | Storage/transfer — no cross-orchestrator sync of sensitive |
| Not retrievable by cross-orchestrator search | `filterBlocksForSearch` if search is federated; else N/A |
| Blocked from export/sync | `filterBlocksForExport`, `filterBlocksForPeerTransmission` |

### 5.7 Enforcement Locations

| Phase | File | Change |
|-------|------|--------|
| **(a) Handshake generation** | `ipc.ts` `resolveProfileIdsToContextBlocks` | Include `sensitive` in governance when building blocks |
| **(b) Context block resolution** | `contextGovernance.ts` `inferGovernanceFromLegacy`, `resolveEffectiveGovernance` | Interpret `sensitive` → `cloud_ai_allowed: false`, `searchable: false` |
| **(c) AI query indexing** | `embeddings.ts` `processEmbeddingQueue` | Skip embedding if Sensitive (or `searchable: false` already) |
| **(d) Orchestrator transfer** | `contextSyncEnqueue.ts`, `filterBlocksForPeerTransmission` | Exclude Sensitive from sync if policy says so |
| **(e) UI display** | `HandshakeWorkspace` BlockCard, `ContextItemEditor` | Show Sensitive badge; add checkbox + tooltip |

---

## 6. Original Access Surface

### 6.1 Code Paths Exposing/Downloading Originals

| Path | File | Method |
|------|------|--------|
| `getProfileDocumentContent` | `hsContextProfileService.ts` lines 378–402 | Decrypts, returns `{ content, filename, mimeType }` |
| Document Vault `getDocument` | `documentService.ts` | `vaultService.getDocument` |
| HTTP route | `main.ts` `POST /api/vault/document/get` | Document Vault only; **no** HS Profile route |

### 6.2 Internal Service Methods

- `getProfileDocumentContent` — called by VaultService when exposed; **no callers found** in grep.
- **Assumption:** May be used by extension or future IPC; not currently exposed via HTTP.

### 6.3 Generic Vault APIs

- Document Vault `document/get` uses `vault_documents` by id. HS Profile docs use `storage_key` = `hs_doc_<id>` — different id space; not directly accessible via Document Vault API unless id is known.

### 6.4 Signed URLs, Tokens, Streaming

- **None** for HS Profile documents.

### 6.5 Role/Policy Checks

- `requireHsContextAccess(tier, 'read')` — tier gate only
- **No** whitelist, ownership, or handshake-scoped check.

### 6.6 Insertion Points for Whitelist Gate

| Point | File | Action |
|-------|------|--------|
| Before decrypt in `getProfileDocumentContent` | `hsContextProfileService.ts` line 385 | Check whitelist; return 403 if not approved |
| New IPC/HTTP route | `main.ts` | Add route that calls whitelist service then `getProfileDocumentContent` |

### 6.7 Insertion Points for Warning Dialog

| Point | Location |
|-------|----------|
| UI before download | New component or extend `HsContextDocumentUpload` "Preview" / add "Download" button |
| Extension vault UI | Where document download is triggered |

---

## 7. External-Link Handling Analysis

### 7.1 Where Links Are Stored

| Location | Field | Example |
|----------|-------|---------|
| `ProfileFields.website` | `hsContextNormalize.ts` | `f.website` |
| Block payload | `context_blocks.payload` | JSON with `website`, `url` keys |
| Ad-hoc context | Plain text or JSON | May contain URLs |

### 7.2 Storage Format

- **Plain strings** inside `fields` JSON, `payload` text, or block content.

### 7.3 Rendering in Active Handshake UI

- **HandshakeWorkspace BlockCard:** `block.parsedContent` — `extractTextFromPayload` flattens to string; no linkification.
- **No** `<a href>` rendering of URLs in context blocks.

### 7.4 Sanitization / Validation

- **None** for handshake context links.
- `sanitizeReturnTo` exists for SSO redirects only.

### 7.5 Dangerous Protocols

- **Not prevented** in handshake context. No check for `javascript:`, `data:`, `file:`, `blob:`.

### 7.6 Insertion Points for Link Safety

| Feature | Location |
|---------|----------|
| **(a) URL validation** | Before storing in `fields`/payload; in `hsContextNormalize` or validators |
| **(b) Safe display-only** | BlockCard render — show as text, or sanitize before linkify |
| **(c) Warning dialog** | Before opening link (when linkification added) |
| **(d) Whitelist-gated open** | New `openExternalLink` flow with approval |
| **(e) Audit event** | On link open request/approval/denial |
| **(f) Sensitivity for links** | If links are queryable items, use same `usage_policy` |

---

## 8. Active Handshake Rendering Path

### 8.1 Exact Render Chain

1. **HandshakeView** (`HandshakeView.tsx`) — `selectedRecord` from `handshakes`
2. **HandshakeWorkspace** (`HandshakeWorkspace.tsx`) — receives `record`, `contextBlockCount`, `vaultStatus`
3. **Load blocks:** `window.handshakeView?.queryContextBlocks(record.handshake_id)` → `blocks` state
4. **Context Graph section** — collapsible (`contextGraphExpanded`), contains `BlockCard` per block
5. **BlockCard** — renders `blockTitle`, `parsedContent`, visibility, "Block Details"

### 8.2 Hidden/Collapsed Context Area

- **Component:** Context Graph div in `HandshakeWorkspace.tsx` (lines 612–678)
- **State:** `contextGraphExpanded` (useState)
- **Default:** `true` when `anyHasProfile` (line 451); else `false`
- **Toggle:** Click on header (lines 619–639)

### 8.3 Auto-Expansion for Structured HS Context

- **Current:** `useEffect` (lines 449–453): `setContextGraphExpanded(anyHasProfile)` when loading completes
- **anyHasProfile:** `blocks.some(b => b.hasStructuredProfile)` — `hasStructuredProfileData(payload)` checks for keys like `company`, `address`, `contact`

### 8.4 BlockCard and Structured Detection

- **BlockCard:** `HandshakeWorkspace.tsx` lines 222–393
- **Structured detection:** `hasStructuredProfileData` (lines 104–117) — `PROFILE_KEY_PATTERNS` includes `company`, `legal`, `address`, `contact`, `website`, `tax_id`, etc.
- **Format:** `formatStructuredProfileCompact` for preview

### 8.5 Best Insertion Point for Structured Business Context Panel

- **Option A:** Replace or augment the generic Context Graph when `vault_profile` blocks exist — add a "Publisher Context" sub-section
- **Option B:** New section between Context Graph and BEAP Messages — "Structured Business Context" when blocks have structured profile data
- **Option C:** Extend BlockCard to render `ProfileFields` in a structured layout when `block.type === 'vault_profile'`

**File:** `HandshakeWorkspace.tsx` — insert after line 678 (Context Graph closing div) or inside the Context Graph when expanded.

### 8.6 Reusable Components

| Component | File | Use |
|-----------|------|-----|
| `StateBadge` | HandshakeWorkspace | Status |
| `MetaRow`, `CopyableHash` | HandshakeWorkspace | Key-value |
| `InlineFilterChip` | HandshakeWorkspace | Filters |
| `PolicyRadioGroup` | PolicyRadioGroup.tsx | AI policy |
| `VaultStatusIndicator` | VaultStatusIndicator.tsx | Vault state |
| `ContextItemEditor` | ContextItemEditor.tsx | Per-item governance (drawer) |

---

## 9. Vault UI and Form Policy Analysis

### 9.1 Current Vault Create/Edit UI

| Item Type | UI | File |
|-----------|-----|------|
| Legacy handshake_context | `renderHandshakeContextDialog` | `vault-ui-typescript.ts` lines 1951–2176 |
| HS Context Profile | Electron/extension profile form | `createProfile`, `updateProfile`; extension uses `HsContextDocumentUpload`, profile edit UI |
| HS Profile document | `HsContextDocumentUpload` | `extension-chromium/src/vault/hsContext/HsContextDocumentUpload.tsx` |

### 9.2 Checkbox/Toggle/Tooltip Patterns

- **PolicyRadioGroup:** Radio for AI mode; description under each option
- **ContextItemEditor:** Checkboxes for usage policy (Searchable, Local AI, Cloud AI, etc.)
- **renderHandshakeContextDialog:** Checkboxes for `safe_to_share`, `step_up_required` with inline labels
- **Tooltip:** No standard tooltip component found; `title` attribute used ad-hoc

### 9.3 AI-Use Defaults in UI

- **PolicyRadioGroup:** "Default policy for newly attached context" — `ai_processing_mode`
- **ContextItemEditor:** Per-item checkboxes (post-attach)

### 9.4 Where Sensitive Checkbox Should Appear

| Item Type | Location |
|-----------|----------|
| **(a) Information blocks** | Per-block in ContextItemEditor; or at attach in ad-hoc form |
| **(b) PDFs/documents** | `HsContextDocumentUpload` — per-document row; or in profile document list |
| **(c) Custom context documents** | Same as (b) if custom docs use same pipeline |
| **(d) Links** | If links become items — per-link in form |

### 9.5 Form Model Support

- **Legacy handshake_context:** Free-form `payload` textarea; no schema
- **HS Context Profiles:** `fields` (JSON), `custom_fields` (JSON) — optional; no strict validation
- **Per-item policy:** `ContextItemEditor` supports `usage_policy`; can add `sensitive` checkbox

---

## 10. Schema Typing Opportunities

### 10.1 Current Untyped Structures

| Structure | Location | Type |
|-----------|----------|------|
| Block `content`/`payload` | `context_blocks`, `context_store` | string (JSON or plain) |
| `ProfileFields` | `hs_context_profiles.fields` | JSON object |
| `custom_fields` | `hs_context_profiles.custom_fields` | JSON array |
| Block `type` | `context_blocks.type` | string (no enum) |
| `governance_json` | `context_blocks` | JSON object |

### 10.2 Lowest-Blast-Radius Typing

| Target | File | Approach |
|--------|------|----------|
| `ProfileFields` | `hsContextNormalize.ts` | Already typed; add runtime validation |
| Block governance | `contextGovernance.ts` | `ContextItemGovernance` exists; add `sensitive` |
| `UsagePolicy` | `contextGovernance.ts` | Add `sensitive?: boolean` |

### 10.3 Field Categories for Typing

| Category | Current | Typing |
|----------|---------|--------|
| Company/business identity | `ProfileFields` | Extend interface |
| Contact fields | `ContactEntry[]` | Exists |
| Identifiers/tax | `vatNumber`, etc. | Exists |
| Opening hours | `OpeningHoursEntry[]` | Exists |
| Links | `website` string | Add URL validator |
| Document descriptors | `ProfileDocumentSummary` | Exists |
| Parsed text records | `extracted_text` | Add validation wrapper |
| Original references | `storage_key` | Opaque |
| AI-use/sensitivity | `UsagePolicy` | Add `sensitive` |

### 10.4 Existing Validators

- **zod/io-ts:** Not found in shared packages
- **Custom:** `computeBlockHash`, `verifyContextCommitment` — hash validation only
- **Reuse:** Can add zod schemas for `ProfileFields`, `UsagePolicy` in shared package

---

## 11. Parser-Related and Policy-Related Security Risks

| Risk | Location | Status |
|------|----------|--------|
| File upload abuse | `uploadProfileDocument` — no BLOCKED_EXTENSIONS | HS Profile bypasses documentService blocklist |
| Parser abuse / zip bombs | `extractTextFromPdf` — no size limit on output | Large PDF → unbounded memory |
| Huge PDFs | Extension 50MB; backend none | Backend could accept larger |
| Malformed PDFs | pdfjs may throw | Caught; `markDocumentExtractionFailed` |
| OCR CPU exhaustion | `extractTextOcr` — no timeout | Long-running OCR possible |
| Embedded link leakage | Extracted text may contain URLs | No stripping |
| Hidden/invisible text | pdfjs extracts all text | Could include hidden content |
| Prompt injection in extracted text | No validation | Could reach LLM |
| Stored XSS | Rendered in `<pre>` / text | Low if no HTML render |
| SSRF from links | No link handling | N/A until links are opened |
| Policy bypass (Sensitive → external) | `filterBlocksForCloudAI` | Correct if `cloud_ai_allowed` set |
| Inheritance bugs | `itemAllowsUsage` denyByDefault | `filterBlocksForCloudAI` uses `true` (deny missing) |
| Host-environment rendering | No iframe/object | Low |
| Missing audit | Upload, parse, download | No audit for HS Profile docs |

---

## 12. Audit and Observability

### 12.1 Current Logging

| Event | Logged | Location |
|-------|--------|----------|
| Upload | `console.log` in documentService; **none** for HS Profile | — |
| Parse start | `console.log` | `hsContextOcrJob.ts` line 225 |
| Parse success | `console.log` | `hsContextOcrJob.ts` line 237 |
| Parse failure | `console.error` | `hsContextOcrJob.ts` line 239 |
| Document read | **None** | — |
| Document download | **None** | — |
| AI-policy decisions | **None** | — |
| Tool authorization | `insertAuditLogEntry` | `authorizeToolInvocation.ts` |

### 12.2 Audit Systems

- **audit_log** table: `handshake/db.ts` — `insertAuditLogEntry`
- **ingestion_audit_log:** Ingestion pipeline
- **Extension:** `auditLog` in hardening.ts — separate from Electron

### 12.3 Best Insertion Points for New Audit Events

| Event | Location |
|-------|----------|
| Document uploaded | `uploadProfileDocument` after INSERT |
| Parse started | `runExtractionJob` start |
| Parse succeeded | `markDocumentExtractionSuccess` |
| Parse failed | `markDocumentExtractionFailed` |
| Extracted text validated | After new validation step |
| Original access requested | Before `getProfileDocumentContent` |
| Original access approved/denied | In whitelist service |
| External link open requested | New link handler |
| External link open approved/denied | New link handler |
| Sensitive flag set/unset | On governance update |
| AI-use effective policy resolved | In `resolveEffectiveGovernance` (optional) |
| Sensitive item excluded from external AI | In `filterBlocksForCloudAI` (optional) |

---

## 13. Follow-up Implementation Anchors

### 13.1 Files Likely to Change First

- `packages/shared/src/handshake/contextGovernance.ts` — add `sensitive` to UsagePolicy
- `electron/main/handshake/contextGovernance.ts` — interpret `sensitive` in filters
- `electron/main/vault/hsContextProfileService.ts` — validation, optional `sensitive` on documents
- `electron/main/vault/hsContextOcrJob.ts` — validation before `markDocumentExtractionSuccess`
- `apps/electron-vite-project/src/components/HandshakeWorkspace.tsx` — structured panel, Sensitive badge
- `apps/electron-vite-project/src/components/ContextItemEditor.tsx` — Sensitive checkbox + tooltip
- `apps/extension-chromium/src/vault/hsContext/HsContextDocumentUpload.tsx` — Sensitive checkbox per document

### 13.2 Backend Entry Points

- `uploadProfileDocument` — add MIME validation, BLOCKED_EXTENSIONS, size limit
- `runExtractionJob` — add validation step
- `resolveProfileIdsToContextBlocks` — include `sensitive` in governance
- `getProfileDocumentContent` — whitelist gate
- `filterBlocksForCloudAI`, `filterBlocksForSearch` — ensure `sensitive` implies deny

### 13.3 Frontend Entry Points

- `HandshakeWorkspace` — Context Graph, BlockCard
- `ContextItemEditor` — add Sensitive checkbox
- `HsContextDocumentUpload` — add Sensitive checkbox per document
- `HandshakeContextProfilePicker` — per-profile Sensitive (optional)
- `PolicyRadioGroup` — tooltip for "Sensitive" meaning (optional)

### 13.4 Jobs/Services to Extend

- `runExtractionJob` — validation
- `processEmbeddingQueue` — respect `searchable: false` for Sensitive (already via governance)
- New: `artefactWhitelistService` for original access

### 13.5 Validators/Schemas to Add

- Extracted text validator (length, charset, dangerous patterns)
- `ProfileFields` runtime validator (zod or custom)
- URL validator for `website` and link fields

### 13.6 Routes/Actions to Add

- `POST /api/vault/hs-profile-document/get` — whitelist-gated original download
- Optional: `POST /api/vault/hs-profile-document/request-access` — whitelist approval flow

### 13.7 Tables/Columns for Migration

- `hs_context_profile_documents` — add `sensitive INTEGER DEFAULT 0`
- `hs_context_profiles` — add `default_sensitive INTEGER DEFAULT 0` (optional)
- New: `artefact_access_whitelist` (optional)
- `context_blocks` / `context_store` — `governance_json` already supports new fields

### 13.8 Feature Flags / Policy Hooks

- `ENABLE_SENSITIVE_POLICY` — gate new Sensitive checkbox and enforcement
- `ENABLE_EXTRACTED_TEXT_VALIDATION` — gate validation in runExtractionJob
- `ENABLE_ORIGINAL_WHITELIST` — gate whitelist before getProfileDocumentContent

### 13.9 Effective AI-Use Resolution Enforcement

- `contextGovernance.ts` — `itemAllowsUsage` for `cloud_ai_allowed`, `searchable`
- `filterBlocksForCloudAI` — when `sensitive` or `cloud_ai_allowed: false` → exclude
- `embeddings.ts` — `filterBlocksForSearch` before embedding (already)
- `main.ts` chatWithContextRag — `filterBlocksForCloudAI` (already)

### 13.10 Sensitive Tooltip and Checkbox Wiring

- **Tooltip text:** "If checked, the data will remain in the inner vault of the receiving orchestrator and must not be queryable by external AI."
- **Checkbox state:** Bound to `usage_policy.sensitive` or `governance.sensitive`
- **UI locations:** ContextItemEditor (per block), HsContextDocumentUpload (per document), optionally at profile level

---

## Ready for Implementation Prompt

### Confirmed Findings

- HS Profile extraction uses `hsContextOcrJob` only; no backend MIME validation; no extracted-text validation.
- AI policy model: `UsagePolicy` with `local_ai_allowed`, `cloud_ai_allowed`, `searchable`; `filterBlocksForCloudAI` enforces at query time.
- `getProfileDocumentContent` exists but has no HTTP route and no whitelist.
- Links in context are plain strings; no sanitization or warning flow.
- HandshakeWorkspace is the active render path; Context Graph is collapsible; BlockCard renders blocks.
- ContextItemEditor has checkboxes for usage policy; can add Sensitive.
- `governance_json` on blocks supports new fields without schema migration.

### Assumptions

- `getProfileDocumentContent` is not currently exposed via HTTP; callers may exist in paths not searched.
- "Inner vault of receiving orchestrator" implies no cross-orchestrator sync of sensitive data; current sync logic may need clarification.
- Extension HS Profile form structure (create/edit) may differ from legacy `renderHandshakeContextDialog`; Electron-specific UI not fully traced.

### Unknowns

- Exact Electron HS Profile create/edit UI flow (which components, which routes).
- Whether `getProfileDocumentContent` is ever called and from where.
- Full list of extension API endpoints for HS Profile document operations.
- Whether `transmit_to_peer_allowed` should be false for Sensitive (tooltip says "remain in inner vault" — may imply no peer transmission).

### Summary for Next Implementation Prompt

Include: this report; HS_CONTEXT_REFACTOR_ANALYSIS_REPORT.md; specific files in Section 13; the tooltip text; and the requirement that Sensitive be an enforcement policy (not display-only). Specify whether Sensitive should also set `transmit_to_peer_allowed: false` and `export_allowed: false`.

---

*End of report. No code proposed.*
