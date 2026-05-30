/**
 * Capability ladder — selects the best available + implemented isolation
 * backend and caches the result for the process lifetime.
 *
 * Ladder (build001):
 *   Windows → try HyperV  (detected but not implemented → skip)
 *             → PodmanExec (working)
 *   Linux   → try Firecracker (detected if /dev/kvm present but not implemented → skip)
 *             → PodmanExec (working)
 *
 * The ladder will promote automatically when a higher-tier backend gains
 * implemented:true in a future build — no other code needs to change.
 *
 * Disclosure invariant: the active tier is always logged truthfully so the
 * UI/claims reflect the ACTUAL isolation level, never an aspirational one.
 */

import type { CapabilityResult, IsolationProvider } from './IsolationProvider.js'
import { HyperVProvider } from './HyperVProvider.js'
import { FirecrackerProvider } from './FirecrackerProvider.js'
import { PodmanExecProvider } from './PodmanExecProvider.js'

const LOG_PREFIX = '[ISOLATION]'

interface CandidateEntry {
  name: string
  provider: IsolationProvider
  /** Platforms this candidate applies to. Empty = all platforms. */
  platforms?: NodeJS.Platform[]
}

function buildLadder(): CandidateEntry[] {
  return [
    { name: 'HyperV',      provider: new HyperVProvider(),      platforms: ['win32'] },
    { name: 'Firecracker', provider: new FirecrackerProvider(), platforms: ['linux'] },
    { name: 'PodmanExec',  provider: new PodmanExecProvider() },
  ]
}

interface ResolvedProvider {
  provider: IsolationProvider
  cap: CapabilityResult
  name: string
}

let _singleton: ResolvedProvider | null = null

/**
 * Walk the capability ladder and return the first backend that is both
 * available and implemented. The result is cached for the process lifetime.
 *
 * Pass `forceRefresh=true` in tests to reset the cache.
 */
export async function resolveIsolationProvider(forceRefresh = false): Promise<IsolationProvider> {
  if (_singleton && !forceRefresh) {
    return _singleton.provider
  }

  const ladder = buildLadder()
  const platform = process.platform

  for (const { name, provider, platforms } of ladder) {
    // Skip candidates that don't apply to this platform.
    if (platforms && !platforms.includes(platform)) {
      continue
    }

    let cap: CapabilityResult
    try {
      cap = await provider.detectCapability()
    } catch (e) {
      console.warn(
        `${LOG_PREFIX} detectCapability threw for ${name}: ${e instanceof Error ? e.message : String(e)}`,
      )
      continue
    }

    if (!cap.available) {
      console.log(`${LOG_PREFIX} candidate=${name} available=false tier=${cap.tier} reason="${cap.details}"`)
      continue
    }

    if (!cap.implemented) {
      console.log(
        `${LOG_PREFIX} candidate=${name} available=true implemented=false tier=${cap.tier} — skipping stub. ` +
          `Reason: "${cap.details}"`,
      )
      continue
    }

    // Winner.
    console.log(
      `${LOG_PREFIX} active backend=${name} tier=${cap.tier} details="${cap.details}"`,
    )
    _singleton = { provider, cap, name }
    return provider
  }

  // No usable backend — return PodmanExecProvider anyway so the error surfaces
  // at callPipeline with a clear message rather than crashing here.
  const fallback = new PodmanExecProvider()
  const fallbackCap = await fallback.detectCapability().catch(() => ({
    available: false,
    implemented: true,
    tier: 'podman' as const,
    details: 'detectCapability threw',
  }))
  console.warn(
    `${LOG_PREFIX} no usable backend found — using PodmanExec as fallback ` +
      `(available=${fallbackCap.available}). Pipeline calls will fail until pod is ready.`,
  )
  _singleton = { provider: fallback, cap: fallbackCap, name: 'PodmanExec(fallback)' }
  return fallback
}

/** Return the cached provider without resolving (null if not yet resolved). */
export function getCachedIsolationProvider(): IsolationProvider | null {
  return _singleton?.provider ?? null
}

/**
 * Return the cached provider, or resolve synchronously by resolving with
 * the default ladder. Prefer resolveIsolationProvider() at startup; use
 * this only in call sites that cannot await.
 *
 * If nothing is cached yet this returns a fresh PodmanExecProvider without
 * running the full ladder — the disclosure log will fire when the ladder
 * runs asynchronously.
 */
export function getIsolationProviderSync(): IsolationProvider {
  if (_singleton) return _singleton.provider
  return new PodmanExecProvider()
}

/** Reset cached provider — tests only. */
export function clearIsolationProviderCacheForTest(): void {
  _singleton = null
}
