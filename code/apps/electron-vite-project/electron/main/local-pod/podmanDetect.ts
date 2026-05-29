/**
 * Runtime Podman availability checks for the local desktop pod.
 *
 * Linux: podman on PATH + healthy engine (no podman machine).
 * Windows / macOS: podman on PATH + healthy engine + at least one running podman machine.
 *
 * Evaluation uses @repo/podman-probe contract (cross-surface invariant).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  evaluatePodmanProbe,
  type PodmanProbeFailureCode,
} from '@repo/podman-probe'

const execFileAsync = promisify(execFile)

const DETECT_TIMEOUT_MS = 5_000

export type PodmanSetupErrorCode =
  | 'probe_pending'
  | 'not_installed'
  | 'machine_not_initialized'
  | 'machine_not_running'

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

const ENGINE_UNHEALTHY_MESSAGE =
  'Podman is installed but the engine is not healthy. Run "podman info" in a terminal or restart Podman Desktop.'

const MACHINE_NOT_INITIALIZED_MESSAGE =
  'Podman is installed but no virtual machine exists yet. Run "podman machine init" once, then "podman machine start".'

const MACHINE_NOT_RUNNING_MESSAGE =
  'Podman is installed but the virtual machine is not running. Run "podman machine start" (or start it from Podman Desktop).'

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

async function isPodmanEngineHealthy(execFile: ExecFileFn): Promise<boolean> {
  try {
    await execFile('podman', ['info'])
    return true
  } catch {
    return false
  }
}

interface PodmanMachineRow {
  Running?: boolean
  running?: boolean
}

export type PodmanMachineProbeState = 'not_applicable' | 'none' | 'stopped' | 'running'

export async function probePodmanMachineState(
  execFile: ExecFileFn = defaultExecFile,
): Promise<PodmanMachineProbeState> {
  try {
    const { stdout } = await execFile('podman', ['machine', 'list', '--format', 'json'])
    const trimmed = stdout.trim()
    if (!trimmed || trimmed === '[]') return 'none'

    const parsed = JSON.parse(trimmed) as PodmanMachineRow[] | PodmanMachineRow
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    if (rows.length === 0) return 'none'
    if (rows.some((row) => row.Running === true || row.running === true)) return 'running'
    return 'stopped'
  } catch {
    return 'none'
  }
}

function mapProbeFailureToSetupError(
  failureCode: PodmanProbeFailureCode | undefined,
): PodmanSetupError {
  switch (failureCode) {
    case 'machine_not_initialized':
      return new PodmanSetupError(
        'machine_not_initialized',
        PODMAN_SETUP_MESSAGES.machine_not_initialized,
      )
    case 'machine_not_running':
      return new PodmanSetupError(
        'machine_not_running',
        PODMAN_SETUP_MESSAGES.machine_not_running,
      )
    case 'engine_unhealthy':
      return new PodmanSetupError('not_installed', ENGINE_UNHEALTHY_MESSAGE)
    case 'not_on_path':
    default:
      return new PodmanSetupError('not_installed', PODMAN_SETUP_MESSAGES.not_installed)
  }
}

/**
 * Verify Podman is installed and (on Windows/macOS) a machine is running.
 * Throws {@link PodmanSetupError} with an actionable userMessage when not ready.
 */
export async function assertPodmanReady(options?: PodmanDetectOptions): Promise<void> {
  const platform = options?.platform ?? process.platform
  const execFile = options?.execFile ?? defaultExecFile

  const binaryOnPath = await isPodmanOnPath(platform, execFile)
  const engineHealthy = binaryOnPath ? await isPodmanEngineHealthy(execFile) : false
  const machineState =
    platform === 'win32' || platform === 'darwin'
      ? await probePodmanMachineState(execFile)
      : ('not_applicable' as const)

  const evaluation = evaluatePodmanProbe({
    surface: 'orchestrator_host',
    platform,
    binaryOnPath,
    engineHealthy,
    machineState,
  })

  if (!evaluation.ok) {
    throw mapProbeFailureToSetupError(evaluation.failureCode)
  }
}

/**
 * Non-throwing readiness probe — use to populate {@link setPodSetupErrorRef} and ingestion mode.
 */
export async function probePodmanSetup(options?: PodmanDetectOptions): Promise<PodmanSetupError | null> {
  try {
    await assertPodmanReady(options)
    return null
  } catch (err) {
    if (err instanceof PodmanSetupError) {
      return err
    }
    return new PodmanSetupError(
      'not_installed',
      err instanceof Error ? err.message : 'Podman readiness check failed unexpectedly',
    )
  }
}

export const PODMAN_SETUP_MESSAGES = {
  probe_pending: 'Checking Podman installation…',
  not_installed: NOT_INSTALLED_MESSAGE,
  machine_not_initialized: MACHINE_NOT_INITIALIZED_MESSAGE,
  machine_not_running: MACHINE_NOT_RUNNING_MESSAGE,
} as const

export const PODMAN_MANUAL_INSTALL_URL = 'https://podman.io/docs/installation'
