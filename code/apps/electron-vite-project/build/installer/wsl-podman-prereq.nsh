; WR Desk Windows installer — WSL2 + Podman prerequisites (PRIMARY path)
;
; Runtime one-click WSL install was removed: an elevated child process cannot be
; monitored reliably from a running Electron app. WSL provisioning belongs HERE,
; in the NSIS installer, which is already elevated and can request a normal reboot.
;
; TODO (required product work — not wired yet):
;   1. After File section, run: wsl.exe --install (or dism optional feature)
;   2. Optionally winget install RedHat.Podman
;   3. Use nsExec / ExecWait and surface errors in installer UI
;   4. If reboot required, call SetRebootFlag true / custom page explaining restart
;
; Example hook (enable when implementing):
;
; !macro customInstall
;   DetailPrint "Installing Windows Subsystem for Linux (WSL2)…"
;   nsExec::ExecToLog '"$WINDIR\System32\wsl.exe" --install'
;   Pop $0
;   ${If} $0 != 0
;     MessageBox MB_OK|MB_ICONEXCLAMATION "WSL install returned $0. You may need to run wsl --install from an Administrator terminal, then restart."
;   ${Else}
;     SetRebootFlag true
;   ${EndIf}
; !macroend
;
; See: apps/electron-vite-project/docs/WINDOWS_INSTALLER_WSL.md
