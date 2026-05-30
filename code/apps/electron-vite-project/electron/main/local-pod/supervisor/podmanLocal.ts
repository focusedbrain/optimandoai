/**
 * Local Podman exec helpers for host pod supervisor (no SSH).
 */

import { runPodmanCli } from '../podExec.js'

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

/** Inline Node probe — node:20-alpine has no curl; Podman httpGet probes also shell out to curl. */
export function buildNodeHealthProbeScript(port: number, timeoutMs: number): string {
  const ms = Math.max(1000, timeoutMs)
  return (
    `fetch('http://127.0.0.1:${port}/health',{signal:AbortSignal.timeout(${ms})})` +
    `.then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`
  )
}

export function buildLocalHealthProbeCommand(
  containerName: string,
  port: number,
  timeoutMs: number,
): string[] {
  return ['exec', containerName, 'node', '-e', buildNodeHealthProbeScript(port, timeoutMs)]
}

export async function probeContainerHealthLocal(
  containerName: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const result = await runPodman(
    buildLocalHealthProbeCommand(containerName, port, timeoutMs),
    timeoutMs + 5_000,
  )
  return result.code === 0
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
