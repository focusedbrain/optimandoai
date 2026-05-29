/**
 * App-locale (English) user-facing Podman setup copy — never raw OS output.
 */

import type { PodmanSetupErrorCode } from './podmanDetect.js'
import type { PodmanCommandResult } from './podmanInstallRunner.js'
import type { WslIssue } from './wslProbe.js'
import { uacWasCancelled } from './wslProbe.js'

export type PodmanSetupCopyPhase =
  | 'need_package'
  | 'need_virtualization'
  | 'need_restart'

export function wslIssueHeadline(issue: WslIssue): string {
  switch (issue) {
    case 'not_installed':
      return 'Windows Subsystem for Linux is required'
    case 'no_distro':
      return 'Linux environment needed for Podman'
    case 'needs_update':
      return 'WSL update required'
    case 'virtualization_disabled':
      return 'Enable virtualization to continue'
    case 'ready':
      return 'WSL is ready'
    default:
      return 'WSL setup required'
  }
}

export function wslIssueSummary(issue: WslIssue): string {
  switch (issue) {
    case 'not_installed':
      return 'Podman on Windows uses WSL2. Click Install & set up Podman to install WSL (Windows may ask once for permission), then Podman, automatically.'
    case 'no_distro':
      return 'WSL is installed but no Linux environment is set up yet. Click Install & set up Podman — Windows may ask once for permission (UAC), then setup continues automatically.'
    case 'needs_update':
      return 'WSL needs an update before Podman can run. Click Install & set up Podman to update WSL automatically.'
    case 'virtualization_disabled':
      return 'Podman on Windows requires WSL2, which needs hardware virtualization (Intel VT-x / AMD-V) enabled in BIOS or UEFI.'
    case 'ready':
      return ''
    default:
      return 'WSL must be configured before Podman can run on Windows. Click Install & set up Podman to continue.'
  }
}

export function wslIssueFailureDetail(issue: WslIssue): string {
  switch (issue) {
    case 'not_installed':
      return 'Automatic setup will install WSL2. If Windows asks for administrator permission, choose Yes.'
    case 'no_distro':
      return 'Automatic setup will run wsl --install to create the Linux environment Podman needs.'
    case 'needs_update':
      return 'Automatic setup will run wsl --update.'
    case 'virtualization_disabled':
      return 'Enable virtualization in your PC firmware, then open WR Desk and run setup again.'
    default:
      return 'Try setup again. If Windows prompts for permission, choose Yes.'
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
        ? 'Podman on Windows uses WSL2. One click installs WSL (if needed), Podman, and starts secure isolation.'
        : plat === 'darwin'
          ? 'One click installs Podman on this Mac and starts secure isolation.'
          : 'WR Desk requires Podman for security isolation on this server.'
    case 'machine_not_initialized':
    case 'machine_not_running':
      return 'Podman is installed. One click will finish setup and start secure isolation.'
    case 'engine_unhealthy':
      return plat === 'linux'
        ? 'Podman is present but the engine is not responding on this server.'
        : 'Podman is present but not responding. Click Install & set up Podman to retry, or restart Podman Desktop.'
    case 'probe_pending':
      return 'WR Desk uses container isolation as a core security measure. Verifying Podman on this computer…'
    default:
      return 'Secure container isolation requires Podman on this computer.'
  }
}

export function wslManualInstallSteps(issue: WslIssue): string {
  const cmd =
    issue === 'needs_update'
      ? 'wsl --update'
      : issue === 'no_distro'
        ? 'wsl --install'
        : 'wsl --install'
  return [
    '1. Right-click the Start button → Terminal (Admin) or Windows PowerShell (Admin).',
    `2. Run: ${cmd}`,
    '3. Restart your computer when Windows asks (required for WSL).',
    '4. Open WR Desk again — setup continues automatically.',
  ].join('\n')
}

export function setupFailureDetailForWslInstall(issue: WslIssue): string {
  return wslIssueFailureDetail(issue)
}

export function wslInstallFailedMessage(issue: WslIssue): string {
  switch (issue) {
    case 'not_installed':
      return 'WSL is not installed yet'
    case 'no_distro':
      return 'Linux environment for WSL is not set up yet'
    case 'needs_update':
      return 'WSL could not be updated automatically'
    default:
      return 'WSL setup did not complete'
  }
}

/** Actionable English failure — headline (short) + detail (next steps). Never raw OS output. */
export function resolveWslInstallFailureCopy(
  issue: WslIssue,
  result: PodmanCommandResult,
): { message: string; detail: string } {
  if (uacWasCancelled(result)) {
    return {
      message: 'Administrator permission is required',
      detail: [
        'Windows did not receive permission to install WSL.',
        '',
        'Click Install & set up Podman again and choose Yes when the UAC prompt appears.',
        '',
        'If no prompt appears, use an admin terminal instead:',
        wslManualInstallSteps(issue),
      ].join('\n'),
    }
  }

  if (issue === 'not_installed' || issue === 'unknown') {
    return {
      message: 'Install WSL in an administrator terminal',
      detail: [
        `Automatic install did not finish (exit code ${result.exitCode ?? 'unknown'}).`,
        '',
        'Install WSL manually, then restart:',
        wslManualInstallSteps('not_installed'),
      ].join('\n'),
    }
  }

  if (issue === 'no_distro') {
    return {
      message: 'Create the WSL Linux environment manually',
      detail: [
        `Automatic install did not finish (exit code ${result.exitCode ?? 'unknown'}).`,
        '',
        wslManualInstallSteps('no_distro'),
      ].join('\n'),
    }
  }

  if (issue === 'needs_update') {
    return {
      message: 'Update WSL in an administrator terminal',
      detail: [
        `Automatic update did not finish (exit code ${result.exitCode ?? 'unknown'}).`,
        '',
        wslManualInstallSteps('needs_update'),
      ].join('\n'),
    }
  }

  return {
    message: wslInstallFailedMessage(issue),
    detail: wslManualInstallSteps(issue),
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
