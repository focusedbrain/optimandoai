# B-8.4 Audit — Workspace Vitest Failure Classification (Post PR B-8.3)

**Scope.** Diagnostic classification only — **no code or test fixes** in this document.  
**Method.** Workspace root `pnpm exec vitest run` with `--reporter=json`, twice, on Windows (Node v22.22.0).

## Consistency / flakiness (Phase instruction)

Two full-suite runs (`vitest-audit-run1.json`, `vitest-audit-run2.json`) yielded **exactly the same failure set**: **201** failed assertions, **zero** deltas between runs keyed by `{test file} :: {fullName}`. At this granularity, failures are **not flaky** across the two executions; residual ordering or timing flake would require additional dedicated stress runs.

Intermediate artifacts (if present in repo root): `vitest-audit-run*.json`, `vitest-audit-failures-flat.json`, `vitest-audit-failure-lines.txt`.

---

## Section 1 — Failure classification summary

Counts are operational estimates after applying the Phase B decision tree. Some tests sit on boundaries (fixtures vs product bug); ambiguous cases default to **Category 1** with a pointer to Section 3 for **review-first** regressions.

| Category | Approx. count | Notes |
|---------|-----------------|--------|
| **1. Stale test (update needed)** | ~95 | Canonical fixture drift (`validateCapsule` / `validateInput`), incomplete DB schemas in integration tests (`inbox_attachments`), sealed-gate-aware expectations, UI copy/layout, brittle static substring / line-number tests, relay capsule JSON vs current relay validation. |
| **2. Real Phase B regression (suspects)** | **~14** | **Not proven here** — these need main-code review **before** any test rewrite. Listed in Section 3 with contracts. |
| **3. Pre-Phase-B legacy / known debt** | ~7 | Tests or suites explicitly documenting “expected failures until …”, OCR strictness churn, sandbox host-AI matrices that predate hardened resolver semantics. |
| **4. Removed-functionality test** | **6** | Depends on **`processPendingP2PBeapEmails` no-op stub** (`beapEmailIngestion.ts` explicitly returns `0`); exercised behavior no longer exists. |
| **5. Environmental / harness** | ~79 | Incomplete **Electron mocks** (`app.getPath`), **jsdom** gaps (**`CSS.escape`**, value setter quirks), **`WRVault Write Canary`** in unit tests calling `setValueSafely`, **validator subprocess unavailable** (“Validation service unavailable”), **static imports** dragging real `electron` / huge modules. |

**Sum:** 95 + 14 + 7 + 6 + 79 = **201** (rounding reconciled to 201 by treating borderline cases as documented in Section 2 groups).

---

## Section 2 — Per-failure / grouped details

Below, **Group ID** is for batch fix PRs. Every workspace failure maps to one group (some groups contain many tests).

### Group A — Relay server: capsule fixture vs `validateInput(..., 'p2p_relay')` (Category **1**)

| File | Count | Evidence |
|------|------:|----------|
| `packages/relay-server/__tests__/relay-server.test.ts` | 4 | `expected 422 to be 200` — `server.ts` returns 422 when `validateInput` fails (`Capsule rejected`). `validBeapCapsule()` mirrors old minimal handshake JSON and no longer satisfies shared ingestion validator. |

Representative failing tests: **R1_store_and_pull**, **R3_auth_ingest_valid**, **R7_register_handshake** (ingest phase), plus **R2_ack_removes** cascading from empty store after failed ingest.

### Group B — Ingestion validator & pipeline: CandidateCapsule + reason-code ordering (Category **1**)

| File | Count | Evidence |
|------|------:|----------|
| `.../ingestion/__tests__/validator.test.ts` | 9 | `validateCapsule` returns `.success === false` on payloads that omit fields now mandatory in ingestion-core / or returns **`MISSING_REQUIRED_FIELD`** ahead of semantic codes tests expect (`HASH_BINDING_MISMATCH`, `PAYLOAD_SIZE_EXCEEDED`, …). |
| `.../ingestion/__tests__/adversarial.test.ts` | 10 | Same pattern — reason code drift (`MISSING_REQUIRED_FIELD` vs specific adversarial outcomes), “valid” adversarial payloads no longer classified as validator-passing where tests expect passes. |
| `.../ingestion/__tests__/integration.test.ts` | 3 | `processIncomingInput` → `success` false where tests expect handshake pipeline routing / `'validated'` audit. Root cause likely same capsule canonical shape drift + audit wiring — **not proven as production bug in this audit**. |

Related: **`.../ingestion/__tests__/hardening.test.ts`** — §“prototype key in nested object stripped…” expects `success === true` but gets false (validator / sanitizer behavior vs fixture). Prefer **Cat 1** until Section 3 review says otherwise.

Also: **`.../handshake/__tests__/hardening-verification.test.ts`** (9 failures, `expected false to be true` / flipped booleans). Same ingestion / handshake canon surface; **assume Cat 1 (fixtures)** but **elevate individually to Cat 2** if manual review finds enforcement weakened.

### Group C — Sealed-storage merge / re-seal IPC tests (Category **1** dominant; **§F.4** ambiguous)

| File | Count | Evidence |
|------|------:|----------|
| `.../email/__tests__/b5ExtensionMerge.test.ts` | 7 | **§F.1–F.3, F.6:** `SealVerificationError: [SEALED_GATE] UPDATE` — helpers still use **`UPDATE`** paths that violate gate contract when row already sealed unless tests route through operational-reseal APIs or update mocks. **§E.6:** `ARTEFACT_PURPOSE_*` expectation mismatch vs `validateDecryptedBeapContent`. **§G.2:** `Cannot find module '../beapInboxClonePrepare'` — module path or feature relocation. |
| `.../email/__tests__/mergeExtensionDepackaged.validation.test.ts` | 4 | `SqliteError: no such table: inbox_attachments` on in-memory schema — fixture missing table `b5ExtensionMerge.test.ts` already defines. **§TEST-INT-3** also expects `ARTEFACT_UNKNOWN_KEY` but gets `null`. |
| `.../email/__tests__/b7IpcContentUpdates.test.ts` | 5 | `expected false to be true` on `resealWithAiAnalysis` / `resealWithPdfExtraction` success flags — likely mock / key provider / DB row shape drift (optional forward-migration paths). |
| `.../email/__tests__/b72DecryptedContentReseal.test.ts` | 4 | Same pattern; **§2.1** includes `SqliteError: table inbox_messages has no column…` — column rename / schema drift in test harness. |

### Group D — B-5.1 extension merge bypass / buffer drain (Category **2** suspects)

| File | Count | Evidence |
|------|------:|----------|
| `.../email/__tests__/b51ExtensionMergeBypass.test.ts` | 3 | Assertions on quarantine row counts (`expected +0 to be 1`, `expected 1 to be +0`) — directly encodes **“no failure-path bypass write”** structural concern. **Requires implementation review** before downgrading to fixture-only (Category 1). |

### Group E — `processPendingP2PBeapEmails` stub (Category **4**)

| File | Count | Evidence |
|------|------:|----------|
| `.../email/__tests__/pbeapValidation.test.ts` | 4 | Tests call no-op stub; expect `validated_at` / `validation_reason` updates — **product behavior intentionally removed** (inline `processBeapPackageInline` migration, PR B-4 comment on stub). |
| `.../email/__tests__/pr22SecurityDeferrals.test.ts` | 2 | **OB-1 / OB-2** same stub dependency. |

### Group F — B-4 P2P relay migration (mixed **5** + **1**)

| File | Count | Evidence |
|------|------:|----------|
| `.../email/__tests__/b4P2PRelayMigration.test.ts` | 10 | **8×** `TypeError: Cannot read properties of undefined (reading 'getPath')` — importing production modules pulls **Electron `app`** without complete mock. **2×** `SqliteError: no such column: relationship_id` — **test migration harness** out of sync with real `db.ts` schema (not necessarily product bug). |

### Group G — Message router native transaction (Category **5**)

| File | Count | Evidence |
|------|------:|----------|
| `.../email/__tests__/messageRouter.ingestTransaction.test.ts` | 1 | `Error: Validation service unavailable` — subprocess / service not started in Vitest harness. |

### Group H — Internal Host-AI / inference (mixed **5** + **1** + **3**)

| File | Count | Evidence |
|------|------:|----------|
| `.../internalInference/__tests__/hostAiPeerEndpointAndAdvertisement.test.ts` | 3 | `TypeError: db.prepare is not a function` — fake `db` object is not `better-sqlite3`. |
| `.../internalInference/__tests__/internalInferenceService.test.ts` | 1 | Same `db.prepare` issue. |
| `.../internalInference/__tests__/internalInference.directHost.regression.test.ts` | 1 | `electron` mock missing `BrowserWindow` export. |
| `.../internalInference/__tests__/hostAiRoutingCorrectness.regression.test.ts` | 3 | Suite title documents **expected failures until resolver hardens** → classify **Category 3** pending product decision whether to tighten resolver or rewrite expectations. |
| `.../internalInference/__tests__/listHostCapabilities.hostAiRoute.test.ts` | 2 | String expectations on resolver error tokens — **possible Cat 2** if resolver contract changed unintentionally (**Section 3**). |
| `.../internalInference/__tests__/hostAiE2eSandboxToHostSuccess.integration.test.ts` | 1 | E2E matrix — classify **review-first** (**Section 3**). |
| `.../internalInference/__tests__/sandbox_lists_remote_ollama_models_even_when_beap_endpoint_missing.regression.test.ts` | 1 | Count mismatch (`expected 1 to be …`) — **Cat 3 / 2** ambiguity; treat as resolver/listing semantics review. |

### Group I — Electron / vault ancillary (Category **5**)

| File | Count | Evidence |
|------|------:|----------|
| `.../handshake/__tests__/revocation.test.ts` | 1 | `getPath` undefined (Electron mock). |
| `.../main/vault/rpcAuth.test.ts` | 1 | Same pattern on vault RPC import chain. |

### Group J — Handshake outbound queue / IPC (mixed **1** / **3**)

| File | Count | Evidence |
|------|------:|----------|
| `.../handshake/__tests__/outboundQueue.backoff.test.ts` | 5 | Fetch call counts mismatch (`expected 2 got 10`); **`SCHEMA_PERMANENT` vs `PAYLOAD_PERMANENT`**; diagnostic substring expectations — likely **classification rename** (**Cat 1**) but verify no autodrain loop regression (**Cat 2** suspect). |
| `.../handshake/__tests__/ipc.internal.relayPush.test.ts` | 2 | `expected false to be true` on coordination relay path — **Cat 2** suspect (live relay push semantics). |
| `.../handshake/__tests__/counterpartyKeyBinding.regression.test.ts` | 1 | State `'ACCEPTED'` vs `'ACTIVE'` mismatch — handshake progression contract (**Cat 2** suspect). |
| `.../handshake/__tests__/internalRelayOutboundGuards.test.ts` | 1 | `expected true to be false` on envelope predicate — tightening/loosening of internal relay guard (**Cat 2** suspect). |

### Group K — Renderer / extension — BEAP packaging & artefacts (Category **1**)

| File | Count | Evidence |
|------|------:|----------|
| `.../beap-messages/services/__tests__/BeapPackageBuilder.test.ts` | 7 | `expected false to be true` across transport-leak policy gating suite — canonical build API or policy bitmask drift after Phase B tightening. |
| `.../beap-messages/services/__tests__/sessionImportArtefact.test.ts` | 6 | Build success flags false — same family. |

### Group L — Extension handshake builder / migration static tests (Category **1**)

| File | Count | Evidence |
|------|------:|----------|
| `.../beap-builder/__tests__/handshakeRefresh.test.ts` | 4 | `buildContextBlocks` expectations (`block_type`, `scope_id`); `sendViaHandshakeRefresh` “Target cannot be null” — API shape / mock RPC target drift. |
| `.../handshake/__tests__/migration.test.ts` | 5 | Source-level string negative checks (`RecipientHandshakeSelect`, `rpcTypes.ts`, `useFullAutoStatus.ts`) — **brittle**; files moved or reintroduced substrings legitimately. |

### Group M — Autofill / vault UI core (predominantly Category **5**)

| File | Count | Evidence |
|------|------:|----------|
| `.../vault/autofill/committer.test.ts` | 24 | **`[WRVault Write Canary] setValueSafely() called outside of overlay consent…`** + `commitInsert` / `runSafetyChecks` receive `undefined` where structured safety result expected — harness does not simulate consent path or preview layer. |
| `.../vault/autofill/fieldScanner.test.ts` | 7 | `CSS.escape` undefined in jsdom; hostname expectation `localhost` vs full URL. |
| `.../vault/autofill/__tests__/datavault-improvements.test.ts` | 5 | Same `escape` dependency for fingerprint path. |
| `.../vault/autofill/__tests__/datavault-classifier.test.ts` | 7 | Mixed: `escape` TypeErrors + German keyword / select-fill behavioral assertions — split **5** + **2** as **Cat 5** vs **Cat 1** when fixing. |
| `.../vault/autofill/__tests__/hardening.test.ts` | 9 | `guardElement` codes (`ELEMENT_HIDDEN` vs `ELEMENT_OFFSCREEN` / NOT_FOCUSABLE); `evaluateSafeMode` now emits **`ha_mode_active`** instead of older reason tokens — classifier/priority reorder (**likely Cat 1**). |
| `.../vault/autofill/__tests__/scan-dos-caps.test.ts` | 4 | `querySelectorAll` instrumentation sees calls (scanner implementation drift); HA cap attribution string (`time_budget` vs `element_cap`). |
| `.../vault/autofill/__tests__/background-sender-gate.test.ts` | 2 | Negative index / position checks on `.search()` in bundled file — brittle offset tests. |
| `.../vault/autofill/__tests__/security-regression.test.ts` | 1 | `AAD_SCHEMA_VERSION` type expectation mismatch — module export shape (**Cat 1**). |
| `.../vault/autofill/__tests__/writes-kill-switch.test.ts` | 1 | Static substring `import { initWritesKillSwitch` not found — import style changed (**Cat 1** brittle test). |

### Group N — Policy engine evaluator (Category **1** fixtures)

| File | Count | Evidence |
|------|------:|----------|
| `.../policy/engine/__tests__/evaluator.test.ts` | 8 | `ingress` layers undefined → `.length` / `.filter` TypeErrors; `allowedArtefactTypes not iterable` — fixture policy JSON not updated for nested **ingress / egress** structs. |

### Group O — Desktop UI / libs (mostly Category **1**)

| File | Count | Evidence |
|------|------:|----------|
| `.../components/ThisDeviceCard.test.tsx` | 1 | Rendered markup doesn’t contain expected pairing-code instructional string — UX copy/design drift. |
| `.../lib/__tests__/beapInboxActionTooltips.test.ts` | 1 | Tooltip string changed (“Clone …” wording) — deliberate product copy (**Cat 1** snapshot / expectation). |
| `.../lib/__tests__/inboxMessageSandboxClone.test.ts` | 1 | `undefined` vs `'Konge-AS1'` on sandbox clone meta — **`depackaged_json` shape drift** (**Cat 1**). |
| `.../lib/__tests__/hostInferenceSelectorIntegration.test.ts` | 4 | Persisted **`host-internal:…`** model id normalization vs ephemeral `:connecting` / `:checking` suffix handling — orchestrator invariant tests (**possible Cat 2** — list in Section 3). |
| `.../lib/__tests__/finalAcceptance.hostAiInvariants.test.ts` | 2 | One failure reads **`\\ufeff` BOM prefixed** bundled/main module text — filesystem / toolchain artifact; second failure merges Host rows (**Cat 5** + **possible Cat 2**). |

### Group P — Misc electron main (mixed)

| File | Count | Evidence |
|------|------:|----------|
| `.../main/vault/hsContextOcrJob.test.ts` | 2 | `validateExtractedText` rejects less aggressively than tests expect (**Cat 3** legacy strictness vs **Cat 1** tightened implementation — low structural risk). |
| `.../ingestion/__tests__/hardening.test.ts` | 2 | IPC import **`getPath`** failure + validator nested prototype test (see Group B note). Split **Cat 5** + **Cat 1**. |

---

## Section 3 — Real regressions (Category 2) — review-first ledger

These are **not adjudicated guilty** — they satisfy **Question E indicators** from the audit prompt (behavioral invariant / regression guard / coordination contract).

| Area | Tests (file + name hint) | Contract | Severity |
|------|---------------------------|----------|----------|
| **Bypass / failure-path invariant** | `b51ExtensionMergeBypass.test.ts` — §2.4, §3.2, §3.5 quarantine counts | Failure extension-merge path must not silently drop quarantine bookkeeping | **High** structural |
| **Handshake coordination** | `ipc.internal.relayPush.test.ts` (both) | Internal initiate must push capsule through coordination fallback semantics | Medium / user-visible |
| **Relay guard truth** | `internalRelayOutboundGuards.test.ts` | Misclassification expands relay attack surface | **High** structural |
| **Handshake activation** | `counterpartyKeyBinding.regression.test.ts` R2 | Accept path must reach `ACTIVE` vs stuck `ACCEPTED` after context sync | User-visible reliability |
| **Outbound queue backoff** | `outboundQueue.backoff.test.ts` — especially fetch count QB_09 | Autodrain should not regress into unbounded retries / wrong terminal codes | Medium — verify **classification rename vs loop bug** |
| **Host inference selector** | `hostInferenceSelectorIntegration.test.ts` (4 tests) | Ephemeral `:connecting` rows must stabilize persisted IDs | UX / correctness |
| **Host capabilities routing** | `listHostCapabilities.hostAiRoute.test.ts` (2) | Resolver must preserve intended WebRTC-vs-direct precedence | Medium |
| **Host AI E2E / sandbox regression** | `hostAiE2eSandboxToHostSuccess.integration.test.ts`, `sandbox_lists_remote_ollama…` | Capability publication when BEAP advertisement missing — multi-row inference | Medium |

**Not promoted to Category 2 here (default Category 1 until proven):** ingestion fixture suites (`validator` / `adversarial` / `integration` / **most** `hardening-verification`) — overwhelmingly consistent with **`validateCapsule` canonical tightening** signature.

---

## Section 4 — Fix scope groups (Phase 5 synthesis)

### Group 1 — Stale test updates (Category 1)

Includes **Groups A, B (majority), C (majority excluding §D review findings), K, L, N, O (bulk), relay fixtures, merge schema fixtures.**  
Effort:** medium–large**, highly parallelizable by directory. Dependencies: ingestion-core canon decisions should precede rewiring capsules in handshake + relay tests.

### Group 2 — Real regression fixes (Category 2)

Address **Section 3** findings in **electron main handshake + inbox extension-merge + inference resolver** stacks. Dependencies: reproduction under debugger; possibly split into **two focused PRs** (inbox merge bypass vs handshake coordination vs Host-AI resolver).

### Group 3 — Test deletions (Category 4)

Delete or replace **Group E** tests with assertions on **`processBeapPackageInline` / sealed row** observable effects instead of the stubbed drain helper.

### Group 4 — Pre-Phase-B legacy (Category 3)

Track **`hostAiRoutingCorrectness.regression.test.ts`** and **OCR strictness (`hsContextOcrJob`)** separately — possibly close as “suite obsolete” or rewrite under new inference contracts.

### Group 5 — Environmental / flaky hardening (Category 5)

**Committer harness**, **`CSS.escape` polyfill**, **electron mock completeness** (`getPath`, `BrowserWindow`), **spawn validator subprocess** for router integration test, BOM-safe static reads. Some items can piggy-back **Group 1** PRs (`evaluator.test.ts` prefers fixture fix vs environment).

---

## Section 5 — Recommended sequencing

1. **Triage Cat 4 (Group E)** — delete or rewrite to real migration surfaces (small, clarifies baseline).  
2. **Parallel track A — Harness (Cat 5 core)** — shared `electron` test mock helper + jsdom escape polyfill; unblocks dozens of correlated failures noise reduction.  
3. **Parallel track B — Section 3 (Cat 2 suspects)** — time-box investigation; promote/demote findings with traced stack + expected vs actual handshake / merge / inference states. Any confirmed structural regression blocks B-9 work.  
4. **Canon alignment (Cat 1 bulk)** — update relay + ingestion capsules + handshake hardening matrices + merge DB fixtures behind single **ingestion-core** contract reference.  
5. **Defer pure Cat 3** unless quick wins emerge.

*Batched PR suggestion:* **B-8.5** = Groups **1 + 5** (fixture + harness) where safe; **B-8.6** = **Group 2** regressions confirmed from Section 3; **B-8.7** = **Group E** removals + rewritten coverage.

---

## Section 6 — What was not verified

- Passing tests’ **adequacy** (happy-path only hazards).  
- **Coverage gaps** (missing failure-mode specs for subprocess validator, Electron integration).  
- **Performance / load** regressions — not measured.  
- **macOS/Linux** harness variance for autofill scanner / Electron mocks (audit run on Win32 only).  
- **Production Electron binary** paths — Vitest exercises **system Node**, not Electron ABI, consistent with PR B-8.3 framing.

---

### Audit metadata

| Item | Value |
|------|-------|
| Total tests (both runs) | 3703 |
| Failed tests | **201** (consistent across runs) |
| Passed / skipped / todo | unchanged vs B-8.3 summary (~3470 / 3 / 29) |
| Failing unique test files | **48** |

**End of B-8.4 classification audit.**
