/**
 * WSL2 diagnosis and remediation for Windows Podman (WSL2 backend).
 */

import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { decodeProcessBuffer, decodeProcessOutput } from './processOutputDecode.js'
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

const WSL_TIMEOUT_MS = 120_000
/** Windows ERROR_CANCELLED — user declined UAC elevation. */
export const WSL_UAC_CANCELLED_EXIT = 1223

export function uacWasCancelled(result: PodmanCommandResult): boolean {
  return result.exitCode === WSL_UAC_CANCELLED_EXIT || result.stderr.includes('UAC_CANCELLED')
}

/** Metadata-only log — decoded output for diagnosis, never shown raw in UI. */
export function logWslCommandResult(label: string, result: PodmanCommandResult): void {
  console.log(
    `[PODMAN_SETUP] ${label} exit=${result.exitCode ?? 'null'} ok=${result.ok} command=${result.command}`,
  )
  const out = result.stdout.trim()
  const err = result.stderr.trim()
  if (out) {
    for (const line of out.split('\n')) {
      console.log(`[PODMAN_SETUP]   stdout: ${line}`)
    }
  }
  if (err) {
    for (const line of err.split('\n')) {
      console.log(`[PODMAN_SETUP]   stderr: ${line}`)
    }
  }
  if (!out && !err) {
    console.log('[PODMAN_SETUP]   (no captured output)')
  }
}

function readCapturedLogFile(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return ''
    return decodeProcessBuffer(fs.readFileSync(filePath), true).trim()
  } catch {
    return ''
  }
}

function cleanupTempFiles(...paths: string[]): void {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
}

function spawnWsl(args: readonly string[], commandLabel: string, elevated = false): Promise<PodmanCommandResult> {
  if (elevated) {
    return spawnWslElevated(args, commandLabel)
  }
  return spawnWslDirect(args, commandLabel)
}

function spawnWslDirect(args: readonly string[], commandLabel: string): Promise<PodmanCommandResult> {
  return new Promise((resolve) => {
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
  })
}

/** UAC elevation — inner script runs elevated; output captured to temp files for logging. */
function spawnWslElevated(args: readonly string[], commandLabel: string): Promise<PodmanCommandResult> {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const wslPath = `${systemRoot}\\System32\\wsl.exe`
  const id = randomBytes(8).toString('hex')
  const tmpDir = os.tmpdir()
  const innerScript = path.join(tmpDir, `wrdesk-wsl-inner-${id}.ps1`)
  const launcherScript = path.join(tmpDir, `wrdesk-wsl-launch-${id}.ps1`)
  const outLog = path.join(tmpDir, `wrdesk-wsl-out-${id}.txt`)
  const exitLog = path.join(tmpDir, `wrdesk-wsl-exit-${id}.txt`)

  const wslArgString = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(' ')
  const innerContent = [
    '$ErrorActionPreference = "Continue"',
    `$outFile = '${outLog.replace(/'/g, "''")}'`,
    `$exitFile = '${exitLog.replace(/'/g, "''")}'`,
    `$output = & '${wslPath.replace(/'/g, "''")}' ${wslArgString} *>&1 | Out-String`,
    '[System.IO.File]::WriteAllText($outFile, $output, [System.Text.Encoding]::Unicode)',
    '$code = $LASTEXITCODE',
    'if ($null -eq $code) { $code = 1 }',
    '[System.IO.File]::WriteAllText($exitFile, $code.ToString())',
    'exit $code',
  ].join('\n')

  const launcherContent = [
    `$inner = '${innerScript.replace(/'/g, "''")}'`,
    "$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -PassThru -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Normal','-File',$inner)",
    'if ($null -eq $p) { Write-Error UAC_CANCELLED; exit 1223 }',
    'exit $p.ExitCode',
  ].join('\n')

  try {
    fs.writeFileSync(innerScript, innerContent, 'utf8')
    fs.writeFileSync(launcherScript, launcherContent, 'utf8')
  } catch (err) {
    return Promise.resolve({
      ok: false,
      command: commandLabel,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: null,
    })
  }

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherScript],
      {
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let psStdout = ''
    let psStderr = ''
    child.stdout?.on('data', (chunk) => {
      psStdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      psStderr += String(chunk)
    })

    const finish = (exitCode: number | null) => {
      const captured = readCapturedLogFile(outLog)
      let wslExit: number | null = null
      try {
        if (fs.existsSync(exitLog)) {
          wslExit = parseInt(fs.readFileSync(exitLog, 'utf8').trim(), 10)
          if (Number.isNaN(wslExit)) wslExit = null
        }
      } catch {
        wslExit = null
      }

      cleanupTempFiles(innerScript, launcherScript, outLog, exitLog)

      const launcherFailed = exitCode === WSL_UAC_CANCELLED_EXIT || psStderr.includes('UAC_CANCELLED')
      const effectiveExit = launcherFailed ? WSL_UAC_CANCELLED_EXIT : (wslExit ?? exitCode)
      const ok = effectiveExit === 0

      const result: PodmanCommandResult = {
        ok,
        command: commandLabel,
        stdout: captured || psStdout.trim(),
        stderr: launcherFailed ? 'UAC_CANCELLED' : psStderr.trim(),
        exitCode: effectiveExit,
      }
      logWslCommandResult(`${commandLabel} (elevated)`, result)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, WSL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      cleanupTempFiles(innerScript, launcherScript, outLog, exitLog)
      resolve({
        ok: false,
        command: commandLabel,
        stdout: '',
        stderr: err.message,
        exitCode: null,
      })
    })
  })
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

export async function runWslInstall(): Promise<PodmanCommandResult> {
  return spawnWsl(['--install'], 'wsl.exe --install', true)
}

export async function runWslInstallNoDistro(): Promise<PodmanCommandResult> {
  return spawnWsl(['--install', '--no-distribution'], 'wsl.exe --install --no-distribution', true)
}

export async function runWslUpdate(): Promise<PodmanCommandResult> {
  return spawnWsl(['--update'], 'wsl.exe --update', true)
}

export async function runWslInstallWithDistro(): Promise<PodmanCommandResult> {
  return spawnWsl(['--install'], 'wsl.exe --install', true)
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
