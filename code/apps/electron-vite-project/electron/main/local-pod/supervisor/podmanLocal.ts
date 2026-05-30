/**
 * Local Podman exec helpers for host pod supervisor (no SSH).
 */

import { runPodmanCli } from '../podExec.js'
import { LOCAL_POD_EXEC_LAYER_EXIT_CODES } from '../podConstants.js'

export interface PodmanRunResult {
  code: number
  stdout: string
  stderr: string
}

export async function runPodman(args: string[], timeoutMs = 30_000): Promise<PodmanRunResult> {
  return runPodmanCli(args, { timeoutMs })
}

export async function inspectContainerState(containerName: string): Promise<
  'running' | 'exited' | 'missing' | 'unknown'
> {
  const result = await runPodman([
    'inspect',
    containerName,
    '--format',
    '{{.State.Status}}',
  ])
  if (result.code !== 0) return 'missing'
  const status = result.stdout.trim().toLowerCase()
  if (status === 'running') return 'running'
  if (status === 'exited' || status === 'stopped') return 'exited'
  return 'unknown'
}

export type PodmanAggregatedHealthStatus = 'healthy' | 'unhealthy' | 'starting' | 'none'

/** Podman-native HEALTHCHECK aggregation (liveness in pod.yaml) — avoids host exec when healthy. */
export async function inspectPodmanHealthStatus(
  containerName: string,
): Promise<PodmanAggregatedHealthStatus> {
  const result = await runPodman([
    'inspect',
    containerName,
    '--format',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
  ])
  if (result.code !== 0) return 'none'
  const status = result.stdout.trim().toLowerCase()
  if (status === 'healthy') return 'healthy'
  if (status === 'unhealthy') return 'unhealthy'
  if (status === 'starting') return 'starting'
  return 'none'
}

/** Inline Node probe — exit 0 ok, 2 HTTP non-2xx, 1 fetch error; 125+ is podman exec layer. */
export function buildNodeHealthProbeScript(port: number, timeoutMs: number): string {
  const ms = Math.max(1000, timeoutMs)
  return (
    `fetch('http://127.0.0.1:${port}/health',{signal:AbortSignal.timeout(${ms})})` +
    `.then(r=>process.exit(r.ok?0:2)).catch(()=>process.exit(1))`
  )
}

export function buildLocalHealthProbeCommand(
  containerName: string,
  port: number,
  timeoutMs: number,
): string[] {
  return ['exec', containerName, 'node', '-e', buildNodeHealthProbeScript(port, timeoutMs)]
}

export type ContainerHealthExecOutcome =
  | { kind: 'ok' }
  | { kind: 'http_unhealthy'; exitCode: number }
  | { kind: 'exec_layer'; exitCode: number }
  | { kind: 'fetch_error'; exitCode: number }

export async function probeContainerHealthExec(
  containerName: string,
  port: number,
  timeoutMs: number,
): Promise<ContainerHealthExecOutcome> {
  const result = await runPodman(
    buildLocalHealthProbeCommand(containerName, port, timeoutMs),
    timeoutMs + 5_000,
  )
  const code = result.code
  if (code === 0) {
    return { kind: 'ok' }
  }
  if (LOCAL_POD_EXEC_LAYER_EXIT_CODES.has(code)) {
    return { kind: 'exec_layer', exitCode: code }
  }
  if (code === 2) {
    return { kind: 'http_unhealthy', exitCode: code }
  }
  return { kind: 'fetch_error', exitCode: code }
}

export async function restartContainerLocal(containerName: string): Promise<boolean> {
  const kill = await runPodman(['kill', '--signal', 'SIGKILL', containerName])
  if (kill.code !== 0 && !kill.stderr.includes('no such container')) {
    return false
  }
  const start = await runPodman(['start', containerName])
  return start.code === 0
}

export async function stopPodLocal(podName: string): Promise<void> {
  await runPodman(['pod', 'rm', '-f', podName])
}
