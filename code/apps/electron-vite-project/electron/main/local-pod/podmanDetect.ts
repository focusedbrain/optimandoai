/**
 * Runtime Podman availability checks for the local desktop pod.
 *
 * Linux: podman on PATH + healthy engine (no podman machine).
 * Windows / macOS: podman on PATH + machine running + engine healthy + pod daemon reachable.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  evaluatePodmanProbe,
  type PodmanProbeFailureCode,
} from '@repo/podman-probe'

const execFileAsync = promisify(execFile)

const DETECT_TIMEOUT_MS = 15_000

export type PodmanSetupErrorCode =
  | 'probe_pending'
  | 'not_installed'
  | 'machine_not_initialized'
  | 'machine_not_running'
  | 'engine_unhealthy'

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
  /** Unit tests — do not scan Program Files when `where` fails. */
  disableWellKnownPaths?: boolean
}

const NOT_INSTALLED_MESSAGE =
  'Podman is not installed on this computer. Install it once to enable secure container isolation, then click Check again.'

const ENGINE_UNHEALTHY_MESSAGE =
  'Podman is installed but not responding. Open Podman Desktop (or restart the Podman service), then click Check again.'

const MACHINE_NOT_INITIALIZED_MESSAGE =
  'Podman is installed. Create its background environment (one-time): run "podman machine init", then "podman machine start".'

const MACHINE_NOT_RUNNING_MESSAGE =
  'Podman is installed but its background environment is stopped. Run "podman machine start" (or start it from Podman Desktop).'

let _cachedPodmanBin: string | null = null

export function clearPodmanBinCacheForTest(): void {
  _cachedPodmanBin = null
}

function windowsPodmanPathCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const progFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const progFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  return [
    path.join(progFiles, 'RedHat', 'Podman', 'podman.exe'),
    path.join(progFiles, 'Podman', 'podman.exe'),
    path.join(progFilesX86, 'RedHat', 'Podman', 'podman.exe'),
    path.join(localAppData, 'Programs', 'Podman', 'podman.exe'),
    path.join(localAppData, 'Microsoft', 'WindowsApps', 'podman.exe'),
  ]
}

async function defaultExecFile(
  file: string,
  args: readonly string[],
  timeoutMs = DETECT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], {
    timeout: timeoutMs,
    windowsHide: true,
  })
  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString(),
    stderr: typeof result.stderr === 'string' ? result.stderr : result.stderr.toString(),
  }
}

export async function resolvePodmanBin(
  platform: NodeJS.Platform,
  execFile: ExecFileFn = defaultExecFile,
  disableWellKnownPaths = false,
): Promise<string | null> {
  if (_cachedPodmanBin && existsSync(_cachedPodmanBin)) {
    return _cachedPodmanBin
  }

  try {
    if (platform === 'win32') {
      const { stdout } = await execFile('where', ['podman'])
      const first = stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (first && existsSync(first)) {
        _cachedPodmanBin = first
        return first
      }
    } else {
      const { stdout } = await execFile('which', ['podman'])
      const resolved = stdout.trim()
      if (resolved) {
        _cachedPodmanBin = resolved
        return resolved
      }
    }
  } catch {
    /* fall through to well-known paths */
  }

  if (platform === 'win32' && !disableWellKnownPaths) {
    for (const candidate of windowsPodmanPathCandidates()) {
      if (existsSync(candidate)) {
        _cachedPodmanBin = candidate
        return candidate
      }
    }
  }

  _cachedPodmanBin = null
  return null
}

async function podmanExec(
  execFile: ExecFileFn,
  platform: NodeJS.Platform,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const bin = await resolvePodmanBin(platform, execFile)
  if (!bin) {
    throw new Error('podman not found')
  }
  return execFile(bin, args)
}

async function isPodmanOnPath(
  platform: NodeJS.Platform,
  execFile: ExecFileFn,
  disableWellKnownPaths = false,
): Promise<boolean> {
  return (await resolvePodmanBin(platform, execFile, disableWellKnownPaths)) != null
}

async function isPodmanEngineHealthy(
  execFile: ExecFileFn,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    await podmanExec(execFile, platform, ['info'])
    return true
  } catch {
    return false
  }
}

/** Confirms the container engine accepts commands (daemon / machine is usable). */
async function isPodmanPodCapable(
  execFile: ExecFileFn,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    await podmanExec(execFile, platform, ['ps', '-q'])
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
  platform: NodeJS.Platform = process.platform,
): Promise<PodmanMachineProbeState> {
  try {
    const { stdout } = await podmanExec(execFile, platform, [
      'machine',
      'list',
      '--format',
      'json',
    ])
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
      return new PodmanSetupError('engine_unhealthy', ENGINE_UNHEALTHY_MESSAGE)
    case 'not_on_path':
    default:
      return new PodmanSetupError('not_installed', PODMAN_SETUP_MESSAGES.not_installed)
  }
}

function platformRequiresMachine(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/**
 * Verify Podman is installed and (on Windows/macOS) a machine is running.
 * Throws {@link PodmanSetupError} with an actionable userMessage when not ready.
 */
export async function assertPodmanReady(options?: PodmanDetectOptions): Promise<void> {
  const platform = options?.platform ?? process.platform
  const execFile = options?.execFile ?? defaultExecFile

  _cachedPodmanBin = null
  const disableWellKnownPaths = options?.disableWellKnownPaths ?? false
  const binaryOnPath = await isPodmanOnPath(platform, execFile, disableWellKnownPaths)
  if (!binaryOnPath) {
    throw new PodmanSetupError('not_installed', PODMAN_SETUP_MESSAGES.not_installed)
  }

  let machineState: PodmanMachineProbeState = 'not_applicable'
  if (platformRequiresMachine(platform)) {
    machineState = await probePodmanMachineState(execFile, platform)
    if (machineState === 'none') {
      throw new PodmanSetupError(
        'machine_not_initialized',
        PODMAN_SETUP_MESSAGES.machine_not_initialized,
      )
    }
    if (machineState === 'stopped') {
      throw new PodmanSetupError(
        'machine_not_running',
        PODMAN_SETUP_MESSAGES.machine_not_running,
      )
    }
  }

  const engineHealthy = await isPodmanEngineHealthy(execFile, platform)
  if (!engineHealthy) {
    throw new PodmanSetupError('engine_unhealthy', ENGINE_UNHEALTHY_MESSAGE)
  }

  const podCapable = await isPodmanPodCapable(execFile, platform)
  if (!podCapable) {
    if (platformRequiresMachine(platform)) {
      throw new PodmanSetupError(
        'machine_not_running',
        PODMAN_SETUP_MESSAGES.machine_not_running,
      )
    }
    throw new PodmanSetupError('engine_unhealthy', ENGINE_UNHEALTHY_MESSAGE)
  }

  const evaluation = evaluatePodmanProbe({
    surface: 'orchestrator_host',
    platform,
    binaryOnPath: true,
    engineHealthy: true,
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
  engine_unhealthy: ENGINE_UNHEALTHY_MESSAGE,
} as const

export const PODMAN_MANUAL_INSTALL_URL = 'https://podman.io/docs/installation'
