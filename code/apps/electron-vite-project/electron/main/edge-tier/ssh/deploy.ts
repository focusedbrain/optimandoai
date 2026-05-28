/**
 * Remote REMOTE_EDGE pod deployer over SSH — Phase 4 (P4.3).
 *
 * Secrets are passed via a single `env VAR=value …` command line; the manifest
 * on disk retains ${PLACEHOLDERS} only. No secret files, no curl|bash, no heredocs.
 */

import type { SshCommandRunner } from './types.js'

export const REMOTE_MANIFEST_PATH = '/tmp/beap-pod-remote-edge.yaml'
export const REMOTE_POD_NAME = 'beap-pod-remote-edge'
export const DEFAULT_HEALTH_TIMEOUT_MS = 60_000
export const DEFAULT_HEALTH_POLL_MS = 2_000

export type DeployEventKind = 'log' | 'stage' | 'done' | 'error'

export interface DeployReplicaState {
  readonly host: string
  readonly podId: string
  readonly publicKey: string
  readonly attestationJwt: string
}

export interface DeployEvent {
  readonly kind: DeployEventKind
  readonly message: string
  readonly stage_name?: string
  readonly replica_state?: DeployReplicaState
}

/** SSH client surface required for deploy (run + in-memory upload). */
export interface DeploySshClient extends SshCommandRunner {
  uploadContent(content: string | Buffer, remotePath: string): Promise<void>
}

export interface DeployArgs {
  readonly client: DeploySshClient
  readonly host: string
  readonly podId: string
  /** Public key claim, e.g. `ed25519:<hex>`. */
  readonly publicKey: string
  readonly privateKeyHex: string
  readonly attestationJwt: string
  readonly podAuthSecret: string
  /** Manifest template with ${VAR} placeholders — must not contain secret values. */
  readonly manifestYaml: string
  readonly certTtlSeconds: number
}

export interface DeployPodmanPlayParams {
  readonly podAuthSecret: string
  readonly privateKeyHex: string
  readonly podId: string
  readonly attestationJwt: string
  readonly certTtlSeconds: number
  readonly manifestPath?: string
}

export const CONTAINER_HEALTH_CHECKS = [
  { container: 'beap-pod-remote-edge-ingestor', port: 18100 },
  { container: 'beap-pod-remote-edge-validator', port: 18101 },
  { container: 'beap-pod-remote-edge-depackager', port: 18102 },
  { container: 'beap-pod-remote-edge-pdf-parser', port: 18107 },
  { container: 'beap-pod-remote-edge-certifier', port: 18104 },
] as const

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Disable shell history for a one-shot secret-bearing command. */
export function wrapHistorySafe(command: string): string {
  return `export HISTFILE=/dev/null HISTSIZE=0; ${command}`
}

/**
 * Build the podman play command: env-scoped secrets → envsubst (stdin) → play kube.
 * Secrets stay on one command line; never written to the manifest file.
 */
export function buildPodmanPlayCommand(params: DeployPodmanPlayParams): string {
  const manifestPath = params.manifestPath ?? REMOTE_MANIFEST_PATH
  const envPairs = [
    `POD_AUTH_SECRET=${shellQuote(params.podAuthSecret)}`,
    `EDGE_PRIVATE_KEY_HEX=${shellQuote(params.privateKeyHex)}`,
    `EDGE_POD_ID=${shellQuote(params.podId)}`,
    `SSO_ATTESTATION_JWT=${shellQuote(params.attestationJwt)}`,
    `CERT_TTL_SECONDS=${shellQuote(String(params.certTtlSeconds))}`,
  ].join(' ')

  const playPipeline = `envsubst < ${manifestPath} | podman play kube -`
  return wrapHistorySafe(`env ${envPairs} ${playPipeline}`)
}

export function buildPreDeployCleanupCommand(): string {
  return `podman pod rm -f ${REMOTE_POD_NAME} 2>/dev/null || true`
}

export function buildPodStopCommand(): string {
  return wrapHistorySafe(`podman pod stop ${REMOTE_POD_NAME} 2>/dev/null || true`)
}

export function buildPodRmCommand(): string {
  return wrapHistorySafe(`podman pod rm -f ${REMOTE_POD_NAME} 2>/dev/null || true`)
}

export function buildTeardownCommand(): string {
  return wrapHistorySafe(
    `podman pod stop ${REMOTE_POD_NAME} 2>/dev/null || true; podman pod rm ${REMOTE_POD_NAME} 2>/dev/null || true; rm -f ${REMOTE_MANIFEST_PATH}`,
  )
}

export function buildRestartCommand(): string {
  return wrapHistorySafe(`podman pod restart ${REMOTE_POD_NAME}`)
}

export function buildRemoveManifestCommand(): string {
  return `rm -f ${REMOTE_MANIFEST_PATH}`
}

export function buildContainerHealthCommand(container: string, port: number): string {
  return `podman exec ${container} curl -sf http://127.0.0.1:${port}/health >/dev/null 2>&1`
}

/** Liveness probe with curl max-time (supervisor stuck detection — P5.9). */
export function buildContainerHealthProbeCommand(
  container: string,
  port: number,
  timeoutMs: number,
): string {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000))
  return `podman exec ${container} curl -sf --max-time ${timeoutSec} http://127.0.0.1:${port}/health >/dev/null 2>&1`
}

export function buildKillContainerCommand(containerName: string): string {
  return wrapHistorySafe(`podman kill --signal=SIGKILL ${containerName}`)
}

/** Remote VM wipe sequence for nuclear reset (P5.10). Stop/rm errors are ignored. */
export function buildNuclearResetRemoteCommands(): string[] {
  return [
    wrapHistorySafe(`podman pod stop ${REMOTE_POD_NAME} 2>/dev/null || true`),
    wrapHistorySafe(`podman pod rm -f ${REMOTE_POD_NAME} 2>/dev/null || true`),
    wrapHistorySafe('podman volume prune --force 2>/dev/null || true'),
    'rm -rf /tmp/beap-pod-*.yaml 2>/dev/null || true',
    'rm -rf /var/lib/quarantine 2>/dev/null || true',
  ]
}

export function buildAllHealthCommand(): string {
  return CONTAINER_HEALTH_CHECKS.map(({ container, port }) =>
    buildContainerHealthCommand(container, port),
  ).join(' && ')
}

export interface DeployDeps {
  readonly run: (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>
  readonly uploadContent: (content: string | Buffer, remotePath: string) => Promise<void>
  readonly sleep?: (ms: number) => Promise<void>
  readonly healthTimeoutMs?: number
  readonly healthPollMs?: number
}

function yieldLog(message: string, stream: 'stdout' | 'stderr' = 'stdout'): DeployEvent {
  const prefix = stream === 'stderr' ? '[stderr] ' : ''
  return { kind: 'log', message: `${prefix}${message}`.trimEnd() }
}

function yieldStage(stage_name: string, message: string): DeployEvent {
  return { kind: 'stage', stage_name, message }
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trimEnd())
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function runLogged(
  deps: DeployDeps,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return deps.run(command)
}

function* emitRunOutput(result: {
  stdout: string
  stderr: string
}): Generator<DeployEvent> {
  for (const line of splitLines(result.stdout)) {
    if (line) yield yieldLog(line)
  }
  for (const line of splitLines(result.stderr)) {
    if (line) yield yieldLog(line, 'stderr')
  }
}

async function bestEffortCleanup(deps: DeployDeps): Promise<void> {
  await runLogged(deps, buildTeardownCommand())
}

/**
 * Deploy REMOTE_EDGE pod to a remote VM. Edge private key is injected via env only.
 * On failure, stops the pod and removes the manifest (best-effort rollback).
 */
export async function* deployEdgePod(args: DeployArgs): AsyncGenerator<DeployEvent> {
  yield* deployEdgePodWithAutoCleanup(args)
}

export async function* deployEdgePodWithDeps(
  args: DeployArgs,
  deps: DeployDeps,
): AsyncGenerator<DeployEvent> {
  const sleep = deps.sleep ?? defaultSleep
  const healthTimeoutMs = deps.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  const healthPollMs = deps.healthPollMs ?? DEFAULT_HEALTH_POLL_MS

  let failedStage: string | undefined

  try {
    yield yieldStage('upload_manifest', `Uploading manifest to ${REMOTE_MANIFEST_PATH}…`)
    await deps.uploadContent(args.manifestYaml, REMOTE_MANIFEST_PATH)
    const chmodResult = await runLogged(deps, `chmod 600 ${REMOTE_MANIFEST_PATH}`)
    yield* emitRunOutput(chmodResult)
    if (chmodResult.code !== 0) {
      failedStage = 'upload_manifest'
      yield {
        kind: 'error',
        message: `Failed to set manifest permissions (exit ${chmodResult.code ?? 'unknown'}).`,
        stage_name: failedStage,
      }
      return
    }

    yield yieldStage('start_pod', 'Starting REMOTE_EDGE pod…')

    const preCleanup = await runLogged(deps, buildPreDeployCleanupCommand())
    yield* emitRunOutput(preCleanup)

    const playCmd = buildPodmanPlayCommand({
      podAuthSecret: args.podAuthSecret,
      privateKeyHex: args.privateKeyHex,
      podId: args.podId,
      attestationJwt: args.attestationJwt,
      certTtlSeconds: args.certTtlSeconds,
    })

    const playResult = await runLogged(deps, playCmd)
    yield* emitRunOutput(playResult)

    if (playResult.code !== 0) {
      failedStage = 'start_pod'
      yield {
        kind: 'error',
        message: `podman play kube failed (exit ${playResult.code ?? 'unknown'}).`,
        stage_name: failedStage,
      }
      return
    }

    yield yieldStage('health_check', 'Waiting for all containers to report /health…')

    const healthCmd = buildAllHealthCommand()
    const deadline = Date.now() + healthTimeoutMs
    let healthy = false

    while (Date.now() < deadline) {
      const healthResult = await runLogged(deps, healthCmd)
      if (healthResult.code === 0) {
        healthy = true
        break
      }
      yield yieldLog('Containers not ready yet; retrying…')
      await sleep(healthPollMs)
    }

    if (!healthy) {
      failedStage = 'health_check'
      yield {
        kind: 'error',
        message: `Health check timed out after ${healthTimeoutMs / 1000}s — not all containers returned /health OK.`,
        stage_name: failedStage,
      }
      return
    }

    yield yieldLog('All four containers healthy.')

    yield yieldStage('cleanup', 'Removing manifest from VM…')
    const rmResult = await runLogged(deps, buildRemoveManifestCommand())
    yield* emitRunOutput(rmResult)

    yield {
      kind: 'done',
      message: `REMOTE_EDGE pod deployed on ${args.host}.`,
      stage_name: 'cleanup',
      replica_state: {
        host: args.host,
        podId: args.podId,
        publicKey: args.publicKey,
        attestationJwt: args.attestationJwt,
      },
    }
  } catch (err) {
    yield {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
      stage_name: failedStage ?? 'upload_manifest',
    }
  }
}

/** Run deploy and invoke cleanup when an error-stage event is emitted. */
export async function* deployEdgePodWithAutoCleanup(
  args: DeployArgs,
  deps?: DeployDeps,
): AsyncGenerator<DeployEvent> {
  const resolvedDeps: DeployDeps = deps ?? {
    run: (cmd) => args.client.run(cmd),
    uploadContent: (content, path) => args.client.uploadContent(content, path),
  }

  let failed = false
  for await (const event of deployEdgePodWithDeps(args, resolvedDeps)) {
    yield event
    if (event.kind === 'error') {
      failed = true
    }
  }

  if (failed) {
    yield yieldStage('cleanup', 'Rolling back failed deploy…')
    await bestEffortCleanup(resolvedDeps)
    yield yieldLog('Rollback complete (pod stopped, manifest removed).')
  }
}

/** Collect all events from {@link deployEdgePod} (tests and IPC helpers). */
export async function collectDeployEvents(
  args: DeployArgs,
  deps?: DeployDeps,
): Promise<DeployEvent[]> {
  const events: DeployEvent[] = []
  for await (const event of deployEdgePodWithAutoCleanup(args, deps)) {
    events.push(event)
  }
  return events
}
