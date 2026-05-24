/**
 * Remote Podman installer over SSH — Phase 4 (P4.2).
 *
 * Uses only the target distro's native package repositories (apt/dnf/yum).
 * No third-party repos, no curl|bash, no signature bypass.
 */

import type { SshCommandRunner } from './types.js'
import type { TargetProbe } from './types.js'

export const MIN_PODMAN_MAJOR = 4

export type InstallEventKind = 'log' | 'stage' | 'done' | 'error'

export interface InstallEvent {
  readonly kind: InstallEventKind
  readonly message: string
  readonly stage_name?: string
}

export interface InstallPodmanDeps {
  readonly run: (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>
}

/** Parse major Podman version from `podman --version` output. */
export function parsePodmanMajorVersion(output: string): number | null {
  const match = output.match(/podman(?:\.io)?\s+version\s+(\d+)/i) ?? output.match(/version\s+(\d+)/i)
  if (!match) return null
  const major = Number.parseInt(match[1]!, 10)
  return Number.isFinite(major) ? major : null
}

export function isPodmanVersionSupported(major: number | null): boolean {
  return major !== null && major >= MIN_PODMAN_MAJOR
}

/** Build install shell for the probed distro family (native repos only). */
export function buildPodmanInstallCommand(probe: TargetProbe): string {
  if (probe.family === 'unsupported') {
    throw new Error(`Cannot install Podman on unsupported distro: ${probe.distro}`)
  }

  let inner: string
  switch (probe.family) {
    case 'debian':
      inner = 'apt-get update -y && apt-get install -y podman'
      break
    case 'fedora':
      inner = 'dnf install -y podman'
      break
    case 'rhel':
      inner = `if command -v dnf >/dev/null 2>&1; then dnf install -y podman; elif command -v yum >/dev/null 2>&1; then yum install -y podman; else echo "Neither dnf nor yum found" >&2; exit 127; fi`
      break
    default:
      throw new Error(`Unsupported distro family: ${probe.family as string}`)
  }

  return wrapWithSudo(probe, inner)
}

export function wrapWithSudo(probe: TargetProbe, command: string): string {
  if (probe.is_root) return command
  return `sudo -n sh -c ${shellQuote(command)}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const PODMAN_VERSION_CMD = 'podman --version 2>/dev/null || true'
const PODMAN_SOCKET_CMD =
  'systemctl --user enable --now podman.socket 2>/dev/null || loginctl enable-linger "$USER" 2>/dev/null; systemctl --user enable --now podman.socket 2>/dev/null || true'

function yieldLog(
  message: string,
  stream: 'stdout' | 'stderr' = 'stdout',
): InstallEvent {
  const prefix = stream === 'stderr' ? '[stderr] ' : ''
  return { kind: 'log', message: `${prefix}${message}`.trimEnd() }
}

function yieldStage(stage_name: string, message: string): InstallEvent {
  return { kind: 'stage', stage_name, message }
}

async function runLogged(
  deps: InstallPodmanDeps,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return deps.run(command)
}

/**
 * Install Podman on a probed remote host. Idempotent when a supported version is already present.
 */
export async function* installPodman(
  client: SshCommandRunner,
  probe: TargetProbe,
): AsyncGenerator<InstallEvent> {
  const deps: InstallPodmanDeps = { run: (cmd) => client.run(cmd) }

  if (!probe.verdict.ok) {
    yield {
      kind: 'error',
      message: `Target probe failed (${probe.verdict.reason}): ${probe.verdict.message}`,
    }
    return
  }

  if (probe.family === 'unsupported') {
    yield {
      kind: 'error',
      message: `Cannot install Podman on unsupported distribution "${probe.distro}".`,
    }
    return
  }

  yield yieldStage('check_version', 'Checking installed Podman version…')

  const versionResult = await runLogged(deps, PODMAN_VERSION_CMD)
  for (const line of splitLines(versionResult.stdout)) {
    if (line) yield yieldLog(line)
  }
  for (const line of splitLines(versionResult.stderr)) {
    if (line) yield yieldLog(line, 'stderr')
  }

  const existingMajor = parsePodmanMajorVersion(versionResult.stdout)
  if (isPodmanVersionSupported(existingMajor)) {
    yield {
      kind: 'done',
      message: `Podman ${existingMajor}.x already installed — no package changes needed.`,
      stage_name: 'check_version',
    }
    return
  }

  if (existingMajor !== null && existingMajor < MIN_PODMAN_MAJOR) {
    yield yieldLog(
      `Podman ${existingMajor}.x is below the minimum (${MIN_PODMAN_MAJOR}.0); upgrading via native package manager.`,
    )
  }

  yield yieldStage('install', `Installing Podman via native ${probe.family} packages…`)

  const installCmd = buildPodmanInstallCommand(probe)
  const installResult = await runLogged(deps, installCmd)
  for (const line of splitLines(installResult.stdout)) {
    if (line) yield yieldLog(line)
  }
  for (const line of splitLines(installResult.stderr)) {
    if (line) yield yieldLog(line, 'stderr')
  }

  if (installResult.code !== 0) {
    yield {
      kind: 'error',
      message: `Podman installation failed (exit ${installResult.code ?? 'unknown'}).`,
      stage_name: 'install',
    }
    return
  }

  yield yieldStage('verify', 'Verifying Podman version…')
  const verifyResult = await runLogged(deps, PODMAN_VERSION_CMD)
  for (const line of splitLines(verifyResult.stdout)) {
    if (line) yield yieldLog(line)
  }

  const installedMajor = parsePodmanMajorVersion(verifyResult.stdout)
  if (!isPodmanVersionSupported(installedMajor)) {
    yield {
      kind: 'error',
      message:
        installedMajor === null
          ? 'Podman install finished but `podman --version` did not return a recognizable version.'
          : `Podman ${installedMajor}.x is installed but version ${MIN_PODMAN_MAJOR}.0 or newer is required for BEAP edge pods.`,
      stage_name: 'verify',
    }
    return
  }

  yield yieldStage('podman_socket', 'Enabling podman.socket (optional)…')
  yield* streamPodmanSocketEnable(deps)

  yield {
    kind: 'done',
    message: `Podman ${installedMajor}.x installed and verified.`,
    stage_name: 'verify',
  }
}

async function* streamPodmanSocketEnable(
  deps: InstallPodmanDeps,
): AsyncGenerator<InstallEvent> {
  const socketResult = await runLogged(deps, PODMAN_SOCKET_CMD)
  for (const line of splitLines(socketResult.stdout)) {
    if (line) yield yieldLog(line)
  }
  for (const line of splitLines(socketResult.stderr)) {
    if (line) yield yieldLog(line, 'stderr')
  }
  if (socketResult.code !== 0) {
    yield yieldLog(
      'podman.socket could not be enabled (non-fatal; rootful podman still works for deploy).',
      'stderr',
    )
  }
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trimEnd())
}

/** Collect all events from {@link installPodman} (tests and IPC helpers). */
export async function collectInstallPodmanEvents(
  client: SshCommandRunner,
  probe: TargetProbe,
): Promise<InstallEvent[]> {
  const events: InstallEvent[] = []
  for await (const event of installPodman(client, probe)) {
    events.push(event)
  }
  return events
}
