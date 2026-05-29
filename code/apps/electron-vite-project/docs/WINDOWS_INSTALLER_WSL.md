# Windows installer: WSL2 + Podman (required path)

## Why not runtime auto-install?

WR Desk **does not** run `wsl --install` from the running app. An elevated install spawns a **detached** administrator PowerShell window that the app cannot monitor (`exit=null`, no captured output), which leads to infinite “Installing WSL2…” spinners and no reliable success/failure signal.

## Primary fix: NSIS installer

WSL2 and Podman provisioning belong in the **WR Desk installer** (NSIS), which:

- Runs with installer elevation (normal UX)
- Can call `wsl.exe --install` and `winget install RedHat.Podman` with `ExecWait` / `nsExec`
- Can set reboot flags and show a clear “restart to finish” page

**Stub:** `build/installer/wsl-podman-prereq.nsh` (included from `electron-builder.config.cjs`). The `customInstall` macro is commented until product wires the full flow.

Build NSIS: `pnpm run build:nsis` in `apps/electron-vite-project`.

## Runtime fallback (recovery only)

If WSL is missing on an already-installed copy (portable `win-unpacked`, skipped installer step, or broken machine), the blocking modal shows **manual** instructions:

1. Open PowerShell **as Administrator**
2. Run `wsl --install` (copy button in UI)
3. Restart the computer
4. Reopen WR Desk — Podman one-click continues when WSL is ready

No elevated child windows. No fake progress for unm monitorable steps.
