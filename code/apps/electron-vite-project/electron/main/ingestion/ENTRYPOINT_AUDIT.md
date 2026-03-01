# Entry Point Audit — BEAP Ingestion Layer

## Purpose

This document inventories all external input entry points into the Electron main process and confirms that every path routes through `processIncomingInput()` before reaching the handshake layer.

## External Input Entry Points

### 1. WebSocket RPC — `ingestion.ingest`

- **Location**: `electron/main.ts` → `handleIngestionRPC()` → `processIncomingInput()`
- **Routes through ingestion**: YES
- **Can bypass to handshake**: NO — `handleIngestionRPC` calls `processIncomingInput()` first, then only forwards `ValidatedCapsule` to `processHandshakeCapsule()`

### 2. HTTP POST — `/api/ingestion/ingest`

- **Location**: `registerIngestionRoutes()` in `electron/main/ingestion/ipc.ts`
- **Routes through ingestion**: YES — calls `processIncomingInput()`
- **Can bypass to handshake**: NO

### 3. WebSocket RPC — `handshake.*` methods

- **Location**: `electron/main.ts` → `handleHandshakeRPC()`
- **Routes through ingestion**: N/A — these are read-only query + revocation handlers
- **Can bypass to handshake processing**: NO — `handleHandshakeRPC` does NOT call `processHandshakeCapsule()`. It only calls:
  - `getHandshakeRecord()` (read)
  - `listHandshakeRecords()` (read)
  - `queryContextBlocks()` (read)
  - `authorizeAction()` (read)
  - `isHandshakeActive()` (read)
  - `revokeHandshake()` (state mutation, but revocation only — no capsule processing)

### 4. HTTP GET/POST — `/api/handshake/*` routes

- **Location**: `registerHandshakeRoutes()` in `electron/main/handshake/ipc.ts`
- **Routes through ingestion**: N/A — read-only queries + revocation
- **Can bypass to handshake processing**: NO — same as above, no call to `processHandshakeCapsule()`

### 5. HTTP GET — `/api/ingestion/quarantine`, `/api/ingestion/sandbox-queue`

- **Location**: `registerIngestionRoutes()` in `electron/main/ingestion/ipc.ts`
- **Routes through ingestion**: N/A — read-only endpoints
- **Can bypass**: NO — no write path

## Direct Call Analysis

### `processHandshakeCapsule()` Callers

The function `processHandshakeCapsule` in `electron/main/handshake/enforcement.ts` is called from exactly one location in production code:

1. `electron/main/ingestion/ipc.ts` → `handleIngestionRPC()` → after successful `processIncomingInput()` → `processHandshakeCapsule(distribution.validated_capsule, ...)`

No other file in the codebase calls `processHandshakeCapsule()` in production code. Test files may call it with mock `ValidatedCapsule` objects.

### Runtime Guard

Even if a caller managed to reach `processHandshakeCapsule()` with a fabricated input, the runtime brand guard rejects any input where:
- `__brand !== 'ValidatedCapsule'`
- `validated_at` is missing or not a string
- `validator_version` is missing or not a string
- `provenance` or `capsule` objects are missing

### Forbidden Cast Policy

Production code SHALL NOT contain `as ValidatedCapsule` outside `validator.ts`. A CI test (`forbiddenCasts.test.ts` or equivalent) verifies this by scanning source files.

## Legacy Handlers

No legacy handlers exist that can call `processHandshakeCapsule()` directly. The handshake IPC handler (`handleHandshakeRPC`) was designed from the start as a read-only + revocation interface.

## Conclusion

All external input paths route through `processIncomingInput()`. The handshake layer is unreachable without a `ValidatedCapsule`. Runtime guards provide defense-in-depth beyond compile-time type safety.
