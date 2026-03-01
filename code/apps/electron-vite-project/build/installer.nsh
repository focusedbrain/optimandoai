; ============================================================================
; OpenGiraffe Custom NSIS Installer Script
; Optional Components - Ollama Runtime Download (User-Initiated)
; Startup Registration - Task Scheduler (Reliable background service)
; ============================================================================
; This script hooks into electron-builder's NSIS template to:
;   1. Register a Task Scheduler ONLOGON task so WR Desk Orchestrator starts
;      automatically as a headless background service on every Windows login.
;      (More reliable than HKCU\Run which can be suppressed by startup policies)
;   2. Offer downloading Ollama from the official website after installation.
; NO binaries are bundled - user downloads from official source.
; ============================================================================

!include "LogicLib.nsh"

; ============================================================================
; Macro: customInstall - Called after main installation is complete
; ============================================================================
!macro customInstall
  ; ------------------------------------------------------------------
  ; Register Task Scheduler ONLOGON task for per-user autostart.
  ; This runs schtasks.exe without requiring admin rights (/RL LIMITED).
  ; The 30-second delay (/DELAY 0000:30) gives the desktop session time
  ; to fully initialise before the app starts — ensuring Chrome extensions
  ; and the SSO flow work correctly right out of the box.
  ; ------------------------------------------------------------------
  DetailPrint "Registering WR Desk Orchestrator as a startup service..."
  ExecWait 'schtasks /Create /F /TN "WRDeskOrchestrator" /TR "\"$INSTDIR\WR Desk.exe\" --hidden" /SC ONLOGON /DELAY 0000:30 /RL LIMITED /IT' $0
  ${If} $0 == 0
    DetailPrint "Startup task registered successfully."
  ${Else}
    DetailPrint "Note: Could not register startup task via schtasks (exit code $0). The app will register itself on first launch."
  ${EndIf}

  ; ------------------------------------------------------------------
  ; Also write the classic HKCU\Run entry as a fallback.
  ; ------------------------------------------------------------------
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WR Desk" '"$INSTDIR\WR Desk.exe" --hidden'

  ; ------------------------------------------------------------------
  ; Ask user if they want to download Ollama
  ; ------------------------------------------------------------------
  MessageBox MB_YESNO|MB_ICONQUESTION "OpenGiraffe can use Ollama for local AI features.$\r$\n$\r$\nWould you like to open the Ollama download page?$\r$\n$\r$\n(Ollama is free, open-source software under the MIT License.$\r$\nYou can also download it later from https://ollama.ai)" IDYES downloadOllama IDNO skipOllama

  downloadOllama:
    ExecShell "open" "https://ollama.ai/download"
    Goto doneOllama

  skipOllama:
    ; User chose not to download

  doneOllama:
!macroend

; ============================================================================
; Macro: customUnInstall - Called during uninstall
; ============================================================================
!macro customUnInstall
  ; Remove the Task Scheduler task
  ExecWait 'schtasks /Delete /F /TN "WRDeskOrchestrator"'
  ; Remove the HKCU\Run registry entry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WR Desk"
!macroend
