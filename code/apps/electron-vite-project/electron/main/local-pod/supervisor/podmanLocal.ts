/**
 * Local Podman exec helpers for host pod supervisor (no SSH).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface PodmanRunResult {
  code: number
  stdout: string
  stderr: string
}

export async function runPodman(args: string[], timeoutMs = 30_000): Promise<PodmanRunResult> {
  try {
    const result = await execFileAsync('podman', args, {
      timeout: timeoutMs,
      windowsHide: true,
    })
    return {
      code: 0,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string }
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
    }
  }
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
  await runPodman(['pod', 'stop', '--time', '10', podName])
  await runPodman(['pod', 'rm', podName])
}
