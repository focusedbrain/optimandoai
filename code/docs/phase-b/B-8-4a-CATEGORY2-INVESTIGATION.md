# B-8.4a Investigation — Category 2 Suspect Classification

**Scope.** Diagnostic classification only — **no code changes**.  
**Repository.** `apps/electron-vite-project` and related packages under workspace root.  
**Method.** Read failing tests + production sources; run focused Vitest where needed; compare to in-code “canon” comments and migration notes.

## Count note (B-8.4 headline “~14” vs measured failures)

The B-8.4 audit grouped **suspect areas** (~14 bullets). Across the flagged files there are **`20` discrete failing assertions** today (Vitest granularity). Treat **20** as the investigated test-failure cardinality; “14” is a headline cluster count, not a strict 1:1 with failing `it(...)` bodies.

---

## Section 1 — Per-failure classification

| Source | Approx. failing line (`expect`) | Audit group | Final classification | Severity (if regression) |
|--------|----------------------------------|-------------|----------------------|---------------------------|
| `electron/main/email/__tests__/b51ExtensionMergeBypass.test.ts` | ~353 §2.4 quarantine row count | I | **Reclassified as stale** (test mocks) | — |
| `electron/main/email/__tests__/b51ExtensionMergeBypass.test.ts` | ~424 §3.2 drain processed/quarantine | I | **Reclassified as stale** | — |
| `electron/main/email/__tests__/b51ExtensionMergeBypass.test.ts` | ~473 §3.5 pendingCount notify | I | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/internalRelayOutboundGuards.test.ts` | ~13 `initiate` envelope predicate | II | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/ipc.internal.relayPush.test.ts` | ~145 success / relay push | II | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/ipc.internal.relayPush.test.ts` | ~222 success / coordination_unavailable | II | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/counterpartyKeyBinding.regression.test.ts` | ~166 state ACTIVE | II | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/outboundQueue.backoff.test.ts` | ~298 QB_09 fetch counts | II | **Ambiguous** | — |
| `electron/main/handshake/__tests__/outboundQueue.backoff.test.ts` | ~428 QB_16 `failure_class` | II | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/outboundQueue.backoff.test.ts` | ~493 QB_17 `failure_class` | II | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/outboundQueue.backoff.test.ts` | ~513 QB_18 log substring | II | **Reclassified as stale** | — |
| `electron/main/handshake/__tests__/outboundQueue.backoff.test.ts` | ~610 QB_22 reregister spy | II | **Reclassified as stale** (harness/env) | — |
| `src/lib/__tests__/hostInferenceSelectorIntegration.test.ts` | 4 failing `it(...)` blocks (persisted id vs ephemeral `modelId`) | III | **Ambiguous** | — |
| `electron/main/internalInference/__tests__/listHostCapabilities.hostAiRoute.test.ts` | ~177 case (1) `resolveDirect` not called | III | **Ambiguous** | — |
| `electron/main/internalInference/__tests__/listHostCapabilities.hostAiRoute.test.ts` | ~212 case (3) same | III | **Ambiguous** | — |
| `electron/main/internalInference/__tests__/hostAiE2eSandboxToHostSuccess.integration.test.ts` | ~315 targets length | III | **Reclassified as stale** | — |
| `electron/main/internalInference/__tests__/sandbox_lists_remote_ollama_models_even_when_beap_endpoint_missing.regression.test.ts` | ~323 targets length | III | **Reclassified as stale** | — |

*Row for `hostInferenceSelectorIntegration.test.ts` summarizes **four** failing tests that share Section 4 question **A);** ambiguous total **7** = 4 + QB_09 + both `listHostCapabilities` rows.*

**Totals**

| Classification | Count (of 20 failures) |
|----------------|------------------------|
| Confirmed real regression | **0** |
| Reclassified as stale | **13** |
| Ambiguous | **7** |

---

## Section 2 — Confirmed real regressions

**None.** No failure in this slate met the bar **test expectation == canon directive** AND **production behavior diverges in a way that violates that directive**, with independent evidence excluding test/mock drift.

Most items that *looked* regression-shaped (ACTIVE transition, outbound `failure_class`, Host route ordering) traced to explicit in-code gates, implemented `failure_class` writes, or test harness gaps.

---

## Section 3 — Reclassified as stale (evidence shorthand)

### Group I — `b51ExtensionMergeBypass.test.ts` (3)

- **Canon intent (B-5.1 / merged code):** `mergeExtensionDepackaged.ts` documents sealed-gate semantics and quarantine-vs-retry buffer behavior consistent with Phase B prompts.
- **Actual failure mechanism:** stderr shows `[MERGE] encryptForQuarantine failed: undefined` because the Vitest mock returns `{ ciphertext, nonce, ephemeralPublicKey }` while **`encryptForQuarantine` returns `{ ok: true; blob } | { ok: false; error }`** (`electron/main/quarantine-encrypt/index.ts`). `mergeExtensionDepackaged.ts` guards `if (!encResult.ok)`.
- **Why not a canon bypass:** Shell-row no-write + retry-buffer path tests **already pass**. Only the quarantine-write path breaks at **encryption mock incompatibility**.
- **Also:** mocks use `storageId` / `sha256`; production expects `storage_id`, `blob_sha256`, `blob_size_bytes` from `writeQuarantineBlob` — even after `ok:true`, mocks would remain wrong until aligned.

### Group II — `internalRelayOutboundGuards.test.ts` (1)

- **Production comment + code (`internalRelayOutboundGuards.ts`):** Phase 3 explicitly includes **`initiate`** in `RELAY_ENVELOPE_INTERNAL_WIRE_TYPES` (“initiate is now sent via coordination relay”).
- **Test expectation:** `{ capsule_type: 'initiate' }` should be **not** an internal relay envelope.
- **Conclusion:** test predates Phase 3 routing change; update expectation to `true` (or split legacy vs relay-envelope coverage).

### Group II — `ipc.internal.relayPush.test.ts` (2)

- **Production contract (`handshake/ipc.ts`):** internal initiates require **`counterparty_pairing_code` → `normalizePairingCode` → `validateInternalInitiateContract`** with `receiver_pairing_code` before building the initiate capsule; counterparty UUID alone is no longer sufficient for the “new” internal model.
- **Test payload:** supplies `counterparty_device_id` but **no** `counterparty_pairing_code`, so `handleHandshakeRPC` returns **`success: false`** before relay push.
- **Conclusion:** stale fixture; not evidence coordination push is broken in production when correct IPC params are supplied.

### Group II — `counterpartyKeyBinding.regression.test.ts` R2 (1)

- **Test expectation:** one inbound `context_sync` ⇒ acceptor **`ACTIVE`** immediately.
- **Canon in source of truth module (`contextSyncActiveGate.ts` + enforcement comment):** `ACTIVE` requires **both**
  - inbound `seq >= 1` while row is `ACCEPTED`, **and**
  - **`last_seq_sent >= 1`** (durably-enqueued outbound context-sync / own side),
  otherwise state remains unchanged.
- **Observed:** after successful ingest, row stays **`ACCEPTED`** — matches gate.
- **Conclusion:** test needs to seed `last_seq_sent` / simulate dual roundtrip, or expect `ACCEPTED` until both conditions hold.

### Group II — `outboundQueue.backoff.test.ts` (4 of 5)

- **QB_16 / QB_17:** tests expect `PAYLOAD_PERMANENT` but DB/result uses `SCHEMA_PERMANENT` on terminal invalid paths — `outboundQueue.ts` persists `SCHEMA_PERMANENT` in multiple terminal branches (search hits show explicit writes on HTTP 400/failed paths). Classify as **stale expected label** unless product wants to reclassify codes (then it’s a product decision, not a Phase B seal bypass).
- **QB_18:** diagnostics log no longer contains substring `terminal_http_400` — **stale log-format assertion**.
- **QB_22:** expects `registerHandshakeWithRelay` called on “stale registry” repair; actual coordination send path hits **`orchestratorModeStore` → `app.getPath` missing** in Vitest (same class of issue as other suites). **Harness gap**, not proof re-register logic removed.

### Group III — Host AI target cardinality (2)

- **E2E (`hostAiE2eSandboxToHostSuccess.integration.test.ts`):** expects **one** `targets` entry; logs show **two model rows** added for same handshake (`TARGET_MODEL_ADD` twice). Likely **product now surfaces per-model rows**; update expected length or assert aggregate invariants instead of `length === 1`.
- **Sandbox regression (`sandbox_lists_remote_ollama…`):** symmetric row-count drift (`expected 2 got 1`) — same family (target merge / policy), not a structural seal issue.

---

## Section 4 — Ambiguous (canon owner questions)

### A) `validateStoredSelectionForOrchestratorWithDiagnostics` model id (4 failures in `hostInferenceSelectorIntegration.test.ts`)

- **Evidence:** `inferenceSelectionPersistence.ts` documents handshake-first matching because list rows may use ephemeral tails while persistence stores `host-internal:<hid>:<model>`, but on success it returns **`modelId: t.id`** (ephemeral row id) not **`stored.id`** (lines ~272–289, ~534–594).
- **Test expectation:** after validation, `modelId` should equal persisted `…:llama` even when IPC row id is `…:connecting`.
- **Question for canon owner:** Should orchestrator restore return **stable persisted id** for submit/display, or **live row id** from `inference_targets`? Both are defensible; pick one and align tests + copy.

### B) `listHostCapabilities.hostAiRoute.test.ts` — `resolveSandboxToHostHttpDirectIngest` call expectations (2)

- **Evidence:** With WebRTC data-channel success, implementation still invoked `resolveSandboxToHostHttpDirectIngest` once; tests assert it must **never** be called when DC path works (or when expecting `HOST_AI_DIRECT_PEER_BEAP_MISSING`).
- **Question:** Is an **opportunistic HTTP resolve/probe** alongside DC allowed (defense-in-depth / legacy compat), or is it a **forbidden double-resolve** that leaks preference ordering? This is a **routing architecture** decision, not covered by Phase B sealed inbox canon.

### C) `outboundQueue.backoff.test.ts` QB_09 — fetch call count (expected 2, observed 10)

- **Evidence:** under fake timers + `runAllTimersAsync`, multiple auto-drain/backoff timers may schedule additional attempts; may also reflect recent healing-loop behavior.
- **Question:** Is **>2 fetch attempts within the advanced window** acceptable (more aggressive healing), or must the queue remain **strictly single follow-up** per the test’s contract?
- **Flag:** treat as **performance/loop-bounds** review, not an inbox seal regression.

---

## Section 5 — Group I deep-dive (bypass property)

### What the tests claim

`b51ExtensionMergeBypass.test.ts` §2.4 / §3.2 / §3.5 assert: when validation fails **and** a paired sandbox exists, **a sealed `quarantine_messages` row is written**, retry buffer stays empty, and UI pending count eventually clears after drain.

### What production does (happy path design)

`mergeExtensionDepackaged.ts`:

1. Validator rejects merge (`!resp.outcome.ok`) → read `rejection_reason` from `sealed_quarantine`.
2. Call `attemptQuarantineWrite` when sandbox exists.
3. `attemptQuarantineWrite` encrypts package bytes → `writeQuarantineBlob` → builds quarantine canonical JSON → **validator subprocess** seals → `prepareSealedInsert` into `quarantine_messages`.
4. If quarantine path fails, fall back to in-memory retry buffer + renderer notify (B-5.1 no-inbox-write property).

### Step-by-step mismatch in Vitest (not in logic)

Runtime logs from focused Vitest run:

```
[MERGE] encryptForQuarantine failed: undefined
```

This matches code:

```ts
if (!encResult.ok) {
  console.warn('[MERGE] encryptForQuarantine failed:', encResult.error)
  return false
}
```

with a mock returning **no** `ok` field.

### Canon comparison

- **No evidence** the merge path writes sealed inbox content on validator failure (§2.1–§2.3 still pass: shell row unchanged; buffer + notify on no-quarantine).
- **No evidence** quarantine insert bypasses the seal gate — failure occurs **before** sealed insert because encryption never returns `ok:true`.

### Bottom line

**B-5.1’s “no failure-path inbox write” property is not contradicted by these failures.** The failing cases are **quarantine-path integration tests with outdated mocks**, not proof of a live bypass.

---

## Section 6 — Recommended next steps

1. **Close Group I as test-harness debt** — update `encryptForQuarantine` + `writeQuarantineBlob` mocks to match real result shapes; re-run `b51ExtensionMergeBypass.test.ts` before any production edits.
2. **Close internal relay push + guards** — align tests with **pairing-code internal initiate** and **initiate included in relay envelope** set.
3. **Close counterparty context_sync regression** — align R2 with `contextSyncActiveGate.ts`’s **dual requirement** for `ACTIVE`.
4. **Outbound queue** — refresh expectations for `SCHEMA_PERMANENT` labels + diagnostic log strings; add electron/orchestrator mocks for coordination rows (QB_22); decide QB_09 timer contract separately.
5. **Host AI / selector** — resolve **Section 4** questions before mass-editing tests; these are **product contracts**, not Phase B seal mechanics.

**No “stop the line” regression PR is mandated by this investigation** on Category 2 suspects alone.

---

## Section 7 — What was not verified

- End-to-end manual runs of Electron with real vault + real coordination relay.
- Cross-OS behavior differences (investigation run on Windows).
- Whether any **non-suspect** failing tests hide a structural regression (out of B-8.4a scope).
- Full timing model of outbound auto-drain under real wall clocks (QB_09).

---

**End of B-8.4a investigation report.**
