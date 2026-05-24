# Ingestion Pipeline — Pod Hot Path (P1.12)

**Status:** Pod is the exclusive ingestion path as of Phase 1 (2026-05-24).

## Overview

All inbound BEAP messages arrive at `processIncomingInput()` in
`ingestionPipeline.ts`. Since P1.12 this always routes through the local
BEAP pod, with no in-process fallback.

## Flow

```
Electron caller
  │
  ▼
processIncomingInput(rawInput, sourceType, transportMeta)
  │  ingestion/ingestionPipeline.ts
  │
  ▼
HTTP POST http://127.0.0.1:18100/ingest      ← WR_POD_BASE_URL overrides in tests
  │  @repo/pod-client  →  pod ingestor role
  │
  ├─── [422 Validation failure]
  │      PodIngestResult { valid: false, reason, details }
  │
  └─── [200 Success]
         pod ingestor → pod validator → pod depackager → pod sealer
         PodIngestResult { valid: true, needs_depackaging: false, validated: ValidatedCapsule }
         │                               OR (qBEAP)
         │               { valid: true, needs_depackaging: false, depackaged: { ... }, seal, sealInputJson }
         │
         ▼
  Distribution gate (ingestionPipeline.ts)
    ├─ capsule_type == handshake_*  → processHandshakeCapsule()
    ├─ capsule_type == message_*    → sandbox / quarantine
    └─ unknown                      → quarantine
```

## Key files

| File | Role |
|------|------|
| `ingestion/ingestionPipeline.ts` | Orchestrator — calls pod, routes result |
| `packages/pod-client/src/client.ts` | HTTP wrapper — ingest + retry + timeout |
| `packages/beap-pod/src/roles/ingestor.ts` | Pod ingestor entry point |
| `packages/beap-pod/src/roles/validator.ts` | Pod validator |
| `packages/beap-pod/src/roles/depackager.ts` | Pod depackager (qBEAP/pBEAP decrypt) |
| `packages/beap-pod/src/roles/sealer.ts` | Pod sealer (HMAC-SHA256) |
| `validation/inProcessValidator.ts` | In-process re-seal for update operations |
| `email/beapEmailIngestion.ts` | P2P/relay BEAP ingestion (calls pod for qBEAP) |
| `email/messageRouter.ts` | Email-path BEAP routing (calls pod for qBEAP) |

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WR_POD_BASE_URL` | `http://127.0.0.1:18100` | Override pod URL (tests) |

## Removed in P1.12

- `validator-process/` subprocess and IPC wiring
- `beap/decryptQBeapPackage.ts` in-process qBEAP decryption
- `WR_POD_HOT_PATH` feature flag (pod is now always on)
- `processIncomingInputInProcess()` fallback function

## Fail-closed behaviour

If the pod is unreachable or returns an error, `processIncomingInput()` returns
an `IngestionResult` with `ok: false`. No in-process fallback exists. This is
intentional: the pod provides the security guarantees; bypassing it would
undermine them.
