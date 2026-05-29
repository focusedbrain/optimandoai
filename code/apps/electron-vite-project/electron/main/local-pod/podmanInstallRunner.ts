/**
 * Guided Podman install / machine setup — user-consented shell commands (no bundled runtime).
 */

import { spawn } from 'node:child_process'
import { platform } from 'node:os'

import { resolvePodmanBin } from './podmanDetect.js'

export type PodmanInstallAction =
  | 'winget_install'
  | 'brew_install'
  | 'machine_init'
  | 'machine_start'

export interface PodmanCommandResult {
  ok: boolean
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
}

const COMMAND_TIMEOUT_MS = 600_000

/** Sensible defaults — no user prompts during one-click setup. */
const MACHINE_INIT_ARGS = [
  'machine',
  'init',
  '--cpus',
  '2',
  '--memory',
  '4096',
  '--disk-size',
  '100',
] as const

function shellCommand(action: PodmanInstallAction): string {
  switch (action) {
    case 'winget_install':
      return 'winget install -e --id RedHat.Podman --accept-package-agreements --accept-source-agreements'
    case 'brew_install':
      return 'brew install podman'
    case 'machine_init':
      return `podman ${MACHINE_INIT_ARGS.join(' ')}`
    case 'machine_start':
      return 'podman machine start'
    default:
      return ''
  }
}

function spawnLoggedBin(
  bin: string,
  args: readonly string[],
  commandLabel: string,
): Promise<PodmanCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...args], {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    const timer = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        command: commandLabel,
        stdout,
        stderr: `${stderr}\n[timeout after ${COMMAND_TIMEOUT_MS}ms]`,
        exitCode: null,
      })
    }, COMMAND_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        command: commandLabel,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        command: commandLabel,
        stdout,
        stderr: err.message,
        exitCode: null,
      })
    })
  })
}

function spawnLogged(command: string, shell: boolean): Promise<PodmanCommandResult> {
  return new Promise((resolve) => {
    const child = shell
      ? spawn(command, [], {
          shell: true,
          windowsHide: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn(command.split(/\s+/)[0]!, command.split(/\s+/).slice(1), {
          windowsHide: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    const timer = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        command,
        stdout,
        stderr: `${stderr}\n[timeout after ${COMMAND_TIMEOUT_MS}ms]`,
        exitCode: null,
      })
    }, COMMAND_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        command,
        stdout,
        stderr: err.message,
        exitCode: null,
      })
    })
  })
}

export const LINUX_DISTRO_INSTALL_HINTS = [
  {
    id: 'debian',
    label: 'Debian / Ubuntu',
    commands: ['sudo apt update', 'sudo apt install -y podman'],
  },
  {
    id: 'fedora',
    label: 'Fedora / RHEL / CentOS Stream',
    commands: ['sudo dnf install -y podman'],
  },
  {
    id: 'arch',
    label: 'Arch Linux',
    commands: ['sudo pacman -S --needed podman'],
  },
  {
    id: 'opensuse',
    label: 'openSUSE',
    commands: ['sudo zypper install podman'],
  },
] as const

export type LinuxDistroInstallHint = (typeof LINUX_DISTRO_INSTALL_HINTS)[number]

export function getInstallActionsForPlatform(plat: NodeJS.Platform = platform()): {
  canAutoInstall: boolean
  installAction: PodmanInstallAction | null
  installLabel: string
  installCommand: string | null
  manualHint: string
  linuxDistroHints: readonly LinuxDistroInstallHint[]
} {
  if (plat === 'win32') {
    return {
      canAutoInstall: true,
      installAction: 'winget_install',
      installLabel: 'Install & set up Podman',
      installCommand: shellCommand('winget_install'),
      manualHint: 'Or download Podman from podman.io',
      linuxDistroHints: [],
    }
  }
  if (plat === 'darwin') {
    return {
      canAutoInstall: true,
      installAction: 'brew_install',
      installLabel: 'Install & set up Podman',
      installCommand: shellCommand('brew_install'),
      manualHint: 'Requires Homebrew (brew.sh). Or install from podman.io.',
      linuxDistroHints: [],
    }
  }
  return {
    canAutoInstall: false,
    installAction: null,
    installLabel: 'Set up Podman',
    installCommand: null,
    manualHint:
      'Install Podman using your distribution package manager (see podman.io), then use the button here to verify.',
    linuxDistroHints: LINUX_DISTRO_INSTALL_HINTS,
  }
}

export async function runPodmanInstallAction(
  action: PodmanInstallAction,
): Promise<PodmanCommandResult> {
  const command = shellCommand(action)
  if (!command) {
    return { ok: false, command: '', stdout: '', stderr: 'Unknown action', exitCode: null }
  }

  if (action === 'machine_init' || action === 'machine_start') {
    const plat = platform()
    const bin = await resolvePodmanBin(plat)
    if (!bin) {
      return {
        ok: false,
        command,
        stdout: '',
        stderr: 'podman binary not found',
        exitCode: null,
      }
    }
    const args =
      action === 'machine_init' ? [...MACHINE_INIT_ARGS] : (['machine', 'start'] as const)
    const result = await spawnLoggedBin(bin, args, command)
    return normalizeInstallCommandResult(action, result)
  }

  const result = await spawnLogged(command, true)
  return normalizeInstallCommandResult(action, result)
}

/** Winget exits non-zero when the package is already installed — treat as progress. */
export function isWingetAlreadyInstalledOutput(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('already installed') ||
    lower.includes('no available upgrade') ||
    lower.includes('existing package') ||
    lower.includes('no newer package versions')
  )
}

export function isMachineAlreadyExistsOutput(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('already exists') ||
    lower.includes('vm already exists') ||
    lower.includes('default machine already exists') ||
    lower.includes('machine already exists')
  )
}

export function isMachineAlreadyRunningOutput(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('already running') ||
    lower.includes('already started') ||
    lower.includes('is already running')
  )
}

export function normalizeInstallCommandResult(
  action: PodmanInstallAction,
  result: PodmanCommandResult,
): PodmanCommandResult {
  if (result.ok) return result
  const combined = `${result.stdout}\n${result.stderr}`
  if (action === 'winget_install' && isWingetAlreadyInstalledOutput(combined)) {
    return {
      ...result,
      ok: true,
      stderr: result.stderr
        ? `${result.stderr}\n[interpreted: Podman package already installed — continuing setup]`
        : '[interpreted: Podman package already installed — continuing setup]',
    }
  }
  if (action === 'brew_install' && combined.toLowerCase().includes('already installed')) {
    return { ...result, ok: true }
  }
  if (action === 'machine_init' && isMachineAlreadyExistsOutput(combined)) {
    return {
      ...result,
      ok: true,
      stderr: result.stderr
        ? `${result.stderr}\n[interpreted: Podman machine already exists — continuing setup]`
        : '[interpreted: Podman machine already exists — continuing setup]',
    }
  }
  if (action === 'machine_start' && isMachineAlreadyRunningOutput(combined)) {
    return {
      ...result,
      ok: true,
      stderr: result.stderr
        ? `${result.stderr}\n[interpreted: Podman machine already running — continuing setup]`
        : '[interpreted: Podman machine already running — continuing setup]',
    }
  }
  return result
}
