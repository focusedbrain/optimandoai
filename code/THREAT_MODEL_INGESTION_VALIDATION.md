# BEAP Ingestion & Validation — Threat Model

## 1. Attack Surface Inventory

| Surface | Entry Points | Trust Level |
|---|---|---|
| HTTP API | `/api/ingestion/ingest`, `/api/ingestion/quarantine`, `/api/ingestion/sandbox-queue` | External (untrusted) |
| WebSocket RPC | `ingestion.ingest`, `ingestion.quarantine-list`, `ingestion.sandbox-queue` | Extension (partially trusted) |
| Handshake IPC | `handshake.*` methods (read-only queries + revocation) | Extension (partially trusted) |
| Internal IPC | Electron `ipcMain` handlers | Internal (trusted) |

### Component Boundaries

```
External Input
      │
      ▼
┌─────────────────┐  Raw bytes, untrusted
│    Ingestor      │  MAX_RAW_INPUT_BYTES enforced
│  (Stage 1)       │  Content-type allowlist
└────────┬────────┘
         │ CandidateCapsuleEnvelope
         ▼
┌─────────────────┐  Structural validation
│    Validator     │  Depth/field limits
│  (Stage 2)       │  Prototype pollution defense
└────────┬────────┘
         │ ValidatedCapsule (__brand guard)
         ▼
┌─────────────────┐
│ Distribution Gate│  Routing authority
└────────┬────────┘
    ┌────┼─────────┐
    ▼    ▼         ▼
Pipeline Sandbox  Quarantine
(handshake) (queue)  (persist)
    │
    ▼
┌─────────────────┐  Runtime brand guard
│  Handshake Layer │  20-step frozen pipeline
│  (enforcement)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Tool Authorization│ authorizeToolInvocation()
│     Gate          │ Every invocation checked
└─────────────────┘
```

## 2. Threat Scenarios

### Scenario 1: Validation Bypass — Direct Handshake Call

**Attack**: Caller constructs a fake object matching `ValidatedCapsule` interface and calls `processHandshakeCapsule()` directly, bypassing the Validator.

**Mitigations**:
- TypeScript compile-time: `__brand` literal type prevents assignment from non-validated objects
- Runtime guard: `processHandshakeCapsule()` checks `__brand === 'ValidatedCapsule'`, `validated_at`, `validator_version`, `provenance`, and `capsule` fields at runtime
- Audit: `VALIDATION_BYPASS_ATTEMPT` logged on guard failure
- No alternate entry path: handshake IPC handlers (query/revocation) do not call `processHandshakeCapsule()`

**Fail-closed behavior**: Returns `{ success: false, reason: INTERNAL_ERROR, failedStep: 'runtime_brand_guard' }`.

### Scenario 2: Payload Inflation / Oversized Inputs

**Attack**: Submit a 100MB+ payload to exhaust memory or slow processing.

**Mitigations**:
- `MAX_RAW_INPUT_BYTES` (15MB) enforced in Ingestor before any parsing
- `MAX_PAYLOAD_BYTES` (10MB) enforced in Validator on serialized JSON
- Wall-clock `PIPELINE_TIMEOUT_MS` (10s) in pipeline orchestrator

**Fail-closed behavior**: `ingestion_error_flag = true` (Ingestor) or `PAYLOAD_SIZE_EXCEEDED` (Validator). Quarantine persisted.

### Scenario 3: JSON Bombs (Depth/Width/Recursion)

**Attack**: Deeply nested JSON object (1000+ levels) or object with millions of keys to exhaust stack or CPU.

**Mitigations**:
- `MAX_JSON_DEPTH` (50) measured recursively in Validator; exceeding → `STRUCTURAL_INTEGRITY_FAILURE`
- `MAX_FIELDS` (500) counted recursively; exceeding → `STRUCTURAL_INTEGRITY_FAILURE`
- `MAX_STRING_LENGTH` (5MB) per string value
- Wall-clock timeout catches worst case

**Fail-closed behavior**: Validator rejects with structured error. No partial state.

### Scenario 4: Prototype Pollution

**Attack**: JSON payload contains `__proto__`, `constructor`, or `prototype` keys to pollute Object prototype.

**Mitigations**:
- Validator checks for `__proto__` and `prototype` as own properties → immediate `STRUCTURAL_INTEGRITY_FAILURE`
- `sanitizeObject()` strips `__proto__`, `constructor`, `prototype` keys from validated payload using `Object.create(null)` pattern
- No unsafe object merging (`Object.assign`, spread) of untrusted input into trusted objects

**Fail-closed behavior**: Validator rejects. Sanitized copy used for `ValidatedCapsule`.

### Scenario 5: Replay / Duplicate Flooding

**Attack**: Submit the same valid or invalid input thousands of times to grow quarantine/sandbox tables unboundedly.

**Mitigations**:
- `raw_input_hash` (SHA-256) used as dedup key in both `ingestion_quarantine` and `sandbox_queue` tables
- `INSERT OR IGNORE` prevents duplicate rows
- `UNIQUE INDEX` on `raw_input_hash` enforces at database level
- Handshake layer's `seen_capsule_hashes` table provides additional dedup at the handshake level

**Fail-closed behavior**: Duplicates silently ignored (no error, no growth). First instance preserved.

### Scenario 6: Malformed BEAP Disguised as Valid MIME

**Attack**: Set `Content-Type: application/vnd.beap+json` but include invalid JSON body.

**Mitigations**:
- BEAP detection records detection method; if MIME matches but JSON parsing fails → `malformed = true`
- Ingestor sets `ingestion_error_flag = true` (never silent discard)
- Validator immediately fails with `INGESTION_ERROR_PROPAGATED`
- Quarantine record persisted

**Fail-closed behavior**: Malformed input quarantined with audit trail. Never reaches handshake layer.

### Scenario 7: Forged `__brand` Payloads

**Attack**: Construct a raw JSON object with `__brand: 'ValidatedCapsule'` and attempt to pass it to `processHandshakeCapsule()`.

**Mitigations**:
- Runtime guard checks not just `__brand` but also `validated_at`, `validator_version`, `provenance`, and `capsule` structure
- TypeScript branding prevents compile-time bypass
- Even if runtime check passes, the `extractVerifiedInput()` mapper applies safe defaults for missing fields

**Fail-closed behavior**: Guard rejects with `VALIDATION_BYPASS_ATTEMPT` audit record.

### Scenario 8: Revoked Handshake Reactivation

**Attack**: Submit a capsule targeting a revoked handshake to reactivate it.

**Mitigations**:
- Validator passes (it does NOT check handshake state — by design)
- Handshake pipeline step `checkStateTransition` rejects any capsule on REVOKED state with `HANDSHAKE_REVOKED`
- No mechanism exists to transition from REVOKED to any other state

**Fail-closed behavior**: Pipeline denial. Audit record. No state change.

### Scenario 9: Unauthorized Tool Invocation

**Attack**: Call a tool without a valid handshake or with insufficient scope/purpose.

**Mitigations**:
- `authorizeToolInvocation()` is the single authorization gate for all tool invocations
- Checks: handshake active, not revoked, tool granted, scope allowed, purpose matches, parameters within constraints
- Every decision (allow AND deny) is audit-logged
- Tool runner MUST call this gate; no alternate entry point

**Fail-closed behavior**: Denial with typed `AuthorizationDenialReason`. Audit record always created.

### Scenario 10: Race Conditions Around Queue/Persistence

**Attack**: Concurrent submissions to quarantine or sandbox queue tables to cause data corruption or inconsistency.

**Mitigations**:
- SQLite's `BEGIN IMMEDIATE` transaction mode for handshake persistence
- `INSERT OR IGNORE` for quarantine and sandbox queue prevents duplicate key violations
- `UNIQUE INDEX` on `raw_input_hash` provides atomic dedup at database level
- Ingestion + validation are stateless — no mutable shared state outside SQLite

**Fail-closed behavior**: SQLite serializes concurrent writes. Duplicates ignored atomically.

## 3. Trust Boundary Summary

| Boundary | Enforcement | Bypass Prevention |
|---|---|---|
| External → Ingestor | Size limit, content-type allowlist | `MAX_RAW_INPUT_BYTES` |
| Ingestor → Validator | `CandidateCapsuleEnvelope.__brand` | Type-level separation |
| Validator → Handshake | `ValidatedCapsule.__brand` + runtime guard | Compile + runtime check |
| Handshake → Tool Execution | `authorizeToolInvocation()` | Single gate, audit-logged |
| Invalid Input → Quarantine | `INSERT OR IGNORE` on `raw_input_hash` | Dedup at DB level |
| External Draft → Sandbox | `INSERT OR IGNORE` on `raw_input_hash` | Dedup at DB level |

## 4. Audit Log Expectations

Every threat scenario produces deterministic audit records:

| Scenario | Audit Action | Table |
|---|---|---|
| 1 (Validation bypass) | `VALIDATION_BYPASS_ATTEMPT` | `audit_log` |
| 2 (Oversized) | `rejected` / `error` | `ingestion_audit_log` + `ingestion_quarantine` |
| 3 (JSON bomb) | `rejected` | `ingestion_audit_log` + `ingestion_quarantine` |
| 4 (Prototype pollution) | `rejected` | `ingestion_audit_log` + `ingestion_quarantine` |
| 5 (Replay flooding) | Dedup — single record | `ingestion_quarantine` (INSERT OR IGNORE) |
| 6 (Malformed MIME) | `rejected` | `ingestion_audit_log` + `ingestion_quarantine` |
| 7 (Forged brand) | `VALIDATION_BYPASS_ATTEMPT` | `audit_log` |
| 8 (Revoked reactivation) | `handshake_pipeline_denial` | `audit_log` |
| 9 (Unauthorized tool) | `TOOL_DENIED` | `audit_log` |
| 10 (Race condition) | Atomic dedup | SQLite-level enforcement |
