# Phase 2 Tracker — AI Enrichment, Link Policy, Sandbox Depackager Retirement

> **Phase 2 commits land on `phase-1/pod-becomes-hot-path`.**
> The branch name is historical — it was created for Phase 1 and all subsequent phases
> continue on the same branch. No new branch is created for Phase 2.

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md`  
Phase 1 ref: `docs/architecture/phase-1-tracker.md`

---

## Steps

- [x] **P2.0** — Confirm branch and create Phase 2 tracker *(this file)*
- [x] **P2.1** — Add post-seal AI enrichment hook (enrichment point attached to the sealed row; advisory only, never gating)
- [x] **P2.2** — Phishing/scam scorer (lightweight model invoked after seal; result stored in enrichment column)
- [x] **P2.3** — Validation cross-check (AI plausibility check vs structural validator outcome; discrepancy flagged, not blocking)
- [x] **P2.4** — Wire phishing scorer and crosscheck into AI analysis IPC handlers
- [x] **P2.5** — UI: badges, detail panel, persistent disclaimer (phishing risk badges in inbox rows; "Security analysis" panel with signals/URLs/crosscheck/disclaimer; sub-analysis loading indicator)
- [x] **P2.6** — User-selectable AI provider setting (`inbox_ai_security_provider` in `inbox_settings`; Default/Local Ollama/Cloud; tier defaults in one place; settings UI with privacy disclaimer; plumbed into P2.4 sub-analysis call sites)
- [x] **P2.7** — safeLinks sandbox-orchestrator-only link policy (interceptClick + SafeLinkModal; replaces LinkWarningDialog in EmailMessageDetail; wires security-panel flagged-URL buttons; audit logging; 33 new tests)
- [ ] **P2.8** — Retire extension sandbox depackager (remove vestigial depackager from Chrome extension sandbox; fold into pod path per strategy §9 decision 1)

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P2.0 | ✅ done | P2.0: phase 2 tracker |
| P2.1 | ✅ done | P2.1: extend ai_analysis_json schema with phishing_assessment and validation_crosscheck |
| P2.2 | ✅ done | P2.2: phishing-assessment module with provider-agnostic structured output |
| P2.3 | ✅ done | P2.3: validation cross-check module |
| P2.4 | ✅ done | P2.4: wire phishing assessment and validation crosscheck into AI analysis handlers |
| P2.5 | ✅ done | P2.5: UI badges, detail panel, persistent disclaimer for AI analyses |
| P2.6 | ✅ done | P2.6: user-selectable AI provider with tier defaults |
| P2.7 | ✅ done | P2.7: safeLinks sandbox-orchestrator-only policy with confirmation modal |
| P2.8 | ⬜ pending | — |

---

## AI-is-advisory rule (repeated for every step)

> **AI output is enrichment only — it never gates, quarantines, or rejects a message.**
> The structural validator (pod ingestor → validator → sealer) is the sole trust boundary.
> Any step that introduces logic which rejects or quarantines based on AI output violates
> this rule and must be reworked before merging.

---

## Decisions deferred from strategy §9

| Decision | Resolution |
|----------|------------|
| **Decision 8 — AI provider** | Will be a user-configurable setting. Default provider TBD in P2.6. Interface designed in P2.2 to be provider-agnostic. |
| **Decision 1 — Extension sandbox depackager retirement** | Folded into P2.8. The depackager remains in the extension sandbox until P2.8; no mid-phase partial removal. |

---

## Notes & deviations

*(Record any decisions made differently from the strategy here, with rationale.)*

### P2.7

- **New files:** `src/components/SafeLinkModal.tsx` (P2.7 confirmation modal), `src/components/__tests__/SafeLinkModal.test.tsx` (33 tests — 23 component + 10 from interceptClick file), `src/utils/__tests__/safeLinks.interceptClick.test.ts` (11 unit tests for `interceptClick`).
- **`safeLinks.ts` additions:** `LinkOpenDecision` interface (`action | reason | flaggedUrl? | requiresCredentialAck`) and `interceptClick(url, context)` pure function. Always recommends `open_in_sandbox`. Adds `flaggedUrl` and `requiresCredentialAck` when the URL matches a `phishing_assessment.flagged_urls` entry. URL matching uses hostname+path normalization (trailing-slash tolerant). Credential signals detected via `open_policy` or reason keywords: credential, password, login, phish, harvest.
- **`SafeLinkModal.tsx`:** Replaces `LinkWarningDialog` in the `EmailMessageDetail` link-click flow. Shows: URL (with "redirect resolution not available" note), AI flagged-URL block (CREDENTIAL RISK / FLAGGED BY AI badge + reason text) when `decision.flaggedUrl` present, standard safety warning, credential acknowledgment checkbox (only for credential-request URLs), three action buttons: "Open in sandbox" (primary), "Open in browser", "Cancel". Escape key closes. Resets acknowledgment on `contextKey` change.
- **`EmailMessageDetail.tsx`:** `LinkWarningDialog` import removed; `SafeLinkModal` + `interceptClick` imported. `handleLinkClick` unchanged. New `pendingLinkDecision` useMemo computes `interceptClick` from `pendingLinkUrl` + `message.ai_analysis_json`. New `handleLinkConfirmBrowser` (with audit log). New `handleLinkCancel` (with audit log). `handleLinkWarningSandbox` gains audit log entry at the top. `SafeLinkModal` props: `onOpenInBrowser`, `onOpenInSandbox`, `onCancel`, `sandboxAvailable={showSandboxCloneIcon}`, `sandboxBusy`, `showSandboxOrchestratorWarning`.
- **`InboxSecurityPanel.tsx`:** `onLinkClick?: (url: string) => void` added to `InboxSecurityPanelProps`. `FlaggedUrlsList` receives this prop and wires each "Open in sandbox" row button to `onLinkClick?.(url)`. Button enabled when `onLinkClick` is present; disabled with tooltip when absent.
- **`EmailInboxView.tsx` (`InboxDetailAiPanel`):** Imports `SafeLinkModal`, `interceptClick`, `openAppExternalUrl`. New state: `pendingSecurityLink`, `securityLinkSandboxBusy`. New `pendingSecurityLinkDecision` useMemo. New handlers: `handleSecurityLinkClick`, `handleSecurityLinkSandbox` (calls `beapInboxCloneToSandboxApi`), `handleSecurityLinkBrowser` (calls `openAppExternalUrl`), `handleSecurityLinkCancel`. `InboxSecurityPanel` now receives `onLinkClick={handleSecurityLinkClick}`. `SafeLinkModal` rendered at top of return div.
- **Audit logging:** All action callbacks emit `[LINK_POLICY]` structured log with `{ action, reason, flagged, credentialRisk?, domain, messageId, source? }`. Domain only — never full URL. Each of the three actions (sandbox, browser, cancel) is logged.
- **Non-goals respected:** No automatic redirect resolution. No auto-open without modal. No sandbox implementation changes. No API key handling.
- **Test count:** 33 new tests (11 `interceptClick` unit + 22 `SafeLinkModal` component). Full suite: 11 pre-existing failures unchanged; no new failures introduced.

### P2.6

- **New files:** `electron/main/email/ai/inboxAiProviderSetting.ts` (types, `defaultProviderKindForTier`, `normalizeAiProviderSetting`, `resolveSecurityAiProvider`), `src/components/InboxAiProviderSettings.tsx` (`InboxAiProviderSettingsForm` pure form + `InboxAiProviderSettings` IPC wrapper), `electron/main/email/ai/__tests__/inboxAiProviderSetting.test.ts` (30 tests), `src/components/__tests__/InboxAiProviderSettings.test.tsx` (13 tests).
- **Single source of truth:** tier→provider defaults live exclusively in `defaultProviderKindForTier(tier)`. Free/unknown → `local_ollama`; paid (private, private_lifetime, pro, publisher, publisher_lifetime, enterprise) → `cloud`.
- **`inboxLlmChat.ts` additions:** `preResolveOllamaLlm()` and `preResolveCloudLlm()` — provider-specific resolvers that bypass the ocrRouter preference so that user overrides actually take effect regardless of global preference setting.
- **`ipc.ts` changes:** `registerInboxHandlers` gains optional `getTier?: () => string` parameter. Both sub-analysis call sites (`inbox:aiAnalyzeMessage` and `inbox:aiAnalyzeMessageStream`) now read `inbox_ai_security_provider` from DB, resolve via `resolveSecurityAiProvider`, and fall back to the main-analysis provider only if the security provider is unavailable.
- **`main.ts`:** passes `() => currentTier` to `registerInboxHandlers`.
- **Settings UI:** gear icon (⚙) in the AI panel action bar toggles the `InboxAiProviderSettings` panel. The panel shows Default/Local Ollama/Cloud radio, cloud sub-fields (model name, endpoint URL), and the privacy disclaimer. API key management is explicitly deferred to Backend Configuration; a note is shown in the cloud sub-fields.
- **No automatic failover:** if the chosen provider resolves to null, sub-analyses are silently skipped (no fallback to the other provider). This matches P2.4 best-effort contract.
- **Cloud endpoint field:** stored in DB but not yet wired into provider dispatch. TODO noted in `inboxAiProviderSetting.ts`; actual endpoint override is P2.x work.
- **Test isolation:** `resolveSecurityAiProvider` takes injected resolver callbacks so tests pass pure stubs without mocking ES module imports.

### P2.5

- **New files:** `src/components/InboxSecurityPanel.tsx` (`InboxSecurityPanel` + `InboxPhishingBadge` + `SECURITY_DISCLAIMER` constant), `src/components/__tests__/InboxSecurityPanel.test.tsx` (27 tests), `src/utils/__tests__/parseInboxAiJson.security.test.ts` (12 tests).
- **`parseSecurityAnalysis`** added to `src/utils/parseInboxAiJson.ts`: parses `phishing_assessment` and `validation_crosscheck` from the `ai_analysis_json` column string, returning typed `SecurityAnalysis` (tolerant of absent/invalid sub-fields).
- **Security types** added to `src/types/inboxAi.ts`: `PhishingAssessmentUi`, `ValidationCrosscheckUi`, `SecurityAnalysis`, `PhishingLabel`, `PhishingSignalUi`, `FlaggedUrlUi`, `CrosscheckFindingUi`.
- **Inbox row badges:** `InboxPhishingBadge` rendered inside `InboxMessageRow` (in `EmailInboxView.tsx`). Shows red "phishing risk" for `high`, yellow for `elevated`, grey "needs review" when `crosscheck.agrees_with_validator === false`. No badge when analysis not run or both sub-analyses failed.
- **AI panel section:** `InboxSecurityPanel` appended after "Suggested action" row inside the `visibleSections.has('analysis')` block. Renders score, label, signals, flagged URLs (with disabled "Open in sandbox" buttons — wired in P2.7), crosscheck disagreement, and the persistent disclaimer.
- **Sub-analysis loading indicator:** `subAnalysisLoading` state in `InboxDetailAiPanel`, driven by `inbox:aiSubAnalysisStarted` / `inbox:aiSubAnalysisComplete` IPC events. Shows "analyzing security signals…" while sub-analyses run.
- **Preload additions:** `onAiSubAnalysisStarted` and `onAiSubAnalysisComplete` added to `electron/preload.ts` and typed in `src/components/handshakeViewTypes.ts`.
- **Disclaimer wording is byte-identical** to strategy §6.1: `"AI phishing analysis can miss attacks. Open links only via the sandbox orchestrator. Do not enter credentials based on email contents."`
- **Non-goals respected:** HTML sanitization unchanged, message display not gated on AI analysis, actual sandbox link-open deferred to P2.7.
- **Test pattern:** `renderToStaticMarkup` (no jsdom) — same approach as existing `ThisDeviceCard.test.tsx`.

### P2.4

- **New files:** `email/ai/extractUrls.ts` (URL extractor), `email/ai/subAnalysisOrchestrator.ts` (`runSubAnalyses` pure + `applySubAnalysesToRow` DB helper), `email/ai/__tests__/subAnalysisOrchestrator.test.ts` (12 tests).
- **`inbox:aiAnalyzeMessage` changes:** `isLlmAvailable()` → `preResolveInboxLlm()` so the same resolved provider is shared with the sub-analyses. `validation_reason` added to the SELECT query. After the main LLM call succeeds, `runSubAnalyses` + `applySubAnalysesToRow` run; `applySubAnalysesToRow` is fire-and-forget (`.catch`-wrapped) so a reseal failure never blocks the IPC response.
- **`inbox:aiAnalyzeMessageStream` changes:** `validation_reason` added to SELECT. After the main stream completes and `inbox:aiAnalyzeMessageDone` is sent, the stream handler runs `runSubAnalyses`, calls `applySubAnalysesToRow`, and emits `inbox:aiSubAnalysisStarted` / `inbox:aiSubAnalysisComplete` progress events for the P2.5 UI.
- **Best-effort contract:** If both sub-analyses fail, `applySubAnalysesToRow` returns `{ ok: false }` without calling `resealWithAiAnalysis`, leaving the existing ai_analysis_json untouched. Each failure is logged with `{ ai_subanalysis_failed, reason, detail, messageId }` as a structured event.
- **Pre-existing test failure:** `structural-property.test.ts` "key buffers returned by provider are zeroized after use" fails on this Windows CI environment (buf.every(b => b === 0) → false). Verified pre-existing on the branch before P2.4 changes via `git stash` check.

### P2.3

- **New files:** `email/ai/validationCrosscheck.prompt.ts` (`buildCrosscheckSystemPrompt`, `buildCrosscheckUserMessage`, `CROSSCHECK_VERSION = "v1"`), `email/ai/validationCrosscheck.ts` (`crosscheckValidation`), `email/ai/__tests__/validationCrosscheck.test.ts` (15 tests).
- **`ValidatorSignal` type:** carries `reason_code: ValidationReasonCode | null` and `details: string | null`. Caller passes the `ContentValidationResult`'s reason/details directly; the module renders them into the system prompt so the model sees exactly what the validator said.
- **Advisory-only contract is explicit in the system prompt:** "The structural validator is the CANONICAL AUTHORITY. Its decision is final and sealed. You are a cross-check, not an override." plus a DISAGREEMENT RULE requiring at least one `contradicts_validator_outcome` finding if `agrees_with_validator` is false.
- **`CROSSCHECK_VERSION` is versioned separately from `DISCLAIMER_VERSION`** (phishing assessor). They are independent prompts; bumping one should not imply bumping the other.
- **Schema validation path:** wraps parsed output in `{ ai_analysis_json: { validation_crosscheck: parsed } }` and calls `validateAiAnalysisField` — same P2.1 single-source-of-truth pattern as the phishing assessor.

### P2.2

- **New files:** `email/ai/phishingAssessor.prompt.ts` (prompt builder + `DISCLAIMER_VERSION`), `email/ai/phishingAssessor.ts` (`assessPhishing`), `email/ai/__tests__/phishingAssessor.test.ts` (14 tests).
- **`LlmProvider` type:** alias of `ResolvedLlmContext & { timeoutMs? }` — callers can pass `preResolveInboxLlm()` directly with no adaption.
- **Single source of truth:** schema validation calls `validateAiAnalysisField` (exported from `@repo/ingestion-core` in P2.1) via a thin wrapper `validateAssessmentCandidate`. No duplicated validation logic.
- **`generated_at` / `model` stamping:** the assessor overwrites whatever the model returns with the actual `new Date().toISOString()` and `provider.model`. Model-provided timestamps are unreliable; this ensures the field is authoritative.
- **Markdown fence stripping:** responses wrapped in \`\`\`json … \`\`\` are silently stripped before JSON.parse. Any remaining non-JSON text → `malformed_output`.
- **ingestion-core index update:** `validateAiAnalysisField` added to exports.

### P2.1

- **Step title refined:** tracker listed P2.1 as "Add post-seal AI enrichment hook". The actual P2.1 prompt is schema-only — it extends the `ai_analysis_json` structural validator (in `ingestion-core/contentValidator.ts`) to accept two optional sub-fields: `phishing_assessment` and `validation_crosscheck`. The enrichment hook that populates those fields is implemented in P2.2/P2.3.
- **Location of changes:** `packages/ingestion-core/src/types.ts` (two new `ValidationReasonCode` values), `packages/ingestion-core/src/contentValidator.ts` (extended `validateAiAnalysisField`, new TypeScript interfaces), `packages/ingestion-core/__tests__/contentValidator.aiAnalysis.test.ts` (27 new tests).
- **`validateAiAnalysisField` exported:** previously private; now exported so test files can call it directly if needed. Call path is unchanged: `validateBeapMessageContent` and `validatePlainEmailContent` call it internally.
- **ISO 8601 regex:** accepts `YYYY-MM-DDTHH:MM:SS[.frac][Z|±HH:MM]`. More exotic ISO 8601 forms (week dates, ordinal dates) are not accepted — AI producers are expected to emit standard UTC or offset timestamps.

### P2.0

- Strategy §6 (AI analysis enhancement) and §9 (decisions) are referenced in the Phase 2
  prompt sequence but the relevant sections were not yet written into
  `beap-high-assurance-strategy.md` at Phase 1 close. Those sections should be drafted and
  committed to the strategy doc before P2.1 begins, so that subsequent prompts have a stable
  spec to reference.
- Step titles P2.1–P2.8 are derived from the Phase 2 prompt preamble and the two explicit
  anchor points given in P2.0 (Decision 8 → P2.6; Decision 1 → P2.8). Titles may be refined
  when the individual prompts are run; deviations will be noted here.
