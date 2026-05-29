# Podman installer guarantee (next required work)

## Current state

| Path | Role | Status |
|------|------|--------|
| **Windows NSIS / electron-builder installer** | Primary — install + verify Podman and machine **before first run** | **Not implemented yet** |
| **In-app `PodmanRequiredModal`** | Runtime recovery when Podman is removed, stopped, or broken after install | **Implemented** |

The modal is intentionally a **safety net**, not the primary onboarding path. Users should not rely on hitting the modal on first launch once the installer guarantee ships.

## Target installer behavior (Windows first)

1. Detect Podman on PATH or well-known install locations.
2. If missing, offer winget install (or bundled guidance) during WR Desk setup.
3. After package present, verify `podman machine list` → run `podman machine init` (once) and `podman machine start`.
4. Verify `podman info` and `podman ps` before completing setup.
5. Write orchestrator build stamp / first-run flag so Host AI state resets on upgrade.

## Implementation hooks

- Probe contract: `@repo/podman-probe` + `podmanDetect.ts` (machine before engine on Windows/macOS).
- Guided commands: `podmanInstallRunner.ts` (winget “already installed” → success).
- Runtime UI: `PodmanRequiredModal.tsx` + `podmanSetupIpc.ts`.

## NSIS integration (TODO)

Extend `electron-builder.config.cjs` / custom NSIS include to call a PowerShell helper that mirrors `runMachineSetupFollowUp()` before the app launches. Reuse the same exit-code normalization as winget in `podmanInstallRunner.ts`.
