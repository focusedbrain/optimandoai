# HS Context Refactor — Technical Analysis Report

**Purpose:** Code analysis only. No implementation proposals.  
**Goal:** Provide precise technical findings for follow-up implementation prompts.

---

## 1. Current HS Context Architecture

### 1.1 Relevant Models/Entities

| Entity | Location | Description |
|--------|----------|-------------|
| `ContextBlockForCommitment` | `handshake/contextCommitment.ts` | Block with `block_id`, `block_hash`, `type`, `content`, optional `scope_id` |
| `ContextBlock` | `handshake/types.ts` (lines 363–378) | Persisted block: `payload_ref`, `source`, `embedding_status`, `visibility`, `governance` |
| `ContextBlockInput` | `handshake/types.ts` (lines 244–257) | Input shape with `payload`, `visibility` |
| `VerifiedContextBlock` | `contextEscaping.ts` | UI-facing block with `payload_ref`, `governance`, `source` |
| `HsContextProfile` | `vault/hsContextNormalize.ts` | Profile with `fields` (ProfileFields), `custom_fields` |
| `ProfileFields` | `vault/hsContextNormalize.ts` (lines 19–46) | Typed: `legalCompanyName`, `vatNumber`, `contacts`, `openingHours`, etc. |
| `HsContextProfileRow` | `vault/hsContextProfileService.ts` | DB row: `fields`, `custom_fields` as JSON strings |
| `HsContextProfileDocumentRow` | `vault/hsContextProfileService.ts` | Document row: `extracted_text`, `storage_key`, `extraction_status` |

### 1.2 DB Schema/Tables

| Table | File | Purpose |
|-------|------|---------|
| `context_blocks` | `handshake/db.ts` (migration v1) | Persisted blocks: `payload`, `type`, `data_classification`, `visibility`, `governance_json` |
| `context_store` | `handshake/db.ts` (migration v3) | 3-phase delivery: `content`, `status` (`pending`/`pending_delivery`/`delivered`/`received`) |
| `hs_context_profiles` | `vault/db.ts` (migrateHsContextProfileTables) | Profile metadata: `fields`, `custom_fields` (JSON) |
| `hs_context_profile_documents` | `vault/db.ts` | Document metadata: `storage_key`, `extracted_text`, `extraction_status` |
| `vault_documents` | `vault/db.ts` | Encrypted blobs; HS docs use `storage_key` = `hs_doc_<docId>` |
| `vault_items` | vault schema | Legacy `handshake_context` items with `meta.binding_policy` |

### 1.3 API Endpoints

| Endpoint | File | Purpose |
|----------|------|---------|
| IPC `handshake:initiate` | `main.ts` → `handleHandshakeRPC` | Accepts `context_blocks`, `message`, `profile_ids` |
| IPC `handshake:accept` | `main.ts` → `handleHandshakeRPC` | Accepts `context_blocks`, `profile_ids`, `profile_items` |
| IPC `handshake:queryContextBlocks` | `main.ts` | Returns blocks for handshake |
| IPC `handshake:contextBlockCount` | `main.ts` | Returns block count |
| IPC `handshake:updateContextItemGovernance` | via `handshakeView` | Updates governance per block |
| POST `/api/vault/item/meta/get` | `main.ts` (6138+) | Binding policy for handshake_context items |
| POST `/api/vault/item/meta/set` | `main.ts` | Set binding policy |
| POST `/api/vault/handshake/evaluate` | `main.ts` | `evaluateAttach` for context attachment |
| POST `/api/vault/document/get` | `main.ts` | Decrypt + return document (Pro+ Document Vault) |

**Note:** No dedicated HTTP route for HS Profile document download. `getProfileDocumentContent` exists in `hsContextProfileService.ts` but is not exposed via HTTP in the reviewed code.

### 1.4 Services

| Service | File | Responsibility |
|---------|------|----------------|
| `handleHandshakeRPC` | `handshake/ipc.ts` | Orchestrates initiate/accept/refresh, calls `buildContextBlocksFromParams`, `resolveProfileIdsToContextBlocks` |
| `hsContextProfileService` | `vault/hsContextProfileService.ts` | Profile CRUD, `uploadProfileDocument`, `getProfileDocumentContent`, `resolveProfilesForHandshake` |
| `tryEnqueueContextSync` | `handshake/contextSyncEnqueue.ts` | Builds context_sync capsule from `context_store` |
| `ingestContextBlocks` | `handshake/contextIngestion.ts` | Verifies commitment, persists to `context_blocks` |
| `queryContextBlocks` / `queryContextBlocksWithGovernance` | `handshake/contextBlocks.ts` | Reads blocks with visibility filter |
| `VaultService` | `vault/service.ts` | `listHsProfiles`, `uploadHsProfileDocument`, `resolveHsProfilesForHandshake` |

### 1.5 Validators

| Validator | Location | Scope |
|-----------|----------|-------|
| Block hash | `buildContextBlocksFromParams` (ipc.ts) | `computeBlockHash(content) === block_hash` |
| Commitment | `ingestContextBlocks` | Commitment matches block hashes |
| Block count | `MAX_BLOCKS_PER_CAPSULE` (64) | ipc.ts |
| Message size | `MAX_MESSAGE_BYTES` (32KB) | ipc.ts |
| Tier | `requireHsContextAccess` (hsContextProfileService) | `canAccessRecordType(tier, 'handshake_context', action)` |
| `canAttachContext` | `vaultCapabilities.ts` | Domain glob, `valid_until`, `safe_to_share` |

**Missing:** No schema validation for `ProfileFields`, `custom_fields`, or block `content` structure. No MIME validation for HS Profile document upload beyond PDF check in extension UI.

### 1.6 Serializers/DTOs

| DTO | Location | Notes |
|-----|----------|-------|
| `ContextBlockForCommitment` | `contextCommitment.ts` | `content` is string or object; hashed via `computeBlockHash` |
| `resolveProfileIdsToContextBlocks` output | `ipc.ts` (166–168) | JSON: `{ profile: {...}, documents: [{ filename, extracted_text }] }` |
| `VerifiedContextBlock` | `contextEscaping.ts` | `payload_ref` (string), `governance` |
| `ProfileFields` | `hsContextNormalize.ts` | Typed interface; stored as JSON in DB |

**Generic/untyped:** Block `content` and `payload` are untyped. `type` is a string (`plaintext`, `vault_profile`, etc.) but payload structure is not validated.

### 1.7 UI Components/Forms

| Component | File | Role |
|-----------|------|------|
| `HandshakeWorkspace` | `HandshakeWorkspace.tsx` | Main handshake view: Context Graph (collapsible), BEAP Messages, modals |
| `HandshakeContextSection` | `HandshakeContextSection.tsx` | **Not currently used** in HandshakeView; documented for RelationshipDetail |
| `AcceptHandshakeModal` | `AcceptHandshakeModal.tsx` | Accept flow: Vault Profiles + Ad-hoc tabs, `HandshakeContextProfilePicker` |
| `HandshakeContextProfilePicker` | extension `HandshakeContextProfilePicker.tsx` | Profile selection for accept |
| `ContextItemEditor` | `ContextItemEditor.tsx` | Per-block governance edit (used by HandshakeContextSection) |
| `RelationshipDetail` | `RelationshipDetail.tsx` | **Not imported anywhere**; contains HandshakeContextSection, Proof Chain, Technical Details |
| `HsContextDocumentUpload` | extension `HsContextDocumentUpload.tsx` | PDF upload in profile; shows `extracted_text` snippet |
| `PolicyRadioGroup` | `PolicyRadioGroup.tsx` | AI policy (local/cloud) |

### 1.8 Handshake Rendering Path

1. **HandshakeView** → `HandshakeWorkspace` (when handshake selected)
2. **HandshakeWorkspace** loads blocks via `window.handshakeView?.queryContextBlocks(handshake_id)`
3. Blocks mapped to `ContextBlockWithVisibility` (payload, parsedContent, isStructured, hasStructuredProfile)
4. **Context Graph** section: collapsible (`contextGraphExpanded`), filter chips (All/Public/Private, Sent/Received, Structured/Unstructured)
5. **BlockCard** renders each block: title, payload preview, visibility toggle, "Block Details" expand
6. **No** HandshakeContextSection or RelationshipDetail in the active render path

### 1.9 Permission Model / Role Checks

| Check | Location | Publisher vs Pro |
|-------|----------|------------------|
| `RECORD_TYPE_MIN_TIER['handshake_context']` | `vaultCapabilities.ts` | `publisher` |
| `canAccessRecordType(tier, 'handshake_context', 'share')` | `vaultCapabilities.ts`, `canAttachContext` | Publisher+ required |
| `resolveProfileIdsToContextBlocks` | `ipc.ts` (154–158) | `tier === 'free'` → return `[]`; else `enterprise`/`publisher`/`publisher_lifetime` |
| `requireHsContextAccess` | `hsContextProfileService.ts` | Throws if tier cannot access `handshake_context` |
| `AcceptHandshakeModal` `canUseHsContextProfiles` | `HandshakeView.tsx` (555) | **Hardcoded `true`** — no tier check in UI |
| Vault unlock | `main.ts` accept pre-check | Accept blocked if vault locked |

---

## 2. Current Context Data Flow

### 2.1 Create Flow (Initiator)

1. Client: `HandshakeInitiateModal` or buildForDownload → `context_blocks`, `message`, `profile_ids`
2. IPC `handshake:initiate` → `handleHandshakeRPC`
3. `buildContextBlocksFromParams(rawBlocks, rawMessage)` → blocks
4. `resolveProfileIdsToContextBlocks(profileIds, session, handshakeId)` → vault_profile blocks (Publisher+)
5. `buildInitiateCapsuleWithContent()` → capsule with `context_blocks`, `context_commitment`
6. `persistInitiatorHandshakeRecord()` → `context_store` (status `pending_delivery`)

### 2.2 Create Flow (Acceptor)

1. Client: `AcceptHandshakeModal` → `profile_ids` (HandshakeContextProfilePicker), ad-hoc text/JSON
2. `buildContextBlocks()` (client) → ad-hoc blocks with `computeBlockHashClient`
3. IPC `handshake:accept` with `context_blocks`, `profile_ids`
4. Server: `resolveProfileIdsToContextBlocks(receiverProfileIds, ...)` → loads profile + documents (including `extracted_text`)
5. Merge initiator blocks + receiver blocks → `acceptContextBlocks`
6. `insertContextStoreEntry()` for each block
7. `tryEnqueueContextSync()` → context_sync capsule

### 2.3 Storage Flow

- **context_store:** Holds `content` (full payload) during delivery lifecycle
- **context_blocks:** Ingested after commitment verification; holds `payload` (same as content)
- **Ledger vs Vault:** `getHandshakeDb()` returns Ledger first, then Vault. Handshake tables can live in either.

### 2.4 Render Flow

1. `queryContextBlocks` / `queryContextBlocksWithGovernance` → blocks from `context_blocks`
2. Visibility filter: `visibilityWhereClause` — private blocks hidden when vault locked
3. Blocks passed to HandshakeWorkspace → BlockCard
4. `extractTextFromPayload(payload)` — tries JSON parse, falls back to string
5. `hasStructuredProfileData(payload)` — checks for keys like `company`, `address`, `contact`

### 2.5 Generic/Untyped Data Touch Points

| Location | Data | Typing |
|----------|------|--------|
| `buildContextBlocksFromParams` | `b.content` | Any; only hash validated |
| `resolveProfileIdsToContextBlocks` | `content` = `JSON.stringify({ profile, documents })` | Ad-hoc JSON |
| `context_store.content` | TEXT | Unvalidated |
| `context_blocks.payload` | TEXT | Unvalidated |
| `queryContextBlocks` output | `payload_ref` | String, structure unknown |
| Block `type` | `plaintext`, `vault_profile`, etc. | No enum; free-form string |

### 2.6 Normal Context vs HS Context Overlap

- **Normal context:** Ad-hoc blocks (plaintext/JSON) from initiate/accept; `buildContextBlocksFromParams`
- **HS Context:** `vault_profile` blocks from `resolveProfileIdsToContextBlocks`; same pipeline thereafter
- **Overlap:** Both end up in `context_store` → `context_blocks`; same rendering path; no distinction in UI
- **Divergence:** HS Profiles live in `hs_context_profiles`; tier-gated; documents have `extracted_text`. Legacy `handshake_context` vault items (binding policy) are a separate system.

---

## 3. Existing Document Handling

### 3.1 Upload Pipeline

| Step | Location | Notes |
|------|----------|-------|
| UI | `HsContextDocumentUpload.tsx` | PDF only, 50MB limit, `uploadHsProfileDocument(profileId, file)` |
| API | `vault/service.ts` → `uploadProfileDocument` | `hsContextProfileService.uploadProfileDocument` |
| Encrypt | `hsContextProfileService.ts` (331–335) | `sealRecord(pdfBase64, kek, aad)` |
| Store | `vault_documents` table | `storage_key` = `hs_doc_<docId>` |
| Metadata | `hs_context_profile_documents` | `extraction_status: 'pending'` |
| Extract | `setImmediate(() => runExtractionJob(db, docId, content))` | Async, fire-and-forget |

### 3.2 Storage Mechanism

- **vault_documents:** `wrapped_dek`, `ciphertext` (BLOB); per-document envelope encryption
- **hs_context_profile_documents:** `storage_key` → `vault_documents.id`
- DB: SQLCipher (vault DB encrypted at rest)

### 3.3 Encryption Usage

- `sealRecord` / `openRecord` from `envelope.ts`
- AAD: `Buffer.from(\`hsdoc:${docId}\`)`
- Same pattern as Document Vault

### 3.4 Parser Integration Points

| Parser | File | Usage |
|--------|------|-------|
| `runExtractionJob` | `hsContextOcrJob.ts` | Called after upload |
| `extractTextFromPdf` | `hsContextOcrJob.ts` | pdfjs-dist direct text → OCR fallback (Tesseract) |
| `markDocumentExtractionSuccess` | `hsContextOcrJob.ts` | Writes `extracted_text` to `hs_context_profile_documents` |

### 3.5 MIME/File Validation

- **Extension UI:** `file.type !== 'application/pdf'` (HsContextDocumentUpload)
- **Backend:** No explicit MIME check in `uploadProfileDocument`; accepts `mimeType` param as-is
- **documentService (Document Vault):** `BLOCKED_EXTENSIONS`, `detectMimeType` from extension — not used for HS Profile docs

### 3.6 Text Extraction Flow

1. Upload → `runExtractionJob(db, docId, content)`
2. `extractTextFromPdf(pdfBuffer)` → `{ success, extracted_text, extractor_name }`
3. `markDocumentExtractionSuccess` or `markDocumentExtractionFailed`
4. `extracted_text` stored in `hs_context_profile_documents` (plain column in vault DB)
5. `resolveProfilesForHandshake` → `documents.map(d => ({ filename, extracted_text }))` → included in `vault_profile` block content

### 3.7 PDF/Plain-Text Conversion Logic

- **hsContextOcrJob:** pdfjs-dist `getTextContent()`; fallback to page render → Tesseract OCR
- **email/pdf-extractor:** Separate module; basic heuristics; not used for HS Profiles
- **main.ts PDF parser API:** `/api/...` for attachment extraction; separate from HS Context

### 3.8 Direct Rendering or Download Paths

| Path | Location | Access Control |
|------|----------|----------------|
| `getProfileDocumentContent` | `hsContextProfileService.ts` | Tier + `requireHsContextAccess`; decrypts and returns Buffer |
| **No HTTP route** for HS Profile document download in main.ts | — | — |
| Document Vault `POST /api/vault/document/get` | `main.ts` | Pro+ tier; returns base64 |
| Extension `downloadDocument` | `vault-ui-typescript.ts` | Document Vault, not HS Profile |

**Assumption:** HS Profile document download may be via extension-only path or not yet exposed. `getProfileDocumentContent` exists but no IPC/HTTP found in search.

---

## 4. Existing Link Handling

### 4.1 Where External Links Are Stored/Rendered

- **ProfileFields:** `website` in `hsContextNormalize.ts`; stored as string in `fields` JSON
- **Block payload:** Can contain URLs in plaintext or JSON (e.g. `website`, `url` keys)
- **HandshakeWorkspace BlockCard:** Renders `block.parsedContent` as text; no special link handling
- **HandshakeContextSection:** Renders `payload_ref` in `<pre>`; no linkification

### 4.2 Allowlist/Blocklist/Sanitization

| Module | Purpose | Scope |
|--------|---------|-------|
| `sanitizeReturnTo` | Redirect URL sanitizer | SSO returnTo; not handshake context |
| `overlayProtection.ts` (wrguard) | Blocks external links in overlay | Content script; not handshake |
| **None** for handshake context links | — | — |

### 4.3 Links Opened Inside App

- No evidence of links in handshake context being opened in-app
- `sanitizeReturnTo` rejects `javascript:`, `file:`, etc. for redirects only
- **Conclusion:** No link warning/whitelist flow for handshake context URLs

---

## 5. Security-Sensitive Areas

### 5.1 Raw Artefacts / Unvalidated Payloads to UI

| Risk | Location | Notes |
|------|----------|-------|
| Block `payload_ref` | `HandshakeWorkspace`, `HandshakeContextSection` | Rendered as text; XML-escaped for LLM (`contextEscaping`) but not for DOM |
| `extracted_text` | In `vault_profile` block content | Included in handshake; could contain malicious content if extraction compromised |
| JSON payload | `extractTextFromPayload`, `hasStructuredProfileData` | `JSON.parse` without schema validation; prototype pollution possible |

### 5.2 Originals Download/Open Paths

| Path | Gating | Risk |
|------|--------|------|
| `getProfileDocumentContent` | Tier + vault unlock | Returns decrypted PDF; no whitelist |
| Document Vault `document/get` | Tier | Same; no whitelist |
| **No whitelist flow** for original access | — | — |

### 5.3 Missing or Weak Role Checks

| Location | Issue |
|----------|-------|
| `AcceptHandshakeModal` `canUseHsContextProfiles={true}` | Hardcoded; no tier check |
| `resolveProfileIdsToContextBlocks` | Tier check via `session.canonical_tier` / `session.plan`; `publisher_lifetime` may be missing from union |
| Initiate with context when Ledger available, vault locked | Proceeds without vault unlock (HANDSHAKE_CONTEXT_ARCHITECTURE_ANALYSIS.md) |

### 5.4 Audit Logging

| Area | Present | Location |
|------|---------|----------|
| Handshake pipeline denial/success | Yes | `audit_log` table, `buildSuccessAuditEntry`, `buildDenialAuditEntry` |
| Context block ingestion | Via pipeline | `enforcement.ts` |
| HS Profile document upload | No | — |
| HS Profile document download | No | — |
| Context attachment (accept) | No dedicated | — |

### 5.5 Host-Environment Rendering Risks

- Block content rendered in React as text; no `dangerouslySetInnerHTML` for context blocks in reviewed code
- `prepareContextForLLM` uses `escapeXml`; safe for LLM prompt
- **Assumption:** No iframe or object embedding of context content

---

## 6. UI Surface Analysis

### 6.1 HS Context Creation/Edit Form

- **Accept flow:** `AcceptHandshakeModal` — Vault tab (HandshakeContextProfilePicker) + Ad-hoc tab (text/JSON)
- **Profile creation:** Extension vault UI (`renderHandshakeContextDialog` in vault-ui-typescript.ts) or Electron HS Profile routes
- **Profile edit:** Same; `CreateProfileInput` / `UpdateProfileInput` with `fields`, `custom_fields`
- **No structured form** for company info, tax numbers, contacts, etc.; `fields` is free-form JSON

### 6.2 Handshake Dashboard Context Section

- **HandshakeWorkspace** "Context Graph" — collapsible section
- **Default state:** `contextGraphExpanded` set to `true` when `anyHasProfile` (blocks with structured profile data)
- **Otherwise:** Collapsed by default
- **No** "structured business context panel" — blocks shown as generic cards

### 6.3 Collapsed/Expanded Behavior

| Component | State | Trigger |
|-----------|-------|---------|
| Context Graph | `contextGraphExpanded` | Click header; auto-expand if any block has `hasStructuredProfile` |
| BlockCard unstructured | `unstructuredExpanded` | "▸ Show content" / "▾ Hide content" |
| BlockCard read more | `readMore` | "Read more" / "Show less" |
| Cryptographic Proof Chain | `showProofChain` | RelationshipDetail (unused) |
| Technical Details | `showTechnical` | RelationshipDetail (unused) |

### 6.4 Best Insertion Points for Structured Business Context Panel

1. **HandshakeWorkspace** — Replace or augment the generic Context Graph when handshake selected and blocks include `vault_profile` or structured data
2. **New section** between Context Graph and BEAP Messages — "Publisher Context" when user is Publisher+ and blocks have structured profile
3. **BlockCard** — Extend to render `ProfileFields`-like data in a structured layout (company, contacts, opening hours, etc.) when `hasStructuredProfile` is true

### 6.5 Reusable UI Primitives

| Component | File | Reuse |
|-----------|------|-------|
| `StateBadge` | HandshakeWorkspace, RelationshipDetail | Status styling |
| `MetaRow`, `CopyableHash` | RelationshipDetail, HandshakeWorkspace | Key-value display |
| `InlineFilterChip` | HandshakeWorkspace | Filter chips |
| `PolicyRadioGroup` | Multiple | AI policy |
| `VaultStatusIndicator` | Multiple | Vault lock state |
| `ContextItemEditor` | HandshakeContextSection | Governance edit |

---

## 7. Suggested Refactor Boundaries

### 7.1 Modules to Leave Untouched (Minimal Changes)

- `handshake/contextCommitment.ts` — Hash/commitment logic
- `handshake/capsuleBuilder.ts` — Capsule structure
- `handshake/contextSyncEnqueue.ts` — P2P sync
- `handshake/enforcement.ts` — Pipeline authorization
- `packages/shared/src/vault/vaultCapabilities.ts` — Tier constants, `canAttachContext`
- `contextEscaping.ts` — LLM safety

### 7.2 Best Seams for Introducing New Behavior

| Feature | Seam | Files |
|---------|------|-------|
| **(a) Typed HS Context schema** | New schema types + validation layer | `packages/shared` or `handshake/types.ts`; validator in `ipc.ts` or new `contextSchema.ts` |
| **(b) Parsed document records** | Extend `hs_context_profile_documents` or add `parsed_document` table | `vault/db.ts`, `hsContextProfileService.ts` |
| **(c) Encrypted original artefact records** | Already exist in `vault_documents`; add explicit artefact metadata table if needed | `vault/db.ts`, `hsContextProfileService.ts` |
| **(d) Whitelist-gated original access** | New service + IPC/HTTP route | New `handshake/artefactAccess.ts`; `main.ts` route; gate `getProfileDocumentContent` |
| **(e) Link warning/whitelist flow** | New component + store | New `LinkWarningModal`; URL allowlist table or config; integrate in block render |
| **(f) Expanded structured handshake context UI** | HandshakeWorkspace or new panel | `HandshakeWorkspace.tsx`; optionally `RelationshipDetail.tsx` if revived |

### 7.3 File-Level Recommendations

| Change | Primary File(s) |
|--------|-----------------|
| Typed schema for blocks | `handshake/types.ts`, new `handshake/contextSchema.ts` |
| ProfileFields validation | `hsContextNormalize.ts`, new validators |
| Document representation | `hsContextProfileService.ts`, `resolveProfilesForHandshake` |
| Whitelist for originals | New `vault/artefactWhitelist.ts`, `main.ts` |
| Link whitelist | New `security/linkWhitelist.ts`, block render path |
| Structured context panel | `HandshakeWorkspace.tsx`, new `StructuredContextPanel.tsx` |

---

## 8. Migration Risk Assessment

### 8.1 Breaking Changes

| Risk | Description |
|------|-------------|
| Block `type` / payload shape | Adding strict schema may reject existing `vault_profile` or ad-hoc blocks |
| `context_store` / `context_blocks` | New columns (e.g. `schema_version`) could require backfill |
| `hs_context_profiles.fields` | Validation may fail for existing free-form JSON |

### 8.2 Schema Migration Risks

| Table | Risk |
|-------|------|
| `context_blocks` | Additive migrations generally safe; new CHECK constraints could fail on existing rows |
| `hs_context_profile_documents` | Add columns for `parsed_*` if needed |
| New `artefact_whitelist` or similar | Clean add |

### 8.3 API Compatibility

| Area | Risk |
|------|------|
| `handshake:initiate` / `accept` | New required fields would break older clients |
| `queryContextBlocks` response | Adding fields is backward compatible |
| `resolveProfileIdsToContextBlocks` output | Changing JSON shape breaks commitment hash |

### 8.4 Rendering Regressions

| Risk | Mitigation |
|------|------------|
| BlockCard layout change | Feature-flag or gradual rollout |
| New structured panel hides old blocks | Show both; or migrate blocks to new format |
| RelationshipDetail vs HandshakeWorkspace | RelationshipDetail unused; no regression if not wired |

### 8.5 Permission Regressions

| Risk | Mitigation |
|------|------------|
| Stricter tier check | Ensure `publisher_lifetime` included |
| New whitelist blocks access | Clear UX for whitelist flow |
| Vault unlock enforcement | Align with HANDSHAKE_CONTEXT_ARCHITECTURE_ANALYSIS recommendations |

### 8.6 Performance Concerns

| Area | Note |
|------|------|
| Block query with governance | Already joins; ensure indexes |
| Structured panel parsing | Parse once; memoize |
| Document extraction | Already async; no change |

---

## 9. Implementation Prerequisites

### 9.1 Missing Abstractions

| Abstraction | Purpose |
|-------------|---------|
| Typed block content schema | Validate `content`/`payload` by `type` |
| Artefact access gate | Whitelist check before decrypt + return |
| Link safety layer | Validate/sanitize URLs before opening in context |

### 9.2 Missing Validators

| Validator | Scope |
|-----------|-------|
| ProfileFields | `legalCompanyName`, `vatNumber`, `contacts`, etc. |
| CustomField | `label`, `value` length/format |
| URL in block | If links are to be displayed/opened |
| MIME for HS document upload | Backend check (extension has PDF check) |

### 9.3 Missing Policies

| Policy | Current State |
|--------|---------------|
| Per-document access | None; tier + vault unlock only |
| Per-link access | None |
| Original vs extracted only | No policy; both paths exist |

### 9.4 Missing Tests

| Area | Coverage |
|------|----------|
| `resolveProfileIdsToContextBlocks` with malformed profile | Limited |
| Block payload validation | `buildContextBlocksFromParams` hash only |
| `getProfileDocumentContent` authorization | Service tests exist; no whitelist tests |
| Link handling | None |

### 9.5 Missing Feature Flags

| Feature | Flag |
|---------|------|
| Structured context panel | None |
| Typed schema enforcement | None |
| Whitelist for originals | None |
| Link warning | None |

---

## 10. Follow-up Prompt Inputs

For the next implementation prompt, include:

1. **Schema reference:** This report, Section 1.2 (DB schema), Section 1.1 (models)
2. **Data flow:** Section 2 (create, storage, render flows)
3. **Document handling:** Section 3 (upload, encryption, extraction, `getProfileDocumentContent`)
4. **Link handling:** Section 4 (no current allowlist/whitelist)
5. **Security:** Section 5 (payload risks, original access, audit gaps)
6. **UI:** Section 6 (HandshakeWorkspace as main view, Context Graph collapsible, BlockCard)
7. **Refactor boundaries:** Section 7 (seams for schema, documents, whitelist, link flow, structured UI)
8. **Migration risks:** Section 8
9. **Prerequisites:** Section 9 (validators, policies, tests, flags)
10. **Specific files:** `handshake/ipc.ts`, `handshake/contextBlocks.ts`, `vault/hsContextProfileService.ts`, `HandshakeWorkspace.tsx`, `vault/db.ts`, `vault/hsContextNormalize.ts`

---

*End of report. No code proposed.*
