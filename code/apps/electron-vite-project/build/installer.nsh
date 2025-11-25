; ============================================================================
; OpenGiraffe Custom NSIS Installer Script
; Optional Components Page - Ollama Runtime Installation (User-Initiated)
; ============================================================================
; This script adds an optional components page where users can choose to
; download Ollama from the official source. NO binaries are bundled.
; ============================================================================

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Variables for UI elements
Var Dialog
Var OllamaCheckbox
Var OllamaInstallState
Var LicenseLink
Var DisclaimerLabel
Var InfoLabel

; ============================================================================
; Custom Page: Optional Components
; ============================================================================

; Insert custom page after the directory selection page
!define MUI_PAGE_CUSTOMFUNCTION_SHOW OptionalComponentsPageShow
!insertmacro MUI_PAGE_INSTFILES

; Define the custom page
Page custom OptionalComponentsPage OptionalComponentsLeave

; ============================================================================
; Function: Create the Optional Components Page
; ============================================================================
Function OptionalComponentsPage
    ; Create dialog
    nsDialogs::Create 1018
    Pop $Dialog
    
    ${If} $Dialog == error
        Abort
    ${EndIf}
    
    ; Title/Header text
    ${NSD_CreateLabel} 0 0 100% 24u "Optional Components"
    Pop $InfoLabel
    CreateFont $0 "Segoe UI" 12 700
    SendMessage $InfoLabel ${WM_SETFONT} $0 0
    
    ; Description
    ${NSD_CreateLabel} 0 28u 100% 24u "OpenGiraffe can use Ollama to run local AI models. Ollama is a free, open-source tool."
    Pop $0
    
    ; Checkbox for Ollama installation
    ${NSD_CreateCheckbox} 0 60u 100% 14u "Download Ollama Runtime after installation (MIT License)"
    Pop $OllamaCheckbox
    ${NSD_SetState} $OllamaCheckbox ${BST_UNCHECKED}
    
    ; Disclaimer text
    ${NSD_CreateLabel} 0 82u 100% 36u "By selecting this option, your browser will open to ollama.ai after installation completes. You will download Ollama directly from its official source under the MIT License."
    Pop $DisclaimerLabel
    
    ; License link
    ${NSD_CreateLink} 0 124u 100% 12u "View Ollama License (MIT) - https://github.com/ollama/ollama/blob/main/LICENSE"
    Pop $LicenseLink
    ${NSD_OnClick} $LicenseLink OnLicenseLinkClick
    
    ; Additional info
    ${NSD_CreateLabel} 0 144u 100% 36u "Note: Ollama is NOT bundled with this installer. If you skip this step, you can install Ollama later from https://ollama.ai"
    Pop $0
    
    ; Models info
    ${NSD_CreateGroupBox} 0 184u 100% 56u "About Local AI Models"
    Pop $0
    ${NSD_CreateLabel} 8u 198u 95% 36u "After installing Ollama, you can download AI models through the OpenGiraffe LLM Settings panel. Each model has its own license - please review before downloading."
    Pop $0
    
    nsDialogs::Show
FunctionEnd

; ============================================================================
; Function: Handle License Link Click
; ============================================================================
Function OnLicenseLinkClick
    ExecShell "open" "https://github.com/ollama/ollama/blob/main/LICENSE"
FunctionEnd

; ============================================================================
; Function: Save user selection when leaving the page
; ============================================================================
Function OptionalComponentsLeave
    ${NSD_GetState} $OllamaCheckbox $OllamaInstallState
FunctionEnd

; ============================================================================
; Function: Show Optional Components Page (MUI callback)
; ============================================================================
Function OptionalComponentsPageShow
FunctionEnd

; ============================================================================
; Section: Post-Installation Actions
; ============================================================================
Section "-PostInstall"
    ; Check if user opted to download Ollama
    ${If} $OllamaInstallState == ${BST_CHECKED}
        ; Open Ollama download page in default browser
        ExecShell "open" "https://ollama.ai/download"
        
        ; Show message to user
        MessageBox MB_ICONINFORMATION|MB_OK "Your browser will now open to the Ollama download page.$\r$\n$\r$\nPlease follow the instructions there to install Ollama.$\r$\n$\r$\nOnce installed, you can configure AI models in OpenGiraffe's LLM Settings."
    ${EndIf}
SectionEnd

; ============================================================================
; Uninstaller: Clean up (does NOT uninstall Ollama - user manages that separately)
; ============================================================================
Section "un.PostUninstall"
    ; Note: We do NOT uninstall Ollama here since it was installed separately
    ; and may be used by other applications
SectionEnd

