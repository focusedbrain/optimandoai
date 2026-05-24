/**
 * Local pod lifecycle manager — Phase 1, P1.8.
 *
 * startLocalPod() — called after vault unlock (same callsite as
 *   validatorOrchestrator.start).  Linux-only; no-op on other platforms.
 *   Errors are caught and logged; they never crash the app.  The existing
 *   in-process validation path (validatorOrchestrator) keeps running in
 *   parallel; the pod-client (P1.9) will route calls through the pod.
 *
 * stopLocalPod()  — called on vault-lock and app-quit.  Runs `podman pod
 *   stop && podman pod rm`.  Safe to call when no pod is running.
 *
 * Platform guard: startLocalPod() checks process.platform === 'linux' (or
 *   options.platform in tests) and logs a clear message before returning when
 *   not on Linux.  Phase 2 adds Windows/macOS support.
 *
 * Module state: _activePod and _startPromise are module-level so that
 *   concurrent calls to startLocalPod() join the same Promise.  Tests call
 *   _resetStateForTest() in afterEach to isolate state.
 */

import { generatePodAuthSecret, deriveSealKeyHex } from './secrets.js'
import { applyPodManifest, type ActivePod, type PodRunnerOptions } from './podRunner.js'

// ── Module-level state ─────────────────────────────────────────────────────────

let _activePod: ActivePod | null = null
let _startPromise: Promise<void> | null = null

// ── Public API ─────────────────────────────────────────────────────────────────

export interface LocalPodOptions extends PodRunnerOptions {
  /**
   * Override the platform string used for the Linux guard.
   * Defaults to process.platform.  Tests pass 'linux' or 'win32' explicitly.
   */
  platform?: NodeJS.Platform | string
}

/**
 * Start the BEAP local pod (Linux only).
 *
 * - On non-Linux platforms: logs a message and returns immediately.
 * - If the pod is already running: no-op.
 * - If a start is already in progress: joins that Promise.
 * - Errors are caught internally and logged — never propagated.
 *
 * @param vault   Vault service instance (must be unlocked; provides seal key).
 * @param options Override manifest path, pod name, platform, or executor (tests).
 */
export async function startLocalPod(
  vault: { deriveApplicationKey(info: string): Buffer | null },
  options?: LocalPodOptions,
): Promise<void> {
  const platform = options?.platform ?? process.platform

  if (platform !== 'linux') {
    console.log(
      `[LOCAL_POD] local pod only supported on Linux in Phase 1 — skipping on ${platform}`,
    )
    return
  }

  if (_activePod) {
    console.log('[LOCAL_POD] pod already running — skipping start')
    return
  }

  if (_startPromise) {
    // A start is in flight — join it rather than forking a second pod.
    return _startPromise
  }

  _startPromise = _doStart(vault, options).finally(() => {
    _startPromise = null
  })

  return _startPromise
}

/**
 * Stop the BEAP local pod.
 *
 * Called on vault-lock and app-quit.  Safe when no pod is running.
 * Errors are logged and not rethrown.
 */
export async function stopLocalPod(): Promise<void> {
  if (!_activePod) return

  const pod = _activePod
  _activePod = null

  console.log(`[LOCAL_POD] Stopping pod: ${pod.podName}`)
  try {
    await pod.stop()
    console.log('[LOCAL_POD] Pod stopped and removed')
  } catch (err) {
    console.error('[LOCAL_POD] Error stopping pod:', (err as Error).message ?? err)
  }
}

/** For tests — resets module-level singleton state between test cases. */
export function _resetStateForTest(): void {
  _activePod = null
  _startPromise = null
}

// ── Internal ───────────────────────────────────────────────────────────────────

async function _doStart(
  vault: { deriveApplicationKey(info: string): Buffer | null },
  options?: LocalPodOptions,
): Promise<void> {
  const podAuthSecret = generatePodAuthSecret()
  const sealKeyHex = deriveSealKeyHex(vault)

  if (!sealKeyHex) {
    console.error(
      '[LOCAL_POD] Vault is locked — cannot derive seal key; pod not started',
    )
    return
  }

  console.log('[LOCAL_POD] Starting pod...')
  try {
    // Extract only the PodRunnerOptions subset from LocalPodOptions
    const runnerOpts: PodRunnerOptions = {
      manifestPath: options?.manifestPath,
      podName: options?.podName,
      executor: options?.executor,
    }
    _activePod = await applyPodManifest(podAuthSecret, sealKeyHex, runnerOpts)
    console.log(`[LOCAL_POD] Pod started: ${_activePod.podName}`)
  } catch (err) {
    // Non-fatal: in-process validation path continues to work.
    console.error(
      '[LOCAL_POD] Failed to start pod:',
      (err as Error).message ?? err,
    )
    _activePod = null
  }
}
