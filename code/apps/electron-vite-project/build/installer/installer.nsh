; WR Desk Windows NSIS customizations (electron-builder include).
; See docs/installer-role-environment-spec.md
;
; - Role page: Host locked/selected; Sandbox disabled (Linux-only reason).
; - Edition-specific hypervisor notice (Home vs Pro); no bundling or auto-install.
; - Seeds orchestrator-mode.json (mode=host) before first app launch.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

Var WRDeskEdition       ; home | pro | other
Var WRDeskHyperVState   ; enabled | disabled | unknown
Var WRDeskRoleDialog
Var WRDeskHostRadio
Var WRDeskSandboxRadio

; ── Windows edition (registry EditionID — mirrors detect-windows-edition.ps1) ──

Function WRDeskDetectWindowsEdition
  StrCpy $WRDeskEdition "other"
  ClearErrors
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" EditionID
  ${If} ${Errors}
    Return
  ${EndIf}

  ${If} $0 == "Core"
  ${OrIf} $0 == "CoreSingleLanguage"
  ${OrIf} $0 == "CoreCountrySpecific"
  ${OrIf} $0 == "Home"
  ${OrIf} $0 == "Home N"
  ${OrIf} $0 == "Home Single Language"
    StrCpy $WRDeskEdition "home"
    Return
  ${EndIf}

  ${If} $0 == "Professional"
  ${OrIf} $0 == "ProfessionalEducation"
  ${OrIf} $0 == "ProfessionalEducationN"
  ${OrIf} $0 == "ProfessionalN"
  ${OrIf} $0 == "ProfessionalWorkstation"
  ${OrIf} $0 == "ProfessionalWorkstationN"
  ${OrIf} $0 == "Enterprise"
  ${OrIf} $0 == "EnterpriseN"
  ${OrIf} $0 == "Education"
  ${OrIf} $0 == "EducationN"
    StrCpy $WRDeskEdition "pro"
    Return
  ${EndIf}
FunctionEnd

; ── Hyper-V probe (Pro notice only; non-blocking) ─────────────────────────────

Function WRDeskDetectHyperV
  StrCpy $WRDeskHyperVState "unknown"
  InitPluginsDir
  File /oname=$PLUGINSDIR\hyperv-status.ps1 "${BUILD_RESOURCES_DIR}\installer\hyperv-status.ps1"
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\hyperv-status.ps1"'
  Pop $0
  Pop $1
  ; Trim trailing CR/LF from captured stdout
  StrCpy $2 $1 7
  ${If} $2 == "enabled"
    StrCpy $WRDeskHyperVState "enabled"
    Return
  ${EndIf}
  StrCpy $2 $1 8
  ${If} $2 == "disabled"
    StrCpy $WRDeskHyperVState "disabled"
    Return
  ${EndIf}
FunctionEnd

; ── Custom role + environment notice page ───────────────────────────────────

Function WRDeskRolePage
  Call WRDeskDetectWindowsEdition
  StrCpy $WRDeskHyperVState ""
  ${If} $WRDeskEdition == "pro"
    Call WRDeskDetectHyperV
  ${EndIf}

  nsDialogs::Create 1018
  Pop $WRDeskRoleDialog
  ${If} $WRDeskRoleDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "Orchestrator role on this Windows PC"
  Pop $0

  ${NSD_CreateRadioButton} 0 24u 100% 12u "Host (this computer)"
  Pop $WRDeskHostRadio
  SendMessage $WRDeskHostRadio ${BM_SETCHECK} ${BST_CHECKED} 0
  EnableWindow $WRDeskHostRadio 0

  ${NSD_CreateRadioButton} 0 40u 100% 12u "Sandbox"
  Pop $WRDeskSandboxRadio
  EnableWindow $WRDeskSandboxRadio 0

  ${NSD_CreateLabel} 12u 56u 100% 20u "Sandbox orchestrators run only on Linux."
  Pop $0

  ; Edition-specific hypervisor notice (text only — no download/install)
  ${If} $WRDeskEdition == "home"
    ${NSD_CreateLabel} 0 82u 100% 48u "Windows Home: a hypervisor (VirtualBox recommended — open source at virtualbox.org, or VMware Workstation) must be installed separately. Linux guest provisioning is a later setup step. This installer does not include or install a hypervisor."
    Pop $0
  ${ElseIf} $WRDeskEdition == "pro"
    ${If} $WRDeskHyperVState == "disabled"
      ${NSD_CreateLabel} 0 82u 100% 56u "Windows Pro: Hyper-V is not enabled. To enable: open Turn Windows features on or off, check Hyper-V, then restart. Or run in an elevated PowerShell: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All. Linux guest provisioning is a later setup step."
      Pop $0
    ${ElseIf} $WRDeskHyperVState == "unknown"
      ${NSD_CreateLabel} 0 82u 100% 48u "Windows Pro: if you plan to use Hyper-V for the Linux guest, ensure Hyper-V is enabled in Turn Windows features on or off. Linux guest provisioning is a later setup step."
      Pop $0
    ${Else}
      ${NSD_CreateLabel} 0 82u 100% 32u "Windows Pro: Hyper-V appears enabled. Linux guest provisioning is a later setup step."
      Pop $0
    ${EndIf}
  ${Else}
    ${NSD_CreateLabel} 0 82u 100% 32u "This Windows edition will run as Host. Sandbox orchestrators are available only on native Linux installs."
    Pop $0
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function WRDeskRolePageLeave
  ; Non-blocking — always continue. Windows role is always host (seed written in customInstall).
FunctionEnd

Page custom WRDeskRolePage WRDeskRolePageLeave

; ── Seed orchestrator-mode.json (mode=host) after files are installed ─────────

!macro customInstall
  InitPluginsDir
  File /oname=$PLUGINSDIR\seed-orchestrator-mode.ps1 "${BUILD_RESOURCES_DIR}\installer\seed-orchestrator-mode.ps1"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\seed-orchestrator-mode.ps1"'
!macroend
