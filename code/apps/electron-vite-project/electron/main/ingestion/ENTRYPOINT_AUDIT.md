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

### 6. Provider email sync — raw RFC822 / provider-structured payloads

- **Location**: `electron/main/email/syncOrchestrator.ts` → `emailGateway` provider
  fetch (`providers/imap.ts`, `providers/gmail.ts`, `providers/outlook.ts`) →
  `messageRouter.ts:detectAndRouteMessage()`.
- **Why this section exists**: the original audit (entries 1–5) covered only the
  WS/HTTP BEAP ingestion RPC surface. The B2 analysis (`docs/build-specs/0006`)
  showed provider email sync is the **only raw-MIME ingress** and that it was NOT
  documented here — the documented invariant did not match the trace. This entry
  closes that gap (B2 build spec 0007, Phase 3.5).
- **Untrusted content**: YES — raw RFC822 (IMAP), `format=raw`/`full` (Gmail), or
  Graph payloads (Outlook). This is attacker-influenced MIME, the highest-risk
  input class.
- **Routing**:
  - **Flag OFF (`WRDESK_SEAM_DEPACKAGE_CUTOVER` unset, default)**: the legacy
    inline path runs unchanged — the provider/gateway parses MIME and
    `detectAndRouteMessage` classifies plain vs BEAP carrier. (Verbatim behavior;
    no seam involvement.)
  - **Flag ON**: the opaque payload is handed to
    `dispatch({ kind: 'depackage-email' })` via `liveDepackageCutover.ts`. The
    orchestrator inspects **neither** the raw bytes nor any post-parse structure
    (R2). `detectAndRouteMessage` becomes a **consumer of the typed result union**
    (`plain | beap-carrier | mixed`) or a typed worker failure.
- **INV-7 (no risk routing)**: any failure to establish the safety contract —
  opaque payload unobtainable, guest failure, limits exceeded, safe-text
  rejection, ambiguous/partially-matching carrier classification — **quarantines**
  (raw/opaque bytes custody-sealed, typed reason code) or fails closed. There is
  never a best-effort inline parse, partial-trust display, or silent isolation
  downgrade while the flag is on. Extracted BEAP packages are forwarded to the
  B1-routed pipeline-2 path; plain mail is consumer-wrapped, sealed, and stored.

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
