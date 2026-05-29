# Entry Point Audit — BEAP Ingestion Layer

> **Canonical security property:** [SECURITY/ISOLATION.md](../../../../SECURITY/ISOLATION.md)  
> Untrusted capsule bytes are **pod-only**. CI enforces via `scripts/check-beap-pod-isolation-gate.mjs`.

## Flow (external input)

```
External input
    │
    ▼
processIncomingInput()   [ingestion/ingestionPipeline.ts]
    │
    ▼
dispatchProcessIncomingInput()   [ingestion/ingestionDispatcher.ts]
    │  assertExternalUntrustedViaPodOnly(mode)
    ├─ Blocked / waitForHostPod / halted → held queue (POD_REQUIRED / EDGE_UNREACHABLE)
    ├─ sourceType === 'internal' → processIncomingInputInProcess (trusted only; runtime assert)
    └─ else → HTTP POST /ingest   [pod ingestor @ 127.0.0.1:18100 or WR_POD_BASE_URL]
              │
              ▼ (pod-internal)
         validator → depackager → sealer
              │
              ▼
         PodIngestResult → distribution gate → handshake_pipeline / sandbox / quarantine
```

## Host preflight

- `runStartupPodmanProbe()` before `startIngestionModeLifecycle()` (`electron/main.ts`)
- `beapPreflightGate.ts` blocks P2P server, coordination WS, relay pull until Podman ready
- `PodmanRequiredModal` — no dismiss-and-continue

## qBEAP / pBEAP depackage (inline P2P / email)

`dispatchDepackageQBeap` → pod HTTP only (`ingestionDispatcher.ts`). No `decryptQBeapPackage()` in production `electron/main`.

## Known pod routing gaps (explicit reject in main)

| Path | Status |
|------|--------|
| Handshake-shaped inline JSON | Hard reject |
| Sandbox quarantine inner `quarantine-blob-v1` decrypt | **GAP** — `quarantine_inner_decrypt_requires_pod`; no depackager endpoint yet |

## Trusted in-process (exempt from pod gate)

- `validatorOrchestrator` / inner seal on canonical JSON
- `computeSeal(..., 'outer')` on ledger session material
- Composer PDF via LibreOffice (`main.ts`)

## Enforcement

| Layer | File |
|-------|------|
| CI static | `scripts/check-beap-pod-isolation-gate.mjs` |
| Vitest | `ingestion/__tests__/podIsolation.invariant.test.ts` |
| Runtime | `security/securityInvariant.ts` + `ingestionDispatcher.ts` |
