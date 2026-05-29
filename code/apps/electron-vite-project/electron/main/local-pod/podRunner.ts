/**
 * Pod runner — Phase 1, P1.8; LOCAL_VERIFY env injection — Phase 3, P3.8.
 *
 * Applies the BEAP pod manifest via `podman play kube` on any desktop host where
 * Podman is installed (Linux native; Windows/macOS via Podman Desktop).
 * lifecycle (stop + remove on teardown).
 *
 * Secret injection strategy:
 *   The manifest template contains ${POD_AUTH_SECRET} and ${SEAL_KEY_HEX} as
 *   plaintext placeholders.  LOCAL_VERIFY adds ${LOCAL_SSO_SUB},
 *   ${TRUSTED_EDGE_POD_IDS}, and __KEYCLOAK_JWKS_JSON__.  This module performs
 *   a safe in-memory string substitution, writes the result to a mode-0600 temp
 *   file, calls podman, then immediately deletes the temp file.
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

import { resolveBeapPodManifestPath } from './beapPodPaths.js'

const execFileAsync = promisify(execFile)

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Injectable podman executor.  Receives the args array and the process
 * environment.  Returns a Promise that resolves on success or rejects with
 * an Error on non-zero exit.
 */
export type PodmanExecutor = (args: string[], env: NodeJS.ProcessEnv) => Promise<void>

export interface LocalVerifyEnv {
  localSsoSub: string
  trustedEdgePodIds: string
  keycloakJwksJson: string
  /** When true, LOCAL_VERIFY accepts cert-less P2P ingest (native BEAP direct path). */
  allowDirectP2p: boolean
}

export interface PodRunnerOptions {
  /** Path to the pod.yaml manifest template (default: see resolveManifestPath). */
  manifestPath?: string
  /** Pod name used for stop / rm commands (default: 'beap-pod'). */
  podName?: string
  /** Injectable podman executor — for tests. */
  executor?: PodmanExecutor
  /** When set, substitute LOCAL_VERIFY verifier env placeholders. */
  localVerify?: LocalVerifyEnv
  /** Test seam — skip digest verify and seccomp install. */
  skipImageDigestVerify?: boolean
}

export interface ActivePod {
  readonly podName: string
  stop(): Promise<void>
}

export const DEFAULT_POD_NAME = 'beap-pod'
export const DEFAULT_LOCAL_VERIFY_POD_NAME = 'beap-pod-local-verify'

// 60 s: generous for image pull on first run; subsequent starts are faster.
const PODMAN_TIMEOUT_MS = 60_000

// ── Default executor ───────────────────────────────────────────────────────────

const defaultExecutor: PodmanExecutor = async (args, env) => {
  const result = await execFileAsync('podman', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    timeout: PODMAN_TIMEOUT_MS,
  })
  if (result.stdout) console.log(`[LOCAL_POD] podman ${args[0]}: ${result.stdout.trim()}`)
  if (result.stderr) console.warn(`[LOCAL_POD] podman ${args[0]} stderr: ${result.stderr.trim()}`)
}

// ── Manifest path resolution ───────────────────────────────────────────────────

export function resolveManifestPath(override?: string): string {
  if (override) return override
  return resolveBeapPodManifestPath('pod.yaml')
}

export function resolveLocalVerifyManifestPath(override?: string): string {
  if (override) return override
  return resolveBeapPodManifestPath('pod-local-verify.yaml')
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Apply the BEAP pod manifest via `podman play kube`.
 */
export async function applyPodManifest(
  podAuthSecret: string,
  sealKeyHex: string,
  options?: PodRunnerOptions,
): Promise<ActivePod> {
  const podName = options?.podName ?? DEFAULT_POD_NAME
  const manifestPath = options?.manifestPath ?? resolveManifestPath()
  const executor = options?.executor ?? defaultExecutor
  const localVerify = options?.localVerify

  if (!options?.skipImageDigestVerify) {
    const { verifyBeapImageDigest } = await import('./imageDigestVerify.js')
    const { installLocalPodSeccompProfiles } = await import('./installSeccompProfiles.js')
    installLocalPodSeccompProfiles()
    await verifyBeapImageDigest()
  }

  let template: string
  try {
    template = readFileSync(manifestPath, 'utf8')
  } catch (err) {
    throw new Error(
      `[LOCAL_POD] Cannot read pod manifest at ${manifestPath}: ${(err as Error).message}`,
    )
  }

  let substituted = template
    .replace(/\$\{POD_AUTH_SECRET\}/g, podAuthSecret)
    .replace(/\$\{SEAL_KEY_HEX\}/g, sealKeyHex)

  if (localVerify) {
    substituted = substituted
      .replace(/\$\{LOCAL_SSO_SUB\}/g, localVerify.localSsoSub)
      .replace(/\$\{TRUSTED_EDGE_POD_IDS\}/g, localVerify.trustedEdgePodIds)
      .replace(/__KEYCLOAK_JWKS_JSON__/g, localVerify.keycloakJwksJson)
      .replace(/\$\{LOCAL_VERIFY_ALLOW_DIRECT_P2P\}/g, localVerify.allowDirectP2p ? '1' : '0')
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'beap-pod-'))
  const tmpManifest = join(tmpDir, 'pod-applied.yaml')

  try {
    writeFileSync(tmpManifest, substituted, { mode: 0o600 })

    await withTimeout(
      executor(['play', 'kube', tmpManifest], { ...process.env }),
      PODMAN_TIMEOUT_MS,
      `podman play kube timed out after ${PODMAN_TIMEOUT_MS / 1000}s`,
    )
  } finally {
    try { unlinkSync(tmpManifest) } catch { /* already gone */ }
    try { rmdirSync(tmpDir) } catch { /* already gone */ }
  }

  return {
    podName,
    stop: () => teardownPod(podName, executor),
  }
}

async function teardownPod(podName: string, executor: PodmanExecutor): Promise<void> {
  try {
    await executor(['pod', 'stop', '--time', '10', podName], { ...process.env })
    console.log(`[LOCAL_POD] pod stop ${podName}: ok`)
  } catch (err) {
    console.warn(`[LOCAL_POD] pod stop ${podName}: ${(err as Error).message}`)
  }

  try {
    await executor(['pod', 'rm', podName], { ...process.env })
    console.log(`[LOCAL_POD] pod rm ${podName}: ok`)
  } catch (err) {
    console.warn(`[LOCAL_POD] pod rm ${podName}: ${(err as Error).message}`)
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
