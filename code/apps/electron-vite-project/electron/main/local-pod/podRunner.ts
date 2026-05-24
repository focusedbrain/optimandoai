/**
 * Pod runner — Phase 1, P1.8.
 *
 * Applies the BEAP pod manifest via `podman play kube` and manages the pod
 * lifecycle (stop + remove on teardown).
 *
 * Secret injection strategy:
 *   The manifest template contains ${POD_AUTH_SECRET} and ${SEAL_KEY_HEX} as
 *   plaintext placeholders.  This module performs a safe in-memory string
 *   substitution, writes the result to a mode-0600 temp file, calls podman,
 *   then immediately deletes the temp file.  Secrets never appear in argv or
 *   in the environment passed to the podman subprocess.
 *
 * Design constraints:
 *   - No secrets in subprocess argv (they go in the manifest file, briefly).
 *   - Temp manifest deleted regardless of podman exit code.
 *   - executor is injectable for unit tests (default: real podman).
 *   - manifestPath is injectable for unit tests (default: process.cwd() relative).
 */

import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Injectable podman executor.  Receives the args array and the process
 * environment.  Returns a Promise that resolves on success or rejects with
 * an Error on non-zero exit.
 *
 * The default implementation wraps `execFileAsync('podman', args, { env })`.
 * Tests substitute a vi.fn() that captures calls without spawning a process.
 */
export type PodmanExecutor = (args: string[], env: NodeJS.ProcessEnv) => Promise<void>

export interface PodRunnerOptions {
  /** Path to the pod.yaml manifest template (default: see resolveManifestPath). */
  manifestPath?: string
  /** Pod name used for stop / rm commands (default: 'beap-pod'). */
  podName?: string
  /** Injectable podman executor — for tests. */
  executor?: PodmanExecutor
}

export interface ActivePod {
  readonly podName: string
  stop(): Promise<void>
}

export const DEFAULT_POD_NAME = 'beap-pod'

// 60 s: generous for image pull on first run; subsequent starts are faster.
const PODMAN_TIMEOUT_MS = 60_000

// ── Default executor ───────────────────────────────────────────────────────────

const defaultExecutor: PodmanExecutor = async (args, env) => {
  const result = await execFileAsync('podman', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    timeout: PODMAN_TIMEOUT_MS,
  })
  // execFileAsync rejects on non-zero exit; log stdout/stderr on success for diagnostics.
  if (result.stdout) console.log(`[LOCAL_POD] podman ${args[0]}: ${result.stdout.trim()}`)
  if (result.stderr) console.warn(`[LOCAL_POD] podman ${args[0]} stderr: ${result.stderr.trim()}`)
}

// ── Manifest path resolution ───────────────────────────────────────────────────

/**
 * Resolve the default manifest path.
 *
 * In development (Electron started from the repo root):
 *   process.cwd() = repo root → packages/beap-pod/pod.yaml
 *
 * In production (packaged Electron):
 *   BEAP_POD_MANIFEST env var must be set, or pass manifestPath in options.
 *
 * Phase 1 note: local pod is Linux-only and primarily a dev-machine feature.
 * Packaging for production is deferred to Phase 2.
 */
export function resolveManifestPath(override?: string): string {
  if (override) return override
  if (process.env['BEAP_POD_MANIFEST']) return process.env['BEAP_POD_MANIFEST']
  return join(process.cwd(), 'packages', 'beap-pod', 'pod.yaml')
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Apply the BEAP pod manifest via `podman play kube`.
 *
 * Steps:
 *   1. Read the manifest template.
 *   2. Substitute ${POD_AUTH_SECRET} and ${SEAL_KEY_HEX}.
 *   3. Write substituted YAML to a mode-0600 temp file.
 *   4. Run `podman play kube <tmpFile>`.
 *   5. Delete the temp file (always — even on error).
 *   6. Return an ActivePod handle whose stop() runs pod stop + rm.
 */
export async function applyPodManifest(
  podAuthSecret: string,
  sealKeyHex: string,
  options?: PodRunnerOptions,
): Promise<ActivePod> {
  const podName = options?.podName ?? DEFAULT_POD_NAME
  const manifestPath = resolveManifestPath(options?.manifestPath)
  const executor = options?.executor ?? defaultExecutor

  // ① Read manifest template
  let template: string
  try {
    template = readFileSync(manifestPath, 'utf8')
  } catch (err) {
    throw new Error(
      `[LOCAL_POD] Cannot read pod manifest at ${manifestPath}: ${(err as Error).message}`,
    )
  }

  // ② Substitute secrets in-memory
  const substituted = template
    .replace(/\$\{POD_AUTH_SECRET\}/g, podAuthSecret)
    .replace(/\$\{SEAL_KEY_HEX\}/g, sealKeyHex)

  // ③ Write to mode-0600 temp file
  const tmpDir = mkdtempSync(join(tmpdir(), 'beap-pod-'))
  const tmpManifest = join(tmpDir, 'pod-applied.yaml')

  try {
    writeFileSync(tmpManifest, substituted, { mode: 0o600 })

    // ④ Apply the manifest
    await withTimeout(
      executor(['play', 'kube', tmpManifest], { ...process.env }),
      PODMAN_TIMEOUT_MS,
      `podman play kube timed out after ${PODMAN_TIMEOUT_MS / 1000}s`,
    )
  } finally {
    // ⑤ Always delete the temp manifest (secrets must not linger)
    try { unlinkSync(tmpManifest) } catch { /* already gone */ }
    try { rmdirSync(tmpDir) } catch { /* already gone */ }
  }

  // ⑥ Return handle
  return {
    podName,
    stop: () => teardownPod(podName, executor),
  }
}

/**
 * Stop and remove the pod.  Errors are logged but not rethrown — teardown
 * is always best-effort (the pod may already be stopped or removed).
 */
async function teardownPod(podName: string, executor: PodmanExecutor): Promise<void> {
  try {
    await executor(['pod', 'stop', '--time', '10', podName], { ...process.env })
    console.log(`[LOCAL_POD] pod stop ${podName}: ok`)
  } catch (err) {
    // Non-fatal: pod may already be stopped.
    console.warn(`[LOCAL_POD] pod stop ${podName}: ${(err as Error).message}`)
  }

  try {
    await executor(['pod', 'rm', podName], { ...process.env })
    console.log(`[LOCAL_POD] pod rm ${podName}: ok`)
  } catch (err) {
    console.warn(`[LOCAL_POD] pod rm ${podName}: ${(err as Error).message}`)
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
