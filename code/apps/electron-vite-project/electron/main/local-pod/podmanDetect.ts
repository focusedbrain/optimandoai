/**
 * Runtime Podman availability checks for the local desktop pod.
 *
 * Linux: podman on PATH is sufficient (no podman machine).
 * Windows / macOS: podman on PATH plus at least one running podman machine.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DETECT_TIMEOUT_MS = 5_000

export type PodmanSetupErrorCode = 'not_installed' | 'machine_not_running'

export class PodmanSetupError extends Error {
  readonly code: PodmanSetupErrorCode
  readonly userMessage: string

  constructor(code: PodmanSetupErrorCode, userMessage: string) {
    super(userMessage)
    this.name = 'PodmanSetupError'
    this.code = code
    this.userMessage = userMessage
  }
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

export interface PodmanDetectOptions {
  platform?: NodeJS.Platform
  execFile?: ExecFileFn
}

const NOT_INSTALLED_MESSAGE =
  'Podman is not installed. Install Podman Desktop from https://podman.io and restart the application.'

const MACHINE_NOT_RUNNING_MESSAGE =
  'Podman is installed but no machine is running. Open Podman Desktop and start a machine, then restart the application.'

async function defaultExecFile(
  file: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], {
    timeout: DETECT_TIMEOUT_MS,
    windowsHide: true,
  })
  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString(),
    stderr: typeof result.stderr === 'string' ? result.stderr : result.stderr.toString(),
  }
}

async function isPodmanOnPath(
  platform: NodeJS.Platform,
  execFile: ExecFileFn,
): Promise<boolean> {
  try {
    if (platform === 'win32') {
      const { stdout } = await execFile('where', ['podman'])
      return stdout.trim().length > 0
    }
    const { stdout } = await execFile('which', ['podman'])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

interface PodmanMachineRow {
  Running?: boolean
  running?: boolean
}

async function hasRunningPodmanMachine(execFile: ExecFileFn): Promise<boolean> {
  try {
    const { stdout } = await execFile('podman', [
      'machine',
      'list',
      '--format',
      'json',
    ])
    const trimmed = stdout.trim()
    if (!trimmed) return false

    const parsed = JSON.parse(trimmed) as PodmanMachineRow[] | PodmanMachineRow
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.some((row) => row.Running === true || row.running === true)
  } catch {
    return false
  }
}

/**
 * Verify Podman is installed and (on Windows/macOS) a machine is running.
 * Throws {@link PodmanSetupError} with an actionable userMessage when not ready.
 */
export async function assertPodmanReady(options?: PodmanDetectOptions): Promise<void> {
  const platform = options?.platform ?? process.platform
  const execFile = options?.execFile ?? defaultExecFile

  const onPath = await isPodmanOnPath(platform, execFile)
  if (!onPath) {
    throw new PodmanSetupError('not_installed', NOT_INSTALLED_MESSAGE)
  }

  if (platform === 'win32' || platform === 'darwin') {
    const machineRunning = await hasRunningPodmanMachine(execFile)
    if (!machineRunning) {
      throw new PodmanSetupError('machine_not_running', MACHINE_NOT_RUNNING_MESSAGE)
    }
  }
}

export const PODMAN_SETUP_MESSAGES = {
  not_installed: NOT_INSTALLED_MESSAGE,
  machine_not_running: MACHINE_NOT_RUNNING_MESSAGE,
} as const
