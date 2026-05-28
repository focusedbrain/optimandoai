import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { loadExpectedDigest } from './image-digest.js'

const execFileAsync = promisify(execFile)

export interface PodmanRunResult {
  code: number
  stdout: string
  stderr: string
}

export type PodmanRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<PodmanRunResult>

export const defaultPodmanRunner: PodmanRunner = async (args, options) => {
  try {
    const result = await execFileAsync('podman', args, {
      timeout: options?.timeoutMs ?? 120_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, HISTFILE: '/dev/null', HISTSIZE: '0' },
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

let _runner: PodmanRunner = defaultPodmanRunner

export function setPodmanRunnerForTests(runner: PodmanRunner | null): void {
  _runner = runner ?? defaultPodmanRunner
}

export async function runPodman(
  args: string[],
  options?: { timeoutMs?: number; input?: string },
): Promise<PodmanRunResult> {
  return _runner(args, options)
}

export type PodmanInspectFn = (imageRef: string) => Promise<string | null>

export async function defaultPodmanInspectDigest(imageRef: string): Promise<string | null> {
  if (process.env['WRDESK_AGENT_SKIP_DIGEST_VERIFY'] === '1') {
    return loadExpectedDigestOptional(imageRef)
  }
  const result = await runPodman(['image', 'inspect', imageRef, '--format', '{{.Digest}}'], {
    timeoutMs: 15_000,
  })
  if (result.code !== 0) return null
  const digest = result.stdout.trim()
  return digest.length > 0 ? digest : null
}

function loadExpectedDigestOptional(imageRef: string): string | null {
  try {
    return loadExpectedDigest(imageRef)
  } catch {
    return 'sha256:skipped'
  }
}

export async function inspectContainerState(containerName: string): Promise<
  'running' | 'exited' | 'missing' | 'unknown'
> {
  const result = await runPodman(['inspect', containerName, '--format', '{{.State.Status}}'])
  if (result.code !== 0) return 'missing'
  const status = result.stdout.trim().toLowerCase()
  if (status === 'running') return 'running'
  if (status === 'exited' || status === 'stopped') return 'exited'
  return 'unknown'
}

export async function probeContainerHealthExec(
  containerName: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000))
  const script =
    `wget -qO- --timeout=${timeoutSec} http://127.0.0.1:${port}/health >/dev/null 2>&1 || ` +
    `curl -sf --max-time ${timeoutSec} http://127.0.0.1:${port}/health >/dev/null 2>&1`
  const result = await runPodman(['exec', containerName, 'sh', '-c', script], { timeoutMs: timeoutMs + 2000 })
  return result.code === 0
}

export async function probeIngestorHealthHost(port = 18100, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function restartContainer(containerName: string): Promise<boolean> {
  const kill = await runPodman(['kill', '--signal', 'SIGKILL', containerName])
  if (kill.code !== 0 && !kill.stderr.includes('no such container')) {
    return false
  }
  const start = await runPodman(['start', containerName])
  return start.code === 0
}

export async function stopAndRemovePod(podName: string): Promise<void> {
  await runPodman(['pod', 'stop', '--time', '10', podName], { timeoutMs: 30_000 })
  await runPodman(['pod', 'rm', '-f', podName], { timeoutMs: 30_000 })
}
