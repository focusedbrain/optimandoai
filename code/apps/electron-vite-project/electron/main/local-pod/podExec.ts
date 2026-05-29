/**
 * Central Podman CLI resolution — same binary the setup probe uses.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { resolvePodmanBin, clearPodmanBinCacheForTest } from './podmanDetect.js'

const execFileAsync = promisify(execFile)

let _cachedCli: string | null = null

export async function resolvePodmanCli(): Promise<string> {
  if (_cachedCli) return _cachedCli
  const bin = await resolvePodmanBin(process.platform)
  if (!bin) {
    throw new Error('podman_cli_unavailable')
  }
  _cachedCli = bin
  return bin
}

export function clearPodmanCliCacheForTest(): void {
  _cachedCli = null
  clearPodmanBinCacheForTest()
}

export interface PodmanCliResult {
  code: number
  stdout: string
  stderr: string
}

export async function runPodmanCli(
  args: string[],
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<PodmanCliResult> {
  const bin = await resolvePodmanCli()
  try {
    const result = await execFileAsync(bin, args, {
      timeout: options?.timeoutMs ?? 30_000,
      windowsHide: true,
      env: options?.env ?? process.env,
    })
    return {
      code: 0,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? e.message ?? ''),
    }
  }
}

/** Build a PodmanExecutor compatible with podRunner injectable tests. */
export function createPodmanExecutor(defaultTimeoutMs = 60_000) {
  return async (args: string[], env: NodeJS.ProcessEnv): Promise<void> => {
    const result = await runPodmanCli(args, { timeoutMs: defaultTimeoutMs, env })
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`
      throw new Error(`Command failed: podman ${args.join(' ')}\n${detail}`)
    }
    if (result.stdout.trim()) {
      console.log(`[LOCAL_POD] podman ${args[0]}: ${result.stdout.trim()}`)
    }
    if (result.stderr.trim()) {
      console.warn(`[LOCAL_POD] podman ${args[0]} stderr: ${result.stderr.trim()}`)
    }
  }
}
