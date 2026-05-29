/**
 * Relay deploy/boot preflight — refuse to serve if BEAP ingestor isolation is unavailable.
 * No desktop modal on this surface; fail closed with loud logs and non-zero exit.
 */

import type { CoordinationConfig } from './config.js'

const TAG = '[Coordination][BEAP_ISOLATION_PREFLIGHT]'

/** Forbidden in all environments — relay must never skip container-isolated validation. */
if (process.env.COORD_BEAP_ISOLATION_SKIP === '1') {
  console.error(
    `${TAG} FATAL: COORD_BEAP_ISOLATION_SKIP is set. ` +
      'Relay must validate capsules via the BEAP ingestor pod only; remove this variable.',
  )
  process.exit(1)
}

/** Production startup guard — refuse to run with TEST_MODE in production (mirrors auth.ts). */
if (process.env.COORD_TEST_MODE === '1' && process.env.NODE_ENV === 'production') {
  console.error(`${TAG} FATAL: COORD_TEST_MODE is enabled in production. Refusing to start.`)
  process.exit(1)
}

/**
 * Test-only: skip ingestor health preflight (vitest). Capsule validation still uses
 * validateRelayCapsuleViaIngestor in server.ts — never in-process validateInput.
 */
export function isRelayIsolationPreflightSkipped(): boolean {
  return process.env.COORD_TEST_MODE === '1' && process.env.NODE_ENV !== 'production'
}

export async function runRelayPodIsolationPreflight(config: CoordinationConfig): Promise<void> {
  if (isRelayIsolationPreflightSkipped()) {
    console.warn(`${TAG} SKIPPED (COORD_TEST_MODE — ingestor health preflight only; capsule path still pod-only)`)
    return
  }

  const base = config.beap_ingestor_url.replace(/\/$/, '')
  const healthUrl = `${base}/health`
  const timeoutMs = config.beap_ingestor_preflight_timeout_ms

  console.log(`${TAG} Probing ingestor isolation at ${healthUrl}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(healthUrl, { signal: controller.signal })
    if (!res.ok) {
      console.error(
        `${TAG} FATAL: BEAP ingestor health returned HTTP ${res.status}. ` +
          'Relay refuses to start without container-isolated capsule handling. ' +
          'Ensure Podman (or host runtime) has started the BEAP pod and ingestor is listening on ' +
          `${base}.`,
      )
      process.exit(1)
    }
    const body = (await res.json()) as { status?: string; role?: string }
    if (body.status !== 'ok' || body.role !== 'ingestor') {
      console.error(
        `${TAG} FATAL: Unexpected ingestor health payload: ${JSON.stringify(body)}. ` +
          'Expected role=ingestor. Refusing to start relay in non-isolated mode.',
      )
      process.exit(1)
    }
    console.log(`${TAG} OK — ingestor isolation ready (${healthUrl})`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `${TAG} FATAL: Cannot reach BEAP ingestor at ${healthUrl}: ${msg}. ` +
        'Install/start Podman on the relay host, apply packages/beap-pod/pod-relay-host.yaml ' +
        '(podman play kube), then restart coordination-service. ' +
        'Do not bundle Podman inside the coordination image.',
    )
    process.exit(1)
  } finally {
    clearTimeout(timer)
  }
}
