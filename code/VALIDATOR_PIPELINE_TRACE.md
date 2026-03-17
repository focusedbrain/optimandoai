# Validator Pipeline Trace — ingestion-core

**Date:** 2025-03-15

---

## 1. ingestion-core/ingestor.ts

### What does `ingestInput()` do?

**Function:** `ingestInput(rawInput, sourceType, transportMeta): CandidateCapsuleEnvelope`

1. **Size check:** Rejects if `rawInput.body` exceeds `INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES` (15 MB).
2. **BEAP detection:** Calls `detectBeapCapsule(rawInput)` — MIME, headers, JSON structure, attachment metadata.
3. **Output paths:**
   - **Detected:** Returns candidate with `raw_payload: detection.raw_capsule_json`, `ingestion_error_flag: false`.
   - **Malformed:** Returns candidate with `raw_payload: null`, `ingestion_error_flag: true`.
   - **Plain content:** Returns candidate with `raw_payload: buildPlainDraftPayload(body)` (wraps as `internal_draft`).

### Input

- **Type:** `RawInput` — `{ body: string | Buffer, headers?, mime_type?, filename?, attachments? }`.
- **Not:** File path. Body is raw bytes/string already loaded by caller.

### Output

- **CandidateCapsuleEnvelope:** `{ __brand, provenance, raw_payload, ingestion_error_flag, ingestion_error_details? }`.

### Provenance metadata

- **Yes.** `buildProvenanceMetadata(sourceType, transportMeta, classification, rawInputHash)` attached to every candidate.
- Includes: `source_type`, `origin_classification`, `ingested_at`, `transport_metadata`, `input_classification`, `raw_input_hash`, `ingestor_version`.

### "Depackage only, no validation" rule

- **Yes.** Ingestor SHALL NOT perform validation, check handshake state, or call handshake functions (per module comment).
- It only classifies and extracts; validation is Stage 2.

### Status: ✅

---

## 2. ingestion-core/validator.ts

### What does `validateCapsule()` do?

**Function:** `validateCapsule(candidate): ValidationResult`

Validates structural correctness of `CandidateCapsuleEnvelope`. Produces `ValidatedCapsule` on success. Fail-closed on any violation.

### Structural checks

| Check | Constant / Logic |
|-------|------------------|
| Raw input size | Ingestor only (MAX_RAW_INPUT_BYTES) |
| Payload size | `INGESTION_CONSTANTS.MAX_PAYLOAD_BYTES` (10 MB) — line 303 |
| JSON depth | `INGESTION_CONSTANTS.MAX_JSON_DEPTH` (50) — `measureJsonDepth()` |
| Field count | `INGESTION_CONSTANTS.MAX_FIELDS` (500) — `countFields()` |
| schema_version | Must be in `SUPPORTED_SCHEMA_VERSIONS` [1, 2] |
| capsule_type | Must be in `VALID_CAPSULE_TYPES` (initiate, accept, refresh, revoke, context_sync, internal_draft) |
| Required fields | Per `REQUIRED_FIELDS_BY_TYPE` for each capsule_type |
| sharing_mode | If present: receive-only | reciprocal |
| Hash format | capsule_hash, prev_hash: 64-char hex |
| sender_public_key | 64-char hex |
| sender_signature | 128-char hex |
| countersigned_hash | 128-char hex |

### SIZE_LIMITS constants

- **No separate `SIZE_LIMITS`.** Uses `INGESTION_CONSTANTS`:
  - `MAX_PAYLOAD_BYTES`: 10 MB
  - `MAX_RAW_INPUT_BYTES`: 15 MB
  - `MAX_JSON_DEPTH`: 50
  - `MAX_FIELDS`: 500
  - `MAX_STRING_LENGTH`: 5 MB (defined but not used in validator)

### Prototype pollution guard

- **Yes.** Lines 174–178:
  - `Object.prototype.hasOwnProperty.call(obj, '__proto__')` or `'prototype'` → fail with `STRUCTURAL_INTEGRITY_FAILURE`.
- **Yes.** `sanitizeObject()` (lines 132–150) strips `POISONED_KEYS` (`__proto__`, `constructor`, `prototype`) before building validated payload.

### Output

- **Success:** `{ success: true, validated: ValidatedCapsule }`.
- **Failure:** `{ success: false, reason: ValidationReasonCode, details: string }`.
- **ValidatedCapsule:** `{ __brand: 'ValidatedCapsule', provenance, capsule, validated_at, validator_version, schema_version }`.

### "Validated" marking

- **Yes.** `createValidatedCapsule()` sets `validated_at: new Date().toISOString()`, `validator_version`, `__brand: 'ValidatedCapsule'`.

### Status: ✅

---

## 3. ingestion-core/distributionGate.ts

### What does it do?

**Function:** `routeValidatedCapsule(capsule: ValidatedCapsule): DistributionDecision`

Routes validated capsules by `capsule_type`:

| capsule_type | target |
|--------------|--------|
| initiate, accept, refresh, revoke, context_sync | `handshake_pipeline` |
| internal_draft + origin internal | `handshake_pipeline` |
| internal_draft + origin external | `sandbox_sub_orchestrator` |
| Other | `quarantine` |

### "Only validated capsules pass"

- **Yes.** Function accepts `ValidatedCapsule` only. Caller (`processIncomingInput` / `validateInput`) only invokes it when `validateCapsule` succeeds.
- No bypass; invalid candidates never reach the gate.

### Where does a validated capsule go next?

- **Returns:** `DistributionDecision` with `target` and `validated_capsule`.
- **Caller responsibility:** Electron `processIncomingInput` uses `distribution.target` to decide:
  - `handshake_pipeline` → `canonicalRebuild` → `processHandshakeCapsule` (handshake enforcement).
  - `sandbox_sub_orchestrator` → (handled by caller; not depackaging sandbox — that's a different path).
  - `quarantine` → insert into quarantine table.
- **Not to depackaging:** ingestion-core is for **handshake capsules** (initiate/accept/refresh/revoke/context_sync). BEAP message packages (qBEAP/pBEAP) bypass this pipeline and go to `p2p_pending_beap` → extension sandbox depackaging.

### Status: ✅

---

## 4. ingestion-core/pipeline.ts

### Composition

**Function:** `validateInput(rawInput, sourceType, transportMeta): PipelineResult`

```
ingestInput(rawInput, ...) → candidate
validateCapsule(candidate) → validationResult
routeValidatedCapsule(validationResult.validated) → distribution
return { success, validated, distribution }
```

Plus wall-clock timeout checks (`PIPELINE_TIMEOUT_MS` = 10s) after ingest and after validate.

### Is this pipeline called from importPipeline.ts?

- **No.** Extension `importPipeline.ts` uses `importBeapMessage`, `verifyImportedMessage`, `sandboxDepackage` — it does **not** use ingestion-core.

### Or from the sandbox?

- **No.** Sandbox uses `decryptBeapPackage` → `runDepackagingPipeline` (6-gate depackaging). No ingestion-core.

### Or is it standalone and never wired?

- **No.** It **is** wired, but in different places:
  1. **Electron `ingestionPipeline.ts`:** Uses `ingestInput`, `validateCapsule`, `routeValidatedCapsule` directly (same logic as `validateInput`, but with audit records and async).
  2. **`processIncomingInput`:** The main orchestrator — calls ingest → validate → distribute. Used by:
     - `p2pServer.ts` (P2P /beap/ingest)
     - `coordinationWs.ts` (WebSocket)
     - `relayPull.ts` (relay pull)
     - `ingestion/ipc.ts` (IPC + HTTP `/api/ingestion/ingest`)
     - `handshake/ipc.ts` (file import for handshake capsules)
  3. **`validateInput` (pipeline.ts):** Used by:
     - `packages/coordination-service` (server.ts)
     - `packages/relay-server` (server.ts)

### Status: ✅

- Pipeline is composed and wired.
- Electron uses `processIncomingInput` (ingest → validate → distribute) with audit.
- Coordination/relay services use `validateInput` directly.

---

## 5. beapStructuralValidator.ts

### Does it exist?

- **No.** No file matching `beapStructuralValidator*` in the repo.

### Same as validator.ts or separate?

- **N/A.** The structural validation logic lives in `validator.ts` (ingestion-core). There is no separate `beapStructuralValidator` module.

### Ready for containerisation?

- **ingestion-core is container-ready:** Zero dependencies on Electron, DB, or app state. Can run in Node.js, Docker, child_process (per package README).
- **validator.ts** is the structural validator; it is part of ingestion-core and is already portable.

### Status: ❌ (file does not exist) / ✅ (validator.ts provides equivalent)

---

## Summary Table

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Ingestor | ingestor.ts | ✅ | Raw body/Buffer in; CandidateCapsuleEnvelope out; provenance attached; no validation |
| Validator | validator.ts | ✅ | Size, depth, field count, prototype pollution, required fields; INGESTION_CONSTANTS |
| Distribution Gate | distributionGate.ts | ✅ | Routes by capsule_type; only validated capsules |
| Pipeline | pipeline.ts | ✅ | validateInput = ingest → validate → distribute |
| processIncomingInput | ingestionPipeline.ts | ✅ | Same flow + audit; used by Electron |
| importPipeline.ts (extension) | — | N/A | Does not use ingestion-core; uses sandbox depackaging |
| beapStructuralValidator.ts | — | ❌ | Does not exist; validator.ts is the structural validator |

---

## Scope of ingestion-core

**Handles:** Handshake capsules only — `initiate`, `accept`, `refresh`, `revoke`, `context_sync`, `internal_draft`.

**Does NOT handle:** qBEAP/pBEAP message packages (header/metadata/envelope, no `capsule_type`). Those bypass ingestion-core and go to `p2p_pending_beap` → extension sandbox depackaging.
