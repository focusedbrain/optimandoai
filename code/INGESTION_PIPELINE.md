# BEAP Ingestion & Validation Pipeline — Specification

## Architecture Overview

The ingestion layer is a mandatory two-stage pipeline that sits upstream of the existing BEAP Handshake layer. All external input must pass through the Ingestor and Validator before entering the handshake pipeline.

```
External Input ──► Ingestor ──► Validator ──► Distribution Gate
(Email, API,       (Stage 1)    (Stage 2)          │
 File, Extension)                        ValidatedCapsule ONLY
                                                    │
                                        Existing Handshake Layer
                                  (20-step frozen pipeline, unchanged)
```

## Trust Boundary

All ingestion and validation code resides in the Electron main process. No LLM/LWM participates in ingestion or validation.

| Component | Location |
|---|---|
| Ingestor | `electron/main/ingestion/` |
| Validator | `electron/main/ingestion/` |
| Distribution Gate | `electron/main/ingestion/` |
| Shared IPC types | `packages/shared/src/ingestion/` |

## Type System

### Branded Types

Two branded types enforce a non-bypassable boundary:

- **`CandidateCapsuleEnvelope`** (`__brand: 'CandidateCapsule'`) — Ingestor output
- **`ValidatedCapsule`** (`__brand: 'ValidatedCapsule'`) — Validator output

TypeScript prevents assignment between these types. The `ValidatedCapsule` constructor is module-private within `validator.ts`. Only `validateCapsule()` can produce instances.

### Key Invariants

1. `processHandshakeCapsule()` accepts ONLY `ValidatedCapsule`
2. No `as ValidatedCapsule` casts in production code outside `validator.ts`
3. All interface fields are `readonly`
4. Ingestion and validation are stateless — no database writes

## Stage 1: Ingestor

**File:** `ingestor.ts`

Accepts raw input and produces `CandidateCapsuleEnvelope`.

### Responsibilities
- Classify input as: `beap_capsule_present`, `beap_capsule_malformed`, or `plain_external_content`
- Extract raw BEAP capsule JSON if detected
- Wrap plain content as `internal_draft` capsule
- Attach provenance metadata (source type, transport metadata, SHA-256 hash)
- Forward malformed BEAP with `ingestion_error_flag = true` (never silently discard)

### BEAP Detection (Priority Order)
1. MIME type: `application/vnd.beap+json` or `application/beap`
2. Header markers: `X-BEAP-Version`, `X-BEAP-Capsule-Type`
3. JSON structure: `schema_version` + `capsule_type` at top level
4. Attachment metadata: `.beap` extension or BEAP MIME type

### Ingestor SHALL NOT
- Perform handshake state lookup, tier checks, policy resolution
- Verify signatures or perform structural validation
- Execute tools or payloads
- Call any handshake layer function

## Stage 2: Validator

**File:** `validator.ts`

Validates structural correctness and produces `ValidatedCapsule` on success.

### Validation Steps (Ordered, Fail on First Error)

| # | Check | Failure Code |
|---|---|---|
| 1 | Ingestion error flag | `INGESTION_ERROR_PROPAGATED` |
| 2 | JSON parsability (not null, array, or prototype polluted) | `MALFORMED_JSON` / `STRUCTURAL_INTEGRITY_FAILURE` |
| 3 | `schema_version = 1` | `SCHEMA_VERSION_UNSUPPORTED` |
| 4 | `capsule_type` present and valid | `MISSING_REQUIRED_FIELD` / `INVALID_ENUM_VALUE` |
| 5 | Required fields per capsule type | `MISSING_REQUIRED_FIELD` |
| 6 | Enum field values (sharing_mode, external_processing, cloud_payload_mode) | `INVALID_ENUM_VALUE` |
| 7 | Structural integrity (seq, timestamp, handshake_id, context_blocks) | `STRUCTURAL_INTEGRITY_FAILURE` |
| 8 | Cryptographic field presence (capsule_hash, sender_id for non-drafts) | `CRYPTOGRAPHIC_FIELD_MISSING` |
| 9 | Hash field format (64-char hex) | `HASH_BINDING_MISMATCH` |
| 10 | Payload size (≤ 10MB) | `PAYLOAD_SIZE_EXCEEDED` |

### Validator SHALL NOT
- Check handshake state, enforce sharing mode, enforce tier
- Verify sender domain, verify WR Desk policy anchor
- Check timestamps (that's the handshake layer's job)
- Execute capsules or persist state

## Distribution Gate

**File:** `distributionGate.ts`

Routes validated capsules to trust domains:

| Condition | Target |
|---|---|
| `initiate`, `accept`, `refresh`, `revoke` | `handshake_pipeline` |
| `internal_draft` + `external` origin | `sandbox_sub_orchestrator` |
| `internal_draft` + `internal` origin | `handshake_pipeline` |
| Unresolvable | `quarantine` |

Capsules routed to sandbox are queued but not processed (future workstream).

## Handshake Integration

### Change 1: Type Boundary

`processHandshakeCapsule()` now accepts only `ValidatedCapsule`. The function extracts the capsule payload and maps it to the internal `VerifiedCapsuleInput` format. The 20-step frozen pipeline runs unchanged.

### Change 2: IPC Routing

The ingestion pipeline is wired into WebSocket RPC (`ingestion.*` methods) and HTTP routes (`/api/ingestion/*`), upstream of handshake endpoints.

## Fail-Closed Behavior

| Stage | Condition | Behavior |
|---|---|---|
| Ingestor | Input unreadable | `ingestion_error_flag = true` |
| Ingestor | Provenance undetermined | Error in candidate |
| Validator | Any validation error | Reject with reason code |
| Distribution Gate | No valid target | Quarantine |
| Pipeline | Unhandled exception | Catch, log, reject |

## IPC Contract

| Channel | Direction | Purpose |
|---|---|---|
| `ingestion.ingest` | Extension → Main | Forward raw external input |
| `ingestion-result` | Main → Extension | Ingestion outcome |
| `ingestion.quarantine-list` | Extension → Main | Read-only quarantine list |

## Audit

Every pipeline execution produces an `IngestionAuditRecord` with: timestamp, raw_input_hash, source_type, origin_classification, input_classification, validation_result, reason_code, distribution_target, processing_duration_ms, pipeline_version.

## Test Coverage

**82 tests across 7 files:**

| File | Tests | Coverage |
|---|---|---|
| `ingestor.test.ts` | 13 | All source types, detection paths, provenance, hash correctness |
| `beapDetection.test.ts` | 11 | All 4 detection methods, priority, malformed handling |
| `validator.test.ts` | 19 | All 10 validation steps, all capsule types, structural checks |
| `distributionGate.test.ts` | 6 | All routing rules |
| `plainTransform.test.ts` | 5 | Draft wrapping, unicode, empty content |
| `integration.test.ts` | 8 | Full pipeline flow, audit, fail-closed |
| `adversarial.test.ts` | 20 | Bypass attempts, oversized, nested, prototype pollution, null bytes, dedup |

## Architectural Invariants

1. Only validated capsules cross the trust boundary
2. Ingestor ≠ Validator (strict separation)
3. Validator ≠ policy engine
4. Fail closed at every stage
5. Type system prevents bypass
6. Ingestion is stateless
7. Handshake semantics unchanged
8. 20-step frozen pipeline untouched
