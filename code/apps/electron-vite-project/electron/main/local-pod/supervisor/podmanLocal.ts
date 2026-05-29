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

export function buildLocalHealthProbeCommand(
  containerName: string,
  port: number,
  timeoutSec: number,
): string[] {
  return [
    'exec',
    containerName,
    'curl',
    '-sf',
    '--max-time',
    String(Math.max(1, timeoutSec)),
    `http://127.0.0.1:${port}/health`,
  ]
}

export async function probeContainerHealthLocal(
  containerName: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const timeoutSec = Math.ceil(timeoutMs / 1000)
  const result = await runPodman(buildLocalHealthProbeCommand(containerName, port, timeoutSec))
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
