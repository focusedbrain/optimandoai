/**
 * Guided Podman install / machine setup — user-consented shell commands (no bundled runtime).
 */

import { spawn } from 'node:child_process'
import { platform } from 'node:os'

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

function shellCommand(action: PodmanInstallAction): string {
  const plat = platform()
  switch (action) {
    case 'winget_install':
      return 'winget install -e --id RedHat.Podman --accept-package-agreements --accept-source-agreements'
    case 'brew_install':
      return 'brew install podman'
    case 'machine_init':
      return 'podman machine init'
    case 'machine_start':
      return 'podman machine start'
    default:
      return ''
  }
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
      installLabel: 'Install Podman with winget',
      installCommand: shellCommand('winget_install'),
      manualHint: 'Or download Podman Desktop from podman.io',
      linuxDistroHints: [],
    }
  }
  if (plat === 'darwin') {
    return {
      canAutoInstall: true,
      installAction: 'brew_install',
      installLabel: 'Install Podman with Homebrew',
      installCommand: shellCommand('brew_install'),
      manualHint: 'Requires Homebrew (brew.sh). Or install from podman.io.',
      linuxDistroHints: [],
    }
  }
  return {
    canAutoInstall: false,
    installAction: null,
    installLabel: 'Install via your package manager',
    installCommand: null,
    manualHint:
      'Linux orchestrator hosts use distro packages — pick your distribution below, install Podman, then use Check again. Auto-install is not offered (operator policy).',
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
  return spawnLogged(command, true)
}
