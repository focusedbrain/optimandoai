# B-8.4d — Definitive Triage of Remaining Failures (Post B-8.4c)

**Scope.** Diagnostic classification only — **no fixes**.  
**Method.** Workspace-root `pnpm exec vitest run` with `--reporter=json`  
(`vitest-triage-output.json`), Windows, Node toolchain as in CI dev. Failures
flattened to `vitest-triage-failures-flat.json` (one row per failing `it`).

**Run snapshot (authoritative for this report)**

| Metric | Value |
|--------|------:|
| Total tests | 3697 |
| Failed | **147** |
| Passed | 3518 |
| Skipped | 3 |
| Pending | 3 |

**Important discovery (beyond the “147” headline).** Vitest also reports
**39 test files** that **failed during collection / module load** with **zero**
`assertionResults` rows. Those suites did not execute their `it` bodies; their
failures are **not** in the 147-row flat list. They are documented in
**Section 4.2** and are overwhelmingly **Category 5** (same `getPath`, globals,
and resolution errors).

---

## Section 1 — Triage summary (the 147 failing `it` blocks)

| Bucket | Count | Notes |
|--------|------:|--------|
| **Category 1 (stale test)** | **90** | Fixtures, schemas, brittle static expectations, Phase B canon drift vs test; includes policy-engine fixtures missing `ingress` shape, sealed-gate/seal-helper drift, migration substring tests vs current sources. |
| **Category 2 (real regression)** | **0** | **No failure met the bar:** test encodes canon contract **and** production contradicts canon with evidence excluding harness/fixture (**Section 3**). |
| **Category 5 (environmental / harness)** | **52** | Counted failures whose **recorded heads** match harness gaps: Electron `app.getPath` (11), WRVault write canary (9), incomplete autofill mocks / `reading 'valid'` (14), fake `db` without `prepare` (4), validator subprocess unavailable (1), **`CSS`/label resolution `reading 'escape'`** (10 = jsdom missing `CSS.escape`), jsdom textarea `value` setter (1), Vitest incomplete `electron` mock — `BrowserWindow` (1), plus **`messageRouter.ingestTransaction`** validator error (included in subprocess count). |

**Tracked separately (still inside the 147 where applicable)**

| Bucket | Count | Notes |
|--------|------:|--------|
| **Question C — QB_09** | **1** | `outboundQueue.backoff.test.ts` — `QB_09_post_failure_autodrain_retries_without_second_user_call` — **do not remap** into Cat 1/2/5 until diagnostic completes (B-8.4c scope statement). |
| **Category 3 legacy (within 147)** | **4** | `hsContextOcrJob.test.ts` ×2 (`validateExtractedText` markup strictness); `hostAiRoutingCorrectness.regression.test.ts` ×2 (explicit “expected failures until resolver hardens” — assertion now conflicts with tightened routing; **policy decision**, not Phase B ingestion bypass). |

**Cross-check:** 90 + 52 + 1 (QB_09) + 4 (Cat 3) = **147**.

**Excluded from Phase B remediation (conceptual)**

- Outside the 147, many suites are skipped under guards or never reach assertions.
- The **~7** “Category 3” headline from B-8.4 is an audit estimate; measured
  **within** this run’s failed `it` set is **four** legacy-titled rows above.

---

## Section 2 — Category 1 by group

| Group ID | Root cause | Affected areas (representative files) | Count (approx.) | Fix shape |
|----------|-------------|---------------------------------------|-----------------|----------|
| **C1-SEAL-B5** | Sealed-update tests use **`UPDATE`/merge paths** incompatible with **`[SEALED_GATE]`** row-id binding; seals bound to ephemeral `row-*` IDs while updates target **`msg-*`** shells. | `b5ExtensionMerge.test.ts` §F sealed-gate rows | **4** (SealVerificationError) | Align tests with **`prepareSealedOperationalUpdate`** / operational re-seal helpers (audit Group C pattern). |
| **C1-FIXTURE-B5** | Validator / artefact expectations vs current **`validateDecryptedBeapContent`** (`ARTEFACT_PURPOSE_*`, **`MISSING_REQUIRED_FIELD`** ordering). | `b5ExtensionMerge.test.ts` §E.6, §F.4 | **2** (AssertionError) | Refresh capsule/fixture hashes and purpose metadata to Phase B shape. |
| **C1-MODULE-B5G** | **Removed or relocated module** **`../beapInboxClonePrepare`** from merge test import path. | `b5ExtensionMerge.test.ts` §G.2 | **1** | Repoint import to canonical module **or** delete obsolete sandbox-clone IPC test stub. |
| **C1-DB-B4** | In-memory **`migrateHandshakeTables`** harness missing **`relationship_id`** column vs production migration v66+. | `b4P2PRelayMigration.test.ts` §3.1–3.2 | **2** (SqliteError) | Extend test harness schema to match **current** migrations. |
| **C1-DB-MERGE** | Missing **`inbox_attachments`** table in thin schema (Att-2 binding). | `mergeExtensionDepackaged.validation.test.ts` | **3** | Add table + columns mirroring **`b5ExtensionMerge`** harness. |
| **C1-DB-B72** | **`beap_package_json`** column omitted from test DDL vs real inbox DDL. | `b72DecryptedContentReseal.test.ts` | **1** | Align DDL with **`db.ts` / migration** canon. |
| **C1-B4-IMPORT** | Same suite as Group F in B-8.4 audit: **8×** failures are **`getPath`** (see Cat 5); **2×** only are schema — already counted above. When `getPath` is fixed, remaining work is **still** §3 migration harness (**C1**). | `b4P2PRelayMigration.test.ts` | *(split)* | Electron mock (**5**) + schema (**1** above counts). |
| **C1-B7IPC** | `expected false to be true` on **resealWithAiAnalysis**/PDF paths — mocks / sealed row shape drift. | `b7IpcContentUpdates.test.ts` | **5** | Seal helpers + key provider mocks (B-8.4 audit Group C). |
| **C1-POLICY** | **`ingress`** / **`allowedArtefactTypes`** **undefined** in layer fixtures → `intersectIngress` / `verifyNoEscalation` throws. | `policy/engine/__tests__/evaluator.test.ts` | **8** | Build **minimal valid `IngressPolicy`** for each synthetic layer (not a canon bypass — production rightly assumes defined objects when API is exercised). |
| **C1-STEP8-HOSTAI** | Target discovery matrix vs **resolver / ledger / sandbox mode** tightening after Phase B internal inference work. | `listInferenceTargets.step8.test.ts` | **8** | Refresh expectations and probe mocks (**B-8.4 audit Group H drift** — not flagged as ingestion bypass). |
| **C1-EXTENSION-BEAP** | Package builder / session artefact / crypto expectations vs Phase B tightened builder rules. | `BeapPackageBuilder.test.ts`, `sessionImportArtefact.test.ts`, related | **≈13** | Snapshot + bitmask / field expectations (audit Group K). |
| **C1-HANDSHAKE-REFRESH** | **`buildContextBlocks`** undefined `block_type` / scope (API shape drift). | `beap-builder/.../handshakeRefresh.test.ts` | **4** | Align test doubles with builder return shape. |
| **C1-MIGRATION-TEXT** | Static “migration” assertions that **production TS still contains `peerX25519PublicKey`**, etc.: **today `rpcTypes.ts` still declares optional PQ/X25519 fields** (_compat / hybrid_), so failures are **stale prohibition tests**, not seal bypasses. **`C10` empty read** suggests **wrong file path or BOM handling** — see **dual note** in §4. | `migration.test.ts` | **5** | Relax or redefine “cleanup done” predicates per canon-owner **or** fix read path normalization (UTF-8 BOM strip). |
| **C1-RENDERER-UX** | UI copy (`ThisDeviceCard`, `beapInboxActionTooltips`) and **`extractSandboxCloneUiMeta`** field expectations. | `ThisDeviceCard.test.tsx`, `beapInboxActionTooltips.test.ts`, `inboxMessageSandboxClone.test.ts`, `finalAcceptance.hostAiInvariants.test.ts` (the **grep/static** assertions, not BOM) | **≈6** | Update copy assertions; **`finalAcceptance` static-regex** failures may overlap **BOM/static read** (see §7). |

---

## Section 3 — Category 2 (real regression)

**Section 3 empty: no real regressions found.**

For each high-signal structural test reviewed against canon:

- **`hardening.test.ts`** (*“IPC handler does not export `processHandshakeCapsule`”*): failure head is **`getPath`**, not violation of the named assertion — **`ipc.ts` remains the correct module**, and **`Object.keys`** never reached execution (**Category 5**).

- **`hardening.test.ts`** / **`processHandshakeCapsule` rejects fabricated input**: not in failing set (runs when env loads).


- **`b5ExtensionMerge`** **SealVerificationError**: matches B-8.4 **Group C — test harness vs sealed gate** pattern; enforcement triggers on **fixture UPDATE pattern**, not on missing gate in prod.

- **`migration.test.ts`** “no **`peerX25519PublicKey`**”: production **still** contains the symbol (**compat**); the test asserts a cleanup state the codebase has **not taken** — that is **requirements vs test staleness**, not proof of **validator bypass**.

**Recommendation:** If canon-owner mandates **absolute zero legacy key strings**, that becomes a **product cleanup PR**, not proof of **ingestion bypass**.

---

## Section 4 — Category 5 by infrastructure gap

### 4.1 — Counted inside the **147** `it` failures

| Infrastructure gap | Signature | Count | Fix approach |
|----------------------|-----------|------:|--------------|
| **Electron `app.getPath`** | `Cannot read properties of undefined (reading 'getPath')` | **11** | Shared **`vi.mock('electron')`** with `app.getPath`/`userPath` used by **`getAccountsPath`**, **`orchestratorModeStore`**, etc. (**5a** — single mock module). |
| **WRVault write canary** | `[WRVault Write Canary]` | **9** | Test-only shim: **`commitInsert`** pathway or **`__ALLOW_TEST_DOM_WRITE`** (canon-reviewed) (**5b** touches security-critical code — owner review). |
| **Incomplete autofill trust chain** | `reading 'valid'` (`checkFingerprintValid`) | **14** | Mock **`chrome`** / **`checkFingerprint`** dependencies (**5a**). |
| **`CSS.escape` in jsdom** | `reading 'escape'` (`resolveLabel` / `resolveRawLabel`) | **10** | Polyfill **`globalThis.CSS`** in **`setupTests`** (**5a**). |
| **Non-SQLite stub `db`** | `db.prepare is not a function` | **4** | **`better-sqlite3` :memory:** or minimal typed mock (**5a**). |
| **Validator subprocess** | `Validation service unavailable` | **1** | Start subprocess in Vitest **`globalSetup`** (**5b** architectural) **or** mock router ingest (**5a** pragmatic). |
| **jsdom `value` setter** | `Cannot set property value … only a getter` | **1** | Fixture element constructor / polyfill (**5a**). |
| **Incomplete Vitest `electron` mock** | `No "BrowserWindow" export is defined` | **1** | Extend `vi.mock('electron')` (**5a**). |
| **`messageRouter.ingestTransaction`** | (same subprocess / service error) | **(same 1)** | Same as validator row. |

**Sum:** **52**.

### 4.2 — **Suite-load failures** (not in the 147 list)

**39 files** with **collection-time** errors (representative buckets):

| Pattern | Approx. files | Classification |
|---------|---------------|----------------|
| **`getPath` undefined** during import of Electron main handshake/ingestion/p2p/email modules | **~25** | **Category 5** — identical root cause as §4.1; once shared mock lands, **`handshake-e2e-hardened.test.ts`**, ingestion **`e2e.*`** suites, **`beapSync`**, **`executeToolRequest`**, p2p relay suites **should resume**. |
| **`describe is not defined`** (`extension-chromium` automation + NLP suites) | **~6** | **Category 5** — Vitest **globals / pool / environment config** mismatch (`describe` not injected); fix **`vitest.config`** `globals` **or** explicit imports (**5b** vs **5a** depending on project standard). |
| **`beforeEach is not defined`** (`beapCrypto.test.ts`) | **1** | **Category 5** — same globals / environment issue. |
| **`Failed to load url @jest/globals`** (`llm/hardware-capability` + **`diagnostics`**) | **2** | **Category 5** (**5a**) — migrate to **`vitest`** imports **or** add alias. |
| **`Failed to load ../ingestion/distributionGate`** (`invariants.test.ts`) | **1** | **Category 1 × 5 borderline** — incorrect **vite resolve** relative to moved **`distributionGate`** module (**prefer Cat 1** path fix **or** **Cat 5** if intentional lazy boundary). |

**Integration cluster implication:** **`handshake-e2e-hardened.test.ts`** and **all five** ingestion **`e2e.*`** files appear **only** here (load **`getPath`**). Until the mock lands, triage cannot observe their **logical** assertions — **no evidence** of ingestion bypass was obtainable from executed assertions.

---

## Section 5 — Integration test cluster deep-dive

### 5.1 — `b4P2PRelayMigration.test.ts` (**10** failures — all counted in 147)

| Failure type | Count | Category |
|----------------|-------|----------|
| `getAccountsPath` → **`getPath`** | **8** | **5** |
| **`relationship_id` missing** | **2** | **1** |

**Pattern:** Concentrated (**not scattered** across unrelated products). Risk: **medium engineering** noise; **low** bypass risk once harness fixed.

### 5.2 — `handshake-e2e-hardened.test.ts`

| Executed failures | Category |
|-------------------|-----------|
| **0 `it` rows** (file fails load) | **5** (**`getPath`**) |

**Risk:** Highest **latent value** suite for cross-cutting handshake + ingestion; blocked entirely by Electron harness. Any future **Category 2** suspicion must **re-run post-harness-fix**.

### 5.3 — `finalAcceptance.hostAiInvariants.test.ts` (**2** failures)

| Test | Evidence | Category |
|------|----------|----------|
| Host AI ledger presence assertion | AssertionError `false` vs `true` | **1** (selector / **`getAggregated`/ledger** semantics post B-8.4c resolver work) |
| Static regex grep of main-process source | Head shows **`\ufeffimport`** prefix in read string | **5** (**BOM** / static read normalization) |

**Mixed pattern** in one file.

### 5.4 — `migration.test.ts` (extension) (**5** failures)

| Pattern | Category |
|---------|----------|
| `rpcTypes.tsx` etc. **still contain forbidden substrings** (e.g. `peerX25519PublicKey`) | **1** (test assumes cleanup already done — **premise drift**) |
| `C10` **empty source** read | **1** (**path/BOM**/wrong target — classify **dual** §7). |

### 5.5 — Ingestion e2e tests (`authorization`, `e2e.http/ipc/transport/websocket`, `entrypoint.guard`, `entrypoints.guard.e2e`)

| Executed failures | Category |
|-------------------|-----------|
| **0** (`it`s not executed) | **5** — collection **`getPath`** |

**Canon note:** Architectural canon (“**no ingestion bypass**”) **cannot be re-validated** from these suites until they load — **defer** structural conclusions to **post-harness** run.

---

## Section 6 — Recommended fix sequencing

1. **No Category 2 blockers** surfaced — **`B-8.4d-i`** (Cat 1) and **`B-8.4d-iii`** (Cat 5) may proceed **in parallel**.

2. **QB_09** (**`B-8.4d-ii` omission** unless diagnostic proves bug): unchanged — **standalone diagnostic PR**.

3. **Category 3** OCR + hostile matrix: **tracked**; resolving may be **resolver policy** (**product**) vs **relax test** (**test debt**).

4. **Suggested 5 workstream split**
   - **5a-pr (fast):** Electron **`app`** mock (**main + preload import chains**); **`CSS.escape`** polyfill; **`@jest/globals` → vitest**; **`BrowserWindow`** on **`vi.mock`**; **`describe`** globals for extension packages.
   - **5b-pr (architectural):** validator **subprocess** in CI/Vitest; **WRVault canary** test seam (security review mandatory).

---

## Section 7 — What was not verified

- Suites **skipped** by `skipIf(!Database)`, environment gates, **or `.todo()`** (`numPendingTests: 3`).
- **`handshake-e2e-hardened`** / ingestion **e2e** **logical assertions** (**blocked at load**).
- **Windows vs Linux**-only differences (paths, native modules).
- Whether **QB_09** classification changes after coordinator mock stabilizes (**fetch count coupling**).


- Whether **`finalAcceptance`** static reads should **always strip BOM** (tooling policy).

---

### Artifact references (local workspace)

Primary machine-readable extracts (from this triage):

- `code/code/vitest-triage-output.json` — full Vitest JSON report (`numFailedTests: 147`)
- `code/code/vitest-triage-failures-flat.json` — one object per failing `it`

Cross-reference: `docs/phase-b/B-8-4-TEST-FAILURE-AUDIT.md`, `docs/phase-b/B-8-4a-CATEGORY2-INVESTIGATION.md`.
