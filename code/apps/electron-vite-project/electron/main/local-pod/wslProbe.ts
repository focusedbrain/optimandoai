/**
 * WSL2 diagnosis for Windows Podman (WSL2 backend).
 * Install/remediation is NOT done at runtime — see NSIS installer + manual modal copy.
 */

import { decodeProcessOutput } from './processOutputDecode.js'
import type { PodmanCommandResult } from './podmanInstallRunner.js'

export type WslIssue =
  | 'ready'
  | 'not_installed'
  | 'needs_update'
  | 'no_distro'
  | 'virtualization_disabled'
  | 'unknown'

export interface WslDiagnosis {
  issue: WslIssue
  rebootRequired: boolean
  userMessage: string
  /** Decoded diagnostic lines for metadata logging only. */
  logSummary: string[]
}

const WSL_TIMEOUT_MS = 30_000

function spawnWsl(args: readonly string[], commandLabel: string): Promise<PodmanCommandResult> {
  return import('node:child_process').then(({ spawn }) =>
    new Promise((resolve) => {
    const child = spawn('wsl.exe', [...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []

    child.stdout?.on('data', (chunk: Buffer) => outChunks.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => errChunks.push(chunk))

    const timer = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        command: commandLabel,
        stdout: decodeProcessOutput(outChunks, true),
        stderr: `${decodeProcessOutput(errChunks, true)}\n[timeout]`,
        exitCode: null,
      })
    }, WSL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        command: commandLabel,
        stdout: decodeProcessOutput(outChunks, true),
        stderr: decodeProcessOutput(errChunks, true),
        exitCode: code,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        command: commandLabel,
        stdout: decodeProcessOutput(outChunks, true),
        stderr: err.message,
        exitCode: null,
      })
    })
  }),
  )
}

function combinedText(...parts: string[]): string {
  return parts.join('\n').toLowerCase()
}

/** WSL optional component / CLI missing — OS text may omit the literal "wsl" token (e.g. German). */
export function wslSubsystemNotInstalled(text: string): boolean {
  const lower = text.toLowerCase()
  if (lower.includes('wsl is not installed')) return true
  if (lower.includes('nicht installiert')) return true
  if (lower.includes('not installed') && (lower.includes('wsl') || lower.includes('subsystem'))) {
    return true
  }
  if (lower.includes('windows-subsystem') && lower.includes('linux')) {
    if (lower.includes('nicht installiert') || lower.includes('not installed')) return true
  }
  if (lower.includes('windows subsystem') && lower.includes('linux')) {
    if (lower.includes('not installed')) return true
  }
  if (lower.includes('not recognized') && lower.includes('wsl')) return true
  if (lower.includes('nicht erkannt') && lower.includes('wsl')) return true
  if (lower.includes('requires the microsoft store')) return true
  if (lower.includes('please enable the optional component')) return true
  return false
}

export function classifyWslOutput(text: string): WslIssue {
  const lower = text.toLowerCase()
  if (
    lower.includes('virtualization') ||
    lower.includes('virtualisierung') ||
    (lower.includes('hyper-v') && (lower.includes('disabled') || lower.includes('deaktiviert')))
  ) {
    if (
      lower.includes('disabled') ||
      lower.includes('not enabled') ||
      lower.includes('enable') ||
      lower.includes('deaktiviert') ||
      lower.includes('hyper-v') ||
      lower.includes('hypervisor')
    ) {
      return 'virtualization_disabled'
    }
  }
  if (wslSubsystemNotInstalled(lower)) {
    return 'not_installed'
  }
  if (
    (lower.includes('update') || lower.includes('aktualisierung')) &&
    (lower.includes('required') ||
      lower.includes('needs') ||
      lower.includes('older') ||
      lower.includes('kernel') ||
      lower.includes('erforderlich'))
  ) {
    return 'needs_update'
  }
  if (
    lower.includes('no distributions') ||
    lower.includes('no installed distributions') ||
    lower.includes('has no installed distributions') ||
    lower.includes('keine distributionen') ||
    lower.includes('keine distribution') ||
    lower.includes('installierten distributionen') ||
    lower.includes('noch keine distribution')
  ) {
    return 'no_distro'
  }
  return 'unknown'
}

export function outputImpliesReboot(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('restart') ||
    lower.includes('reboot') ||
    lower.includes('re-start') ||
    lower.includes('neustart') ||
    lower.includes('neu starten') ||
    lower.includes('changes will not be effective until') ||
    lower.includes('änderungen werden erst nach') ||
    lower.includes('nach dem neustart')
  )
}

export function issueUserMessage(issue: WslIssue): string {
  switch (issue) {
    case 'ready':
      return 'Windows Subsystem for Linux is ready.'
    case 'not_installed':
      return 'Windows Subsystem for Linux (WSL2) is required for Podman on Windows.'
    case 'needs_update':
      return 'WSL needs an update before Podman can run.'
    case 'no_distro':
      return 'WSL is installed but no Linux environment is available yet.'
    case 'virtualization_disabled':
      return 'Hardware virtualization must be enabled in BIOS/UEFI for Podman on Windows.'
    default:
      return 'WSL setup needs attention before Podman can run.'
  }
}

export async function diagnoseWslState(reason = 'manual'): Promise<WslDiagnosis> {
  const status = await spawnWsl(['--status'], 'wsl.exe --status')
  const list = await spawnWsl(['-l', '--quiet'], 'wsl.exe -l --quiet')
  const version = await spawnWsl(['--version'], 'wsl.exe --version')

  const logSummary = [
    `status: ${status.stdout || status.stderr || '(empty)'}`,
    `list: ${list.stdout || list.stderr || '(empty)'}`,
    `version: ${version.stdout || version.stderr || '(empty)'}`,
  ]

  console.log(`[PODMAN_SETUP] WSL diagnosis (decoded, reason=${reason}):`)
  for (const line of logSummary) {
    console.log(`[PODMAN_SETUP]   ${line}`)
  }

  const blob = combinedText(status.stdout, status.stderr, list.stdout, list.stderr, version.stdout, version.stderr)
  const rebootRequired = outputImpliesReboot(blob)

  if (wslSubsystemNotInstalled(blob)) {
    return {
      issue: 'not_installed',
      rebootRequired,
      userMessage: issueUserMessage('not_installed'),
      logSummary,
    }
  }

  let issue = classifyWslOutput(blob)
  const distros = list.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const wslCliPresent = status.ok || version.ok || list.ok

  if (issue === 'unknown' && distros.length === 0 && wslCliPresent) {
    issue = 'no_distro'
  } else if (issue === 'unknown' && distros.length === 0 && !wslCliPresent) {
    issue = 'not_installed'
  } else if (issue === 'unknown' && (status.ok || version.ok)) {
    issue = 'ready'
  }

  return {
    issue,
    rebootRequired,
    userMessage: issueUserMessage(issue),
    logSummary,
  }
}

export function rebootRequiredMessage(context?: 'wsl_fresh_install'): { message: string; detail: string } {
  if (context === 'wsl_fresh_install') {
    return {
      message: 'Restart your computer to finish installing WSL',
      detail:
        'WSL was installed but Windows requires a restart before it can run. Restart your computer, then open WR Desk again — Podman setup will continue automatically.',
    }
  }
  return {
    message: 'Restart your computer to finish Windows setup',
    detail:
      'WSL or Podman needs a restart to complete. After you restart, open WR Desk again — setup will continue automatically.',
  }
}

export function virtualizationRequiredMessage(): { message: string; detail: string } {
  return {
    message: 'Enable virtualization in your computer firmware',
    detail:
      'Podman on Windows requires WSL2, which needs Intel VT-x / AMD-V (virtualization) enabled in BIOS or UEFI. Ask your IT administrator if this is a managed PC.',
  }
}
