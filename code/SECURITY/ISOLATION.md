# BEAP pod isolation invariant (release-blocking)

## Property

**Untrusted capsule bytes are never parsed, validated, or decrypted in the Electron main process (or coordination Node process in production).** They are handled only inside the BEAP pod (host Podman pod or relay ingestor container).

This is a **fail-closed** security property, not a performance optimization. There is no degraded “legacy in-process” mode.

## Untrusted set (pod-only)

| Operation | Main-process entry | Required path |
|-----------|-------------------|---------------|
| External ingest / validate on raw wire | `coordinationWs`, `relayPull`, `p2pServer`, `ingestion/ipc`, `handshake/ipc` (file import) | `processIncomingInput` → `dispatchProcessIncomingInput` → `processIncomingInputViaPod` |
| qBEAP / pBEAP depackage | `beapEmailIngestion`, `messageRouter` | `dispatchDepackageQBeap` → pod HTTP `/ingest` |
| `decryptQBeapPackage` | — | **Must not be called** from `electron/main` production code |
| `validateCapsule` on raw candidate | — | Only `processIncomingInputInProcess` (internal trusted path) |
| Quarantine inner `quarantine-blob-v1` decrypt | `beapEmailIngestion` | **Blocked** (`quarantine_inner_decrypt_requires_pod`) until pod endpoint exists |
| Handshake-shaped inline bypass | — | Hard reject at email/P2P routers |

## Trusted set (in-process allowed)

| Operation | Where | Why |
|-----------|-------|-----|
| `validatorOrchestrator` / inner seal on canonical JSON | Post-pod | Already depackaged / trusted shape |
| `computeSeal(..., 'outer')` | Ledger / handshake | Session-derived keys, not raw wire |
| User-selected composer PDF (LibreOffice) | `main.ts` | User-supplied file, not inbound BEAP wire |
| `processIncomingInputInProcess` | `sourceType === 'internal'` only | Same-user trusted internal drafts |

## Ingestion modes

`IngestionMode` is exactly:

- `EdgeActive` — pod via edge tier
- `HostPodActive` — pod on host
- `Blocked` — hold queue; **no in-process fallback**

Forbidden forever: `LegacyInProcess`, `InProcessUntrusted`, and similar.

## Enforcement layers

| Layer | Location | Behavior |
|-------|----------|----------|
| **CI static gate** | `scripts/check-beap-pod-isolation-gate.mjs` | Scans `electron/main`; **exit 1** on violation |
| **Vitest** | `electron/main/ingestion/__tests__/podIsolation.invariant.test.ts` | Runs gate + runtime `SecurityInvariantError` tests |
| **Runtime** | `security/securityInvariant.ts` + `ingestionDispatcher.ts` | Throws `SecurityInvariantError` if mode/sourceType illegal |
| **Host preflight** | `security/beapPreflightGate.ts` | Blocks P2P/coordination WS until Podman ready |
| **Relay preflight** | `packages/coordination-service` | Boot + `/relay-validate` on ingestor pod |

## CI

```bash
pnpm run check:beap-pod-isolation
```

Also covered by `pnpm test` via `podIsolation.invariant.test.ts`.

## Deliberate bypass test

Adding e.g. `LegacyInProcess` to `IngestionMode` or calling `decryptQBeapPackage()` from an entry point **must fail** the static gate. Remove the bypass → gate passes.

## Podman bundling

Podman is **not** bundled with the desktop app (license). Users install Podman separately; relay hosts install Podman on the VM.

## Related docs

- `apps/electron-vite-project/electron/main/ingestion/ENTRYPOINT_AUDIT.md` — entrypoint flow (must stay aligned with this file)
- `packages/coordination-service/RELAY_DEPLOY.md` — relay host pod + preflight
