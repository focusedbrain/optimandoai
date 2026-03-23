# Ingestor & Validator Codebase — Hardening Analysis Report

**Date:** 2025-03-04  
**Scope:** BEAP Capsule ingestion, validation, and handshake pipeline  
**Architecture note:** The task describes Ingestor/Validator running in a "local VM" and optionally a "remote server-VM" for High-Assurance. **In the current codebase, all ingestion and validation runs in the Electron main process** — there is no VM isolation. The `sandboxStub.ts` is a placeholder for future sandbox sub-orchestrator; it does not run the Ingestor/Validator.

---

## Files Found

| Filepath | Role/Purpose |
|----------|--------------|
| `electron/main/ingestion/ingestor.ts` | Stage 1: Accepts raw input, detects BEAP, produces `CandidateCapsuleEnvelope` |
| `electron/main/ingestion/validator.ts` | Stage 2: Structural validation, produces `ValidatedCapsule` (only constructor) |
| `electron/main/ingestion/ingestionPipeline.ts` | Orchestrator: Ingestor → Validator → Distribution Gate |
| `electron/main/ingestion/distributionGate.ts` | Routes validated capsules to handshake_pipeline / sandbox / quarantine |
| `electron/main/ingestion/beapDetection.ts` | BEAP detection (MIME, headers, JSON structure, attachment metadata) |
| `electron/main/ingestion/plainTransform.ts` | Wraps plain content as `internal_draft` |
| `electron/main/ingestion/types.ts` | Types, `INGESTION_CONSTANTS`, `RawInput`, `ValidatedCapsule` |
| `electron/main/ingestion/ipc.ts` | IPC handlers: `handleIngestionRPC`, HTTP routes `/api/ingestion/*` |
| `electron/main/ingestion/provenanceMetadata.ts` | Provenance and transport metadata |
| `electron/main/ingestion/persistenceDb.ts` | Quarantine, sandbox queue, audit persistence |
| `electron/main/ingestion/sandboxStub.ts` | Placeholder for future sandbox; does not run Ingestor/Validator |
| `electron/main/handshake/enforcement.ts` | `processHandshakeCapsule`, runtime brand guard, atomic transaction |
| `electron/main/handshake/pipeline.ts` | `runHandshakeVerification` — runs frozen 20-step pipeline |
| `electron/main/handshake/steps/index.ts` | `HANDSHAKE_PIPELINE` — ordered step list |
| `electron/main/handshake/steps/*.ts` | Individual pipeline steps (chainIntegrity, stateTransition, ownership, etc.) |
| `electron/main/handshake/canonicalRebuild.ts` | Gate 2: Canonical rebuild, field allowlist, denied fields |
| `electron/main/handshake/handshakeVerification.ts` | **Unused** — full cryptographic verification (capsule_hash, context_hash) — NOT in pipeline |
| `electron/main/handshake/contextIngestion.ts` | Verifies `context_commitment`, persists context blocks |
| `INGESTION_PIPELINE.md` | Pipeline specification |
| `ENTRYPOINT_AUDIT.md` | Entry point inventory |
| `THREAT_MODEL_INGESTION_VALIDATION.md` | Threat model |

---

## Ingestor Analysis

### Input path
- **WebSocket RPC:** `ingestion.ingest` (main.ts → `handleIngestionRPC` → `processIncomingInput`)
- **HTTP POST:** `/api/ingestion/ingest` (Express route in `registerIngestionRoutes`)
- **IPC:** `handshake:submitCapsule` (Electron `ipcMain.handle`) — forwards JSON string to `handleIngestionRPC`
- **Internal:** `submitCapsuleViaRpc` (capsuleTransport.ts) — same-process call to `handleIngestionRPC`

Raw input arrives as `{ rawInput, sourceType, transportMeta }` where `rawInput.body` is `string | Buffer`.

### Input validation before parsing
- **Size limit:** `MAX_RAW_INPUT_BYTES` (15MB) enforced in `ingestor.ts` before any parsing. Oversized → `ingestion_error_flag = true`.
- **Content-type:** NOT enforced. `ALLOWED_CONTENT_TYPES` exists in `types.ts` but is never used. BEAP detection uses MIME for detection priority, not rejection.
- **Rate limiting:** None. Dedup is via `raw_input_hash` (INSERT OR IGNORE) — prevents unbounded growth but does not rate-limit.

### Deserialization
- **beapDetection.ts:** `JSON.parse(text.trim())` — standard `JSON.parse`, no streaming, no reviver. Malformed JSON → `malformed: true`, `detection_error` set.
- **checkJsonStructure:** Same `JSON.parse(trimmed)` for structure-based detection.
- **Validator:** Receives `candidate.raw_payload` (already parsed object from Ingestor). Validator does NOT re-parse; it validates the object structure. Depth/field limits applied after parse.

### Paths where raw input reaches host without validation
- **None identified.** All external input paths route through `processIncomingInput` (Ingestor → Validator → Distribution Gate). `processHandshakeCapsule` is only called with `ValidatedCapsule` after successful validation. ENTRYPOINT_AUDIT.md confirms this.

---

## Validator Analysis

### Implemented checks (in order)
1. **Ingestion error propagated** — Reject if `candidate.ingestion_error_flag`
2. **JSON parsability** — `raw_payload` must be non-null, object, not array
3. **Prototype pollution** — Reject if `__proto__` or `prototype` is own property
4. **JSON depth** — `measureJsonDepth` ≤ 50
5. **Field count** — `countFields` ≤ 500
6. **schema_version** — Must be in `SUPPORTED_SCHEMA_VERSIONS` (1, 2)
7. **capsule_type** — Must be in `VALID_CAPSULE_TYPES` (initiate, accept, refresh, revoke, internal_draft)
8. **Required fields per type** — `REQUIRED_FIELDS_BY_TYPE` (handshake_id, sender_id, capsule_hash, timestamp, etc.)
9. **Enum validation** — sharing_mode, external_processing, cloud_payload_mode
10. **Structural integrity** — seq (non-negative int), timestamp (string), handshake_id (non-empty string), context_blocks (array if present)
11. **Cryptographic field presence** — capsule_hash, sender_id for non-internal_draft
12. **Hash format** — capsule_hash, prev_hash: 64-char hex
13. **Payload size** — `Buffer.byteLength(JSON.stringify(payload))` ≤ 10MB
14. **Sanitization** — `sanitizeObject` strips `__proto__`, `constructor`, `prototype` before constructing `ValidatedCapsule`

### Missing or incomplete checks
- **capsule_hash integrity:** Validator does NOT recompute `capsule_hash` and compare. It only checks format (64-char hex). A tampered capsule with a forged but correctly formatted `capsule_hash` passes.
- **context_hash:** Not validated in Validator or handshake pipeline.
- **context_blocks hashes vs commitment:** Validator does not verify. This happens later in `ingestContextBlocks` (enforcement.ts transaction) — but only when `context_blocks` are present with content. Hash-only proof blocks are not commitment-verified in the pipeline.
- **handshake_id matches known active handshake:** Validator explicitly does NOT check handshake state (by design). Handshake pipeline does this via `verifyHandshakeOwnership`, `checkStateTransition`.
- **sender_id matches expected counterparty:** Handshake pipeline `verifyHandshakeOwnership` enforces this.
- **timestamp within acceptable window:** Validator does not check. Handshake pipeline `verifyTimestamp` enforces future-timestamp rejection (clock skew).
- **previous_hash chain continuity:** Handshake pipeline `verifyChainIntegrity` enforces this for refresh/revoke.
- **Content-type allowlist:** `ALLOWED_CONTENT_TYPES` is defined but never enforced.
- **String length per field:** `MAX_STRING_LENGTH` (5MB) is in constants but not enforced per-field in Validator.

### Validation order
- Generally correct: cheap checks first (ingestion flag, object shape, depth, field count), then schema/enum, then size. Expensive operations (JSON.stringify for size) are last.
- **Potential issue:** `JSON.stringify(payload)` for size check could be expensive on large objects; depth/field limits mitigate but do not eliminate risk.

---

## Handshake Pipeline (post-Validator)

The handshake pipeline runs after ValidatedCapsule passes Distribution Gate. Key steps:

| Step | Check |
|------|-------|
| checkSchemaVersion | schema_version supported |
| checkDuplicateCapsule | capsule_hash not in seen_capsule_hashes |
| verifyHandshakeOwnership | sender_id is counterparty, no self-handshake, no duplicate active |
| verifyReceiverBinding | receiver_email matches local user (initiate only) |
| verifySenderDomain | sender domain checks |
| verifyWrdeskPolicyAnchor | policy anchor |
| verifyInputLimits | handshake_id, relationship_id, capsule_hash length, proof count |
| checkStateTransition | capsule_type valid for current handshake state |
| verifyChainIntegrity | seq = expected, prev_hash = last_capsule_hash_received |
| verifySharingMode | sharing mode enforcement |
| verifyExternalProcessing | external processing |
| verifyContextBinding | context_block_proofs structure |
| verifyContextVersions | No-op placeholder |
| resolveEffectivePolicy | policy resolution |
| verifyScopePurpose | scope purpose |
| verifyTimestamp | timestamp not in future (clock skew) |
| checkExpiry | handshake not expired, expiry rules |
| collectTierSignals, classifyTier, runTierSpecificChecks, enforceMinimumTier | tier enforcement |

**Critical gap:** The handshake pipeline does NOT recompute `capsule_hash` and compare. `handshakeVerification.ts` implements full cryptographic verification (including capsule_hash recompute) but is **never called** from the production pipeline.

---

## IPC Analysis

### Mechanism
- **WebSocket:** `ws` library, server on `127.0.0.1:WS_PORT`. Extension connects via WebSocket.
- **HTTP:** Express app, `POST /api/ingestion/ingest`, `GET /api/ingestion/quarantine`, etc.
- **Electron IPC:** `ipcMain.handle('handshake:submitCapsule', ...)` for renderer → main.

### Authentication
- **WebSocket:** Vault RPC methods require `vault.bind` or `vault.unlock` to obtain VSBT. `ingestion.ingest` does NOT require vault binding — it is callable by any connected WebSocket client. The handshake pipeline path requires `db` (vault unlocked) and `ssoSession`; if missing, ingestion still runs but handshake processing returns an error.
- **HTTP:** No authentication on `/api/ingestion/ingest`. Any client that can reach the HTTP server can submit.
- **Electron IPC:** Renderer can invoke `handshake:submitCapsule`; it goes through `handleIngestionRPC` which runs the full pipeline.

### Re-validation on host
- **Yes.** After IPC, `handleIngestionRPC` calls `processIncomingInput` (Ingestor + Validator). For handshake_pipeline target, it then runs `canonicalRebuild` (Gate 2) and `processHandshakeCapsule`. The ValidatedCapsule is re-validated structurally by `canonicalRebuild` (field allowlist, denied fields, format validation). There is no separate "host-side" validator; the same Validator runs in the main process.

---

## State Machine

### Exists
- **Yes.** `checkStateTransition` enforces:
  - No record → only `handshake-initiate`
  - REVOKED/EXPIRED → reject all
  - PENDING_ACCEPT → accept, revoke, or reject initiate
  - ACTIVE → refresh, revoke only

### Context-sync enforcement
- **No.** The task asks: "after handshake activation, does the system enforce that only a context-sync Capsule (seq 1) is accepted first?"
- The pipeline does NOT distinguish "context-sync" vs "normal BEAP messaging" capsule types. Handshake capsules are `initiate`, `accept`, `refresh`, `revoke`. There is no `context_delivery` or `context-sync` type in the ingestion Validator or Distribution Gate.
- `context_delivery` is used internally in `handshake.sendContextDelivery` / `handshake.receiveContextDelivery` (ipc.ts) — these are RPC handlers, not ingestion pipeline inputs. Content delivery is a separate flow.
- The pipeline does NOT enforce "first capsule after activation must be context-sync." After activation, `refresh` and `revoke` are accepted; there is no seq=1 context-sync gate.

---

## Error Handling & Failure Modes

### On validation failure
- **Ingestor:** Sets `ingestion_error_flag = true`, returns `CandidateCapsuleEnvelope`. Never silent drop.
- **Validator:** Returns `{ success: false, reason, details }`. No exception; structured result.
- **Pipeline orchestrator:** Returns `{ success: false, reason, validation_reason_code, audit }`. Quarantine record persisted if db available.
- **Handshake pipeline:** Returns `{ success: false, reason, failedStep }`. Audit log entry for denial.

### Error response leakage
- **Validation details:** `result.reason` and `validationResult.details` are returned to the client. These can include: `"Payload size 12345 exceeds limit 10485760"`, `"JSON depth 51 exceeds limit 50"`, `"Missing required field: handshake_id for capsule_type initiate"`. Such messages are useful for debugging but could reveal limits and schema to an attacker.
- **Handshake failures:** `handshakeResult.reason`, `failedStep`, `detail` are returned. E.g. `"INVALID_CHAIN (step: verify_chain_integrity)"`. Reason codes are standardized; `detail` may include raw error messages (e.g. SQLite "FOREIGN KEY constraint failed").

### Audit logging
- **Ingestion:** `insertIngestionAuditRecord` on every pipeline run (success or failure). `insertQuarantineRecord` on rejection.
- **Handshake:** `insertAuditLogEntry` for both success and denial. `buildDenialAuditEntry` and `buildSuccessAuditEntry`.
- **Validation bypass attempt:** `VALIDATION_BYPASS_ATTEMPT` logged in `processHandshakeCapsule` runtime guard.
- **Not all failure paths:** Some catch blocks swallow errors (e.g. `try { insertIngestionAuditRecord(...) } catch { /* non-fatal */ }`). Audit insert failure does not mask the main error.

---

## Critical Findings

1. **capsule_hash not verified** — The Validator and handshake pipeline never recompute `capsule_hash` from canonical fields and compare. A tampered capsule with a correctly formatted but wrong `capsule_hash` is accepted. `handshakeVerification.ts` implements this check but is unused.

2. **context_hash not verified** — No step verifies `context_hash` matches recomputed value. Context commitment is verified only when `context_blocks` with content are ingested (`ingestContextBlocks`).

3. **No VM isolation** — Ingestor/Validator run in the Electron main process. The task describes a "local VM" and "remote server-VM" architecture; the current codebase has no such isolation.

4. **Content-type allowlist unused** — `ALLOWED_CONTENT_TYPES` is defined but never enforced. Any content-type can be submitted.

5. **No rate limiting** — Beyond hash-based dedup (which prevents duplicate storage), there is no rate limiting. An attacker could flood the pipeline with distinct capsules.

6. **Error message information leakage** — Validation and handshake error details are returned to clients, potentially revealing schema, limits, and internal state.

7. **No context-sync state enforcement** — After handshake activation, there is no enforcement that the first post-activation capsule must be a context-sync (seq 1) type. The pipeline accepts refresh/revoke immediately.

8. **HTTP/WebSocket ingestion unauthenticated** — `/api/ingestion/ingest` and `ingestion.ingest` over WebSocket do not require authentication. Vault/session checks apply only when routing to handshake_pipeline.
