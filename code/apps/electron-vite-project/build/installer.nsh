; ============================================================================
; OpenGiraffe Custom NSIS Installer Script
; Optional Components - Ollama Runtime Download (User-Initiated)
; ============================================================================
; This script hooks into electron-builder's NSIS template to offer
; downloading Ollama from the official website after installation.
; NO binaries are bundled - user downloads from official source.
; ============================================================================

!include "LogicLib.nsh"

; ============================================================================
; Macro: customInstall - Called after main installation is complete
; ============================================================================
!macro customInstall
  ; Ask user if they want to download Ollama
  MessageBox MB_YESNO|MB_ICONQUESTION "OpenGiraffe can use Ollama for local AI features.$\r$\n$\r$\nWould you like to open the Ollama download page?$\r$\n$\r$\n(Ollama is free, open-source software under the MIT License.$\r$\nYou can also download it later from https://ollama.ai)" IDYES downloadOllama IDNO skipOllama
  
  downloadOllama:
    ExecShell "open" "https://ollama.ai/download"
    Goto doneOllama
    
  skipOllama:
    ; User chose not to download
    
  doneOllama:
!macroend
