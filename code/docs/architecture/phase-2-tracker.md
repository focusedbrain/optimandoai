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
- [ ] **P2.4** — Tighten link-open policy (restrict external link navigation to pod-cleared URLs; block `javascript:` / `data:` on all platforms)
- [ ] **P2.5** — AI output schema + sealed storage enrichment column (`ai_analysis` JSONB column on `inbox_messages`; sealed alongside main payload)
- [ ] **P2.6** — AI provider user setting (provider selector surface; default provider decided here; pluggable interface for P2.2)
- [ ] **P2.7** — Phase 2 test suite and CI (unit + integration tests for scorer, cross-check, link policy; CI job for AI enrichment smoke test)
- [ ] **P2.8** — Retire extension sandbox depackager (remove vestigial depackager from Chrome extension sandbox; fold into pod path per strategy §9 decision 1)

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P2.0 | ✅ done | P2.0: phase 2 tracker |
| P2.1 | ✅ done | P2.1: extend ai_analysis_json schema with phishing_assessment and validation_crosscheck |
| P2.2 | ✅ done | P2.2: phishing-assessment module with provider-agnostic structured output |
| P2.3 | ✅ done | P2.3: validation cross-check module |
| P2.4 | ⬜ pending | — |
| P2.5 | ⬜ pending | — |
| P2.6 | ⬜ pending | — |
| P2.7 | ⬜ pending | — |
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
