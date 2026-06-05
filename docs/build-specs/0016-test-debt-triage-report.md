# 0016 — Test-debt triage report (off-rig, per `0015` Part 2)

**Status:** TRIAGE COMPLETE. Not a refactor. Zero changes to seam, email-path, or
flag-gated B2 code. One cheap test-harness fix applied; everything else classified and
registered.

**Base reconfirmed:** the failing set is pre-existing and independent of B2/B2.1/B2.2.
Confirmed against base `96981252`; none of the failures touch depackaging, the seam, or
the email path.

**Headline verdict (gates Build C):**
> **`internalInference` plumbing: SOUND.** The host-side request → inference →
> result/error delivery path is present, coherent, and *more* hardened than when its
> failing unit tests were written. Every host-plumbing failure is explained by a stale
> test stub or a stale partial mock — not by a defect in the request/result-over-handshake
> machinery. One class-(b) *caveat* exists on the **sandbox-side entry guard**
> (`runSandboxHostInferenceChat`), which is the caller, not the host plumbing
> `RemoteHandshakeExecutor` will template on. Evidence in §4.

---

## 1. Method

Each suspect area was run **in isolation** (single-file and single-dir) to separate
genuine, reproducible failures from parallel-load artifacts, then reconciled against the
whole-repo run. Production code paths were read to determine whether each red test asserts
a contract the code still owns (broken code) or a contract the code has deliberately
superseded (stale test).

A note on counts: the whole-repo run reports **28** failing tests. Running
`internalInference/` *alone* reports **12** failing tests **plus ~10 file-level load
failures that PASS in the whole-repo run** — i.e. they are load-*order* dependent (they
need a sibling suite to initialise shared module state first). That asymmetry is itself a
class-(c) signal and is recorded below; those 10 are **not** part of the canonical 28.

---

## 2. Classification table

Legend: **(a)** stale test (asserts superseded behavior) · **(b)** genuinely broken code ·
**(c)** environment/timing (the parallel-load class) · **(d)** orphaned (tests for
dead/untracked code).

| # | Area | File · test | n | Class | Root cause (one line) | Action |
|---|------|-------------|---|-------|-----------------------|--------|
| 1 | internalInference | `internalInferenceService.test.ts` › *host dispatch with mocks* (delivery group) | 6 | **(a)** | Tests stub `getHandshakeDbForInternalInference`→`null`; current delivery rejects null-DB with `verified_direct_http_required` before the fetch (superseded DB-less delivery contract). | Registered §5. Fix = refactor-scope (DB mock satisfying policy + endpoint verify). **Not fixed.** |
| 2 | internalInference | `hostAiDirectBeapAdPublish.explicitPolicyDeny.test.ts` › *does not arm republish timer* | 1 | **(a)** | Partial mock of `../p2pEndpointRepair` missing the new `registerP2pEnsureCacheInvalidator` export → mock factory throws. | **FIXED** (added export to mock). ✅ green. |
| 3 | internalInference | `hostAiDirectBeapAdPublish.test.ts` › *publish/retry scheduling* | 3 | **(a)** | Same missing-export drift (now fixed); residual: mock models the cache-invalidator as a no-op so the invalidation→republish the test expects never fires. | Mock export added; residual is refactor-scope. Registered §5. |
| 4 | internalInference | `internalInference.directHost.regression.test.ts:532` › *Host mode cannot use Sandbox host-chat entry point* | 1 | **(b)** | `runSandboxHostInferenceChat` does **not** fast-reject a host-mode caller with `INVALID_INTERNAL_ROLE`; it proceeds and **hangs** (5000 ms timeout). Sandbox-entry guard, not host plumbing. | Registered §5 (full entry). **Not fixed.** No timeout bump (a hang is not a timeout). |
| 5 | internalInference | `hostAiE2eSandboxToHostSuccess.integration.test.ts` › *two Ollama models → host_internal row* | 1 | **(a)/(b)** | Expects **2** `host_internal` rows from a 2-model capabilities POST; gets **1** (row aggregation now one-row-per-host, not one-per-model — needs owner confirmation). | Registered §5. **Not fixed** (ambiguous a-vs-b; needs owner ruling). |
| 6 | llm/diagnostics | `diagnostics.test.ts:67` › *should write logs with timestamp* | 1 | **(c)** | Synchronous `fs.readFileSync` immediately after `ollamaLogger.log()`; under parallel load the buffered/rotating write is not flushed yet. Passes in isolation. | Registered §5. Real fix = flush-before-read / per-test tmp log dir (non-cheap). Timeout treatment N/A (not a timeout). |
| 7 | llm/diagnostics | `diagnostics.test.ts:78` › *should handle different log levels* | 1 | **(c)** | Same write-flush race as #6. | As #6. |
| 8 | llm/diagnostics | `diagnostics.test.ts:141` › *should simulate Vulkan unhealthy scenario* | 1 | **(c)** + minor **(b)** | Branch only runs where Vulkan is unhealthy (headless Linux / CI): then `vulkan.issues.length` is 0 — i.e. the diagnostics layer marks Vulkan unhealthy without populating `issues[]`. Environment-conditional. | Registered §5. Minor code note logged. **Not fixed.** |
| 9 | sealed-storage | `structural-property.test.ts:362` › *key buffers returned by provider are zeroized after use* | 1 | **(a)** | Asserts the gate zeroizes the **provider's** buffer; the documented, intentional contract (`sealed-storage/index.ts:124`) is the opposite: the gate zeroizes its **own copy**, *never* the provider buffer (`index.ts:253/419/674`). **Security posture intact.** | Registered §5 (HIGH-visibility). Contradicts documented contract → flagged; flipping a security assertion needs the storage owner. **Not fixed.** |
| 10 | extension beap-builder | `pr41OrchestratorReads.test.ts` › *session → artefact produced* group | 6 | **(a)** | `buildSessionImportArtefact` was refactored to take an opaque `sessionBlob` (embed-verbatim, decode on receive side); the test's `extractArtefactInput` helper still builds the old `agents/agentBoxes/displayGrids` shape, so `sessionBlob` is undefined → `{ok:false}` (`buildSessionImportArtefact.ts:78`). | Registered §5. Fix = refactor-scope (rewrite helper + receive-side assertions). **Not fixed.** |
| 11 | extension beap-builder | `sandboxCloneCopy` group (`…failedGeneric` assertion, ~:196) | 1 | **(a)/(c)** | Adjacent beap-builder copy-string/branch assertion; not deep-diagnosed (out of the internalInference focus). | Registered §5 as a low-priority follow-up. |

**Cheap fixes applied this task:** #2 (fully green) and the shared mock-export for #3.
No class-(d) orphaned tests were found — every failing test references live, imported
code. No failure was fixable by the established timeout treatment (the directHost case is a
hang, not a timeout; the diagnostics cases are flush/env races, not timeouts), so no
`vi.setConfig` bumps were applied — doing so would have been a misleading "fix."

---

## 3. What was fixed (with diffs in spirit)

**`hostAiDirectBeapAdPublish.explicitPolicyDeny.test.ts` and `hostAiDirectBeapAdPublish.test.ts`**
— the `vi.mock('../p2pEndpointRepair', …)` factories were missing the
`registerP2pEnsureCacheInvalidator` export that the production module now exposes
(`p2pEndpointRepair.ts:75`) and the publish path imports at init. Added:

```ts
// Triage 0015/0016: module gained this export; partial mock must include it.
registerP2pEnsureCacheInvalidator: vi.fn(),
```

Result: `explicitPolicyDeny` is fully green (1/1). `hostAiDirectBeapAdPublish.test.ts` no
longer throws on the missing export; its 3 residual failures are a deeper retry/cache-
invalidation modelling gap (registered §5, item 3) and are refactor-scope, not triage.

This is a pure **test-harness** change — no production code, no seam/email/B2 code touched.

---

## 4. `internalInference` — full diagnosis (the Build-C gate)

Build C's `RemoteHandshakeExecutor` is modelled on the assumption that *"the internal-
inference pattern is live and proven."* Re-verified directly against the code.

### 4.1 The host request/result-over-handshake plumbing is present and coherent
`p2pServiceDispatch.tryHandleInternalServiceP2P` implements the full state machine:
- **`internal_inference_request`** → gate `shouldRejectHttpInternalInferenceRequest()`
  (503 `P2P_INFERENCE_REQUIRED` when the P2P request-plane is mandated and HTTP-compat is
  off) → `handleInternalInferenceRequest` → `finishHostInferencePost` →
  `sendHostInferenceResult` (`p2pServiceDispatch.ts:157-176`).
- **`internal_inference_result` / `internal_inference_error`** (sandbox side) → policy +
  device-binding checks → `resolveInternalInferenceByRequestId` resolves the pending
  request and ACKs 200 (`p2pServiceDispatch.ts:179-244`).
- **Delivery** (`internalInferenceTransport.ts:1704-1846`) prefers the **WebRTC data
  channel** (`sendInternalInferenceWireOverP2pDataChannel`) and falls back to **verified
  direct HTTP** only when the transport decider + handshake DB confirm the endpoint is the
  trusted counterparty's direct ingest (`hostAiVerifiedHttpForHostSendResult`,
  `:112-124`, `:1805-1819`).

### 4.2 The bulk of the suite proves the plumbing works
**214 / 226** `internalInference` tests pass, including: transport decision
(`internalInferenceTransport.decide`), route resolution and predicates, policy gating
(`policy.internalInference`, `hostInferenceCore.policy`), per-handshake rate limiting, the
**503 `P2P_INFERENCE_REQUIRED`** gate, the **403 external-record** rejection, schema
validation, single-owner P2P session, and log redaction. These are the exact behaviors
`RemoteHandshakeExecutor` will rely on, and they are green.

### 4.3 Why the 6 `internalInferenceService` failures are NOT a plumbing defect
All six fail because the suite stubs `getHandshakeDbForInternalInference()` → `null`
(deliberately, "so policy resolution falls back to the store instead of `db.prepare()` on
`{}`"). The *current* delivery path treats a null DB as "cannot verify the direct endpoint"
and returns `{ ok:false, code: SERVICE_RPC_NOT_SUPPORTED, error: 'verified_direct_http_required' }`
**before** `postServiceEnvelopeDirect` (`internalInferenceTransport.ts:1805-1819`). Hence
no body is POSTed (`expected undefined…`) and the compat request yields 503
(`expected 503 to be 200`). The tests encode the **older DB-less "just POST to the
endpoint"** delivery contract; the code has since added a DB-backed trust check — a
**hardening**, correctly classified as test staleness (a). Updating them requires a DB
mock that simultaneously satisfies policy resolution *and* `assertP2pEndpointDirect`, which
is refactor-scope and out of this triage.

### 4.4 The one caveat — sandbox-side, not host plumbing
`internalInference.directHost.regression.test.ts:532` shows `runSandboxHostInferenceChat`
failing to fast-reject a host-mode caller (hangs to the 5 s timeout instead of returning
`INVALID_INTERNAL_ROLE`). This is the **sandbox caller entry point**, not the host
request/result-over-handshake plumbing. It does **not** downgrade the host-plumbing
verdict, but Build C should treat the sandbox-entry role guard as **unproven** and add an
explicit fast-reject + test when it specs the sandbox analog.

### 4.5 Verdict
> **internalInference plumbing: SOUND** for the host request/result-over-handshake path
> that `RemoteHandshakeExecutor` templates on (evidence §4.1–§4.3). **Caveat:** the
> sandbox-entry role guard is a class-(b) hang (§4.4) and must be re-proven as part of
> Build C's sandbox side, not assumed live.

---

## 5. Class-(b) register + non-cheap class-(a) follow-ups

Per `0015` Part 2.3, broken code is **not fixed here**; each gets a short entry. Genuine
class-(b) items are marked ⚠; refactor-scope stale (a) items are listed so future builds
inherit the diagnosis, not the archaeology.

1. ⚠ **Sandbox-entry role guard hang** — `sandboxHostChat.ts` via
   `internalInference.directHost.regression.test.ts:532`.
   *Symptom:* host-mode call to `runSandboxHostInferenceChat` never returns
   `INVALID_INTERNAL_ROLE`; hangs to the 5 s test timeout.
   *Suspected cause:* the role guard is missing or sits **after** a blocking `await`
   (session/probe wait) instead of being the first check.
   *Blast radius:* sandbox host-chat entry only; does not affect host-side dispatch. **Re-prove before Build C's sandbox analog.**

2. ⚠ **Vulkan unhealthy without issues** — `hardware-diagnostics` via
   `diagnostics.test.ts:141`.
   *Symptom:* on machines where Vulkan is unhealthy, `diag.vulkan.issues.length === 0`.
   *Suspected cause:* the unhealthy branch sets `healthy=false` without pushing a reason
   into `issues[]`.
   *Blast radius:* diagnostics/telemetry display only; no inference correctness impact.

3. **Capabilities row aggregation (a-vs-b, owner ruling needed)** —
   `hostAiE2eSandboxToHostSuccess.integration.test.ts`.
   *Symptom:* 2-model capabilities POST yields 1 `host_internal` row, test expects 2.
   *Suspected cause:* intentional move to one-row-per-host (stale test) — **or** a
   regression dropping per-model rows. Needs the list-targets owner to confirm intent.
   *Blast radius:* model-picker UI row count; not the inference path.

4. **Stale DB-less delivery contract** — `internalInferenceService.test.ts` *host dispatch*
   delivery group (6). Stale (a); see §4.3. Fix = DB mock satisfying policy + endpoint
   verify (refactor-scope).

5. **adPublish retry/cache-invalidator modelling** — `hostAiDirectBeapAdPublish.test.ts`
   (3 residual). Stale (a); the no-op `registerP2pEnsureCacheInvalidator` mock never fires
   the invalidation→republish the test expects. Fix = model the invalidator callback +
   fake-timer retry (refactor-scope).

6. **Sealed-storage zeroize test contradicts documented contract** —
   `structural-property.test.ts:362`. Stale (a), **HIGH visibility (security-adjacent)**.
   The test asserts the *provider* buffer is zeroized; `sealed-storage/index.ts:124`
   documents — and the code implements (`:253/419/674`) — zeroizing the gate's **copy**,
   never the provider buffer. **Security posture is intact**; the test is wrong. Flipping a
   security assertion needs the storage owner; not done unilaterally.

7. **beap-builder artefact API refactor** — `pr41OrchestratorReads.test.ts` (6). Stale (a);
   `buildSessionImportArtefact` now embeds an opaque `sessionBlob`
   (`buildSessionImportArtefact.ts:37-58,78`); the test helper builds the pre-refactor
   shape. Fix = rewrite helper + receive-side assertions (refactor-scope).

8. **beap-builder `sandboxCloneCopy` copy/branch assertion** (~:196). Low-priority (a)/(c);
   not deep-diagnosed (outside the internalInference focus).

---

## 6. Contradictions reported (not absorbed), per `0015` Part 2.4

1. **Tension in the fix policy vs. "triage, not refactor."** `0015` Part 2.2 says class-(a)
   stale tests "get updated where the correct current behavior is unambiguous from code."
   For items 4, 6, 7 the correct behavior *is* unambiguous, but the *update* is a multi-file
   test rewrite (DB-trust mock; security assertion flip; opaque-blob helper + receive-side
   assertions) — i.e. refactor-scope, which Part 2 explicitly excludes. Per "report
   contradictions before absorbing them," these were **classified and registered, not
   rewritten.** Recommend a follow-up "stale-test refresh" pass owned by each module's
   owner.
2. **No class-(d).** The spec anticipated orphaned tests; none were found. Every failing
   test imports live code. No `.skip` annotations were added.
3. **Established timeout treatment did not apply.** The two prior parallel-load fixes
   (`hardening`, `b5ExtensionMerge`) were import-graph load timeouts. None of the 28 here is
   that shape: the directHost case is a genuine hang (item 1), the diagnostics cases are
   write-flush/env races (items 6–7 in the table). Applying `vi.setConfig` would not have
   fixed them and would have masked the real causes, so it was not applied.

---

## 7. Net effect

- **1 test file fully recovered** (`explicitPolicyDeny`) via a pure mock-export fix.
- **Shared mock drift removed** from the second adPublish file (residual failures now have
  a clean, registered cause instead of a misleading mock crash).
- **The Build-C gate is answered: `internalInference` plumbing is SOUND** for the host
  request/result path, with one explicitly-scoped sandbox-entry caveat to re-prove.
- The remaining red is now **diagnosed debt**, not archaeology: every item has a class, a
  root cause with file:line, a blast radius, and an owner-scoped fix recommendation.

**Unchanged:** flags (depackage cutover OFF everywhere; B1 validation in soak), the seam,
the email path, and all flag-gated B2 code. The V-series (`0009`) remains the sole B2
acceptance gate.
