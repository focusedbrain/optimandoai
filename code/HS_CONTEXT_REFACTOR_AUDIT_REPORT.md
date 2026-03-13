# HS Context Refactor — Full Audit Report

**Audit date:** 2025-03-13  
**Scope:** Entire HS Context refactor sequence completed so far  
**Method:** Evidence-based code inspection; no implementation changes

---

## 1. Executive Verdict

**Overall status: PARTIAL**

The HS Context refactor delivers most intended outcomes: publisher gating, structured authoring, protected originals/links, sensitive policy, and validation. Several gaps remain, including a **sensitive-policy enforcement gap** for received blocks and **missing validation** of document metadata in some paths.

**Top 5 findings:**

1. **Sensitive policy gap (HIGH):** Ingested blocks from the initiator use `inferGovernanceFromLegacy`, which does not parse block content for `profileSensitive`. Sensitive documents sent by the initiator are not excluded from cloud AI/search on the acceptor side.
2. **Extension gating fixed:** Popup and sidepanel now use `getVaultStatus()` and pass `canUseHsContextProfiles` from API response; no hardcoded `true` remains.
3. **Protected flows implemented:** Warning dialog, acknowledgement, approval/audit tables, and link validation are in place and used.
4. **Document metadata validation partial:** `validateDocumentLabel` is used in HsContextDocumentUpload; `updateProfileDocumentMeta` does not validate label/document_type before DB write.
5. **Tests added:** Publisher gating, link validation, sensitive policy, extracted text, PDF validation, protected flows, and backward compatibility have test coverage; some tests depend on better-sqlite3 (environment-dependent).

---

## 2. Requirement Matrix

### A. Product positioning

**Verdict: PASS**

- **Evidence:** `HandshakeWorkspace.tsx` (lines 730–737): Auto-expand only when `blocks.some(b => b.type === 'vault_profile' && b.source === 'received')`. Generic context does not trigger expansion.
- **Evidence:** `vaultCapabilities.ts`: `RECORD_TYPE_MIN_TIER['handshake_context'] = 'publisher'`; `canAccessRecordType(tier, 'handshake_context', 'share')` gates HS Context.
- **Evidence:** Extension popup/sidepanel: `canUseHsContextProfiles` from `getVaultStatus()`; `SendHandshakeDelivery` uses `skipVaultContext: !canUseHsContextProfiles || !includeVaultProfiles`.
- **Satisfied:** HS Context is publisher-only; generic Pro context does not trigger richer mode; sender-HS-only auto-expand works.

### B. Structured business context content

**Verdict: PASS**

- **Evidence:** `HsContextProfileEditor.tsx`: Sections for Business Identity, Tax & Identifiers, Contacts, Opening Hours, Billing, Links, Documents.
- **Evidence:** `StructuredHsContextPanel.tsx`: Renders `legalCompanyName`, `tradeName`, `address`, `country`, `vatNumber`, `companyRegistrationNumber`, `contacts`, `openingHours`, `billingEmail`, `paymentTerms`, `bankDetails`, `website`, `linkedin`, etc.
- **Evidence:** `hsContextNormalize.ts` / `ProfileFields`: Supports `legalCompanyName`, `tradeName`, `address`, `country`, `vatNumber`, `companyRegistrationNumber`, `supplierNumber`, `customerNumber`, `contacts`, `openingHours`, `website`, `linkedin`, `twitter`, `facebook`, `instagram`, `youtube`, `officialLink`, `supportUrl`, `billingEmail`, `paymentTerms`, `bankDetails`, `deliveryInstructions`, `receivingHours`, `supportHours`, `timezone`.
- **Satisfied:** Structured business fields, documents, links, and safe rendering in the handshake view.

### C. Document model

**Verdict: PASS**

- **Evidence:** `hsContextProfileService.ts`: Documents stored with `extracted_text`; extraction via `runExtractionJob`; `validateExtractedText` rejects HTML/markup.
- **Evidence:** `StructuredHsContextPanel.tsx`: Shows `doc.extracted_text` as default; View Original behind protected flow.
- **Evidence:** `hs_context_profile_documents`: `label`, `document_type`, `sensitive` columns; `HsContextDocumentUpload` supports label.
- **Evidence:** `hsContextProfileService.ts` lines 343–345: `isPdfBuffer` validates PDF magic bytes before storing.
- **Satisfied:** Extracted plain text is default; originals encrypted; label supported; backend PDF validation present.

### D. Protected originals and links

**Verdict: PASS**

- **Evidence:** `ProtectedAccessWarningDialog.tsx`: ORIGINAL_COPY and LINK_COPY with intro, recommend, sandbox messaging; "I understand, proceed" acknowledgement.
- **Evidence:** `StructuredHsContextPanel.tsx`: `handleViewOriginal` / `handleOpenLink` open warning dialog; `handleWarningAcknowledge` calls `requestOriginalDocument` / `requestLinkOpenApproval` with `acknowledgedWarning: true`.
- **Evidence:** `hsContextAccessService.ts`: `requestOriginalDocumentContent` and `requestLinkOpenApproval` require `acknowledgedWarning`; `grantApproval`; `insertAccessAudit` for all outcomes.
- **Evidence:** `linkValidation.ts`: `UNSAFE_PROTOCOLS` (javascript, data, file, blob, vbscript, jar, wyciwyg, ms-its, mhtml, x-javascript); `SAFE_PROTOCOLS` (http, https); `validateHsContextLink` rejects unsafe protocols.
- **Evidence:** `StructuredHsContextPanel.tsx` lines 144–146: Links filtered by `validateHsContextLink`; only valid links get Open button.
- **Satisfied:** Warning flow, recommendation of extracted text, sandbox recommendation, approval/whitelist, dangerous protocols blocked.

### E. Sensitive / AI-usage policy

**Verdict: PARTIAL**

- **Evidence:** `contextGovernance.ts`: `resolveEffectiveUsagePolicy` sets `cloud_ai_allowed: false`, `searchable: false` when `policy.sensitive === true`.
- **Evidence:** `ipc.ts` lines 277, 281, 1178, 1180: `filterBlocksForCloudAI`, `filterBlocksForSearch` used for cloud_ai and search purposes.
- **Evidence:** `ipc.ts` lines 169, 178, 188, 765: `profileSensitive` from documents flows into block and `buildGovernanceForReceiverBlock`; receiver blocks get `sensitive: true` in usage_policy.
- **Gap:** `contextIngestion.ts`: Ingested blocks (initiator → acceptor) use `inferGovernanceFromLegacy(legacy, ...)`. `LegacyBlockInput` has no `profileSensitive`; content is not parsed for `documents.some(d => d.sensitive)`. So initiator blocks with sensitive documents are ingested with governance that does not include `sensitive: true`, and they are not excluded from cloud AI/search on the acceptor.
- **Satisfied:** Sensitive enforced for sender-side and receiver-side blocks built at accept time. **Not satisfied:** Sensitive lost for blocks ingested from the initiator's capsule.

### F. Validation and safety

**Verdict: PARTIAL**

- **Evidence:** `hsContextFieldValidation.ts`: `validateUrl`, `validateEmail`, `validatePhone`, `validateIdentifier`, `validatePlainText`, `validateDocumentLabel`; `validatePlainText` rejects HTML via `/<[a-z][\s\S]*>/i`.
- **Evidence:** `hsContextOcrJob.ts`: `validateExtractedText` rejects HTML/markup; used before `markDocumentExtractionSuccess`.
- **Evidence:** `hsContextProfileService.ts`: `isPdfBuffer` validates PDF magic bytes.
- **Evidence:** `HsContextDocumentUpload.tsx`: Uses `validateDocumentLabel` on upload and `handleUpdateMeta`.
- **Gap:** `updateProfileDocumentMeta` in `hsContextProfileService.ts` (lines 456–486): Accepts `label` and `document_type` without validation; no call to `validateDocumentLabel` or equivalent before DB update.
- **Satisfied:** Extracted text validated; PDF magic-byte validated; field validation in editor. **Not satisfied:** Document metadata updates not validated server-side.

### G. Publisher-only gating

**Verdict: PASS**

- **Evidence:** `vaultCapabilities.ts`: `handshake_context` requires `publisher` tier.
- **Evidence:** `hsContextProfileService.ts` line 98: `requireHsContextAccess(tier, action)` → `canAccessRecordType(tier, 'handshake_context', action)`.
- **Evidence:** `hsContextAccessService.ts` line 25: Same `requireHsContextAccess`.
- **Evidence:** `main.ts` lines 2577, 5969: `vault:getStatus` and `POST /api/vault/status` return `canUseHsContextProfiles = canAccessRecordType(tier, 'handshake_context', 'share')`.
- **Evidence:** Extension `popup-chat.tsx`, `sidepanel.tsx`: `getVaultStatus()` → `status?.canUseHsContextProfiles ?? false`; passed to `SendHandshakeDelivery`, `HandshakeRequestForm`, `InitiateHandshakeDialog`.
- **Evidence:** Electron `HandshakeView`, `HandshakeInitiateModal`, `HandshakeRequestView`, `AcceptHandshakeModal`: `getVaultStatus` / `getVaultStatus` → `canUseHsContextProfiles` passed down.
- **Evidence:** `rpc.ts`: HS Profile methods receive `tier` from WebSocket handler (session-derived); service methods enforce `requireHsContextAccess`.
- **Satisfied:** All known authoring, initiation, accept, and extension surfaces use tier-based gating.

### H. Compatibility and implementation quality

**Verdict: PASS**

- **Evidence:** `validateDocumentLabel(null)` and `validateDocumentLabel(undefined)` return `{ ok: true, value: '' }`.
- **Evidence:** `StructuredHsContextPanel.tsx`: `parseHsContextPayload` returns `null` on parse failure; `profile.fields ?? {}`, `parsed.documents ?? []`; optional fields rendered only when present.
- **Evidence:** `hsContextProfileService.ts` line 130: `sensitive: !!(d.sensitive ?? 0)`; label/document_type nullable.
- **Evidence:** `hsContextHardening.test.ts`, `contextGovernance.test.ts`, `hsContextOcrJob.test.ts`, `hsContextAccessService.test.ts`, `hsContextProfileService.test.ts`: Tests for gating, link validation, sensitive policy, extracted text, PDF validation, protected flows, backward compatibility.
- **Satisfied:** Optional fields; older records without new fields handled; generic context still works; tests added for major rules.

---

## 3. Prompt-Sequence Outcome Audit

### Slice 1: Sensitive policy groundwork, extracted text validation, backend PDF validation, minimal Sensitive UI wiring

**Verdict: PASS**

- **Implemented correctly:** `resolveEffectiveUsagePolicy` with sensitive override; `validateExtractedText` in `hsContextOcrJob.ts`; `isPdfBuffer` in `uploadProfileDocument`; `profileSensitive` flow into block governance; sensitive badge in `StructuredHsContextPanel`.
- **Incomplete:** None for this slice.
- **Deviation:** None.

### Slice 2: Protected original access, protected link flow, warning dialog, audit logging

**Verdict: PASS**

- **Implemented correctly:** `ProtectedAccessWarningDialog` with ORIGINAL_COPY and LINK_COPY; `requestOriginalDocumentContent` and `requestLinkOpenApproval` in `hsContextAccessService`; `hs_context_access_approvals` and `hs_context_access_audit` tables; `validateHsContextLink` for protocol validation; links filtered before Open button.
- **Incomplete:** None.
- **Deviation:** None.

### Slice 3: Sender-HS-only auto-expand, structured HS Context panel, separation from generic context

**Verdict: PASS**

- **Implemented correctly:** `HandshakeWorkspace` auto-expand on `type === 'vault_profile' && source === 'received'`; `StructuredHsContextPanel` for vault_profile blocks; `hsContextBlocks` vs `genericBlocks` separation; `BlockCard` for generic.
- **Incomplete:** None.
- **Deviation:** None.

### Slice 4: Publisher-side structured authoring, labeled custom documents, optional-but-validated fields, publisher-only gating

**Verdict: PARTIAL**

- **Implemented correctly:** `HsContextProfileEditor` with structured sections; `HsContextDocumentUpload` with label; `validateDocumentLabel` in upload and `handleUpdateMeta`; extension and Electron surfaces use `canUseHsContextProfiles` from vault status.
- **Incomplete:** `updateProfileDocumentMeta` does not validate label/document_type before persisting.
- **Deviation:** None.

---

## 4. Security Audit

| Issue | Severity | Evidence | Blocking? |
|-------|----------|----------|-----------|
| **Sensitive lost on ingested initiator blocks** | **HIGH** | `contextIngestion.ts` uses `inferGovernanceFromLegacy`; does not parse block content for `documents.some(d => d.sensitive)`. Initiator's sensitive documents are not excluded from cloud AI/search on acceptor. | **Yes** |
| Raw/original file exposure | Low | Originals served only after acknowledgement + approval; audit logged. | No |
| Unsafe link exposure | Low | `validateHsContextLink` blocks dangerous protocols; only validated links get Open button. | No |
| Parser/output validation | Low | `validateExtractedText` rejects HTML; used before persisting. | No |
| Document metadata validation | Medium | `updateProfileDocumentMeta` does not validate label/document_type; could persist HTML or oversized values. | Non-blocking |
| Policy bypass risk | Low | Tier from session; RPC and service layer enforce `requireHsContextAccess`. | No |
| Approval/whitelist | Low | `requestOriginalDocumentContent` and `requestLinkOpenApproval` require acknowledgement; approval stored in `hs_context_access_approvals`. | No |
| Audit coverage | Low | All request/approve/deny/serve outcomes logged to `hs_context_access_audit`. | No |
| Host-environment risk messaging | Low | `ProtectedAccessWarningDialog` includes sandbox recommendation. | No |

---

## 5. UX / Product Audit

| Criterion | Verdict | Explanation |
|-----------|---------|--------------|
| Clear superiority of HS Context over generic Pro context | PASS | Structured panel, business fields, documents with extracted text; generic uses plain BlockCard. |
| Good structured business readability | PASS | Sections (Business Identity, Tax & Identifiers, Contacts, etc.); clean layout. |
| Correct expansion behavior | PASS | Auto-expand only for received vault_profile blocks. |
| Good document presentation | PASS | Extracted text as default; View Original behind warning; label and document_type shown. |
| Good protected-action UX | PASS | Warning dialog with clear copy; acknowledgement required; approval flow. |
| Clear publisher-only distinction | PASS | HS Context UI hidden when `canUseHsContextProfiles` is false; limitation messaging via absence of UI. |

---

## 6. Gating Consistency Audit

**Surfaces inspected:**

| Surface | Gating | Evidence |
|---------|--------|----------|
| Extension popup | ✅ | `getVaultStatus()` → `canUseHsContextProfiles`; `SendHandshakeDelivery` receives it |
| Extension sidepanel | ✅ | Same pattern; three usages of `canUseHsContextProfiles` |
| HandshakeView (Electron) | ✅ | `getVaultStatus` → `canUseHsContextProfiles` → `AcceptHandshakeModal` |
| HandshakeInitiateModal | ✅ | `getVaultStatus` → `canUseHsContextProfiles` |
| HandshakeRequestView | ✅ | `getVaultStatus` → `canUseHsContextProfiles` |
| vault:getStatus (IPC) | ✅ | Returns `canUseHsContextProfiles` from `canAccessRecordType(tier, 'handshake_context', 'share')` |
| POST /api/vault/status | ✅ | Same |
| vault.hsProfiles.* RPC | ✅ | `tier` from session; `vaultService` methods call `requireHsContextAccess` |
| HsContextProfileEditor (extension) | ✅ | Only shown when `canUseHsContextProfiles` (via parent) |
| SendHandshakeDelivery | ✅ | `skipVaultContext: !canUseHsContextProfiles \|\| !includeVaultProfiles` |

**Leaks:** None found. No surface exposes HS Context to Pro/free without tier check.

**RPC/API paths:** All HS Profile RPC methods receive `tier` from the WebSocket handler (session-derived) and delegate to `vaultService`, which enforces `requireHsContextAccess`.

**Overall gating verdict: PASS**

---

## 7. Data-Model and Compatibility Audit

| Check | Verdict | Evidence |
|-------|---------|----------|
| Older records deserialize safely | PASS | `sensitive: !!(d.sensitive ?? 0)`; label/document_type nullable; `parseHsContextPayload` handles malformed JSON |
| Missing sensitive/label/document_type | PASS | Defaults and optional chaining used throughout |
| Structured panel tolerates older payloads | PASS | `profile.fields ?? {}`, `parsed.documents ?? []`; optional sections only when data present |
| Generic context still renders | PASS | `genericBlocks` rendered via `BlockCard`; `type !== 'vault_profile'` |
| No migration breakage | PASS | Additive migrations for `sensitive`, `label`, `document_type`; `ALTER TABLE ADD COLUMN` with defaults |

**Overall compatibility verdict: PASS**

---

## 8. Test Coverage Audit

| Rule | Test Location | Status |
|------|---------------|--------|
| Publisher gating | `hsContextHardening.test.ts`, `vaultCapabilities.test.ts`, `rpcAuth.test.ts`, `capabilityGate.test.ts` | ✅ |
| Auto-expand rule | `hsContextHardening.test.ts` (shouldAutoExpand) | ✅ |
| Sensitive policy | `contextGovernance.test.ts` (filterBlocksForCloudAI, filterBlocksForSearch) | ✅ |
| Extracted text validation | `hsContextOcrJob.test.ts` (validateExtractedText) | ✅ |
| PDF backend validation | `hsContextProfileService.test.ts` | ✅ (env-dependent) |
| Protected original flow | `hsContextAccessService.test.ts` | ✅ (env-dependent) |
| Protected link flow | `hsContextAccessService.test.ts`, `hsContextHardening.test.ts` (validateHsContextLink) | ✅ |
| Document metadata | `hsContextProfileService.test.ts` | ✅ (env-dependent) |
| Backward compatibility | `hsContextHardening.test.ts` | ✅ |
| Sensitive on ingested blocks | **None** | ❌ |
| updateProfileDocumentMeta validation | **None** | ❌ |

**Critical untested:** Sensitive propagation for ingested initiator blocks (contextIngestion path).

**Overall test verdict: PARTIAL** — Most rules covered; sensitive-ingestion gap and document-meta validation not tested.

---

## 9. Blocking Issues Before Release

### B1. Sensitive policy lost for ingested initiator blocks

- **Why blocking:** Initiator can send sensitive documents; acceptor ingests them without `sensitive: true` in governance; those blocks are included in cloud AI and search. Violates requirement E.
- **Code area:** `contextIngestion.ts` — `ingestContextBlocks` uses `inferGovernanceFromLegacy`; block content is not parsed for `documents.some(d => d.sensitive)`.
- **Fix direction:** For `type === 'vault_profile'` blocks, parse `block.content` (JSON), extract `documents`, compute `profileSensitive = documents?.some(d => d.sensitive === true)`, and pass it into governance construction (e.g. extend `LegacyBlockInput` or add a separate path for vault_profile that sets `usage_policy.sensitive` when `profileSensitive`).

---

## 10. Non-Blocking Follow-Ups

1. **Document metadata validation in updateProfileDocumentMeta:** Call `validateDocumentLabel` and validate `document_type` (e.g. length, no HTML) before DB update.
2. **Test for sensitive ingestion:** Add test that ingests a vault_profile block with `documents[].sensitive: true` and asserts governance has `usage_policy.sensitive: true` and block is excluded from `filterBlocksForCloudAI`.
3. **Environment-independent tests:** Make hsContextProfileService and hsContextAccessService tests run without better-sqlite3 (e.g. mock or skip gracefully with clear output).

---

## 11. Final Release Readiness

**Verdict: NOT READY**

The sensitive-policy gap for ingested initiator blocks is a blocking issue. When an initiator sends HS Context with sensitive documents, the acceptor ingests them without marking governance as sensitive, so those blocks are included in cloud AI and search. This contradicts the requirement that sensitive data must not be queryable by external AI. Fix B1 before release.
