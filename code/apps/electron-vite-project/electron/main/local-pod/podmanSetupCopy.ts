/**
 * App-locale (English) user-facing Podman setup copy — never raw OS output.
 */

import type { PodmanSetupErrorCode } from './podmanDetect.js'
import type { WslIssue } from './wslProbe.js'

export type PodmanSetupCopyPhase =
  | 'need_package'
  | 'need_virtualization'
  | 'need_restart'

/** WSL install/update cannot run reliably from the running app — manual or NSIS installer only. */
export function wslIssueRequiresManualInstall(issue: WslIssue): boolean {
  return (
    issue === 'not_installed' ||
    issue === 'no_distro' ||
    issue === 'needs_update' ||
    issue === 'unknown'
  )
}

export function wslManualInstallCommand(issue: WslIssue): string {
  if (issue === 'needs_update') return 'wsl --update'
  return 'wsl --install'
}

export interface WindowsWslManualInstruction {
  headline: string
  summary: string
  instruction: string
  copyCommand: string
}

export function buildWindowsWslManualInstruction(issue: WslIssue): WindowsWslManualInstruction {
  const copyCommand = wslManualInstallCommand(issue)
  return {
    headline: 'Windows container feature required',
    summary:
      'WR Desk needs the Windows Subsystem for Linux (WSL2) before Podman can run. Install it once from an administrator terminal, then restart your computer.',
    instruction: [
      'WR Desk needs the Windows container feature (WSL2).',
      '',
      '1. Right-click Start → Terminal (Admin) or Windows PowerShell (Admin).',
      `2. Run: ${copyCommand}`,
      '3. Restart your computer when Windows asks (required).',
      '4. Open WR Desk again — setup will continue automatically.',
    ].join('\n'),
    copyCommand,
  }
}

export function wslIssueHeadline(issue: WslIssue): string {
  if (wslIssueRequiresManualInstall(issue)) {
    return buildWindowsWslManualInstruction(issue).headline
  }
  switch (issue) {
    case 'virtualization_disabled':
      return 'Enable virtualization to continue'
    case 'ready':
      return 'WSL is ready'
    default:
      return 'WSL setup required'
  }
}

export function wslIssueSummary(issue: WslIssue): string {
  if (wslIssueRequiresManualInstall(issue)) {
    return buildWindowsWslManualInstruction(issue).summary
  }
  switch (issue) {
    case 'virtualization_disabled':
      return 'Podman on Windows requires WSL2, which needs hardware virtualization (Intel VT-x / AMD-V) enabled in BIOS or UEFI.'
    case 'ready':
      return ''
    default:
      return 'WSL must be configured before Podman can run on Windows.'
  }
}

export function podmanCodeHeadline(code: PodmanSetupErrorCode, plat: NodeJS.Platform): string {
  switch (code) {
    case 'not_installed':
      return plat === 'win32' ? 'Install Podman to continue' : 'Install Podman to continue'
    case 'machine_not_initialized':
    case 'machine_not_running':
      return 'Finish Podman setup'
    case 'engine_unhealthy':
      return 'Podman needs attention'
    case 'probe_pending':
      return 'Checking secure container setup…'
    default:
      return 'Podman setup required'
  }
}

export function podmanCodeSummary(code: PodmanSetupErrorCode, plat: NodeJS.Platform): string {
  switch (code) {
    case 'not_installed':
      return plat === 'win32'
        ? 'When WSL2 is ready, one click installs Podman and starts secure isolation.'
        : plat === 'darwin'
          ? 'One click installs Podman on this Mac and starts secure isolation.'
          : 'WR Desk requires Podman for security isolation on this server.'
    case 'machine_not_initialized':
    case 'machine_not_running':
      return 'Podman is installed. One click will finish setup and start secure isolation.'
    case 'engine_unhealthy':
      return plat === 'linux'
        ? 'Podman is present but the engine is not responding on this server.'
        : 'Podman is present but not responding. Try setup again or restart Podman Desktop.'
    case 'probe_pending':
      return 'WR Desk uses container isolation as a core security measure. Verifying Podman on this computer…'
    default:
      return 'Secure container isolation requires Podman on this computer.'
  }
}

export function mapWslIssueToPhase(issue: WslIssue): PodmanSetupCopyPhase {
  switch (issue) {
    case 'virtualization_disabled':
      return 'need_virtualization'
    case 'not_installed':
    case 'no_distro':
    case 'needs_update':
    case 'unknown':
      return 'need_package'
    default:
      return 'need_package'
  }
}

export function ipcMissingMessage(): string {
  return 'Setup could not start (app bridge unavailable). Restart WR Desk and try again.'
}

export function unexpectedSetupErrorMessage(): string {
  return 'Podman setup stopped unexpectedly. Try again, or install Podman manually from podman.io.'
}
